"""Keep the downloadable three-storey villa input compatible with the real job API."""

import math
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_modern_villa_inputs_build_three_storeys_and_a_low_roof_terrace(tmp_path):
    folder = Path(__file__).parent / "fixtures" / "modern_villa"
    paths = [folder / f"F{number}.svg" for number in range(1, 5)]
    assert all(path.is_file() for path in paths), "The four uploadable villa drawings are missing"
    heights = [3.6, 3.3, 3.3, 1.1]
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        response = client.post(
            "/api/buildings",
            files=[("files", (path.name, path.read_bytes(), "image/svg+xml")) for path in paths],
        )
        assert response.status_code == 202, response.text
        building = response.json()
        assert [floor["number"] for floor in building["floors"]] == [1, 2, 3, 4]
        for floor, height in zip(building["floors"], heights, strict=True):
            job_id = floor["job"]["id"]
            for _ in range(200):
                job = client.get(f"/api/jobs/{job_id}").json()
                if job["state"] in {"needs_information", "failed"}:
                    break
                time.sleep(0.02)
            assert job["state"] == "needs_information", job
            assert "meters_per_unit" in {question["key"] for question in job["questions"]}
            response = client.post(
                f"/api/jobs/{job_id}/answers",
                json={"generation": job["generation"], "values": {
                    "meters_per_unit": 0.01, "floor_height": height, "slab_thickness": 0.2,
                    **({"door_height": 2.3, "window_height": 1.6, "window_sill": 0.8}
                       if floor["number"] < 4 else {}),
                }},
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
        assert all(wall["height"] == 1.1 for wall in walls if wall["source_floor"] == 4)
        assert any(component["type"] == "window" for component in scene["components"])
        xs = [value for wall in walls for value in wall["mesh"]["positions"][0::3]]
        zs = [value for wall in walls for value in wall["mesh"]["positions"][2::3]]
        assert math.isclose(max(xs) - min(xs), 10, abs_tol=1e-8)
        assert math.isclose(max(zs) - min(zs), 14, abs_tol=1e-8)
