import asyncio
import hashlib
import io
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from config import Settings
from main import create_app

SVG = b'<svg viewBox="0 0 100 100"><g class="Wall" id="Wall"><rect x="0" y="0" width="40" height="4"/></g></svg>'
PARAMS = {"meters_per_unit": 0.1, "floor_height": 3}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        yield client


def submit(client, data=SVG, name="drawing.svg"):
    r = client.post("/api/jobs", files={"file": (name, data)})
    assert r.status_code == 202, r.text
    return r.json()["id"]


def wait(
    client, job_id, states=("needs_information", "ready", "failed", "cancelled"), timeout=15.0
):
    deadline = time.time() + timeout
    job = {}
    while time.time() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        job = r.json()
        if job["state"] in states:
            return job
        time.sleep(0.05)
    pytest.fail(
        f"Job did not reach expected state within {timeout}s, current state: {job.get('state')}"
    )


def answer(client, job_id, values):
    job = client.get(f"/api/jobs/{job_id}").json()
    return client.post(
        f"/api/jobs/{job_id}/answers", json={"generation": job["generation"], "values": values}
    )


def test_upload_questions_confirm_build_export(client):
    assert client.get("/health").json() == {"status": "ok"}
    job_id = submit(client)
    job = wait(client, job_id)
    assert job["state"] == "needs_information"
    assert {q["key"] for q in job["questions"]} == {"meters_per_unit", "floor_height"}
    assert client.get(f"/api/jobs/{job_id}/source").content == SVG
    assert client.get(f"/api/jobs/{job_id}/scene").status_code == 409
    assert answer(client, job_id, PARAMS).status_code == 202
    assert wait(client, job_id)["state"] == "ready"
    scene = client.get(f"/api/jobs/{job_id}/scene").json()
    assert scene["components"][0]["dimensions"]["width"] == 4
    assert scene["provenance"]["source_hash"] == hashlib.sha256(SVG).hexdigest()
    exported = client.get(f"/api/jobs/{job_id}/export")
    assert exported.json() == scene
    assert "attachment" in exported.headers["content-disposition"]


def test_unknown_values_only_offer_suggestions(client):
    job_id = submit(client)
    job = wait(client, job_id)
    r = client.post(
        f"/api/jobs/{job_id}/answers",
        json={"generation": job["generation"], "unknown": ["floor_height"]},
    )
    assert r.status_code == 202
    job = wait(client, job_id)
    assert job["state"] == "needs_information"
    assert job["suggestions"]["floor_height"]["provenance"] == "suggested"
    assert "floor_height" not in job["parameters"]
    assert answer(client, job_id, {"meters_per_unit": 0.1}).status_code == 202
    job = wait(client, job_id)
    assert [q["key"] for q in job["questions"]] == ["floor_height"]


def test_invalid_edit_preserves_valid_model_and_undo_redo(client):
    job_id = submit(client)
    wait(client, job_id)
    answer(client, job_id, PARAMS)
    wait(client, job_id)
    scene1 = client.get(f"/api/jobs/{job_id}/scene").json()
    assert answer(client, job_id, {"floor_height": -2}).status_code == 422
    assert client.get(f"/api/jobs/{job_id}/scene").json() == scene1
    answer(client, job_id, {"floor_height": 4})
    assert wait(client, job_id)["state"] == "ready"
    assert client.get(f"/api/jobs/{job_id}/scene").json()["components"][0]["height"] == 4
    for action, expected in [("undo", 3), ("redo", 4)]:
        j = client.get(f"/api/jobs/{job_id}").json()
        r = client.post(f"/api/jobs/{job_id}/{action}", json={"generation": j["generation"]})
        assert r.status_code == 200
        assert client.get(f"/api/jobs/{job_id}/scene").json()["components"][0]["height"] == expected


