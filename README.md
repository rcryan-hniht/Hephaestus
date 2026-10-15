# Hephaestus

> _From drawing. To space._  
> _Imagination is beginning, hephaestus brings it closer._

Hephaestus turns floor-plan evidence into inspectable 3D architecture. Upload a PNG or semantic SVG, confirm missing dimensions, and explore the reconstructed components alongside the original drawing.

Built for architecture and design students, construction learners, and educators, this is a personal CubiCasa5K research prototype. Its models support spatial exploration and drawing verification; they do not establish structural accuracy or infer a complete building from a single plan.

## What is implemented

- **Architectural landing:** Hero photograph, Manifesto construction demonstration, and Selected Works with a DriftWall gallery of 40 real CubiCasa PNG/SVG pairs. Three samples have dedicated explore actions.
- **Four villa presets:** 3F villa, Terrace Villa, Portal Villa, and Gable Villa. These synthetic SVG plans include explicit roof and internal stair geometry with editable suggested dimensions.
- **Automatic construction showcase:** Each preset runs for 18 seconds, rises from its plan, completes a 360° orbit through solid, wireframe, and transparent modes, then sinks back into a drawing and fades to the next preset. The landing uses prepared geometry without requiring a running API. Reduced motion shows a complete, static model.
- **Drawing workspace:** Source preview with pan/zoom, linked component selection where source metadata permits, editable parameters and footprints, floor visibility, perspective/plan/elevation views, section clipping, measurement, and model fitting.
- **Retained processing:** Asynchronous jobs, actual stage feedback, missing-data questions, cancellation, retry, undo/redo, and retention of a valid model when its replacement fails.
- **Multi-floor buildings:** Paired PNG/SVG sources, independent floor jobs, confirmed scale and height, and explicit horizontal alignment before assembly.
- **Exports:** Component-preserving GLB, scene/provenance JSON, and native `.blend` through the backend's headless Blender CLI when available.

## Reconstruction paths

| Input | Current behavior |
| --- | --- |
| Semantic SVG | Backend parses labeled vector geometry and transforms directly. Supported evidence includes walls, rooms/slabs, columns, openings, explicit gable/shed roofs, and straight stair flights. |
| PNG | Local CubiCasa5K 44-channel HourglassNet proposes footprints and openings; Shapely/SciPy post-processing produces candidates for review. CPU is the default. A pretrained checkpoint is required. |
| Optional PNG comparison | Explicitly select OpenRouter with `qwen/qwen2.5-vl-72b-instruct`. Credentials and requests stay in the backend; unavailable engines are reported without substitution. |
| ASCII DXF | Limited browser-only extrusion of straight, closed `LWPOLYLINE` boundaries on wall, column, or slab layers. Units and height require confirmation. |
| JPG/JPEG | Preview-only in the workspace. The backend job API can separately normalize these images to PNG for inference. |

An arbitrary SVG illustration is not automatically a semantic floor plan. Missing scale, height, opening dimensions, and supported roof/stair parameters require confirmation. Suggested values remain assumptions until accepted; PNG extraction does not invent extra floors, roofs, or stairs.

## Run locally

Install Bun, Python 3.14+, and uv. The launcher installs locked dependencies, builds the frontend, and starts both services:

```sh
git clone https://github.com/rcryan-hniht/Hephaestus.git
cd Hephaestus
./start.sh
```

| Service | Address |
| --- | --- |
| Frontend preview | http://localhost:3000 |
| Backend API docs | http://localhost:8000/docs |
| Backend health | http://localhost:8000/health |

`Ctrl+C` stops both processes. `PORT` changes the frontend preview port; `BACKEND_PORT` changes the backend port and Vite proxy target. These port settings apply to `start.sh`; the backend container uses `PORT` for its own HTTP port.

SVG reconstruction and the prepared landing showcase work without a PNG checkpoint or OpenRouter key. PNG inference requires the configuration below.

### Development servers

For frontend hot reload, run these in separate terminals from the repository root:

