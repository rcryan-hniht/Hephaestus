"""Local asynchronous drawing API. Run one worker; this prototype has no public auth."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import Field

from config import Settings
from contracts import Proposal, StrictModel
from jobs import JobError, Jobs


class Generation(StrictModel):
    generation: int = Field(ge=1)


class Answers(Generation):
    values: dict[str, float | bool] = Field(default_factory=dict, max_length=7)
    unknown: list[str] = Field(default_factory=list, max_length=7)
    component_values: dict[str, dict[str, float]] = Field(default_factory=dict, max_length=2000)


class ImportProposal(Generation):
    proposal: Proposal
    component_values: dict[str, dict[str, float]] = Field(default_factory=dict, max_length=2000)


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
            if size > self.limit:
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


def create_app(settings: Settings | None = None, inference=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = Jobs(settings, inference)
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
        return JSONResponse(status_code=exc.status, content={"detail": str(exc)})

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
        return {
            "formats": ["png", "svg"],
            "max_upload_bytes": settings.max_upload_bytes,
            "max_image_pixels": settings.max_image_pixels,
            "schema_version": "hephaestus.scene.v1",
            "requested_model": settings.model,
            "engine": "cubicasa5k-pytorch",
            "inference_configured": True,
            "model_availability": "checked before each PNG inference",
            "export_formats": ["scene.json"],
            "single_floor": True,
        }

    @app.post("/api/jobs", status_code=202)
    async def submit(request: Request, file: UploadFile):
        try:
            data = await file.read(settings.max_upload_bytes + 1)
            jobs = request.app.state.jobs
            return jobs.public(await jobs.submit(data, file.filename or "drawing"))
        finally:
            await file.close()

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

    return app


app = create_app()
