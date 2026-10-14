"""Retained batch sources and source-bound multi-floor assemblies."""

import asyncio
import hashlib
import json
import re
import threading
import uuid

from geometry import assemble_building
from inference import validate_png
from jobs import JobError
from svg import validate_svg


class Buildings:
    def __init__(self, jobs):
        self.jobs = jobs
        self.store = jobs.store
        self.lock = threading.RLock()

    async def submit(self, files):
        if not 1 <= len(files) <= 16 or sum(len(data) for _, data in files) > 40 * 1024 * 1024:
            raise JobError(422, "Select up to 16 drawings, 40 MB total")
        groups = {}
        for name, data in files:
            name = name.replace("\\", "/").split("/")[-1][:200]
            match = re.match(r"^F(\d+)(?:[_. -]|$)", name, re.IGNORECASE)
            kind = name.rsplit(".", 1)[-1].lower()
            if not match or kind not in {"png", "svg"}:
                raise JobError(422, "Use floor prefixes such as F1.png, F1.svg, F2.png")
            if not data or len(data) > self.jobs.settings.max_upload_bytes:
                raise JobError(422, "Each drawing must be non-empty and within the upload limit")
            number = int(match[1])
            groups.setdefault(number, []).append((name, data, kind))
        numbers = sorted(groups)
        if len(numbers) > 8 or numbers != list(range(1, len(numbers) + 1)):
            raise JobError(422, "Use up to 8 consecutive floors starting with F1")
        selected = {}
        for number, sources in groups.items():
            vectors = [s for s in sources if s[2] == "svg"]
            images = [s for s in sources if s[2] == "png"]
            if len(vectors) > 1 or not vectors and len(images) > 1:
                raise JobError(
                    422, f"F{number} has multiple build sources; select one SVG or one PNG"
                )
            selected[number] = vectors[0] if vectors else images[0]
        # Validate every retained source before scheduling any inference.
        try:
            for sources in groups.values():
                for _, data, kind in sources:
                    if kind == "png":
                        await asyncio.to_thread(validate_png, data, self.jobs.settings)
                    else:
                        await asyncio.wait_for(asyncio.to_thread(validate_svg, data), 10)
        except (ValueError, TimeoutError, RecursionError) as exc:
            raise JobError(422, str(exc) or "Drawing validation timed out") from exc
        building = {
            "id": uuid.uuid4().hex,
            "generation": 1,
            "floors": [],
            "alignment_confirmed": False,
            "cancelled": False,
            "active_scene": None,
            "signature": None,
        }
        self.jobs.capacity(new=True, amount=len(numbers))
        self.jobs.reserved_submissions += len(numbers)
        remaining = len(numbers)
        try:
            for number in numbers:
                name, data, _ = selected[number]
                job = await self.jobs.submit(data, name, reserved=True)
                self.jobs.reserved_submissions -= 1
                remaining -= 1
                sources = []
                for index, (source_name, source_data, kind) in enumerate(groups[number]):
                    filename = f"f{number}-source{index}.{kind}"
                    self.store.write(building["id"], filename, source_data)
                    sources.append(
                        {
                            "name": source_name,
                            "size": len(source_data),
                            "kind": kind,
                            "source_hash": hashlib.sha256(source_data).hexdigest(),
                            "used_for_build": source_name == name,
                            "artifact": filename,
                        }
                    )
                building["floors"].append(
                    {
                        "number": number,
                        "job_id": job["id"],
                        "sources": sources,
                        "offset_x": 0,
                        "offset_y": 0,
                    }
                )
        except Exception:
            for floor in building["floors"]:
                job = self.jobs.get(floor["job_id"])
                self.jobs.cancel(job["id"], job["generation"])
            raise
        finally:
            self.jobs.reserved_submissions -= remaining
        self.store.save_building(building)
        return self.get(building["id"])

    def retained(self, building_id):
        building = self.store.get_building(building_id)
        if building is None:
            raise JobError(404, "Building not found")
        return building

    def get(self, building_id):
        with self.lock:
            building = self.retained(building_id)
            jobs = [self.jobs.get(f["job_id"]) for f in building["floors"]]
            states = {j["state"] for j in jobs}
            state = (
                "cancelled"
                if building["cancelled"]
                else next(
                    (
                        s
                        for s in [
                            "failed",
                            "cancelled",
                            "awaiting_ai_result",
                            "extracting",
                            "queued",
                            "validating",
                            "building",
                            "needs_information",
                        ]
                        if s in states
                    ),
                    "ready" if building["alignment_confirmed"] else "needs_information",
                )
            )
            if state == "ready":
                signature = json.dumps(
                    [building["generation"], [(j["id"], j["active_revision"]) for j in jobs]]
                )
                if signature != building["signature"]:
                    snapshots = [self.jobs.scene(j["id"]) for j in jobs]
                    try:
                        scene = assemble_building(building, jobs, snapshots)
                    except ValueError as exc:
                        raise JobError(422, str(exc)) from exc
                    # A correction cannot publish an obsolete assembled snapshot.
                    current = [self.jobs.get(j["id"]) for j in jobs]
                    if [(j["state"], j["active_revision"]) for j in current] != [
                        ("ready", j["active_revision"]) for j in jobs
                    ]:
                        raise JobError(409, "A floor changed during assembly; refresh the building")
                    filename = (
                        "scene-" + hashlib.sha256(signature.encode()).hexdigest()[:16] + ".json"
                    )
                    self.store.write(
                        building_id, filename, json.dumps(scene, allow_nan=False).encode()
                    )
                    building.update(active_scene=filename, signature=signature)
                    self.store.save_building(building)
            return {
                "id": building_id,
                "generation": building["generation"],
                "state": state,
                "alignment_confirmed": building["alignment_confirmed"],
                "has_model": building["active_scene"] is not None,
                "floors": [
                    {k: v for k, v in floor.items() if k != "sources"}
                    | {
                        "job": self.jobs.public(job),
                        "sources": [
                            {k: v for k, v in source.items() if k != "artifact"}
                            for source in floor["sources"]
                        ],
                    }
                    for floor, job in zip(building["floors"], jobs, strict=True)
                ],
            }

    def align(self, building_id, generation, offsets):
        with self.lock:
            building = self.retained(building_id)
            if building["generation"] != generation or building["cancelled"]:
                raise JobError(409, "Building changed or was cancelled; refresh before alignment")
            numbers = [f["number"] for f in building["floors"]]
            if sorted(o.number for o in offsets) != numbers:
                raise JobError(422, "Confirm alignment for every existing floor exactly once")
            by_number = {o.number: o for o in offsets}
            for floor in building["floors"]:
                offset = by_number[floor["number"]]
                floor.update(offset_x=offset.x, offset_y=offset.y)
            building.update(generation=generation + 1, alignment_confirmed=True)
            jobs = [self.jobs.get(f["job_id"]) for f in building["floors"]]
            if all(j["state"] == "ready" for j in jobs):
                try:
                    assemble_building(building, jobs, [self.jobs.scene(j["id"]) for j in jobs])
                except ValueError as exc:
                    raise JobError(422, str(exc)) from exc
            self.store.save_building(building)
            return self.get(building_id)

    def cancel(self, building_id, generation):
        with self.lock:
            building = self.retained(building_id)
            if building["generation"] != generation:
                raise JobError(409, "Building changed; refresh before cancellation")
            building.update(generation=generation + 1, cancelled=True)
            self.store.save_building(building)
            for floor in building["floors"]:
                job = self.jobs.get(floor["job_id"])
                if job["state"] not in {"ready", "failed", "cancelled"}:
                    self.jobs.cancel(job["id"], job["generation"])
            return self.get(building_id)

    def scene(self, building_id):
        try:
            self.get(building_id)
        except JobError as exc:
            if exc.status != 422:
                raise
        building = self.retained(building_id)
        if building["active_scene"] is None:
            raise JobError(409, "All floors and their alignment need confirmation before assembly")
        return json.loads((self.store.root / building_id / building["active_scene"]).read_bytes())

    def source(self, building_id, number, index):
        building = self.retained(building_id)
        floor = next((f for f in building["floors"] if f["number"] == number), None)
        if floor is None or not 0 <= index < len(floor["sources"]):
            raise JobError(404, "Building source not found")
        source = floor["sources"][index]
        return (self.store.root / building_id / source["artifact"]).read_bytes(), source["kind"]
