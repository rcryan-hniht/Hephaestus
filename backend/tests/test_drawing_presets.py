"""Synthetic villa inputs must use the same confirmed reconstruction API as Villa V2."""

import hashlib
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.config import Settings
from app.main import create_app


def wait_for(client, job_id, state):
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["state"] in {state, "failed"}:
            assert job["state"] == state, job
            return job
        time.sleep(0.02)
    pytest.fail(f"Job did not reach {state}: {job}")


@pytest.mark.parametrize("preset_id,count", [("terrace", 3), ("portal", 2), ("gable", 3)])
def test_villa_drawings_require_confirmation_and_build_source_bound_floors(
    tmp_path, preset_id, count
):
    root = Path(__file__).resolve().parents[2]
    catalog = json.loads((root / "frontend/src/drawing-presets.json").read_text())
    preset = next(p for p in catalog if p["id"] == preset_id)
    files = []
    for floor in preset["floors"]:
        data = (
            root / f"backend/tests/fixtures/{preset_id}_villa/F{floor['number']}.svg"
        ).read_bytes()
        assert hashlib.sha256(data).hexdigest() == floor["source_hash"]
        files.append(("files", (f"F{floor['number']}.svg", data, "image/svg+xml")))
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        response = client.post("/api/buildings", files=files)
        assert response.status_code == 202, response.text
        building = response.json()
        assert len(building["floors"]) == count
        for floor, config in zip(building["floors"], preset["floors"], strict=True):
            job_id = floor["job"]["id"]
            job = wait_for(client, job_id, "needs_information")
            assert {q["key"] for q in job["questions"]} >= {"meters_per_unit", "floor_height"}
            assert client.get(f"/api/buildings/{building['id']}/scene").status_code != 200
            proposal = client.get(f"/api/jobs/{job_id}/proposal").json()["proposal"]
            ids = {c["source"]["element_id"] for c in proposal["components"]}
            assert set(config["components"]) <= ids
            overrides = {
                c["id"]: config["components"][c["source"]["element_id"]]
                for c in proposal["components"]
                if c["source"]["element_id"] in config["components"]
            }
            answered = client.post(
                f"/api/jobs/{job_id}/answers",
                json={
                    "generation": job["generation"],
                    "values": config["parameters"],
                    "component_values": overrides,
                },
            )
            assert answered.status_code == 202, answered.text
            wait_for(client, job_id, "ready")
        response = client.post(
            f"/api/buildings/{building['id']}/alignment",
            json={
                "generation": building["generation"],
                "offsets": [
                    {"number": f["number"], "x": f["offsetX"], "y": f["offsetY"]}
                    for f in preset["floors"]
                ],
            },
        )
        assert response.status_code == 200, response.text
        scene = client.get(f"/api/buildings/{building['id']}/scene").json()
        assert scene["schema_version"] == "hephaestus.building.v1"
        assert {c["source_floor"] for c in scene["components"] if c["type"] == "wall"} == set(
            range(1, count + 1)
        )
        assert any(c["opening"] for c in scene["components"])
        assert all(c["mesh"]["positions"] for c in scene["components"] if c["type"] == "wall")
        stairs = [c for c in scene["components"] if c["type"] == "stair"]
        roofs = [c for c in scene["components"] if c["type"] == "roof"]
        assert [c["steps"] for c in stairs] == {
            "terrace": [18, 20],
            "portal": [20],
            "gable": [19, 18],
        }[preset_id]
        assert [c["source_floor"] for c in stairs] == list(range(1, count))
        for stair in stairs:
            floor = stair["source_floor"]
            footprint = Polygon(stair["polygon"])
            rooms = unary_union(
                [
                    Polygon(c["polygon"])
                    for c in scene["components"]
                    if c["source_floor"] == floor
                    and c["type"] == "room"
                    and any(
                        name in c["source"]["element_id"] for name in ["rear-room", "living-room"]
                    )
                ]
            )
            assert rooms.convex_hull.covers(footprint), "Stairs must stay indoors"
            for component in scene["components"]:
                if (
                    component["source_floor"] == floor
                    and component["type"] == "wall"
                    or component["source_floor"] == floor + 1
                    and component["type"] == "room"
                ):
                    assert footprint.intersection(Polygon(component["polygon"])).area < 1e-7, (
                        "Keep stair flights clear of walls and upper slabs"
                    )
            assert max(stair["mesh"]["positions"][1::3]) == pytest.approx(
                scene["floors"][floor]["transform"][1]
            )
        assert roofs
        if preset_id == "gable":
            assert roofs[0]["roof_kind"] == "gable"
            assert max(roofs[0]["mesh"]["positions"][1::3]) == pytest.approx(10.5)
        for component in stairs + roofs:
            ys = component["mesh"]["positions"][1::3]
            assert max(ys) == pytest.approx(component["elevation"] + component["height"])
            assert component["parameters"]["height"]["provenance"] == "user_confirmed"
        elevation = 0
        for floor, config in zip(scene["floors"], preset["floors"], strict=True):
            assert floor["scene"]["source_hash"] == config["source_hash"]
            assert floor["transform"][1] == pytest.approx(elevation)
            elevation += config["parameters"]["floor_height"]
