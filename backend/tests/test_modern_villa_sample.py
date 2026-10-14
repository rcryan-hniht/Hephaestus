"""Keep the downloadable three-storey villa input compatible with the real job API."""

import json
import math
import time
from pathlib import Path

from fastapi.testclient import TestClient
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from app.config import Settings
from app.main import create_app


def test_modern_villa_inputs_build_setback_storeys_terraces_and_a_rooftop_canopy(tmp_path):
    folder = Path(__file__).parent / "fixtures" / "modern_villa"
    paths = [folder / f"F{number}.svg" for number in range(1, 5)]
    assert all(path.is_file() for path in paths), "The four uploadable villa drawings are missing"
    preset_path = Path(__file__).resolve().parents[2] / "frontend/src/villa-preset.json"
    assert preset_path.is_file(), "Villa preset parameters are missing"
    preset = json.loads(preset_path.read_text())
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        response = client.post(
            "/api/buildings",
            files=[("files", (path.name, path.read_bytes(), "image/svg+xml")) for path in paths],
        )
        assert response.status_code == 202, response.text
        building = response.json()
        assert [floor["number"] for floor in building["floors"]] == [1, 2, 3, 4]
        for floor, configuration in zip(building["floors"], preset["floors"], strict=True):
            job_id = floor["job"]["id"]
            for _ in range(200):
                job = client.get(f"/api/jobs/{job_id}").json()
                if job["state"] in {"needs_information", "failed"}:
                    break
                time.sleep(0.02)
            assert job["state"] == "needs_information", job
            assert "meters_per_unit" in {question["key"] for question in job["questions"]}
            assert job["source_hash"] == configuration["source_hash"]
            proposal = client.get(f"/api/jobs/{job_id}/proposal").json()["proposal"]
            overrides = {
                component["id"]: configuration["components"][component["source"]["element_id"]]
                for component in proposal["components"]
                if component["source"]["element_id"] in configuration["components"]
            }
            response = client.post(
                f"/api/jobs/{job_id}/answers",
                json={"generation": job["generation"], "values": configuration["parameters"],
                      "component_values": overrides},
            )
            assert response.status_code == 202, response.text
            for _ in range(200):
                job = client.get(f"/api/jobs/{job_id}").json()
                if job["state"] in {"ready", "failed"}:
                    break
                time.sleep(0.02)
            assert job["state"] == "ready", job
        response = client.post(
            f"/api/buildings/{building['id']}/alignment",
            json={"generation": building["generation"], "offsets": [
                {"number": number, "x": 0, "y": 0} for number in range(1, 5)
            ]},
        )
        assert response.status_code == 200, response.text
        scene = client.get(f"/api/buildings/{building['id']}/scene").json()
        assert [floor["transform"][1] for floor in scene["floors"]] == [0, 3.6, 6.9, 10.2]
        walls = [component for component in scene["components"] if component["type"] == "wall"]
        assert {wall["source_floor"] for wall in walls} == {1, 2, 3, 4}
        assert {round(wall["height"], 2) for wall in walls if wall["source_floor"] == 4} == {1.1, 2.85}
        canopy = next(c for c in scene["components"] if c["source"]["element_id"] == "F4-canopy")
        assert math.isclose(canopy["elevation"] + canopy["height"], 13.2)
        assert math.isclose(canopy["height"], 0.15)
        widths = []
        for number in range(1, 5):
            exterior = [c for c in walls if c["source_floor"] == number and "Facade" in c["label"]]
            x = [p[0] for c in exterior for p in c["polygon"]]
            widths.append(round(max(x) - min(x), 2))
        assert widths == [8.8, 8.5, 7.2, 3.6]
        for number in (2, 3, 4):
            slabs = unary_union([
                Polygon(c["polygon"]) for c in scene["components"]
                if c["source_floor"] == number and c["type"] == "room"
                and c["source"]["element_id"] != "F4-canopy"
            ])
            assert slabs.intersection(box(6.7, -10.9, 8.7, -8.4)).area < 1e-8
            if number == 2:
                assert slabs.intersection(box(5.6, -14.4, 8.6, -11.4)).area < 1e-8
        assert any(component["type"] == "window" for component in scene["components"])
        xs = [value for wall in walls for value in wall["mesh"]["positions"][0::3]]
        zs = [value for wall in walls for value in wall["mesh"]["positions"][2::3]]
        assert math.isclose(max(xs) - min(xs), 10, abs_tol=1e-8)
        assert math.isclose(max(zs) - min(zs), 14, abs_tol=1e-8)
