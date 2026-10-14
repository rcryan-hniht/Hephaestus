# Hephaestus

> *From drawing. To space.*

Hephaestus is an interactive 3D architecture visualizer that bridges 2D architectural drawings (PNG, SVG, DXF) with interactive spatial 3D models.

---

## Features

- **Interactive 3D Viewer**: Real-time orbit, pan, zoom, section clipping, and component inspection powered by Three.js.
- **Drawing-to-Model Workspace**: Inspect source drawings alongside reconstructed 3D geometry with synchronized selection and parameter tuning.
- **Parametric Reconstruction**: Extrudes walls, slabs, rooms, and openings from validated vector contours and architectural proposals.

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh/)
- [Python 3.14+](https://www.python.org/) & [uv](https://docs.astral.sh/uv/)
- [Docker](https://www.docker.com/) *(optional)*

### Running with Docker
```bash
docker compose up --build -d
```
- Frontend: `http://localhost:3000`
- Backend API Docs: `http://localhost:8000/docs`

### Running Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/rcryan-hniht/Hephaestus.git
   cd Hephaestus
   ```

2. **Start the Frontend**:
   ```bash
   cd frontend
   bun install
   bun run dev
   ```
   *Runs at `http://localhost:5173` (proxies `/api` to port 8000).*

3. **Start the Backend**:
   ```bash
   cd backend
   uv sync
   uv run uvicorn main:app --reload --port 8000
   ```
   *Runs at `http://localhost:8000` (interactive docs at `/docs`, health check at `/health`).*

Alternatively, start both with `./start.sh`.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vanilla Three.js, Vite, Bun |
| **Backend** | Python 3.14+, FastAPI, uv, Uvicorn |
| **Containers & Deploy** | Docker Compose, Vercel (frontend), Render (backend) |

---

## Project Structure

```
├── frontend/       # Three.js viewer, drawing workspace UI, Vite app
├── backend/        # FastAPI service, SVG/PNG parsing, geometry reconstruction
├── compose.yaml    # Docker Compose setup
└── start.sh        # Local combined startup script
```

For detailed backend architecture, extraction schemas, and evaluation benchmarks, see [`backend/README.md`](backend/README.md).