def test_cancel_retry_and_stale_answers(client):
    job_id = submit(client)
    j = wait(client, job_id)
    assert (
        client.post(f"/api/jobs/{job_id}/cancel", json={"generation": j["generation"]}).status_code
        == 200
    )
    assert answer(client, job_id, PARAMS).status_code == 409
    assert client.get(f"/api/jobs/{job_id}/source").content == SVG
    cancelled = client.get(f"/api/jobs/{job_id}").json()
    assert (
        client.post(
            f"/api/jobs/{job_id}/retry", json={"generation": cancelled["generation"]}
        ).status_code
        == 202
    )
    wait(client, job_id)
    assert (
        client.post(
            f"/api/jobs/{job_id}/answers", json={"generation": j["generation"], "values": PARAMS}
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "name,data", [("bad.png", b"not png"), ("bad.jpg", b"no"), ("bad.svg", b"<svg><script/></svg>")]
)
def test_invalid_inputs_are_rejected(client, name, data):
    assert client.post("/api/jobs", files={"file": (name, data)}).status_code == 422


def test_valid_jpg_upload_accepted(client):
    out = io.BytesIO()
    Image.new("RGB", (30, 20), "white").save(out, format="JPEG")
    r = client.post("/api/jobs", files={"file": ("drawing.jpg", out.getvalue())})
    assert r.status_code == 202
    assert r.json()["source_kind"] == "png"


def test_export_blend_rejects_invalid_data(client):
    assert client.post("/api/export/blend", content=b"").status_code == 422
    assert client.post("/api/export/blend", content=b"not-a-glb").status_code == 422


def test_export_blend_converts_glb(client):
    glb_path = Path(__file__).resolve().parent.parent.parent / "assets" / "F1_original-png.glb"
    if glb_path.exists():
        with open(glb_path, "rb") as f:
            glb_data = f.read()
        res = client.post("/api/export/blend", content=glb_data)
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/x-blender"
        assert len(res.content) > 1000


def test_png_offline_import_requires_binding_and_review(tmp_path):
    with TestClient(
        create_app(Settings(data_dir=tmp_path, inference_engine="openrouter"))
    ) as client:
        out = io.BytesIO()
        Image.new("RGB", (30, 20)).save(out, format="PNG")
        data = out.getvalue()
        job_id = submit(client, data, "plan.png")
        j = wait(client, job_id)
        assert j["state"] == "failed"
        assert j["error"]["code"] == "missing_credentials"
        p = {
            "job_id": job_id,
            "source_hash": hashlib.sha256(data).hexdigest(),
            "source_kind": "png",
            "coordinate_frame": {"width": 30, "height": 20, "unit": "pixel"},
            "components": [
                {"id": "wall", "type": "wall", "polygon": [[0, 0], [20, 0], [20, 2], [0, 2]]}
            ],
        }
        path = f"/api/jobs/{job_id}/proposal"
        wrong = {**p, "source_hash": "b" * 64}
        assert (
            client.post(path, json={"generation": j["generation"], "proposal": wrong}).status_code
            == 422
        )
        assert (
            client.post(path, json={"generation": j["generation"], "proposal": p}).status_code
            == 202
        )
        j = wait(client, job_id)
        assert "review_confirmed" in [q["key"] for q in j["questions"]]
        answer(client, job_id, PARAMS)
        assert wait(client, job_id)["state"] == "needs_information"
        answer(client, job_id, {"review_confirmed": True})
        assert wait(client, job_id)["state"] == "ready"


def test_png_cubicasa_vectorization(tmp_path, monkeypatch):
    import vectorizer
    from contracts import Proposal

    def fixture_extract(data, job_id, source_hash, **settings):
        return Proposal(
            job_id=job_id,
            source_hash=source_hash,
            source_kind="png",
            coordinate_frame={"width": 64, "height": 64, "unit": "pixel"},
            components=[
                {
                    "id": job_id + ":f0:wall",
                    "type": "wall",
                    "polygon": [[1, 1], [50, 1], [50, 4], [1, 4]],
                }
            ],
        )

    monkeypatch.setattr(vectorizer, "vectorize_floorplan", fixture_extract)
    with TestClient(create_app(Settings(data_dir=tmp_path, inference_engine="cubicasa"))) as client:
        out = io.BytesIO()
        Image.new("RGB", (64, 64), "white").save(out, format="PNG")
        data = out.getvalue()
        job_id = submit(client, data, "test_floorplan.png")
        j = wait(client, job_id, states=("needs_information", "ready"), timeout=30.0)
        assert j["state"] == "needs_information"
        assert "meters_per_unit" in [q["key"] for q in j["questions"]]
        assert "floor_height" in [q["key"] for q in j["questions"]]
        assert answer(client, job_id, {**PARAMS, "review_confirmed": True}).status_code == 202
        ready_job = wait(client, job_id, states=("ready",), timeout=30.0)
        assert ready_job["state"] == "ready"
        scene = client.get(f"/api/jobs/{job_id}/scene").json()
        assert len(scene["components"]) >= 1
        assert "positions" in scene["components"][0]["mesh"]


def test_jobs_survive_restart(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings)) as c:
        job_id = submit(c)
        wait(c, job_id)
        answer(c, job_id, PARAMS)
        assert wait(c, job_id)["state"] == "ready"
    with TestClient(create_app(settings)) as c:
        assert c.get(f"/api/jobs/{job_id}").json()["state"] == "ready"
        assert c.get(f"/api/jobs/{job_id}/scene").json()["components"][0]["height"] == 3