```sh
uv sync --directory backend --frozen --no-dev
uv run --directory backend --frozen --no-sync uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```sh
cd frontend
bun install --frozen-lockfile
bun run dev
```

Vite normally serves http://localhost:5173 and proxies `/api/` to the local backend. If you use another browser origin, include it in `HEPHAESTUS_CORS_ORIGINS`.

## Backend configuration

Shell environment variables or an optional repository-root `.env` configure the backend. If `.env` exists, it must be private: `chmod 600 .env`. Keep it out of Git.

| Variable | Purpose / default |
| --- | --- |
| `HEPHAESTUS_INFERENCE_ENGINE` | `cubicasa` by default; `openrouter` explicitly selects hosted comparison. |
| `CUBICASA_MODEL_PATH` | Existing checkpoint path. Defaults to `<HEPHAESTUS_DATA_DIR>/models/model_best_val_loss_var.pkl`. |
| `HEPHAESTUS_ALLOW_WEIGHT_DOWNLOAD` | Downloads are disabled unless this is explicitly set to `1`. |
| `HEPHAESTUS_DATA_DIR` | SQLite, retained drawings, scenes, and checkpoints. Defaults to `backend/data/`. |
| `OPENROUTER_API_KEY` | Required only for OpenRouter comparison. Backend-only secret. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1`; other base URLs are rejected. |
| `HEPHAESTUS_CORS_ORIGINS` | Comma-separated allowed browser origins; defaults include localhost ports 3000 and 5173. |

To use an existing local checkpoint:

```sh
export CUBICASA_MODEL_PATH=/absolute/path/to/model_best_val_loss_var.pkl
./start.sh
```

For optional OpenRouter comparison, set `HEPHAESTUS_INFERENCE_ENGINE=openrouter` and your API key in the backend environment. Never put the key in a `VITE_` variable. The backend checks the exact configured model's availability before inference.

Run one API process/worker per data directory. The application has no public-user authentication; keep experiments and retained source drawings private.

## Build a preset or multi-floor drawing

1. Open the workspace and load a villa preset, or select files named `F1.svg`, `F2.svg`, etc. Paired images such as `F1.png` and `F1.svg` stay associated with the same floor; SVG takes precedence for reconstruction.
2. For a preset, use **Use villa parameters** to fill its suggestions. Review scale, heights, component dimensions, and offsets. Existing typed values are preserved.
3. Click **Confirm and build** once to confirm all pending floors whose required fields are complete.
4. When every floor is ready, review offsets and use **Confirm alignment and assemble** to publish the combined building.

Batch limits are 8 consecutive floors starting at F1, 16 files, 10 MB per file, and 40 MB total. Single images are limited to 20 megapixels; browser DXF input is limited to 5 MB.

Floor jobs retain their own source hashes, corrections, and revisions. Building scenes use `hephaestus.building.v1` and retain their constituent `hephaestus.scene.v1` sources and confirmed transforms. Backend state persists on disk; the browser does not automatically reopen a building after a page reload.

## Architecture and repository map

The frontend owns its Three.js scene graph. FastAPI manages source-bound jobs and building assembly; SQLite and local files retain metadata and artifacts. SVG extraction and PNG inference feed the same validated scene contract before deterministic mesh construction.

![Hephaestus system architecture](media/hephaestus-3d-architecture-visualizer.png)

