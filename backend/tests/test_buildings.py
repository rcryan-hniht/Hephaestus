import hashlib
import io
import time

from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app

SVG = b'<svg viewBox="0 0 100 100"><g class="Wall"><rect x="0" y="0" width="40" height="4"/></g></svg>'


def png():
    out = io.BytesIO()
    Image.new("RGB", (20, 10), "white").save(out, format="PNG")
    return out.getvalue()


def finish_floor(client, job, height=3):
    for _ in range(200):
        job = client.get("/api/jobs/" + job["id"]).json()
        if job["state"] == "needs_information":
            break
        time.sleep(0.02)
    r = client.post(
        "/api/jobs/" + job["id"] + "/answers",
        json={
            "generation": job["generation"],
            "values": {"meters_per_unit": 0.1, "floor_height": height, "slab_thickness": 0.2},
        },
    )
    assert r.status_code == 202, r.text
    for _ in range(200):
        job = client.get("/api/jobs/" + job["id"]).json()
        if job["state"] == "ready":
            return job
        time.sleep(0.02)
    assert False, job


def test_one_batch_retains_both_floors_and_publishes_wall_geometry_after_confirmation(tmp_path):
    settings = Settings(data_dir=tmp_path, inference_engine="openrouter")
    with TestClient(create_app(settings)) as client:
        r = client.post(
            "/api/buildings",
            files=[
                ("files", ("F2.svg", SVG)),
                ("files", ("F1_scaled.png", png())),
                ("files", ("F1.svg", SVG)),
            ],
        )
        assert r.status_code == 202, r.text
        building = r.json()
        bid = building["id"]
        assert [f["number"] for f in building["floors"]] == [1, 2]
        assert all(f["job"]["source_kind"] == "svg" for f in building["floors"])
        assert len(building["floors"][0]["sources"]) == 2
        assert (
            building["floors"][0]["sources"][0]["source_hash"] == hashlib.sha256(png()).hexdigest()
        )
        assert client.get(f"/api/buildings/{bid}/scene").status_code == 409
        finish_floor(client, building["floors"][0]["job"], 3)
        finish_floor(client, building["floors"][1]["job"], 2.8)
        assert client.get(f"/api/buildings/{bid}/scene").status_code == 409
        r = client.post(
            f"/api/buildings/{bid}/alignment",
            json={
                "generation": building["generation"],
                "offsets": [{"number": 1, "x": 0, "y": 0}, {"number": 2, "x": 1, "y": 0.5}],
            },
        )
        assert r.status_code == 200, r.text
        scene = client.get(f"/api/buildings/{bid}/scene").json()
        assert scene["schema_version"] == "hephaestus.building.v1"
        assert [c["floor"] for c in scene["components"]] == [0, 1]
        assert [c["type"] for c in scene["components"]] == ["wall", "wall"]
        assert scene["components"][1]["elevation"] == 3
        assert scene["components"][1]["mesh"]["positions"][1] >= 3
        assert scene["floors"][1]["transform"] == [1, 3, -0.5]
        assert scene["floors"][0]["scene"]["components"][0]["elevation"] == 0
        source = client.get(f"/api/buildings/{bid}/floors/1/sources/0")
        assert source.content == png()
        original = scene
    with TestClient(create_app(settings)) as client:
        assert client.get(f"/api/buildings/{bid}").json()["state"] == "ready"
        assert client.get(f"/api/buildings/{bid}/scene").json() == original
        building = client.get(f"/api/buildings/{bid}").json()
        second = building["floors"][1]["job"]
        client.post(
            "/api/jobs/" + second["id"] + "/cancel", json={"generation": second["generation"]}
        )
        assert client.get(f"/api/buildings/{bid}").json()["state"] == "cancelled"
        assert client.get(f"/api/buildings/{bid}/scene").json() == original


def test_invalid_batch_is_rejected_before_any_jobs_are_created(tmp_path):
    with TestClient(
        create_app(Settings(data_dir=tmp_path, inference_engine="openrouter"))
    ) as client:
        for files in [
            [("F1.svg", SVG), ("F3.svg", SVG)],
            [("F1.svg", SVG), ("F2.png", b"bad")],
            [("F1.svg", SVG), ("F1_model.svg", SVG)],
        ]:
            r = client.post("/api/buildings", files=[("files", f) for f in files])
            assert r.status_code == 422, r.text
            assert client.app.state.jobs.store.count() == 0


def test_room_only_source_cannot_publish_a_wall_bearing_building(tmp_path):
    room = SVG.replace(b'class="Wall"', b'class="Space"')
    with TestClient(
        create_app(Settings(data_dir=tmp_path, inference_engine="openrouter"))
    ) as client:
        building = client.post("/api/buildings", files=[("files", ("F1.svg", room))]).json()
        finish_floor(client, building["floors"][0]["job"])
        result = client.post(
            "/api/buildings/" + building["id"] + "/alignment",
            json={"generation": building["generation"], "offsets": [{"number": 1, "x": 0, "y": 0}]},
        )
        assert result.status_code == 422
        assert "wall geometry" in result.json()["detail"]
        assert client.get("/api/buildings/" + building["id"] + "/scene").status_code == 409


def test_batch_capacity_is_checked_before_creating_a_child_job(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, max_jobs=1))) as client:
        result = client.post(
            "/api/buildings", files=[("files", ("F1.svg", SVG)), ("files", ("F2.svg", SVG))]
        )
        assert result.status_code == 429
        assert client.app.state.jobs.store.count() == 0