def test_late_inference_cannot_replace_cancelled_job(tmp_path):
    class SlowInference:
        async def extract(self, *args):
            await asyncio.sleep(0.15)
            raise ValueError("Late failure")

    with TestClient(create_app(Settings(data_dir=tmp_path), inference=SlowInference())) as c:
        out = io.BytesIO()
        Image.new("RGB", (20, 20)).save(out, format="PNG")
        job_id = submit(c, out.getvalue(), "p.png")
        j = wait(c, job_id, states=("awaiting_ai_result",))
        c.post(f"/api/jobs/{job_id}/cancel", json={"generation": j["generation"]})
        time.sleep(0.2)
        assert c.get(f"/api/jobs/{job_id}").json()["state"] == "cancelled"


def test_request_limit_applies_before_upload_parser(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, max_upload_bytes=64))) as c:
        assert (
            c.post(
                "/api/jobs",
                content=b"x" * 200,
                headers={"content-type": "application/octet-stream"},
            ).status_code
            == 413
        )


def test_pending_limit_and_private_artifacts(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, max_jobs=1))) as c:
        job_id = submit(c)
        wait(c, job_id)
        assert c.post("/api/jobs", files={"file": ("drawing.svg", SVG)}).status_code == 429
    assert (tmp_path / job_id / "source.svg").stat().st_mode & 0o077 == 0


def test_component_correction_is_saved_and_rebuilt(client):
    job_id = submit(client)
    job = wait(client, job_id)
    proposal = client.get(f"/api/jobs/{job_id}/proposal").json()["proposal"]
    component_id = proposal["components"][0]["id"]
    r = client.post(
        f"/api/jobs/{job_id}/answers",
        json={
            "generation": job["generation"],
            "values": PARAMS,
            "component_values": {component_id: {"height": 2.6}},
        },
    )
    assert r.status_code == 202
    assert wait(client, job_id)["state"] == "ready"
    assert client.get(f"/api/jobs/{job_id}/scene").json()["components"][0]["height"] == 2.6


def test_semantic_svg_failure_retains_the_original_drawing(client):
    drawing = b'<svg viewBox="0 0 10 10"><g class="Wall"><polygon points="0,0 10,10 0,10 10,0"/></g></svg>'
    job_id = submit(client, drawing)
    job = wait(client, job_id)
    assert job["state"] == "failed"
    assert job["error"]["code"] == "validation_failed"
    assert client.get(f"/api/jobs/{job_id}/source").content == drawing


