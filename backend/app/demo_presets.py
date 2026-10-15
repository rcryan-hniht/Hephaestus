"""Regenerate landing demos: cd backend && uv run python -m app.demo_presets."""

import hashlib
import json
from pathlib import Path

from app.extraction.svg import extract_svg
from app.geometry import assemble_building, build_scene

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "frontend/src/prepared-presets.json"


def prepare_presets():
    presets = [
        {
            **json.loads((ROOT / "frontend/src/villa-preset.json").read_text()),
            "id": "modern",
            "folder": "modern_villa",
        },
        *json.loads((ROOT / "frontend/src/drawing-presets.json").read_text()),
    ]
    demos = []
    for preset in presets:
        floors, jobs, scenes = [], [], []
        for floor in preset["floors"]:
            number = floor["number"]
            data = (ROOT / f"backend/tests/fixtures/{preset['folder']}/F{number}.svg").read_bytes()
            source_hash = hashlib.sha256(data).hexdigest()
            if source_hash != floor["source_hash"]:
                raise ValueError(f"Stale source hash: {preset['id']} F{number}")
            job_id = f"demo-{preset['id']}-F{number}"
            proposal = extract_svg(data, job_id, source_hash)
            overrides = {
                c.id: floor["components"][c.source.element_id]
                for c in proposal.components
                if c.source.element_id in floor["components"]
            }
            scenes.append(build_scene(proposal, floor["parameters"], 1, overrides))
            floors.append(
                {
                    "number": number,
                    "offset_x": floor["offsetX"],
                    "offset_y": floor["offsetY"],
                    "sources": [],
                }
            )
            jobs.append(
                {
                    "id": job_id,
                    "name": f"F{number}.svg",
                    "source_hash": source_hash,
                    "state": "ready",
                    "active_revision": 1,
                }
            )
        scene = assemble_building(
            {"id": preset["id"], "generation": 1, "floors": floors}, jobs, scenes
        )
        components = []
        for c in scene["components"]:
            components.append(
                {
                    **{
                        key: c[key]
                        for key in [
                            "id",
                            "floor",
                            "polygon",
                            "height",
                            "elevation",
                            "mesh",
                            "selection_mesh",
                            "opening",
                            "source",
                        ]
                    },
                    "type": "slab" if c["type"] == "room" else c["type"],
                    "backendGeometry": True,
                }
            )
        demos.append(
            {
                "id": preset["id"],
                "name": preset["name"],
                "sample": True,
                "backend": True,
                "configuration_hash": hashlib.sha256(
                    json.dumps(preset, sort_keys=True).encode()
                ).hexdigest(),
                "components": components,
            }
        )
    # Keep display geometry compact; the source drawings retain their full precision.
    return json.loads(json.dumps(demos), parse_float=lambda value: round(float(value), 6))


if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(prepare_presets(), separators=(",", ":"), allow_nan=False) + "\n")
