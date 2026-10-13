"""Deterministic component meshes in meters, with opening-aware wall extrusion."""

import itertools

from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from contracts import Proposal, required_parameters, validate_parameters


def extrude(shape, bottom, top):
    positions, indices = [], []

    def triangle(a, b, c):
        start = len(positions) // 3
        positions.extend([*a, *b, *c])
        indices.extend([start, start + 1, start + 2])

    polygons = [shape] if shape.geom_type == "Polygon" else list(shape.geoms)
    for p in polygons:
        if p.is_empty or p.area < 1e-10:
            continue
        p = orient(p, sign=1)
        for tri in constrained_delaunay_triangles(p).geoms:
            a, b, c = list(orient(tri, sign=1).exterior.coords)[:3]
            triangle((a[0], bottom, a[1]), (b[0], bottom, b[1]), (c[0], bottom, c[1]))
            triangle((a[0], top, a[1]), (c[0], top, c[1]), (b[0], top, b[1]))
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)
            for a, b in itertools.pairwise(pts):
                triangle((a[0], bottom, a[1]), (a[0], top, a[1]), (b[0], top, b[1]))
                triangle((a[0], bottom, a[1]), (b[0], top, b[1]), (b[0], bottom, b[1]))
    return {"positions": positions, "indices": indices}


def build_scene(proposal: Proposal, parameters: dict, revision: int) -> dict:
    validate_parameters(parameters)
    missing = [
        k
        for k in required_parameters(proposal)
        if k not in parameters or (k == "review_confirmed" and parameters[k] is not True)
    ]
    if missing:
        raise ValueError("Missing required confirmation: " + ", ".join(missing))
    scale = parameters.get("meters_per_unit", proposal.meters_per_unit)
    height = parameters["floor_height"]
    for k in ("door_height", "window_height"):
        if (
            parameters.get(k, 0) + (parameters.get("window_sill", 0) if k == "window_height" else 0)
            > height
        ):
            raise ValueError("Opening elevation/height exceeds confirmed floor height")
    shapes = {
        c.id: Polygon([(x * scale, -y * scale) for x, y in c.polygon]) for c in proposal.components
    }
    openings = []
    walls = [shapes[c.id] for c in proposal.components if c.type == "wall"]
    for c in proposal.components:
        if c.type in ("door", "window"):
            shape = shapes[c.id]
            # Cut only evidence that intersects a wall. No guessed opening placement.
            if not any(shape.intersection(w).area > 1e-9 for w in walls):
                raise ValueError(f"Opening {c.id} does not intersect a wall; correct its footprint")
            bottom = 0 if c.type == "door" else parameters["window_sill"]
            top = bottom + parameters[c.type + "_height"]
            openings.append((shape, bottom, top, c.id))
    result = []
    for c in proposal.components:
        shape = shapes[c.id]
        bottom, top = 0, height
        if c.type == "room":
            bottom, top = -parameters["slab_thickness"], 0
        elif c.type in ("door", "window"):
            bottom = 0 if c.type == "door" else parameters["window_sill"]
            top = bottom + parameters[c.type + "_height"]
        mesh = {"positions": [], "indices": []}
        if c.type not in ("door", "window"):
            relevant = [
                (p, b, t, i)
                for p, b, t, i in openings
                if c.type == "wall" and shape.intersection(p).area > 1e-9
            ]
            levels = sorted(
                {bottom, top, *(v for _, b, t, _ in relevant for v in (b, t) if bottom < v < top)}
            )
            for lo, hi in itertools.pairwise(levels):
                cuts = [p for p, b, t, _ in relevant if b < hi and t > lo]
                part = shape.difference(unary_union(cuts)) if cuts else shape
                if part.is_empty:
                    continue
                segment = extrude(part, lo, hi)
                offset = len(mesh["positions"]) // 3
                mesh["positions"].extend(segment["positions"])
                mesh["indices"].extend(i + offset for i in segment["indices"])
        bounds = shape.bounds
        result.append(
            {
                **c.model_dump(mode="json"),
                "polygon": [[x * scale, -y * scale] for x, y in c.polygon],
                "height": top - bottom,
                "elevation": bottom,
                "dimensions": {
                    "width": bounds[2] - bounds[0],
                    "depth": bounds[3] - bounds[1],
                    "height": top - bottom,
                },
                "source_polygon": c.model_dump(mode="json")["polygon"],
                "mesh": mesh,
                "opening": c.type in ("door", "window"),
            }
        )
    values = {k: {"value": v, "provenance": "user_confirmed"} for k, v in parameters.items()}
    if "meters_per_unit" not in values:
        values["meters_per_unit"] = {"value": scale, "provenance": "recognized"}
    return {
        "schema_version": proposal.schema_version,
        "job_id": proposal.job_id,
        "source_hash": proposal.source_hash,
        "source_kind": proposal.source_kind,
        "coordinate_frame": proposal.coordinate_frame.model_dump(mode="json"),
        "model_coordinate_frame": {"axes": "x right, y up, z negative source-y", "unit": "m"},
        "revision": revision,
        "unit": "m",
        "floors": 1,
        "components": result,
        "parameters": values,
        "dimensions": [d.model_dump(mode="json") for d in proposal.dimensions],
        "validation_issues": proposal.validation_issues,
        "warnings": [
            "Single-floor research reconstruction; no unsupported roof, site or interior detail.",
            "Door/window components represent voids, not inferred door leaves or glazing.",
        ],
    }
