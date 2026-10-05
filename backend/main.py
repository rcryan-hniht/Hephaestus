"""Hephaestus backend — serves project data for the 3D visualizer."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Hephaestus", version="0.1.0")

# the frontend origin varies (Vercel preview URLs), so allow all origins
# on read-only endpoints; there is no auth or write surface yet
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/projects")
def projects() -> dict:
    """The study model currently shown in the hero scene."""
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
