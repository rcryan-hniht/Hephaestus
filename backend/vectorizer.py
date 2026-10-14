"""CubiCasa5k PyTorch vectorization pipeline.

Transforms 2D floor-plan images into validated 3D architectural geometry proposals
(walls, rooms, doors, windows) adhering to `hephaestus.scene.v1`.
"""

from __future__ import annotations

import io
import logging

import numpy as np
import torch

try:
    from contracts import Component, CoordinateFrame, Proposal
    from cubicasa_post import get_polygons, split_prediction
    from weights_manager import get_cubicasa_model
except ImportError:
    from backend.contracts import Component, CoordinateFrame, Proposal
    from backend.cubicasa_post import get_polygons, split_prediction
    from backend.weights_manager import get_cubicasa_model
from PIL import Image
from shapely.geometry import Polygon

logger = logging.getLogger(__name__)

ROOM_CLASS_NAMES = [
    "Background",
    "Outdoor",
    "Wall",
    "Kitchen",
    "Living Room",
    "Bedroom",
    "Bath",
    "Hallway",
    "Railing",
    "Storage",
    "Garage",
    "Other room",
]


def _clean_polygon(coords: list[tuple[float, float]], min_area: float = 1.0) -> list[tuple[float, float]] | None:
    """Validate and clean a 2D polygon using Shapely, ensuring simple non-zero area."""
    if len(coords) < 3:
        return None
    poly = Polygon(coords)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.geom_type != "Polygon" or poly.is_empty or poly.area < min_area:
        return None
    exterior = list(poly.exterior.coords)
    if len(exterior) > 1 and exterior[0] == exterior[-1]:
        exterior = exterior[:-1]
    if len(exterior) < 3:
        return None
    return [(float(x), float(y)) for x, y in exterior]


def vectorize_floorplan(
    image_bytes: bytes,
    job_id: str,
    source_hash: str,
    max_side: int = 512,
    threshold: float = 0.4,
    device: str = "cpu",
) -> Proposal:
    """Run CubiCasa5k neural network inference and vectorize floor plan geometry."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, "white")
        bg.alpha_composite(img)
        rgb_img = bg.convert("RGB")
        orig_w, orig_h = rgb_img.size

    # Scale maintaining aspect ratio with dimensions rounded to multiples of 32
    scale = max_side / max(orig_h, orig_w)
    new_w = max(32, int(round(orig_w * scale / 32) * 32))
    new_h = max(32, int(round(orig_h * scale / 32) * 32))

    resized = rgb_img.resize((new_w, new_h), Image.Resampling.BILINEAR)
    arr = np.array(resized, dtype=np.float32)

    # Tensor format: (1, 3, H, W) normalized to [-1, 1]
    tensor = 2.0 * (torch.from_numpy(arr).permute(2, 0, 1) / 255.0) - 1.0
    tensor = tensor.unsqueeze(0).to(device)

    model = get_cubicasa_model(device)
    with torch.no_grad():
        pred = model(tensor)

    # Split output into heatmaps, rooms, icons
    split_lens = [21, 12, 11]
    heatmaps, rooms, icons = split_prediction(pred.cpu(), (new_h, new_w), split_lens)

    # Extract raw geometry from CubiCasa post-processing
    all_opening_types = [1, 2]  # 1: Window, 2: Door
    raw_polygons, raw_types, raw_room_polygons, raw_room_types = get_polygons(
        (heatmaps, rooms, icons), threshold, all_opening_types
    )

    sx = new_w / orig_w
    sy = new_h / orig_h

    components: list[Component] = []
    wall_shapely_polys: list[Polygon] = []

    # 1. Extract Wall components
    for idx, (poly, t) in enumerate(zip(raw_polygons, raw_types)):
        if t.get("type") == "wall":
            scaled_coords = [
                (float(np.clip(x / sx, 0, orig_w)), float(np.clip(y / sy, 0, orig_h)))
                for x, y in poly
            ]
            clean = _clean_polygon(scaled_coords, min_area=2.0)
            if clean:
                comp_id = f"{job_id}:f0:wall_{idx}"
                sp = Polygon(clean)
                wall_shapely_polys.append(sp)
                components.append(
                    Component(
                        id=comp_id,
                        type="wall",
                        floor=0,
                        label="Wall",
                        polygon=clean,
                        confidence=0.92,
                    )
                )

    # 2. Extract Openings (Doors and Windows) that intersect at least one wall
    for idx, (poly, t) in enumerate(zip(raw_polygons, raw_types)):
        kind = t.get("type")
        if kind in ("door", "window"):
            scaled_coords = [
                (float(np.clip(x / sx, 0, orig_w)), float(np.clip(y / sy, 0, orig_h)))
                for x, y in poly
            ]
            clean = _clean_polygon(scaled_coords, min_area=1.0)
            if clean:
                sp = Polygon(clean)
                # In hephaestus.scene.v1, geometry building strictly requires openings to intersect a wall
                if any(sp.intersection(w).area > 1e-4 for w in wall_shapely_polys):
                    comp_id = f"{job_id}:f0:{kind}_{idx}"
                    components.append(
                        Component(
                            id=comp_id,
                            type=kind,
                            floor=0,
                            label=kind.capitalize(),
                            polygon=clean,
                            confidence=0.86,
                        )
                    )

    # 3. Extract Room components
    for idx, (room_poly, rtype) in enumerate(zip(raw_room_polygons, raw_room_types)):
        cls_idx = rtype.get("class", 11)
        label = (
            ROOM_CLASS_NAMES[cls_idx]
            if 0 <= cls_idx < len(ROOM_CLASS_NAMES)
            else "Room"
        )
        if hasattr(room_poly, "exterior"):
            scaled_coords = [
                (float(np.clip(x / sx, 0, orig_w)), float(np.clip(y / sy, 0, orig_h)))
                for x, y in room_poly.exterior.coords[:-1]
            ]
            clean = _clean_polygon(scaled_coords, min_area=10.0)
            if clean:
                comp_id = f"{job_id}:f0:room_{idx}"
                components.append(
                    Component(
                        id=comp_id,
                        type="room",
                        floor=0,
                        label=label,
                        polygon=clean,
                        confidence=0.89,
                    )
                )

    # Fallback: if no walls were recognized (e.g., highly stylized or degenerate image),
    # generate a perimeter bounding wall to guarantee valid architectural reconstruction.
    if not components:
        margin = min(orig_w, orig_h) * 0.05
        perimeter = [
            (margin, margin),
            (orig_w - margin, margin),
            (orig_w - margin, orig_h - margin),
            (margin, orig_h - margin),
        ]
        components.append(
            Component(
                id=f"{job_id}:f0:wall_0",
                type="wall",
                floor=0,
                label="Exterior Wall",
                polygon=perimeter,
                confidence=0.5,
                uncertainty="Fallback perimeter wall generated due to sparse recognition",
            )
        )

    preprocessing_transform = [sx, 0.0, 0.0, sy, 0.0, 0.0]

    return Proposal(
        schema_version="hephaestus.scene.v1",
        job_id=job_id,
        source_hash=source_hash,
        source_kind="png",
        coordinate_frame=CoordinateFrame(
            width=orig_w,
            height=orig_h,
            unit="pixel",
            preprocessing_transform=preprocessing_transform,
        ),
        components=components,
        meters_per_unit=None,
        dimensions=[],
    )
