import hashlib
import math
import time
from collections import Counter

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.contracts import Component, missing_parameters, validate_component_parameters
from app.extraction.svg import extract_svg
from app.geometry import build_scene
from app.main import create_app
from app.services.jobs import Jobs

SVG = b"""<svg viewBox="0 0 30 20"><g class="Wall"><rect width="10" height="1"/></g>
<g id="roof" class="Roof Gable" data-direction="1,0"><rect width="10" height="6"/></g>
<g id="stairs" class="Stair" data-direction="0,-1" data-steps="3"><rect x="12" width="2" height="6"/></g></svg>"""


def proposal(data=SVG):
    return extract_svg(data, "job", hashlib.sha256(data).hexdigest())


def test_svg_preserves_transformed_direction_and_explicit_roof_evidence():
    data = b"""<svg viewBox="0 0 30 20"><g transform="translate(5,2) rotate(90)">
    <g class="Roof Shed" data-direction="1,0"><rect width="10" height="4"/></g>
    <g class="Stair" data-direction="0,-1" data-steps="18"><rect x="12" width="2" height="6"/></g>
    </g></svg>"""
    roof, stair = proposal(data).components
    assert roof.direction == pytest.approx((0, 1))
    assert roof.roof_kind == "shed"
    assert stair.direction == pytest.approx((1, 0))
    assert stair.steps == 18


@pytest.mark.parametrize(
    "group,match",
    [
        ('class="Roof Gable"', "direction"),
        ('class="Roof Gable" data-direction="0,0"', "direction"),
        ('class="Roof" data-direction="1,0"', "roof kind"),
        ('class="Stair" data-direction="nan,1"', "direction"),
        ('class="Stair" data-direction="1,0" data-steps="1"', "steps"),
        ('class="Roof Gable Shed" data-direction="1,0"', "roof kind"),
        ('class="Stair Spiral" data-direction="1,0"', "straight"),
    ],
)
def test_svg_rejects_missing_or_invalid_roof_stair_evidence(group, match):
    data = f'<svg viewBox="0 0 10 10"><g {group}><rect width="4" height="2"/></g></svg>'.encode()
    with pytest.raises(ValueError, match=match):
        proposal(data)


def test_imported_components_require_explicit_direction_and_kind():
    polygon = [(0, 0), (4, 0), (4, 2), (0, 2)]
    with pytest.raises(ValueError, match="direction"):
        Component(id="r", type="roof", polygon=polygon, roof_kind="gable")
    with pytest.raises(ValueError, match="roof kind"):
        Component(id="r", type="roof", polygon=polygon, direction=(1, 0))
    with pytest.raises(ValueError, match="direction"):
        Component(id="s", type="stair", polygon=polygon, direction=(math.inf, 1))


def test_roof_and_stair_wait_for_required_confirmations():
    p = proposal()
    assert set(missing_parameters(p, {"meters_per_unit": 1, "floor_height": 3}, {})) == {
        "roof_rise",
        "roof_thickness",
        "stair_height",
    }
    with pytest.raises(ValueError, match="roof_rise"):
        build_scene(p, {"meters_per_unit": 1, "floor_height": 3}, 1)
    stair_without_count = p.model_copy(deep=True)
    stair_without_count.components[-1].steps = None
    assert "stair_steps" in missing_parameters(stair_without_count, {}, {})
    assert "stair_steps" not in missing_parameters(
        stair_without_count, {}, {stair_without_count.components[-1].id: {"steps": 4}}
    )


def test_gable_and_stair_meshes_keep_source_ids_and_real_heights():
    scene = build_scene(
        proposal(),
        {
            "meters_per_unit": 1,
            "floor_height": 3,
            "roof_rise": 1,
            "roof_thickness": 0.2,
            "stair_height": 2.4,
        },
        1,
    )
    roof, stair = scene["components"][1:]
    assert roof["source"]["element_id"] == "roof"
    assert roof["height"] == 1
    assert roof["elevation"] == 3
    assert roof["dimensions"]["height"] == pytest.approx(1.2)
    roof_vertices = list(zip(*[iter(roof["mesh"]["positions"])] * 3))
    assert any(x == pytest.approx(5) and y == pytest.approx(4) for x, y, _ in roof_vertices)
    assert all(math.isfinite(v) for v in roof["mesh"]["positions"])
    for i in range(0, len(roof["mesh"]["indices"]), 3):
        xs = [roof_vertices[j][0] for j in roof["mesh"]["indices"][i : i + 3]]
        assert max(xs) <= 5 + 1e-9 or min(xs) >= 5 - 1e-9
    assert stair["source"]["element_id"] == "stairs"
    assert stair["steps"] == 3
    assert stair["height"] == 2.4
    stair_vertices = list(zip(*[iter(stair["mesh"]["positions"])] * 3))
    assert {round(y, 5) for _, y, _ in stair_vertices} == {0, 0.8, 1.6, 2.4}


