"""Deterministic component meshes in meters, with opening-aware wall extrusion."""

import itertools
import math

from shapely import constrained_delaunay_triangles
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from app.contracts import (
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


def clip_band(shape, direction, start, end):
    """Clip a footprint between two planes normal to its travel direction."""
    dx, dz = direction
    px, pz = -dz, dx
    reach = max(abs(v) for v in shape.bounds) * 2 + 100
    return shape.intersection(
        Polygon(
            [
                (dx * start + px * reach, dz * start + pz * reach),
                (dx * end + px * reach, dz * end + pz * reach),
                (dx * end - px * reach, dz * end - pz * reach),
                (dx * start - px * reach, dz * start - pz * reach),
            ]
        )
    )


def roof_mesh(shape, direction, eave, rise, thickness, kind):
    projections = [x * direction[0] + z * direction[1] for x, z in shape.exterior.coords]
    start, end = min(projections), max(projections)
    if end - start < 1e-8:
        raise ValueError("Roof direction has no usable span across its footprint")
    midpoint = (start + end) / 2
    bands = [(start, end)] if kind == "shed" else [(start, midpoint), (midpoint, end)]
    positions, indices = [], []

    def triangle(a, b, c):
        index = len(positions) // 3
        positions.extend([*a, *b, *c])
        indices.extend((index, index + 1, index + 2))

    def top(x, z):
        progress = (x * direction[0] + z * direction[1] - start) / (end - start)
        return eave + rise * (progress if kind == "shed" else 1 - abs(2 * progress - 1))

    for lo, hi in bands:
        clipped = clip_band(shape, direction, lo, hi)
        polygons = [clipped] if clipped.geom_type == "Polygon" else list(clipped.geoms)
        for part in polygons:
            if part.is_empty or part.area < 1e-10:
                continue
            for tri in constrained_delaunay_triangles(part).geoms:
                a, b, c = list(orient(tri, sign=1).exterior.coords)[:3]
                triangle(
                    (a[0], top(*a) - thickness, a[1]),
                    (b[0], top(*b) - thickness, b[1]),
                    (c[0], top(*c) - thickness, c[1]),
                )
                triangle((a[0], top(*a), a[1]), (c[0], top(*c), c[1]), (b[0], top(*b), b[1]))
            for ring in [part.exterior, *part.interiors]:
                for a, b in itertools.pairwise(ring.coords):
                    if shape.boundary.distance(Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) > 1e-8:
                        continue
                    low_a, low_b = top(*a) - thickness, top(*b) - thickness
                    triangle((a[0], low_a, a[1]), (a[0], top(*a), a[1]), (b[0], top(*b), b[1]))
                    triangle((a[0], low_a, a[1]), (b[0], top(*b), b[1]), (b[0], low_b, b[1]))
    return {"positions": positions, "indices": indices}


def stair_mesh(shape, direction, bottom, rise, steps):
    projections = [x * direction[0] + z * direction[1] for x, z in shape.exterior.coords]
    start, end = min(projections), max(projections)
    if end - start < 1e-8:
        raise ValueError("Stair direction has no usable span across its footprint")
    mesh = {"positions": [], "indices": []}
    for step in range(steps):
        part = clip_band(
            shape,
            direction,
            start + (end - start) * step / steps,
            start + (end - start) * (step + 1) / steps,
        )
        if part.is_empty or part.area < 1e-10:
            continue
        segment = extrude(part, bottom, bottom + rise * (step + 1) / steps)
        offset = len(mesh["positions"]) // 3
        mesh["positions"].extend(segment["positions"])
        mesh["indices"].extend(i + offset for i in segment["indices"])
    if not mesh["indices"]:
        raise ValueError("Stair footprint has no buildable steps")
    return mesh


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
            else parameters.get({"roof": "roof_rise"}.get(c.type, c.type + "_height"), height)
        )
        h = confirmed.get("height", default_height)
        b = confirmed.get(
            "elevation",
            parameters.get("window_sill", 0)
            if c.type == "window"
            else height
            if c.type == "roof"
            else 0,
        )
        if c.type == "room":
            b -= h
        if c.type in {"door", "window"} and b + h > height:
            raise ValueError("Opening elevation/height exceeds confirmed floor height")
        if c.type == "stair" and b + h > height:
            raise ValueError("Straight stair rise exceeds confirmed floor height")
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
        confirmed = component_parameters.get(c.id, {})
        thickness = None
        steps = None
        if c.type in {"roof", "stair"}:
            dx, dy = c.direction
            length = math.hypot(dx, dy)
            direction = (dx / length, -dy / length)
            if c.type == "roof":
                thickness = confirmed.get("roof_thickness", parameters.get("roof_thickness"))
                mesh = roof_mesh(shape, direction, bottom, top - bottom, thickness, c.roof_kind)
            else:
                steps = confirmed.get(
                    "steps", c.steps if c.steps is not None else parameters.get("stair_steps")
                )
                mesh = stair_mesh(shape, direction, bottom, top - bottom, steps)
        elif c.type not in ("door", "window"):
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
                    "height": top - bottom + (thickness or 0),
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
                **({"roof_thickness": thickness} if c.type == "roof" else {}),
                **({"steps": steps} if c.type == "stair" else {}),
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
            "Single-floor research reconstruction; only source-bound straight stairs and shed/gable roofs are supported."
            if any(c.type in {"roof", "stair"} for c in proposal.components)
            else "Single-floor research reconstruction; no unsupported roof, site or interior detail.",
            *(
                ["Roof thickness is vertical below the sloped surface, not measured normal to it."]
                if any(c.type == "roof" for c in proposal.components)
                else []
            ),
            "Door/window components represent voids, not inferred door leaves or glazing.",
        ],
    }


