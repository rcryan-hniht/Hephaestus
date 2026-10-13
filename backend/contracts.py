"""Versioned evidence contract. AI confidence is separate from geometric validation."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import Polygon

SCHEMA_VERSION = "hephaestus.scene.v1"
PROMPT_VERSION = "architectural-evidence.v1"
MAX_COMPONENTS = 2000
MAX_VERTICES = 20000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SourceRef(StrictModel):
    element_id: str | None = Field(default=None, max_length=256)
    occurrence: int | None = None
    text: str | None = Field(default=None, max_length=2000)
    transform: list[float] = Field(
        default_factory=lambda: [1, 0, 0, 1, 0, 0], min_length=6, max_length=6
    )


class Component(StrictModel):
    id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")
    type: Literal["wall", "room", "column", "door", "window"]
    floor: Literal[0] = 0
    label: str | None = Field(default=None, max_length=256)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=512)
    source: SourceRef = Field(default_factory=SourceRef)
    confidence: float | None = Field(default=None, ge=0, le=1)
    uncertainty: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_polygon(self):
        if any(not math.isfinite(n) or abs(n) > 1e7 for p in self.polygon for n in p):
            raise ValueError("Coordinates must be finite and bounded")
        if self.polygon[0] == self.polygon[-1]:
            self.polygon = self.polygon[:-1]
        p = Polygon(self.polygon)
        if not p.is_valid or p.area <= 1e-8 or len(self.polygon) < 3:
            raise ValueError("Footprint must be a simple nonzero-area polygon")
        return self


class CoordinateFrame(StrictModel):
    width: float = Field(gt=0, le=1e7)
    height: float = Field(gt=0, le=1e7)
    origin: tuple[float, float] = (0, 0)
    unit: Literal["source", "pixel"] = "source"
    y_axis: Literal["down"] = "down"
    preprocessing_transform: list[float] = Field(
        default_factory=lambda: [1, 0, 0, 1, 0, 0], min_length=6, max_length=6
    )


class Dimension(StrictModel):
    text: str = Field(max_length=2000)
    position: tuple[float, float]
    visible: bool
    source_element_id: str | None = Field(default=None, max_length=256)
    value: float | None = Field(default=None, gt=0)
    unit: Literal["m", "cm", "mm", "ft", "in"] | None = None
    reference: tuple[tuple[float, float], tuple[float, float]] | None = None


class Proposal(StrictModel):
    schema_version: Literal["hephaestus.scene.v1"] = SCHEMA_VERSION
    job_id: str = Field(max_length=64)
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_kind: Literal["svg", "png"]
    coordinate_frame: CoordinateFrame
    components: list[Component] = Field(min_length=1, max_length=MAX_COMPONENTS)
    dimensions: list[Dimension] = Field(default_factory=list, max_length=2000)
    meters_per_unit: float | None = Field(default=None, gt=1e-8, le=1000)
    validation_issues: list[str] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def validate_evidence(self):
        if len({c.id for c in self.components}) != len(self.components):
            raise ValueError("Component IDs must be unique")
        if sum(len(c.polygon) for c in self.components) > MAX_VERTICES:
            raise ValueError("Drawing contains too many vertices")
        if self.source_kind == "png":
            f = self.coordinate_frame
            if any(
                x < 0 or y < 0 or x > f.width or y > f.height
                for c in self.components
                for x, y in c.polygon
            ):
                raise ValueError("PNG geometry must lie within the original image")
        if self.meters_per_unit is not None:
            conversions = {"m": 1, "cm": 0.01, "mm": 0.001, "ft": 0.3048, "in": 0.0254}
            scales = []
            for d in self.dimensions:
                if d.visible and d.value and d.unit and d.reference:
                    distance = math.dist(*d.reference)
                    if distance <= 0:
                        raise ValueError("Dimension reference has zero length")
                    scales.append(d.value * conversions[d.unit] / distance)
            if not scales or any(abs(s / self.meters_per_unit - 1) > 0.02 for s in scales):
                raise ValueError("Scale requires consistent visible dimension evidence")
        return self


PARAMETER_LIMITS = {
    "meters_per_unit": (1e-8, 1000),
    "floor_height": (0.5, 20),
    "slab_thickness": (0.01, 2),
    "door_height": (0.2, 10),
    "window_height": (0.1, 10),
    "window_sill": (0, 10),
}


def validate_parameters(values: dict) -> dict:
    for key, value in values.items():
        if key == "review_confirmed":
            if type(value) is not bool:
                raise ValueError("Review confirmation must be boolean")
        elif key not in PARAMETER_LIMITS or type(value) not in (float, int):
            raise ValueError(f"Unsupported parameter: {key}")
        else:
            low, high = PARAMETER_LIMITS[key]
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{key} must be between {low} and {high}")
    return values


def required_parameters(p: Proposal) -> list[str]:
    kinds = {c.type for c in p.components}
    keys = ["floor_height"]
    if p.meters_per_unit is None:
        keys.insert(0, "meters_per_unit")
    if "room" in kinds:
        keys.append("slab_thickness")
    if "door" in kinds:
        keys.append("door_height")
    if "window" in kinds:
        keys.extend(["window_height", "window_sill"])
    if p.source_kind == "png":
        keys.append("review_confirmed")
    return keys