def test_shed_pitch_reverses_with_direction_and_component_overrides():
    data = b"""<svg viewBox="0 0 12 8"><g class="Roof Shed" data-direction="-1,0">
    <rect width="10" height="6"/></g></svg>"""
    p = proposal(data)
    roof_id = p.components[0].id
    params = {"meters_per_unit": 1, "floor_height": 3}
    overrides = {roof_id: {"height": 2, "roof_thickness": 0.1, "elevation": 4}}
    assert missing_parameters(p, params, overrides) == []
    scene = build_scene(p, params, 1, overrides)
    roof = scene["components"][0]
    vertices = list(zip(*[iter(roof["mesh"]["positions"])] * 3))
    assert max(y for x, y, _ in vertices if abs(x) < 1e-9) == pytest.approx(6)
    assert max(y for x, y, _ in vertices if abs(x - 10) < 1e-9) == pytest.approx(4)
    assert roof["height"] == 2
    assert roof["parameters"]["roof_thickness"]["provenance"] == "user_confirmed"


@pytest.mark.parametrize(
    "footprint",
    [
        '<rect width="10" height="6"/>',
        '<polygon points="0,0 10,0 10,6 7,6 7,2 3,2 3,6 0,6"/>',
    ],
)
def test_rotated_gable_has_finite_closed_surface(footprint):
    data = (
        """<svg viewBox="-20 -20 40 40"><g transform="rotate(31)">
    <g class="Roof Gable" data-direction="1,0">"""
        + footprint
        + "</g></g></svg>"
    ).encode()
    roof = build_scene(
        proposal(data),
        {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 1, "roof_thickness": 0.2},
        1,
    )["components"][0]
    mesh = roof["mesh"]
    vertices = [
        tuple(round(v, 7) for v in mesh["positions"][i : i + 3])
        for i in range(0, len(mesh["positions"]), 3)
    ]
    edges = Counter()
    for i in range(0, len(mesh["indices"]), 3):
        triangle = [vertices[j] for j in mesh["indices"][i : i + 3]]
        assert len(set(triangle)) == 3
        for a, b in ((0, 1), (1, 2), (2, 0)):
            edges[tuple(sorted((triangle[a], triangle[b])))] += 1
    assert edges and set(edges.values()) == {2}


def test_stair_count_and_height_overrides_are_type_checked():
    p = proposal()
    stair = p.components[-1]
    validate_component_parameters(p, {stair.id: {"steps": 5, "height": 2}})
    with pytest.raises(ValueError, match="steps"):
        validate_component_parameters(p, {stair.id: {"steps": 2.5}})
    with pytest.raises(ValueError, match="stairs"):
        validate_component_parameters(p, {p.components[0].id: {"steps": 5}})
    with pytest.raises(ValueError, match="roof"):
        validate_component_parameters(p, {stair.id: {"roof_thickness": 0.1}})


def test_missing_questions_identify_only_components_without_evidence_or_overrides():
    data = b"""<svg viewBox="0 0 20 10">
    <g class="Stair" data-direction="1,0" data-steps="5"><rect width="4" height="2"/></g>
    <g class="Stair" data-direction="1,0"><rect x="6" width="4" height="2"/></g>
    <g class="Roof Shed" data-direction="1,0"><rect x="11" width="4" height="2"/></g>
    </svg>"""
    p = proposal(data)
    overrides = {p.components[0].id: {"height": 1}, p.components[2].id: {"height": 1}}
    questions = {
        q["key"]: q
        for q in Jobs.questions(
            None, p, {"meters_per_unit": 1, "floor_height": 3, "roof_thickness": 0.1}, overrides
        )
    }
    assert questions["stair_steps"]["component_ids"] == [p.components[1].id]
    assert questions["stair_height"]["component_ids"] == [p.components[1].id]
    assert "roof_rise" not in questions


def test_svg_job_questions_confirm_and_publish_roof_stair_meshes(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        response = client.post("/api/jobs", files={"file": ("roof.svg", SVG)})
        assert response.status_code == 202
        job_id = response.json()["id"]
        deadline = time.time() + 10
        while time.time() < deadline:
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["state"] == "needs_information":
                break
            time.sleep(0.05)
        assert job["state"] == "needs_information"
        questions = {q["key"]: q for q in job["questions"]}
        assert set(questions) == {
            "meters_per_unit",
            "floor_height",
            "roof_rise",
            "roof_thickness",
            "stair_height",
        }
        assert len(questions["roof_rise"]["component_ids"]) == 1
        assert len(questions["stair_height"]["component_ids"]) == 1
        response = client.post(
            f"/api/jobs/{job_id}/answers",
            json={"generation": job["generation"], "unknown": ["roof_rise"]},
        )
        assert response.status_code == 202
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["suggestions"]["roof_rise"]["provenance"] == "suggested"
        assert "roof_rise" not in job["parameters"]
        response = client.post(
            f"/api/jobs/{job_id}/answers",
            json={
                "generation": job["generation"],
                "values": {
                    "meters_per_unit": 1,
                    "floor_height": 3,
                    "roof_rise": 1,
                    "roof_thickness": 0.2,
                    "stair_height": 2.4,
                    "stair_steps": 4,
                },
                "component_values": {questions["stair_height"]["component_ids"][0]: {"steps": 5}},
            },
        )
        assert response.status_code == 202
        deadline = time.time() + 10
        while time.time() < deadline:
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["state"] in {"ready", "failed"}:
                break
            time.sleep(0.05)
        assert job["state"] == "ready", job.get("error")
        scene = client.get(f"/api/jobs/{job_id}/scene").json()
        assert all(scene["components"][i]["mesh"]["indices"] for i in (1, 2))
        assert scene["components"][2]["steps"] == 5
