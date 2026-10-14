"""Single-process research job lifecycle. Generation tokens reject stale work."""

import asyncio
import hashlib
import json
import time
import uuid

from app.config import Settings
from app.contracts import (
    Proposal,
    missing_parameters,
    required_parameters,
    validate_component_parameters,
    validate_parameters,
)
from app.extraction.inference import CubiCasaInference, InferenceError, OpenRouter, validate_png
from app.extraction.svg import extract_svg, validate_svg
from app.geometry import build_scene
from app.store import Store

ACTIVE = {"queued", "extracting", "awaiting_ai_result", "validating", "building"}
SUGGESTIONS = {
    "floor_height": (2.7, "Illustrative residential floor height; verify your project."),
    "slab_thickness": (0.2, "Illustrative slab thickness; this plan does not specify it."),
    "door_height": (2.1, "Illustrative door opening height; verify against a section."),
    "window_height": (1.2, "Illustrative window opening height; verify your project."),
    "window_sill": (0.9, "Illustrative window sill height; verify against an elevation."),
    "roof_rise": (1.2, "Illustrative roof rise; confirm from an elevation or section."),
    "roof_thickness": (0.2, "Illustrative vertical roof thickness; confirm construction detail."),
    "stair_height": (2.7, "Illustrative total stair rise; confirm floor-to-floor height."),
    "stair_steps": (16, "Illustrative straight-flight step count; confirm from the drawing."),
}


