"""Local asynchronous drawing API. Run one worker; this prototype has no public auth."""

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import Field

from app.config import Settings
from app.contracts import PARAMETER_LIMITS, Proposal, StrictModel
from app.services.buildings import Buildings
from app.services.jobs import JobError, Jobs


class Generation(StrictModel):
    generation: int = Field(ge=1)


class Answers(Generation):
    values: dict[str, int | float | bool] = Field(
        default_factory=dict, max_length=len(PARAMETER_LIMITS) + 1
    )
    unknown: list[str] = Field(default_factory=list, max_length=len(PARAMETER_LIMITS) + 1)
    component_values: dict[str, dict[str, int | float]] = Field(
        default_factory=dict, max_length=2000
    )


class ImportProposal(Generation):
    proposal: Proposal
    component_values: dict[str, dict[str, int | float]] = Field(
        default_factory=dict, max_length=2000
    )


class FloorOffset(StrictModel):
    number: int = Field(ge=1, le=8)
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)


class BuildingAlignment(Generation):
    offsets: list[FloorOffset] = Field(min_length=1, max_length=8)


class BodyLimit:
    """Bound the body before multipart parsing/spooling, including chunked uploads."""

    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        parts, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            limit = 44 * 1024 * 1024 if scope["path"] == "/api/buildings" else self.limit
            if size > limit:
                return await JSONResponse(
                    status_code=413, content={"detail": "Request exceeds drawing upload limit"}
                )(scope, receive, send)
            parts.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        body = b"".join(parts)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def _convert_glb_to_blend(data: bytes, blender_bin: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmpdir:
        in_glb = os.path.join(tmpdir, "model.glb")
        out_blend = os.path.join(tmpdir, "model.blend")
        with open(in_glb, "wb") as f:
            f.write(data)

        script = (
            "import bpy\n"
            "bpy.ops.wm.read_factory_settings(use_empty=True)\n"
            f"bpy.ops.import_scene.gltf(filepath=r'{in_glb}')\n"
            f"bpy.ops.wm.save_as_mainfile(filepath=r'{out_blend}')\n"
        )
        proc = subprocess.run(
            [blender_bin, "--background", "--python-expr", script],
            capture_output=True,
            check=False,
            timeout=45,
        )
        if proc.returncode != 0 or not os.path.exists(out_blend):
            err = proc.stderr.decode(errors="replace")[-300:] or "Conversion failed"
            raise RuntimeError(f"Blender conversion error: {err}")

        with open(out_blend, "rb") as f:
            return f.read()


def create_app(settings: Settings | None = None, inference=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = Jobs(settings, inference)
        app.state.buildings = Buildings(app.state.jobs)
        app.state.jobs.recover()
        yield
        await app.state.jobs.close()

    app = FastAPI(title="Hephaestus", version="0.2.0", lifespan=lifespan)
    app.add_middleware(
        BodyLimit,
        limit=settings.max_upload_bytes + 1024 * 1024
        if settings.max_upload_bytes > 1024
        else settings.max_upload_bytes,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition"],
    )

    @app.exception_handler(JobError)
    async def job_error(request, exc):
        import logging

        logging.getLogger("uvicorn.error").warning("JobError [%s]: %s", exc.status, exc)
        return JSONResponse(status_code=exc.status, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        import logging

        issues = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        logging.getLogger("uvicorn.error").warning(
            "Request validation failed on %s", request.url.path
        )
        return JSONResponse(status_code=422, content={"detail": issues})

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/projects")
    def projects():
        return {
            "projects": [
                {
                    "id": "rose-pine-pavilion",
                    "name": "Rosé Pine Pavilion",
                    "status": "study model",
                    "materials": ["pine", "iris", "overlay", "base"],
                }
            ]
        }

    @app.get("/api/capabilities")
    def capabilities():
        local = settings.inference_engine == "cubicasa"
        configured = bool(settings.api_key)
        if local:
            from app.extraction.cubicasa.weights_manager import get_weights_path

            path = get_weights_path()
            configured = path.is_file() and path.stat().st_size > 10_000_000
        blender_available = bool(shutil.which("blender") or os.path.isfile("/snap/bin/blender"))
        return {
            "formats": ["png", "svg", "jpg", "jpeg"],
            "max_upload_bytes": settings.max_upload_bytes,
            "max_image_pixels": settings.max_image_pixels,
            "schema_version": "hephaestus.scene.v1",
            "requested_model": "CubiCasa5k-Hourglass" if local else settings.model,
            "engine": "cubicasa5k-pytorch" if local else "openrouter",
            "inference_configured": configured,
            "model_availability": "validated before each image inference",
            "export_formats": ["scene.json", "glb"] + (["blend"] if blender_available else []),
            "blender_available": blender_available,
            "single_floor": True,
            "building_batch": {
                "max_floors": 8,
                "max_files": 16,
                "max_total_bytes": 40 * 1024 * 1024,
                "schema_version": "hephaestus.building.v1",
            },
        }

    @app.post("/api/jobs", status_code=202)
    async def submit(request: Request, file: UploadFile):
        try:
            data = await file.read(settings.max_upload_bytes + 1)
            jobs = request.app.state.jobs
            return jobs.public(await jobs.submit(data, file.filename or "drawing"))
        finally:
            await file.close()

    @app.post("/api/buildings", status_code=202)
    async def submit_building(request: Request, files: list[UploadFile]):
        try:
            if not 1 <= len(files) <= 16:
                raise JobError(422, "Select at most 16 drawings")
            drawings = [
                (f.filename or "drawing", await f.read(settings.max_upload_bytes + 1))
                for f in files
            ]
            return await request.app.state.buildings.submit(drawings)
        finally:
            for file in files:
                await file.close()

    @app.get("/api/buildings/{building_id}")
    def building_status(building_id: str, request: Request):
        return request.app.state.buildings.get(building_id)

    @app.post("/api/buildings/{building_id}/alignment")
    def building_alignment(building_id: str, body: BuildingAlignment, request: Request):
        return request.app.state.buildings.align(building_id, body.generation, body.offsets)

    @app.post("/api/buildings/{building_id}/cancel")
    def building_cancel(building_id: str, body: Generation, request: Request):
        return request.app.state.buildings.cancel(building_id, body.generation)

    @app.get("/api/buildings/{building_id}/scene")
    def building_scene(building_id: str, request: Request):
        return request.app.state.buildings.scene(building_id)

    @app.get("/api/buildings/{building_id}/floors/{number}/sources/{index}")
    def building_source(building_id: str, number: int, index: int, request: Request):
        data, kind = request.app.state.buildings.source(building_id, number, index)
        return Response(
            data,
            media_type="image/png" if kind == "png" else "application/octet-stream",
            headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"},
        )

    @app.get("/api/jobs/{job_id}")
    def status(job_id: str, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(jobs.get(job_id))

    @app.get("/api/jobs/{job_id}/source")
    def source(job_id: str, request: Request):
        jobs = request.app.state.jobs
        job = jobs.get(job_id)
        return Response(
            jobs.store.read_source(job),
            media_type="image/png" if job["source_kind"] == "png" else "application/octet-stream",
            headers={
                "Content-Disposition": 'attachment; filename="source.' + job["source_kind"] + '"',
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox",
            },
        )

    @app.get("/api/jobs/{job_id}/proposal")
    def proposal(job_id: str, request: Request):
        job = request.app.state.jobs.get(job_id)
        if job["proposal"] is None:
            raise JobError(409, "Extraction proposal is not available")
        return {"generation": job["generation"], "proposal": job["proposal"]}

    @app.get("/api/jobs/{job_id}/attempts")
    def attempts(job_id: str, request: Request):
        return {"attempts": request.app.state.jobs.get(job_id)["attempts"]}

    @app.post("/api/jobs/{job_id}/proposal", status_code=202)
    async def import_proposal(job_id: str, body: ImportProposal, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(
            jobs.import_proposal(job_id, body.generation, body.proposal, body.component_values)
        )

    @app.post("/api/jobs/{job_id}/answers", status_code=202)
    async def answers(job_id: str, body: Answers, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(
            jobs.answers(job_id, body.generation, body.values, body.unknown, body.component_values)
        )

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel(job_id: str, body: Generation, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(jobs.cancel(job_id, body.generation))

    @app.post("/api/jobs/{job_id}/retry", status_code=202)
    async def retry(job_id: str, body: Generation, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(jobs.retry(job_id, body.generation))

    @app.post("/api/jobs/{job_id}/undo")
    async def undo(job_id: str, body: Generation, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(jobs.history(job_id, body.generation, -1))

    @app.post("/api/jobs/{job_id}/redo")
    async def redo(job_id: str, body: Generation, request: Request):
        jobs = request.app.state.jobs
        return jobs.public(jobs.history(job_id, body.generation, 1))

    @app.get("/api/jobs/{job_id}/scene")
    def scene(job_id: str, request: Request):
        return request.app.state.jobs.scene(job_id)

    @app.get("/api/jobs/{job_id}/export")
    def export(job_id: str, request: Request):
        scene = request.app.state.jobs.scene(job_id)
        return Response(
            json.dumps(scene, allow_nan=False),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="hephaestus-scene.json"'},
        )

    @app.post("/api/export/blend")
    async def export_blend(request: Request):
        data = await request.body()
        if not data:
            raise JobError(422, "No 3D model data provided")
        if len(data) > settings.max_upload_bytes:
            raise JobError(422, "Model exceeds configured size limit")
        if len(data) < 4 or data[:4] != b"glTF":
            raise JobError(422, "Invalid GLB binary data")

        blender_bin = shutil.which("blender") or (
            "/snap/bin/blender" if os.path.exists("/snap/bin/blender") else None
        )
        if not blender_bin:
            raise JobError(503, "Blender executable not found on server")

        try:
            blend_bytes = await asyncio.to_thread(_convert_glb_to_blend, data, blender_bin)
        except TimeoutError as err:
            raise JobError(504, "Blender conversion timed out") from err
        except RuntimeError as err:
            raise JobError(500, str(err)) from err

        return Response(
            blend_bytes,
            media_type="application/x-blender",
            headers={
                "Content-Disposition": 'attachment; filename="model.blend"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    return app


app = create_app()