def test_retyped_component_does_not_inherit_prior_overrides(client):
    job_id = submit(client)
    j = wait(client, job_id)
    p = client.get(f"/api/jobs/{job_id}/proposal").json()["proposal"]
    cid = p["components"][0]["id"]
    client.post(
        f"/api/jobs/{job_id}/answers",
        json={
            "generation": j["generation"],
            "values": PARAMS,
            "component_values": {cid: {"elevation": 1}},
        },
    )
    wait(client, job_id)
    p["components"][0]["type"] = "column"
    j = client.get(f"/api/jobs/{job_id}").json()
    r = client.post(
        f"/api/jobs/{job_id}/proposal", json={"generation": j["generation"], "proposal": p}
    )
    assert r.status_code == 202
    assert wait(client, job_id)["state"] == "ready"
    assert client.get(f"/api/jobs/{job_id}/scene").json()["components"][0]["elevation"] == 0


def test_geometry_and_height_correction_are_applied_in_one_revision(client):
    job_id = submit(client)
    wait(client, job_id)
    answer(client, job_id, PARAMS)
    wait(client, job_id)
    data = client.get(f"/api/jobs/{job_id}/proposal").json()
    p = data["proposal"]
    component_id = p["components"][0]["id"]
    p["components"][0]["polygon"] = [[x + 10, y] for x, y in p["components"][0]["polygon"]]
    r = client.post(
        f"/api/jobs/{job_id}/proposal",
        json={
            "generation": data["generation"],
            "proposal": p,
            "component_values": {component_id: {"height": 4}},
        },
    )
    assert r.status_code == 202
    assert wait(client, job_id)["state"] == "ready"
    scene = client.get(f"/api/jobs/{job_id}/scene").json()
    assert scene["revision"] == 2
    assert scene["components"][0]["height"] == 4
    assert scene["components"][0]["polygon"][0][0] == 1
    bad = client.post(
        f"/api/jobs/{job_id}/proposal",
        json={
            "generation": client.get(f"/api/jobs/{job_id}").json()["generation"],
            "proposal": p,
            "component_values": {component_id: {"height": -4}},
        },
    )
    assert bad.status_code == 422
    assert client.get(f"/api/jobs/{job_id}/scene").json() == scene


def test_jpeg_dimensions_are_bounded_before_canvas_allocation(tmp_path, monkeypatch):
    out = io.BytesIO()
    Image.new("RGB", (20, 20)).save(out, format="JPEG")

    def unexpected_allocation(*args, **kwargs):
        raise AssertionError("Decoded-limit check must happen before allocation")

    monkeypatch.setattr(Image, "new", unexpected_allocation)
    with TestClient(create_app(Settings(data_dir=tmp_path, max_image_pixels=100))) as c:
        r = c.post("/api/jobs", files={"file": ("drawing.jpg", out.getvalue())})
        assert r.status_code == 422
        assert "decoded image limits" in r.json()["detail"]
        assert c.app.state.jobs.store.count() == 0


def test_jpeg_normalization_cannot_exceed_stored_source_limit(tmp_path):
    import random

    image = Image.frombytes("RGB", (64, 64), random.Random(42).randbytes(64 * 64 * 3))
    jpeg = io.BytesIO()
    image.save(jpeg, format="JPEG", quality=80)
    assert len(jpeg.getvalue()) < 10000
    with TestClient(create_app(Settings(data_dir=tmp_path, max_upload_bytes=10000))) as c:
        r = c.post("/api/jobs", files={"file": ("drawing.jpg", jpeg.getvalue())})
        assert r.status_code == 422
        assert "Normalized image exceeds" in r.json()["detail"]
        assert c.app.state.jobs.store.count() == 0
