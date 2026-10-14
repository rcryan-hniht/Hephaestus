import hashlib
import math

import pytest
from shapely.geometry import Polygon

from app.contracts import Component, Proposal
from app.extraction.svg import extract_svg
from app.geometry import build_scene

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


def test_multiple_direct_footprints_are_preserved():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><g class="Wall" id="w"><rect width="10" height="2"/><rect x="20" width="10" height="2"/></g></svg>'
    )
    assert len(p.components) == 2
    assert p.components[1].polygon[0] == (20, 0)


def test_nested_footprints_are_preserved_without_annotation_geometry():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><g class="Wall"><g transform="translate(5 0)"><rect width="10" height="2"/><rect x="20" width="10" height="2"/></g><g class="Dimension"><polygon points="0,0 1,0 0,1"/></g></g></svg>'
    )
    assert len(p.components) == 2
    assert p.components[1].polygon[0] == (25, 0)


@pytest.mark.parametrize("path", ["M0 0 L10 0 M10 10 L0 10 Z", "M0 0 L10 0 @ L10 10 L0 10 Z"])
def test_malformed_path_never_invents_geometry(path):
    with pytest.raises(ValueError):
        proposal(f'<svg viewBox="0 0 10 10"><g class="Wall"><path d="{path}"/></g></svg>'.encode())


def test_opening_exports_distinct_picking_volume():
    scene = build_scene(
        proposal(), {"meters_per_unit": 0.1, "floor_height": 3, "door_height": 2.1}, 1
    )
    door = next(c for c in scene["components"] if c["type"] == "door")
    assert door["mesh"]["positions"] == []
    assert len(door["selection_mesh"]["positions"]) > 0
    assert max(door["selection_mesh"]["positions"][1::3]) == 2.1


def test_rotated_dimensions_label_the_measurement_basis():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><g class="Wall" transform="rotate(45)"><rect width="10" height="1"/></g></svg>'
    )
    c = build_scene(p, {"meters_per_unit": 1, "floor_height": 3}, 1)["components"][0]
    assert c["dimensions"]["basis"] == "axis_aligned_bounds"
    assert sorted(c["dimensions"]["footprint_edge_lengths"]) == pytest.approx([1, 1, 10, 10])


def test_opening_height_can_be_confirmed_per_component():
    p = proposal()
    door = next(c for c in p.components if c.type == "door")
    scene = build_scene(
        p,
        {"meters_per_unit": 0.1, "floor_height": 3},
        1,
        component_parameters={door.id: {"height": 1.9}},
    )
    actual = next(c for c in scene["components"] if c["id"] == door.id)
    assert actual["height"] == 1.9
    assert actual["parameters"]["height"]["provenance"] == "user_confirmed"
    with pytest.raises(ValueError):
        build_scene(
            p,
            {"meters_per_unit": 0.1, "floor_height": 3},
            2,
            component_parameters={"nonexistent": {"height": 2}},
        )


def test_visible_dimension_text_is_extracted_with_units():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><g class="Wall"><rect width="40" height="4"/></g><text x="2" y="8">3.20 m</text></svg>'
    )
    assert p.dimensions[0].value == 3.2
    assert p.dimensions[0].unit == "m"
    assert p.meters_per_unit is None


def test_dimension_value_cannot_contradict_its_source_text():
    base = proposal().model_dump()
    base["meters_per_unit"] = 0.5
    base["dimensions"] = [
        {
            "text": "3 m",
            "position": [0, 0],
            "visible": True,
            "value": 5,
            "unit": "m",
            "reference": [[0, 0], [10, 0]],
        }
    ]
    with pytest.raises(ValueError):
        Proposal.model_validate(base)


def test_printed_area_is_preserved_but_never_used_as_a_length_scale():
    from app.contracts import Dimension, dimension_values

    area = Dimension(
        text="35,0 m²",
        position=[300, 200],
        visible=True,
        value=35,
        unit="m²",
        reference=[[200, 0], [680, 0]],
    )
    assert dimension_values("35,0 m²; 3.20 m; 350000 cm^2") == [
        (35, "m²"),
        (3.2, "m"),
        (350000, "cm²"),
    ]
    base = proposal().model_dump()
    base["dimensions"] = [area.model_dump()]
    p = Proposal.model_validate(base)
    assert p.dimensions[0].unit == "m²"
    assert p.meters_per_unit is None
    base["meters_per_unit"] = 35 / 480
    with pytest.raises(ValueError, match="visible dimension"):
        Proposal.model_validate(base)
    base["meters_per_unit"] = 0.3
    base["dimensions"].append(
        {
            "text": "3 m",
            "position": [0, 0],
            "visible": True,
            "value": 3,
            "unit": "m",
            "reference": [[0, 0], [10, 0]],
        }
    )
    assert Proposal.model_validate(base).meters_per_unit == 0.3
    with pytest.raises(ValueError, match="contradicts"):
        Dimension(text="35 m²", position=[0, 0], visible=True, value=35, unit="m")


def test_svg_area_annotations_keep_the_square_unit():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><g class="Wall"><rect width="40" height="4"/></g><text x="2" y="8">35.0 m&#178;</text></svg>'
    )
    assert p.dimensions[0].value == 35
    assert p.dimensions[0].unit == "m²"
    assert p.meters_per_unit is None


def test_local_marker_reference_does_not_require_external_resources():
    p = proposal(
        b'<svg viewBox="0 0 100 100"><defs><marker id="arrow"/></defs><g class="Wall"><rect width="40" height="4"/></g><path d="M0 0 L1 1" style="marker-end:url(#arrow)"/></svg>'
    )
    assert len(p.components) == 1


def test_tiny_scaled_geometry_cannot_publish_empty_wall_meshes():
    with pytest.raises(ValueError):
        p = proposal(
            b'<svg viewBox="0 0 100 100"><g class="Wall"><rect width="40" height="4"/></g></svg>'
        )
        build_scene(p, {"meters_per_unit": 1e-8, "floor_height": 3}, 1)


def test_opening_wall_contains_only_exposed_surface_faces():
    scene = build_scene(
        proposal(), {"meters_per_unit": 0.1, "floor_height": 3, "door_height": 2.1}, 1
    )
    mesh = scene["components"][0]["mesh"]
    area = 0
    for i in range(0, len(mesh["indices"]), 3):
        a, b, c = [mesh["positions"][j * 3 : j * 3 + 3] for j in mesh["indices"][i : i + 3]]
        u, v = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
        area += (
            math.sqrt(
                sum(
                    n * n
                    for n in [
                        u[1] * v[2] - u[2] * v[1],
                        u[2] * v[0] - u[0] * v[2],
                        u[0] * v[1] - u[1] * v[0],
                    ]
                )
            )
            / 2
        )
    assert area == pytest.approx(27.08)
