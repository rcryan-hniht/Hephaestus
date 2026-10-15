"""Synthetic villa inputs must use the same confirmed reconstruction API as Villa V2."""

import hashlib
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import LineString, Polygon
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
                        name in c["source"]["element_id"]
                        for name in ["rear-room", "living-room", "-hall", "-landing"]
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
                    and abs(
                        component["elevation"]
                        + component["height"]
                        - scene["floors"][floor]["transform"][1]
                    )
                    < 1e-7
                ):
                    assert footprint.intersection(Polygon(component["polygon"])).area < 1e-7, (
                        "Keep stair flights clear of walls and upper slabs"
                    )
            assert max(stair["mesh"]["positions"][1::3]) == pytest.approx(
                scene["floors"][floor]["transform"][1]
            )
        assert roofs
        if preset_id == "terrace":
            assert len(roofs) == 1, (
                "The Terrace roof must have one continuous plane without overlapping panels"
            )
            roof = roofs[0]
            assert max(roof["mesh"]["positions"][1::3]) == pytest.approx(10.2)
            footprint = Polygon(roof["polygon"])
            for wall in scene["components"]:
                if (
                    wall["source_floor"] != 3
                    or wall["type"] != "wall"
                    or "parapet" in wall["source"]["element_id"]
                ):
                    continue
                assert wall["roof_id"] == roof["id"]
                assert footprint.covers(Polygon(wall["polygon"]))
                positions = wall["mesh"]["positions"]
                for y, z in zip(positions[1::3], positions[2::3], strict=True):
                    underside = 9.75 + 0.3 * (-z - 8.5) / 8.9
                    assert y <= underside + 1e-7, "No upper wall may protrude through the roof"
            ground = [c for c in scene["components"] if c["source_floor"] == 1]
            window = next(c for c in ground if c["source"]["element_id"] == "F1-front-window-9")
            assert window["type"] == "window" and window["opening"]
            assert Polygon(window["polygon"]).bounds == pytest.approx((8.7, -8.7, 13.6, -8.5))
            assert (window["height"], window["elevation"]) == pytest.approx((2.55, 0.15))
            assert not any(
                c["source"]["element_id"] == "F1-garden-retaining-wall-10" for c in ground
            )
            connection = LineString([(7.5, -11.5), (8.5, -11.5)])
            ground_slabs = unary_union(
                [Polygon(c["polygon"]) for c in ground if c["type"] == "room"]
            )
            ground_walls = unary_union(
                [Polygon(c["polygon"]) for c in ground if c["type"] == "wall"]
            )
            assert ground_slabs.covers(connection), (
                "The left room must share a continuous ground floor"
            )
            assert connection.intersection(ground_walls).length < 1e-7, (
                "Remove the shared partition"
            )
            assert (
                ground_walls.intersection(
                    Polygon([(3.2, -9.5), (7.8, -9.5), (7.8, -17), (3.2, -17)])
                ).area
                < 1e-7
            )
            entry = next(c for c in ground if c["source"]["element_id"] == "F1-left-front-door")
            assert entry["type"] == "door" and entry["opening"]
            assert Polygon(entry["polygon"]).bounds == pytest.approx((3.2, -9.4, 7.7, -9.2))
            assert entry["height"] == pytest.approx(2.55)
            assert entry["elevation"] == pytest.approx(0.15)
            assert ground_walls.covers(Polygon(entry["polygon"])), (
                "The opening must cut a real facade wall"
            )
            lower = next(
                c
                for c in scene["components"]
                if c["source"]["element_id"] == "F2-balcony-parapet-26"
            )
            upper = next(
                c
                for c in scene["components"]
                if c["source"]["element_id"] == "F3-balcony-parapet-24"
            )
            assert min(p[0] for p in lower["polygon"]) == pytest.approx(
                min(p[0] for p in upper["polygon"])
            )
            assert max(p[0] for p in lower["polygon"]) == pytest.approx(
                max(p[0] for p in upper["polygon"])
            )
        if preset_id == "portal":
            assert not any(
                c["source"]["element_id"] == "F1-tall-white-frame-26" for c in scene["components"]
            )
            crown = next(
                c for c in scene["components"] if c["source"]["element_id"] == "F2-portal-crown-32"
            )
            assert Polygon(crown["polygon"]).area == pytest.approx(64.575)
            path = LineString([(9.1, -14.75), (10.8, -14.75)])
            upper = [c for c in scene["components"] if c["source_floor"] == 2]
            shared = next(c for c in upper if c["source"]["element_id"] == "F2-side-wall-27")
            assert Polygon(shared["polygon"]).bounds == pytest.approx((9.825, -16.4, 10.025, -9.34))
            assert not any(
                c["source"]["element_id"] == "F2-side-wall-34"
                or c["source"]["element_id"].startswith("F2-connecting-")
                for c in upper
            )
            left = next(c for c in upper if c["source"]["element_id"] == "F2-rear-room-4")
            right = next(c for c in upper if c["source"]["element_id"] == "F2-rear-room-9")
            assert max(p[0] for p in left["polygon"]) == pytest.approx(9.825)
            assert min(p[0] for p in right["polygon"]) == pytest.approx(10.025)
            floors = unary_union(
                [
                    Polygon(c["polygon"])
                    for c in upper
                    if c["type"] == "room" and abs(c["elevation"] + c["height"] - 4.5) < 1e-7
                ]
            )
            walls = unary_union([Polygon(c["polygon"]) for c in upper if c["type"] == "wall"])
            doors = unary_union([Polygon(c["polygon"]) for c in upper if c["type"] == "door"])
            assert floors.covers(path), "Both wings need a continuous floor connection"
            assert path.intersection(walls.difference(doors)).length < 1e-7, (
                "The shared wall must retain a connecting door"
            )
        if preset_id == "gable":
            assert roofs[0]["roof_kind"] == "gable"
            assert max(roofs[0]["mesh"]["positions"][1::3]) == pytest.approx(10.5)
            for name in ["F3-front-gable-wall-6", "F3-rear-gable-wall-3"]:
                wall = next(c for c in scene["components"] if c["source"]["element_id"] == name)
                assert wall["roof_id"]
                assert max(wall["mesh"]["positions"][1::3]) == pytest.approx(10.3)
            assert any(
                c["source"]["element_id"] == "F1-front-entry-door" and c["type"] == "door"
                for c in scene["components"]
            )
            attic_job = building["floors"][2]["job"]["id"]
            generation = client.get(f"/api/jobs/{attic_job}").json()["generation"]
            assert (
                client.post(
                    f"/api/jobs/{attic_job}/answers",
                    json={"generation": generation, "values": {"roof_thickness": 0.1}},
                ).status_code
                == 202
            )
            wait_for(client, attic_job, "ready")
            thinner_roof = client.get(f"/api/jobs/{attic_job}/scene").json()
            front = next(
                c
                for c in thinner_roof["components"]
                if c["source"]["element_id"] == "F3-front-gable-wall-6"
            )
            assert max(front["mesh"]["positions"][1::3]) == pytest.approx(3.1)
        for component in stairs + roofs:
            ys = component["mesh"]["positions"][1::3]
            assert max(ys) == pytest.approx(component["elevation"] + component["height"])
            assert component["parameters"]["height"]["provenance"] == "user_confirmed"
        elevation = 0
        for floor, config in zip(scene["floors"], preset["floors"], strict=True):
            assert floor["scene"]["source_hash"] == config["source_hash"]
            assert floor["transform"][1] == pytest.approx(elevation)
            elevation += config["parameters"]["floor_height"]
