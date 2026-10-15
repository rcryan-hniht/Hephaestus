import hashlib

import pytest
from pydantic import ValidationError

from app.contracts import Proposal
from app.extraction.svg import extract_svg
from app.geometry import build_scene

SVG = b"""<svg viewBox="0 0 12 8">
<g id="front" class="Wall Gable" data-roof-ref="gable"><rect x="0" y="1" width="10" height="1"/></g>
<g id="gable" class="Roof Gable" data-direction="1,0"><rect width="10" height="6"/></g>
</svg>"""


def proposal(data=SVG):
    return extract_svg(data, "job", hashlib.sha256(data).hexdigest())


def vertices(component):
    positions = component["mesh"]["positions"]
    return list(zip(positions[::3], positions[1::3], positions[2::3]))


def test_svg_resolves_forward_roof_reference_and_gable_wall_reaches_underside():
    p = proposal()
    wall, roof = p.components
    assert wall.roof_id == roof.id
    assert wall.source.element_id == "front"
    scene = build_scene(
        p,
        {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 2, "roof_thickness": 0.2},
        1,
    )
    wall_mesh = scene["components"][0]
    assert wall_mesh["height"] == 3  # Source-confirmed nominal height remains intact.
    assert max(y for _, y, _ in vertices(wall_mesh)) == pytest.approx(4.8)
    for x, expected in ((0, 2.8), (5, 4.8), (10, 2.8)):
        assert any(
            abs(vx - x) < 1e-8 and abs(y - expected) < 1e-8 for vx, y, _ in vertices(wall_mesh)
        )
    for triangle in [
        wall_mesh["mesh"]["indices"][i : i + 3]
        for i in range(0, len(wall_mesh["mesh"]["indices"]), 3)
    ]:
        xs = [vertices(wall_mesh)[i][0] for i in triangle]
        assert max(xs) <= 5 + 1e-8 or min(xs) >= 5 - 1e-8


def test_current_roof_overrides_rebuild_wall_pitch():
    p = proposal()
    roof_id = p.components[1].id
    scene = build_scene(
        p,
        {"meters_per_unit": 1, "floor_height": 3},
        2,
        {roof_id: {"height": 3, "elevation": 4, "roof_thickness": 0.4}},
    )
    wall = scene["components"][0]
    assert max(y for _, y, _ in vertices(wall)) == pytest.approx(6.6)
    assert any(abs(x) < 1e-8 and abs(y - 3.6) < 1e-8 for x, y, _ in vertices(wall))


def test_gable_wall_front_face_normals_point_outward():
    wall = build_scene(
        proposal(),
        {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 2, "roof_thickness": 0.2},
        1,
    )["components"][0]
    points = vertices(wall)
    normals = []
    for i in range(0, len(wall["mesh"]["indices"]), 3):
        a, b, c = [points[j] for j in wall["mesh"]["indices"][i : i + 3]]
        if all(abs(p[2] + 1) < 1e-8 for p in (a, b, c)):
            nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(nz) > 1e-10:
                normals.append(nz)
    assert normals and all(nz > 0 for nz in normals)


@pytest.mark.parametrize(
    "svg,match",
    [
        (SVG.replace(b'data-roof-ref="gable"', b'data-roof-ref="missing"'), "roof"),
        (SVG.replace(b'class="Roof Gable"', b'class="Wall"'), "roof"),
        (
            SVG.replace(
                b"</svg>",
                b'<g id="gable" class="Roof Shed" data-direction="1,0"><rect width="10" height="6"/></g></svg>',
            ),
            "ambiguous",
        ),
        (SVG.replace(b'class="Wall Gable"', b'class="Space"'), "wall"),
    ],
)
def test_svg_rejects_invalid_roof_references(svg, match):
    with pytest.raises(ValueError, match=match):
        proposal(svg)


def test_imported_proposal_rejects_missing_roof_reference():
    data = proposal().model_dump()
    data["components"][0]["roof_id"] = "other"
    with pytest.raises(ValidationError, match="roof"):
        Proposal.model_validate(data)


def test_rotated_roof_preserves_world_pitch_on_wall():
    data = SVG.replace(b'<g id="front"', b'<g transform="rotate(90)"><g id="front"').replace(
        b"</svg>", b"</g></svg>"
    )
    wall = build_scene(
        proposal(data),
        {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 2, "roof_thickness": 0.2},
        1,
    )["components"][0]
    assert max(y for _, y, _ in vertices(wall)) == pytest.approx(4.8)
    assert any(abs(z + 5) < 1e-8 and abs(y - 4.8) < 1e-8 for _, y, z in vertices(wall))


def test_roof_bound_wall_keeps_door_void_and_rejects_opening_above_underside():
    door = b'<g class="Door"><rect x="2" y="1" width="1" height="1"/></g>'
    data = SVG.replace(b"</svg>", door + b"</svg>")
    scene = build_scene(
        proposal(data),
        {
            "meters_per_unit": 1,
            "floor_height": 3,
            "roof_rise": 2,
            "roof_thickness": 0.2,
            "door_height": 2,
        },
        1,
    )
    wall = scene["components"][0]
    points = vertices(wall)
    for i in range(0, len(wall["mesh"]["indices"]), 3):
        triangle = [points[j] for j in wall["mesh"]["indices"][i : i + 3]]
        x = sum(p[0] for p in triangle) / 3
        y = sum(p[1] for p in triangle) / 3
        z = sum(p[2] for p in triangle) / 3
        assert not (2 < x < 3 and -2 < z < -1 and 0 < y < 2)

    eave_door = SVG.replace(
        b"</svg>",
        b'<g class="Door"><rect x="0" y="1" width="1" height="1"/></g></svg>',
    )
    with pytest.raises(ValueError, match="roof underside"):
        build_scene(
            proposal(eave_door),
            {
                "meters_per_unit": 1,
                "floor_height": 3,
                "roof_rise": 2,
                "roof_thickness": 0.2,
                "door_height": 2.9,
            },
            1,
        )


def test_disconnected_opening_overlap_still_checks_each_roof_edge():
    data = b"""<svg viewBox="0 0 12 8">
    <g id="wall" class="Wall Gable" data-roof-ref="roof">
      <polygon points="0,0 10,0 10,4 8,4 8,1 2,1 2,4 0,4"/>
    </g>
    <g id="roof" class="Roof Gable" data-direction="1,0"><rect width="10" height="6"/></g>
    <g class="Door"><rect x="0" y="2" width="10" height="1"/></g>
    </svg>"""
    with pytest.raises(ValueError, match="roof underside"):
        build_scene(
            proposal(data),
            {
                "meters_per_unit": 1,
                "floor_height": 3,
                "roof_rise": 2,
                "roof_thickness": 0.2,
                "door_height": 2.9,
            },
            1,
        )


def test_wall_outside_roof_or_underside_below_base_fails_actionably():
    outside = SVG.replace(b'x="0" y="1"', b'x="5" y="1"')
    with pytest.raises(ValueError, match="roof footprint"):
        build_scene(
            proposal(outside),
            {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 2, "roof_thickness": 0.2},
            1,
        )
    with pytest.raises(ValueError, match="wall base"):
        build_scene(
            proposal(),
            {"meters_per_unit": 1, "floor_height": 3, "roof_rise": 2, "roof_thickness": 0.2},
            1,
            {proposal().components[0].id: {"elevation": 4}},
        )