| Path | Responsibility |
| --- | --- |
| `frontend/src/main.js` | Landing chapters, navigation, and shared render loop. |
| `frontend/src/PresetShowcase.js` | Timed construction, orbit, inspection modes, and drawing fades. |
| `frontend/src/workspace.js` | Uploads, confirmation, editing, assembly, and exports. |
| `frontend/src/scene.js` | Three.js rendering, controls, selection, sections, and materials. |
| `frontend/src/floors.js` / `frontend/src/api.js` | Floor grouping, preset suggestions, and job client. |
| `frontend/src/villa-preset.json` / `frontend/src/drawing-presets.json` | Source hashes and suggested villa parameters. |
| `frontend/src/prepared-presets.json` | Prepared landing geometry generated from the SVG fixtures. |
| `frontend/vite.config.js` | Source root, API proxy, and reference/sample/preset asset emission. |
| `backend/app/main.py` | FastAPI job, building, capability, and export endpoints. |
| `backend/app/services/` | Job lifecycle and retained building manifests. |
| `backend/app/extraction/` | Semantic SVG parser, local CubiCasa inference, and optional OpenRouter. |
| `backend/app/contracts.py` / `backend/app/geometry.py` | Validation, provenance, mesh construction, and assembly. |
| `backend/app/store.py` | SQLite and private artifact persistence. |
| `backend/app/demo_presets.py` | Rebuilds prepared landing geometry from preset sources. |
| `backend/app/evaluation.py` | Read-only dataset manifest and evaluation CLI. |
| `backend/tests/fixtures/` | Synthetic SVG plans and regression fixtures, including the four villas. |
| `assets/` | Tracked runtime Hero image and 40 catalog PNG/SVG pairs; unrelated local references remain ignored. |
| `start.sh` / `compose.yaml` / `render.yaml` | Local launcher, Docker services, and Render backend configuration. |

See the [backend guide](backend/README.md) for API payloads, evidence contracts, and evaluation details. The API also exposes interactive schemas at `/docs` and runtime capabilities at `/api/capabilities`.

When preset drawings or dimensions change, update their recorded source hashes and regenerate the landing geometry:

```sh
cd backend
uv run --frozen --no-dev python -m app.demo_presets
```

The generator rejects stale SVG hashes. Commit the matching fixtures, configuration, and prepared JSON together.

## Deployment

### Frontend: Vercel

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output Directory | `dist` |
| Build environment | `VITE_API_BASE_URL=https://<your-backend-origin>` |

Set backend `HEPHAESTUS_CORS_ORIGINS` to the exact frontend origin. `VITE_API_BASE_URL` is public configuration baked into the frontend build; changing it requires rebuilding.

Vite emits the Hero as `/reference/hero.webp`, gallery pairs under `/samples/`, and villa drawings under `/presets/`. Their source assets and SVG fixtures are tracked in Git so a fresh checkout can build them. Keep generated `dist/` files ignored. Missing source assets show a fallback or unavailable state instead of breaking the build.

### Backend: Render

Use [render.yaml](render.yaml), which builds [backend/Dockerfile](backend/Dockerfile) from the repository root, runs one Uvicorn worker, and checks `/health`. The image includes Blender; pretrained CubiCasa weights are not bundled. Configure a checkpoint location and the chosen inference engine explicitly.

The configured free service has an ephemeral filesystem. Retained jobs, drawings, revisions, and checkpoints need a persistent disk for durable hosted storage. The blueprint's OpenRouter variables alone do not switch the default local inference engine.

### Local Docker

Docker Compose requires a root `.env`, even if it contains no credentials:

```sh
touch .env
chmod 600 .env
docker compose up --build -d
```

The frontend is available at http://localhost:3000 and proxies `/api/` to the backend; API docs are at http://localhost:8000/docs. The named `backend-data` volume retains backend state. `docker compose down` preserves it.

**Current frontend image limitation:** `.dockerignore` excludes `assets/`, and the frontend Dockerfile copies only the modern-villa fixtures. The container therefore lacks the Hero/gallery assets and Terrace/Portal/Gable source drawings. Use the local launcher or Vercel build for the complete visual catalog. The prepared Manifesto models are bundled separately and remain available.

## Checks

Frontend unit tests and production build:

```sh
cd frontend
bun test tests
bun run build
```

Backend tests with development dependencies:

```sh
uv sync --directory backend --frozen
uv run --directory backend --frozen --no-sync pytest -q
uv run --directory backend --frozen --no-sync ruff check .
```

Browser checks live in `frontend/tests/*.browser.mjs` and use Playwright. Their server ports and environment variables vary; follow each script's setup and the [backend browser-test instructions](backend/README.md#run-locally). Routine checks use synthetic fixtures and mocked inference without paid API calls or model downloads.

The original CubiCasa5K dataset is not bundled. The evaluation CLI supports explicit dataset roots, preserves split membership, and writes experiment results outside the dataset. See `python -m app.evaluation --help` from the configured backend environment.