def assemble_building(building, jobs, scenes):
    """Compose validated source scenes; never mutate single-floor evidence."""
    import copy
    import hashlib
    import json

    result, sources, warnings = [], [], []
    elevation, size = 0, 0
    ids = set()
    for floor, job, scene in zip(building["floors"], jobs, scenes, strict=True):
        if (
            job["state"] != "ready"
            or scene["job_id"] != job["id"]
            or scene["source_hash"] != job["source_hash"]
            or scene["revision"] != job["active_revision"]
        ):
            raise ValueError("Every assembled floor must match its ready source revision")
        if not any(c["type"] == "wall" for c in scene["components"]):
            raise ValueError(
                f"F{floor['number']} has no wall geometry; correct its extraction before assembly"
            )
        scale = scene["parameters"]["meters_per_unit"]["value"]
        origin = scene["coordinate_frame"]["origin"]
        transform = [
            floor["offset_x"] - origin[0] * scale,
            elevation,
            -floor["offset_y"] + origin[1] * scale,
        ]
        for component in scene["components"]:
            size += len(component["mesh"]["positions"]) + len(
                (component.get("selection_mesh") or {}).get("positions", [])
            )
            if len(result) >= 2000 or size > 2_000_000 or component["id"] in ids:
                raise ValueError(
                    "Combined building exceeds geometry limits or repeats component IDs"
                )
            ids.add(component["id"])
            c = copy.deepcopy(component)
            c.update(
                floor=len(sources),
                source_floor=floor["number"],
                job_id=job["id"],
                source_hash=job["source_hash"],
                local_elevation=c["elevation"],
                elevation=c["elevation"] + elevation,
            )
            c["polygon"] = [[x + transform[0], z + transform[2]] for x, z in c["polygon"]]
            for mesh in [c["mesh"], c.get("selection_mesh")]:
                if mesh:
                    mesh["positions"] = [
                        v + transform[i % 3] for i, v in enumerate(mesh["positions"])
                    ]
                    if any(not math.isfinite(v) or abs(v) > 20000 for v in mesh["positions"]):
                        raise ValueError("Aligned geometry exceeds supported model coordinates")
            result.append(c)
        sources.append(
            {
                "number": floor["number"],
                "name": job["name"],
                "transform": transform,
                "provenance": "user_confirmed",
                "scene": scene,
                "drawings": [
                    {k: v for k, v in s.items() if k != "artifact"} for s in floor["sources"]
                ],
            }
        )
        warnings.extend(f"F{floor['number']}: {w}" for w in scene.get("warnings", []))
        elevation += scene["parameters"]["floor_height"]["value"]
    fingerprint = hashlib.sha256(
        json.dumps(
            [(f["scene"]["source_hash"], f["transform"]) for f in sources], allow_nan=False
        ).encode()
    ).hexdigest()
    return {
        "schema_version": "hephaestus.building.v1",
        "building_id": building["id"],
        "job_id": ":".join(j["id"] for j in jobs),
        "source_hash": fingerprint,
        "unit": "m",
        "source_kind": "multiple",
        "name": "Building · " + " + ".join(f"F{f['number']}" for f in sources),
        "revision": ".".join(str(s["revision"]) for s in scenes),
        "alignment_revision": building["generation"],
        "floors": sources,
        "components": result,
        "parameters": {},
        "warnings": warnings,
        "alignment": "User-confirmed source-origin offsets; paired PNG/SVG registration is not inferred.",
    }
