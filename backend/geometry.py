"""Deterministic component meshes in meters, with opening-aware wall extrusion."""

import itertools
import math

from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from contracts import (
    Proposal,
    missing_parameters,
    validate_component_parameters,
    validate_parameters,
)


def extrude(shape, bottom, top, bottom_cap=None, top_cap=None):
    positions, indices = [], []

    def triangle(a, b, c):
        start = len(positions) // 3
        positions.extend([*a, *b, *c])
        indices.extend([start, start + 1, start + 2])

    for cap, elevation, upper in [
        (shape if bottom_cap is None else bottom_cap, bottom, False),
        (shape if top_cap is None else top_cap, top, True),
    ]:
        for tri in constrained_delaunay_triangles(cap).geoms:
            a, b, c = list(orient(tri, sign=1).exterior.coords)[:3]
            if upper:
                b, c = c, b
            triangle((a[0], elevation, a[1]), (b[0], elevation, b[1]), (c[0], elevation, c[1]))
    polygons = [shape] if shape.geom_type == "Polygon" else list(shape.geoms)
    for p in polygons:
        if p.is_empty or p.area < 1e-10:
            continue
        p = orient(p, sign=1)
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)
            for a, b in itertools.pairwise(pts):
                triangle((a[0], bottom, a[1]), (a[0], top, a[1]), (b[0], top, b[1]))
                triangle((a[0], bottom, a[1]), (b[0], top, b[1]), (b[0], bottom, b[1]))
    return {"positions": positions, "indices": indices}


def build_scene(
    proposal: Proposal, parameters: dict, revision: int, component_parameters: dict | None = None
) -> dict:
    validate_parameters(parameters)
    component_parameters = component_parameters or {}
    validate_component_parameters(proposal, component_parameters)
    missing = missing_parameters(proposal, parameters, component_parameters)
    if missing:
        raise ValueError("Missing required confirmation: " + ", ".join(missing))
    scale = parameters.get("meters_per_unit", proposal.meters_per_unit)
    height = parameters["floor_height"]
    elevations = {}
    for c in proposal.components:
        confirmed = component_parameters.get(c.id, {})
        default_height = (
            parameters.get("slab_thickness")
            if c.type == "room"
            else parameters.get(c.type + "_height", height)
        )
        h = confirmed.get("height", default_height)
        b = confirmed.get(
            "elevation", parameters.get("window_sill", 0) if c.type == "window" else 0
        )
        if c.type == "room":
            b -= h
        if c.type in {"door", "window"} and b + h > height:
            raise ValueError("Opening elevation/height exceeds confirmed floor height")
        elevations[c.id] = (b, b + h)
    shapes = {
        c.id: Polygon([(x * scale, -y * scale) for x, y in c.polygon]) for c in proposal.components
    }
    if any(p.area < 1e-8 or max(abs(v) for v in p.bounds) > 10000 for p in shapes.values()):
        raise ValueError(
            "Confirmed scale produces negligible or oversized physical geometry; correct the scale"
        )
    openings = []
    walls = [shapes[c.id] for c in proposal.components if c.type == "wall"]
    for c in proposal.components:
        if c.type in ("door", "window"):
            shape = shapes[c.id]
            # Cut only evidence that intersects a wall. No guessed opening placement.
            if not any(shape.intersection(w).area > 1e-9 for w in walls):
                raise ValueError(f"Opening {c.id} does not intersect a wall; correct its footprint")
            bottom, top = elevations[c.id]
            for wall in proposal.components:
                if wall.type == "wall" and shape.intersection(shapes[wall.id]).area > 1e-9:
                    lo, hi = elevations[wall.id]
                    if bottom < lo or top > hi:
                        raise ValueError("Opening exceeds its wall's confirmed vertical bounds")
            openings.append((shape, bottom, top, c.id))
    result = []
    for c in proposal.components:
        shape = shapes[c.id]
        bottom, top = elevations[c.id]
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
            parts = []
            for lo, hi in itertools.pairwise(levels):
                cuts = [p for p, b, t, _ in relevant if b < hi and t > lo]
                part = shape.difference(unary_union(cuts)) if cuts else shape
                parts.append((lo, hi, part))
            for i, (lo, hi, part) in enumerate(parts):
                if part.is_empty:
                    continue
                below = parts[i - 1][2] if i else Polygon()
                above = parts[i + 1][2] if i + 1 < len(parts) else Polygon()
                # Only exposed lintels/sills get caps; overlapping internal faces cause artifacts.
                segment = extrude(part, lo, hi, part.difference(below), part.difference(above))
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
                    "basis": "axis_aligned_bounds",
                    "width": bounds[2] - bounds[0],
                    "depth": bounds[3] - bounds[1],
                    "height": top - bottom,
                    "footprint_edge_lengths": [
                        math.dist(a, b) for a, b in itertools.pairwise(list(shape.exterior.coords))
                    ],
                },
                "source_polygon": c.model_dump(mode="json")["polygon"],
                "mesh": mesh,
                "selection_mesh": extrude(shape, bottom, top)
                if c.type in ("door", "window")
                else None,
                "opening": c.type in ("door", "window"),
                "parameters": {
                    k: {"value": v, "provenance": "user_confirmed"}
                    for k, v in component_parameters.get(c.id, {}).items()
                },
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