class JobError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Jobs:
    def __init__(self, settings: Settings, inference=None):
        self.settings = settings
        self.store = Store(settings.data_dir)
        if inference is not None:
            self.inference = inference
        elif settings.inference_engine == "openrouter":
            self.inference = OpenRouter(settings)
        else:
            self.inference = CubiCasaInference(settings)
        self.tasks = {}
        self.reserved_submissions = 0
        self.semaphore = asyncio.Semaphore(1)

    def recover(self):
        for job in self.store.all():
            if job["state"] in ACTIVE:
                job.update(
                    state="failed",
                    generation=job["generation"] + 1,
                    error={
                        "code": "interrupted",
                        "message": "Backend stopped during processing. Retry to resume; saved evidence and valid model are retained.",
                    },
                )
                self.store.save(job)

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def get(self, job_id):
        job = self.store.get(job_id)
        if not job:
            raise JobError(404, "Job not found")
        return job

    def check(self, job_id, generation):
        job = self.get(job_id)
        if job["generation"] != generation:
            raise JobError(409, "This job changed; refresh before applying your correction")
        return job

    def capacity(self, new=False, amount=1):
        reserved = self.reserved_submissions
        if (new and self.store.count() + reserved + amount > self.settings.max_jobs) or sum(
            not t.done() for t in self.tasks.values()
        ) + reserved + amount > self.settings.max_pending_jobs:
            raise JobError(
                429,
                "Local experiment capacity reached; wait for processing or archive data offline",
            )

    async def submit(self, data, name, reserved=False):
        self.capacity(new=True, amount=0 if reserved else 1)
        if not data or len(data) > self.settings.max_upload_bytes:
            raise JobError(422, "Empty drawing or file exceeds configured limit")
        name = name.replace("\\", "/").split("/")[-1][:200]
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in ("jpg", "jpeg", "webp"):
            try:
                import io

                from PIL import Image

                with Image.open(io.BytesIO(data)) as img:
                    if getattr(img, "n_frames", 1) != 1:
                        raise ValueError("Only single-frame images are supported")
                    if (
                        img.width * img.height > self.settings.max_image_pixels
                        or max(img.size) > 20000
                    ):
                        raise ValueError("Image exceeds decoded image limits")
                    bg = Image.new("RGB", img.size, "white")
                    if img.mode in ("RGBA", "LA") or (
                        img.mode == "P" and "transparency" in img.info
                    ):
                        bg.paste(img, mask=img.convert("RGBA").split()[3])
                    else:
                        bg.paste(img.convert("RGB"))
                    out = io.BytesIO()
                    bg.save(out, format="PNG")
                    data = out.getvalue()
                    if len(data) > self.settings.max_upload_bytes:
                        raise ValueError("Normalized image exceeds the drawing upload limit")
                kind = "png"
            except Exception as e:
                raise JobError(422, f"Invalid image format: {e}") from e
        elif ext in ("png", "svg"):
            kind = ext
        else:
            raise JobError(422, "Supported input formats are PNG, JPG, and SVG")
        job_id = uuid.uuid4().hex
        source_hash = hashlib.sha256(data).hexdigest()
        try:
            if kind == "png":
                dimensions = await asyncio.to_thread(validate_png, data, self.settings)
                proposal = None
            else:
                _, frame = await asyncio.wait_for(asyncio.to_thread(validate_svg, data), timeout=10)
                dimensions = frame[2:4]
                proposal = None
        except (ValueError, TimeoutError, RecursionError) as e:
            raise JobError(422, str(e) or "Drawing validation timed out") from e
        self.capacity(new=True, amount=0 if reserved else 1)
        job = {
            "id": job_id,
            "name": name,
            "source_kind": kind,
            "inference_engine": self.settings.inference_engine if kind == "png" else "svg",
            "source_hash": source_hash,
            "source_dimensions": list(dimensions),
            "generation": 1,
            "state": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "parameters": {},
            "component_parameters": {},
            "proposal": proposal.model_dump(mode="json") if proposal else None,
            "questions": [],
            "suggestions": {},
            "error": None,
            "attempts": [],
            "history": [],
            "history_cursor": -1,
            "active_revision": None,
            "next_revision": 1,
            "corrections": [],
            "events": [{"state": "queued", "time": time.time()}],
        }
        self.store.write(job_id, "source." + kind, data)
        self.store.save(job)
        self.schedule(job)
        return self.get(job_id)

    def schedule(self, job):
        old = self.tasks.get(job["id"])
        if old and not old.done():
            old.cancel()
        task = asyncio.create_task(self.run(job["id"], job["generation"]))
        self.tasks[job["id"]] = task

        def finished(done):
            if self.tasks.get(job["id"]) is done:
                self.tasks.pop(job["id"], None)

        task.add_done_callback(finished)

    def current(self, job_id, generation):
        job = self.get(job_id)
        return job if job["generation"] == generation and job["state"] != "cancelled" else None

    def update(self, job_id, generation, **values):
        job = self.current(job_id, generation)
        if job is None:
            return None
        if "state" in values and values["state"] != job["state"]:
            job["events"] = (job["events"] + [{"state": values["state"], "time": time.time()}])[
                -200:
            ]
        job.update(values, updated_at=time.time())
        self.store.save(job)
        return job

    async def run(self, job_id, generation):
        try:
            async with self.semaphore:
                async with asyncio.timeout(self.settings.job_timeout):
                    await self.process(job_id, generation)
        except asyncio.CancelledError:
            pass
        except InferenceError as e:
            self.update(
                job_id,
                generation,
                state="failed",
                error={"code": e.code, "message": str(e)},
                attempts=e.attempts,
            )
            self.save_attempts(job_id, generation, e.attempts)
        except (ValueError, TimeoutError) as e:
            self.update(
                job_id,
                generation,
                state="failed",
                error={
                    "code": "timeout" if isinstance(e, TimeoutError) else "validation_failed",
                    "message": str(e) or "Processing timed out; retry with retained source.",
                },
            )
        except Exception as exc:  # noqa: BLE001 — isolate a job failure without exposing internals
            import traceback

            traceback.print_exc()
            self.update(
                job_id,
                generation,
                state="failed",
                error={
                    "code": "processing_failed",
                    "message": f"Processing failed: {exc}",
                },
            )

    def save_attempts(self, job_id, generation, attempts):
        if self.current(job_id, generation):
            self.store.write(
                job_id,
                f"attempts-{generation}.json",
                json.dumps(attempts, allow_nan=False).encode(),
            )

    async def process(self, job_id, generation):
        job = self.update(job_id, generation, state="extracting", error=None)
        if job is None:
            return
        if job["proposal"] is None:
            if job["source_kind"] == "svg":
                p = await asyncio.to_thread(
                    extract_svg, self.store.read_source(job), job_id, job["source_hash"]
                )
                job = self.update(job_id, generation, proposal=p.model_dump(mode="json"))
            else:
                self.update(job_id, generation, state="awaiting_ai_result")
                result = await self.inference.extract(
                    self.store.read_source(job), job_id, job["source_hash"]
                )
                job = self.update(
                    job_id,
                    generation,
                    proposal=result.proposal.model_dump(mode="json"),
                    attempts=result.attempts,
                )
                self.save_attempts(job_id, generation, result.attempts)
            if job is None:
                return
        job = self.update(job_id, generation, state="validating")
        if job is None:
            return
        proposal = Proposal.model_validate(job["proposal"])
        self.validate_binding(job, proposal)
        questions = self.questions(proposal, job["parameters"], job.get("component_parameters", {}))
        if questions:
            self.update(job_id, generation, state="needs_information", questions=questions)
            return
        self.update(job_id, generation, state="building", questions=[])
        version = job["next_revision"]
        scene = await asyncio.to_thread(
            build_scene, proposal, job["parameters"], version, job.get("component_parameters", {})
        )
        job = self.current(job_id, generation)
        if job is None:
            return
        scene["provenance"] = {
            "source_hash": job["source_hash"],
            "generation": generation,
            "extraction": "direct_vector"
            if job["source_kind"] == "svg"
            else "candidate_image_geometry",
            "attempts": [
                {k: v for k, v in a.items() if k != "raw_content"} for a in job["attempts"]
            ],
            "corrections": job["corrections"],
        }
        self.store.write(
            job_id, f"scene-{version}.json", json.dumps(scene, allow_nan=False).encode()
        )
        job["history"] = job["history"][: job["history_cursor"] + 1] + [version]
        job.update(
            state="ready",
            active_revision=version,
            next_revision=version + 1,
            history_cursor=len(job["history"]) - 1,
            questions=[],
            error=None,
            updated_at=time.time(),
        )
        job["events"] = (job["events"] + [{"state": "ready", "time": time.time()}])[-200:]
        self.store.publish(
            job,
            {
                "scene": scene,
                "proposal": job["proposal"],
                "parameters": job["parameters"],
                "component_parameters": job.get("component_parameters", {}),
            },
        )

    def validate_binding(self, job, proposal):
        if (
            proposal.job_id != job["id"]
            or proposal.source_hash != job["source_hash"]
            or proposal.source_kind != job["source_kind"]
        ):
            raise JobError(422, "Proposal job/source identifiers do not match the retained drawing")
        if [proposal.coordinate_frame.width, proposal.coordinate_frame.height] != job[
            "source_dimensions"
        ]:
            raise JobError(422, "Proposal dimensions do not match the retained drawing")
        if job["source_kind"] == "png" and proposal.coordinate_frame.unit != "pixel":
            raise JobError(422, "PNG proposal coordinates must be original-image pixels")

    def questions(self, proposal, parameters, component_parameters):
        result = []
        for key in missing_parameters(proposal, parameters, component_parameters):
            kinds = {
                "door_height": {"door"},
                "window_height": {"window"},
                "window_sill": {"window"},
                "slab_thickness": {"room"},
                "roof_rise": {"roof"},
                "roof_thickness": {"roof"},
                "stair_height": {"stair"},
                "stair_steps": {"stair"},
            }
            override_field = {
                "door_height": "height",
                "window_height": "height",
                "window_sill": "elevation",
                "slab_thickness": "height",
                "roof_rise": "height",
                "roof_thickness": "roof_thickness",
                "stair_height": "height",
                "stair_steps": "steps",
            }.get(key)
            affected = [
                c.id
                for c in proposal.components
                if c.type
                in kinds.get(key, {"wall", "column", "room", "door", "window", "roof", "stair"})
                and (
                    override_field is None
                    or override_field not in component_parameters.get(c.id, {})
                )
                and (key != "stair_steps" or c.steps is None)
            ]
            message = {
                "meters_per_unit": "Confirm meters per source unit, using a known reference length.",
                "review_confirmed": "Review and correct the candidate PNG footprints before confirming them.",
                "stair_steps": "Confirm the number of steps in the straight stair flight.",
                "roof_thickness": "Confirm vertical roof thickness in meters.",
            }.get(key, "Confirm " + key.replace("_", " ") + " in meters.")
            result.append(
                {
                    "key": key,
                    "message": message,
                    "component_ids": affected,
                    "regions": [
                        {"component_id": c.id, "polygon": c.model_dump(mode="json")["polygon"]}
                        for c in proposal.components
                        if c.id in affected
                    ],
                    "provenance": "unknown",
                }
            )
        return result

    def mutate(self, job, state="queued"):
        job.update(
            generation=job["generation"] + 1, state=state, error=None, updated_at=time.time()
        )
        self.store.save(job)
        return job

    def answers(self, job_id, generation, values, unknown, component_values=None):
        job = self.check(job_id, generation)
        if (
            job["state"] in {"cancelled", "queued", "extracting", "awaiting_ai_result"}
            or job["proposal"] is None
        ):
            raise JobError(409, "Wait for extraction or retry the cancelled job before answering")
        if len(job["corrections"]) >= 100:
            raise JobError(429, "Correction history limit reached for this experiment")
        try:
            validate_parameters(values)
            validate_component_parameters(
                Proposal.model_validate(job["proposal"]), component_values or {}
            )
        except ValueError as e:
            raise JobError(422, str(e)) from e
        if any(
            key not in required_parameters(Proposal.model_validate(job["proposal"]))
            for key in unknown
        ):
            raise JobError(422, "Unknown question key")
        for key in unknown:
            value, reason = SUGGESTIONS.get(
                key,
                (
                    None,
                    "Use a measured reference length; there is no safe default for drawing scale or geometry review.",
                ),
            )
            job["suggestions"][key] = {
                "value": value,
                "reason": reason,
                "provenance": "suggested",
                "requires_confirmation": True,
            }
        if not values and not component_values:
            self.store.save(job)
            return job
        self.capacity()
        job["parameters"].update(values)
        saved = job.setdefault("component_parameters", {})
        for component_id, overrides in (component_values or {}).items():
            saved.setdefault(component_id, {}).update(overrides)
        job["corrections"].append(
            {
                "generation": generation + 1,
                "values": values,
                "component_values": component_values or {},
                "time": time.time(),
            }
        )
        self.schedule(self.mutate(job))
        return self.get(job_id)

    def import_proposal(self, job_id, generation, proposal, component_values=None):
        job = self.check(job_id, generation)
        if job["state"] == "cancelled":
            raise JobError(409, "Retry the cancelled job before importing")
        self.validate_binding(job, proposal)
        try:
            validate_component_parameters(proposal, component_values or {})
        except ValueError as e:
            raise JobError(422, str(e)) from e
        self.capacity()
        if len(job["corrections"]) >= 100:
            raise JobError(429, "Correction history limit reached for this experiment")
        job["parameters"].pop("review_confirmed", None)
        old_types = {c["id"]: c["type"] for c in (job["proposal"] or {}).get("components", [])}
        new_types = {c.id: c.type for c in proposal.components}
        job["proposal"] = proposal.model_dump(mode="json")
        job["component_parameters"] = {
            k: v
            for k, v in job.get("component_parameters", {}).items()
            if k in new_types and old_types.get(k) == new_types[k]
        }
        for component_id, values in (component_values or {}).items():
            job["component_parameters"].setdefault(component_id, {}).update(values)
        job["corrections"].append(
            {
                "generation": generation + 1,
                "kind": "proposal_import",
                "component_values": component_values or {},
                "time": time.time(),
            }
        )
        self.schedule(self.mutate(job))
        return self.get(job_id)

    def cancel(self, job_id, generation):
        job = self.check(job_id, generation)
        if job["state"] == "cancelled":
            return job
        task = self.tasks.get(job_id)
        if task:
            task.cancel()
        return self.mutate(job, "cancelled")

    def retry(self, job_id, generation):
        job = self.check(job_id, generation)
        if job["state"] not in {"failed", "cancelled"}:
            raise JobError(409, "Retry is available for failed or cancelled jobs")
        self.capacity()
        self.schedule(self.mutate(job))
        return self.get(job_id)

    def history(self, job_id, generation, direction):
        job = self.check(job_id, generation)
        cursor = job["history_cursor"] + direction
        if not 0 <= cursor < len(job["history"]):
            raise JobError(409, "No saved revision in that direction")
        task = self.tasks.get(job_id)
        if task:
            task.cancel()
        revision = self.store.revision(job_id, job["history"][cursor])
        job.update(
            proposal=revision["proposal"],
            parameters=revision["parameters"],
            component_parameters=revision.get("component_parameters", {}),
            history_cursor=cursor,
            active_revision=job["history"][cursor],
            questions=[],
        )
        return self.mutate(job, "ready")

    def scene(self, job_id):
        job = self.get(job_id)
        if job["active_revision"] is None:
            raise JobError(409, "No validated model is available yet")
        return self.store.revision(job_id, job["active_revision"])["scene"]

    def public(self, job):
        return {
            k: v
            for k, v in job.items()
            if k not in {"proposal", "attempts", "history", "corrections"}
        } | {
            "attempts": [
                {k: v for k, v in a.items() if k != "raw_content"} for a in job["attempts"]
            ],
            "can_undo": job["history_cursor"] > 0,
            "can_redo": job["history_cursor"] + 1 < len(job["history"]),
            "has_model": job["active_revision"] is not None,
        }
