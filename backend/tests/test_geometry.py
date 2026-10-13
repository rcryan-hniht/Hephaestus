import hashlib

import pytest
from shapely.geometry import Polygon

from contracts import Component, Proposal
from geometry import build_scene
from svg import extract_svg

SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<g transform="translate(10 5)"><g id="Wall" class="Wall"><polygon points="0,0 40,0 40,4 0,4"/></g>
<g id="Wall" class="Wall" transform="scale(2)"><rect x="0" y="10" width="20" height="2"/></g>
<g id="door" class="Door"><polygon points="10,0 20,0 20,4 10,4"/></g></g>
<g style="display:none"><text>3.0 m</text></g></svg>"""


def proposal(data=SVG):
    return extract_svg(data, "job", hashlib.sha256(data).hexdigest())


def test_transforms_repeated_ids_and_hidden_dimensions():
    p = proposal()
    assert len(p.components) == 3
    assert len({c.id for c in p.components}) == 3
    assert [c.source.element_id for c in p.components[:2]] == ["Wall", "Wall"]
    assert p.components[0].polygon[0] == (10.0, 5.0)
    assert p.components[1].polygon[0] == (10.0, 25.0)
    assert p.dimensions[0].visible is False
    assert p.meters_per_unit is None


@pytest.mark.parametrize(
    "content",
    [
        b"<svg><script>alert(1)</script></svg>",
        b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
        b'<svg><image href="https://evil.test/x"/></svg>',
        b'<svg><g class="Wall"><path d="M0 0 C1 1 2 2 3 3 Z"/></g></svg>',
        b'<svg><g class="Wall" transform="scale(0)"><rect width="2" height="2"/></g></svg>',
    ],
)
def test_rejects_unsafe_or_unsupported_svg(content):
    with pytest.raises(ValueError):
        proposal(content)


def test_invalid_candidate_polygons_are_rejected():
    with pytest.raises(ValueError):
        Component(id="x", type="wall", polygon=[(0, 0), (2, 2), (0, 2), (2, 0)])
    with pytest.raises(ValueError):
        Component(id="x", type="wall", polygon=[(0, 0), (float("inf"), 0), (0, 1)])


def test_mesh_uses_confirmed_units_and_cuts_door():
    p = proposal()
    scene = build_scene(
        p, {"meters_per_unit": 0.1, "floor_height": 3, "door_height": 2.1}, revision=1
    )
    wall = scene["components"][0]
    assert wall["polygon"][0] == [1.0, -0.5]
    assert wall["height"] == 3
    mesh = wall["mesh"]
    vertices = mesh["positions"]
    # Wall volume: 4m * .4m * 3m minus 1m * .4m * 2.1m = 3.96m³.
    volume = 0
    for i in range(0, len(mesh["indices"]), 3):
        a, b, c = [vertices[j * 3 : j * 3 + 3] for j in mesh["indices"][i : i + 3]]
        volume += (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
        ) / 6
    assert abs(volume) == pytest.approx(3.96)
    assert scene["parameters"]["floor_height"]["provenance"] == "user_confirmed"
    assert scene["job_id"] == "job"
    assert scene["components"][0]["source"]["element_id"] == "Wall"


def test_does_not_build_without_required_confirmation():
    with pytest.raises(ValueError):
        build_scene(proposal(), {"meters_per_unit": 0.1}, revision=1)


def test_png_candidates_require_explicit_review():
    p = Proposal(
        job_id="j",
        source_hash="a" * 64,
        source_kind="png",
        coordinate_frame={"width": 10, "height": 10},
        components=[Component(id="a", type="wall", polygon=[(0, 0), (4, 0), (4, 1), (0, 1)])],
    )
    with pytest.raises(ValueError, match="review"):
        build_scene(p, {"meters_per_unit": 1, "floor_height": 3}, revision=1)


def test_room_floor_area_is_preserved():
    p = proposal(
        b'<svg viewBox="0 0 10 10"><g class="Space Kitchen" id="r"><polygon points="0,0 4,0 4,3 0,3"/></g></svg>'
    )
    scene = build_scene(
        p, {"meters_per_unit": 1, "floor_height": 3, "slab_thickness": 0.2}, revision=1
    )
    assert Polygon(scene["components"][0]["polygon"]).area == 12
    assert scene["components"][0]["elevation"] == -0.2
