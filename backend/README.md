# Hephaestus backend

Personal CubeCasa5K research backend with retained multi-floor buildings. Python 3.14+, FastAPI,
SQLite and private local artifacts. It accepts PNG and semantic SVG drawings,
asks for missing essential information, and exports inspectable component
meshes in a versioned scene JSON. It has no public-user authentication.

Default PNG engine: local CubiCasa5K/PyTorch on CPU. SVG uses exact vector evidence.
Linux dependencies use the official PyTorch CPU index to avoid unused CUDA
libraries in local and Docker installs. Configure the PyTorch sources explicitly
before installing a GPU runtime.
OpenRouter is an optional comparison engine (`HEPHAESTUS_INFERENCE_ENGINE=openrouter`),
using the explicitly selected `qwen/qwen2.5-vl-72b-instruct`.

Local weights are read from `CUBICASA_MODEL_PATH` or
`<HEPHAESTUS_DATA_DIR>/models/model_best_val_loss_var.pkl` (default `backend/data`).
Missing weights fail clearly; automatic download requires
`HEPHAESTUS_ALLOW_WEIGHT_DOWNLOAD=1`. Tests never require a model download.

## Layout

```text
backend/
├── app/
│   ├── main.py                 # FastAPI application and endpoints
│   ├── config.py               # Backend environment and runtime settings
│   ├── contracts.py            # Validated scene and parameter schemas
│   ├── store.py                # SQLite persistence and local artifacts
│   ├── geometry.py             # Scene meshes and multi-floor assembly
│   ├── evaluation.py           # Read-only dataset evaluation CLI
│   ├── services/
│   │   ├── jobs.py             # Source-bound extraction/build lifecycle
│   │   └── buildings.py        # Batch floors and building manifests
│   └── extraction/
│       ├── svg.py              # Safe vector evidence parsing
│       ├── inference.py        # Local and optional OpenRouter engines
│       └── cubicasa/
│           ├── cubicasa_model.py
│           ├── cubicasa_post.py
│           ├── vectorizer.py
│           └── weights_manager.py
├── tests/                     # Regression tests and synthetic fixtures
└── data/                      # Ignored runtime artifacts and checkpoints
```

Run Python modules from `backend/`: the API entrypoint is `app.main:app`,
and evaluation uses `python -m app.evaluation`. Application imports use the
`app` package; model loading remains deferred until local inference is needed.

## Run locally

From the repository root:

```sh
uv venv backend/.venv --python 3.14
uv pip install --python backend/.venv/bin/python --torch-backend cpu -r backend/requirements.txt
uv run --directory backend --frozen --no-dev uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

`http://localhost:8000/docs` provides the interactive API. `/health` and
`/api/projects` retain their previous contracts. `./start.sh` runs the existing
frontend and API together. The workspace submits PNG/SVG jobs, shows actual
processing stages, asks for missing parameters, and loads validated component
meshes automatically. DXF reconstruction remains local; JPG is preview-only.
The original drawing remains available alongside extracted outlines. Footprint
and component edits, undo/redo, cancellation and retry use job generations;
failed replacements retain the displayed model. Export GLB from the viewport or
scene JSON with source evidence and confirmed parameter provenance.

Vite dev and preview proxy `/api/` to `127.0.0.1:8000`; set `BACKEND_PORT` when
running a different local API port. For Vercel/Render, set the public frontend
build variable `VITE_API_BASE_URL` to the backend origin and add the frontend
origin to backend `HEPHAESTUS_CORS_ORIGINS`. Keep the API key backend-only.

Selected Works uses local CubeCasa validation samples `7813`, `13852` and
`14175`. The original `F1_scaled.png` files and paired `model.svg` files are
copied unchanged to ignored `assets/cubicasa/<id>/drawing.png` and `source.svg`.
Vite serves and bundles those selected assets when present. Missing assets show
an unavailable state without substituting generated drawings or models.
Opening a sample submits its paired SVG and asks for missing scale/height and
opening parameters. No model assumptions are applied and no hosted PNG request
is sent when opening these vector samples. PNG and SVG coordinates remain
separate; a paired filename does not establish their geometric registration.

For a building, select multiple PNG/SVG files once: `F1.png`, `F1.svg`,
`F2.png`, `F2.svg` (suffixes such as `F1_scaled.png` work). The workspace
groups consecutive floor prefixes starting with F1 and uses one SVG per floor
when available; otherwise it submits one PNG. Paired PNG files remain local
comparison sources, not extra AI submissions. Duplicate build sources and
missing floor numbers are rejected before submission. Limits: 8 floors,
16 files, 10 MB per file and 40 MB total.

Each floor keeps its own source-bound job, questions, corrections and history.
`Use all suggestions` fills blank numeric fields in that floor in one action;
it preserves typed values and never supplies scale or checks PNG footprint
review. `Confirm and build` remains explicit. Confirm alignment after every
floor is ready: drawings are normalized by their recorded source origin, moved
by the editable X/Y plan offsets and stacked using confirmed floor heights.
A failed, cancelled or incomplete floor cannot replace the valid building.

The frontend exports `hephaestus.building.v1` JSON containing each original
single-floor `hephaestus.scene.v1` scene, source hash, revision, drawings and
confirmed transform, plus combined components in meters. GLB includes the
per-floor source and transform metadata. `POST /api/buildings` accepts repeated
multipart `files` in one request, retains paired sources and creates source-bound
single-floor jobs. `GET /api/buildings/{id}` reports every floor; `POST .../alignment`
confirms `{generation, offsets: [{number, x, y}]}`; `GET .../scene` publishes the
combined wall-bearing building only after all floors and alignment are ready.
`POST .../cancel` invalidates a batch; `GET .../floors/{number}/sources/{index}`
retrieves retained originals. SQLite building manifests and scene artifacts
survive backend restart. The browser does not automatically reopen a building
on page reload yet; retain the building ID or export its JSON.

A single Export button opens `.glb` and `.blend` options. GLB is produced in the
viewport with floor/source metadata; native `.blend` uses the backend's headless
Blender CLI. The Docker image installs Blender. The menu disables native Blender
export when the server lacks it, and conversion failure does not silently change
the selected format.

Browser integration checks use private temporary jobs and no live AI requests.
Start `backend/.venv/bin/python backend/tests/browser_server.py` from the root,
then `BACKEND_PORT=8765 bun run dev --host 127.0.0.1 --port 4174` in `frontend/`.
Run `node tests/floors.browser.mjs` and `node tests/floors-lifecycle.browser.mjs`
for batch assembly, persistence handoff, independent drafts and failed-source handling.
Run `node tests/export-menu.browser.mjs` for the single-button export flow.
Run `node tests/workspace.browser.mjs` in `frontend/` for SVG reconstruction,
correction recovery, history, export, failed PNG retention and mobile layout.
For PNG, start the test server with `--mock-ai --port 8766`, use another Vite
server with `BACKEND_PORT=8766` on port 4175, then run `node tests/png.browser.mjs`.
The mock exercises OpenRouter request/response parsing without contacting a
provider. `node tests/antigravity.browser.mjs` checks the decorative effect.

The owner-readable repository `.env` supplies `OPENROUTER_API_KEY` and
`OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`. Keys are loaded only by the
backend. Never give them a `VITE_` prefix. `HEPHAESTUS_DATA_DIR` changes the
artifact directory; default is `backend/data/`. `HEPHAESTUS_CORS_ORIGINS` is a
comma-separated list of explicitly allowed browser origins, with localhost
defaults. Run exactly one API process/worker per data directory.

The configured checkpoint is `qwen/qwen2.5-vl-72b-instruct`, explicitly selected
by the owner on 2026-10-14 after the original 7B checkpoint was unavailable.
The 72B identifier was present with image support in the public catalog checked
that day. The backend still rechecks exact availability before every PNG request.
Unavailable models yield `model_unavailable`; no fallback is substituted.
Provenance records the requested and actual model for each attempt. A live
image-chat smoke check on 2026-10-14 used the owner's supplied Flickr image:
the requested and actual model matched, provider Parasail reported 919 tokens
and $0.0007518 cost, with 3.873 seconds measured request latency. This check
tested image chat; architectural PNG reconstruction checks still use fixtures.

## Docker

```sh
docker compose up --build -d
docker compose logs backend
docker compose down
```

Compose builds `frontend/Dockerfile` and `backend/Dockerfile` as separate services.
Frontend serves the built Vite site at `http://localhost:3000` and proxies
`/api/` to the backend on the internal Docker network. Backend API docs stay at
`http://localhost:8000/docs`. Use `docker compose up --build -d backend` to run
only the API. There is no combined root Dockerfile.

Compose loads the ignored root `.env` into the backend at runtime, binds both
published ports to `127.0.0.1`, uses read-only container filesystems and a named
backend data volume.
The backend image runs as UID 10001; the frontend uses unprivileged Nginx.
Images exclude environment files and dataset sources. Local ignored reference
assets are excluded from the Docker context, so the frontend uses its supported
missing-reference fallback. Vercel remains the frontend deployment target.
`docker compose down` preserves the volume; deleting the volume loses
stored sources and revisions. Build the backend alone with:

```sh
docker build -f backend/Dockerfile -t hephaestus-backend:local .
docker run --rm -p 127.0.0.1:8000:8000 --env-file .env -v hephaestus-data:/app/data hephaestus-backend:local
```

`render.yaml` describes the Docker backend; deployment is not automatic.
Its free-instance filesystem is ephemeral. Use local Docker for persistent
experiments; configure a persistent disk and access control before treating a
hosted deployment as durable or publicly usable. `PORT` configures the HTTP
port, with 8000 as the container default.

## API workflow

1. `GET /api/capabilities` lists implemented formats, limits, requested model
   and export format.
2. `POST /api/jobs` accepts a multipart field named `file`; returns HTTP 202
   with a unique job `id`, input hash and `generation`.
3. Poll `GET /api/jobs/{id}` for actual stages: `queued`, `extracting`,
   `awaiting_ai_result`, `validating`, `needs_information`, `building`, `ready`,
   `failed`, or `cancelled`. No invented percentage is returned.
4. Inspect `GET /api/jobs/{id}/proposal` and original
   `GET /api/jobs/{id}/source`. SVG sources are download-only with a sandbox
   policy; never inject source SVG into HTML. Geometry questions include
   component IDs and source polygons for linked drawing selection.
5. Answer `POST /api/jobs/{id}/answers` using the current generation:

   ```json
   {
     "generation": 1,
     "values": {"meters_per_unit": 0.01, "floor_height": 3.0},
     "component_values": {"<component-id>": {"height": 2.1, "elevation": 0.0}}
   }
   ```

   Additional required values depend on the evidence: `slab_thickness`,
   `door_height`, `window_height`, and `window_sill`. Component height/elevation
   overrides can replace opening/slab defaults for those components. Floor
   height and drawing scale remain essential. Height and elevation are meters;
   room elevation is its finished floor level and thickness extends below it.
   PNG geometry also requires `review_confirmed: true` after human review and
   correction. The model cannot confirm its own geometry.

   To say “I don't know”, send `{"generation": 1, "unknown": ["floor_height"]}`.
   Suggestions remain labeled `suggested`, never change parameters, and require
   a later explicit answer. Scale and geometry review have no safe default.
6. Once required information is confirmed, building starts automatically.
   Fetch `GET /api/jobs/{id}/scene` or `/export` for the last valid model.
   Failed edits and pending replacements retain this valid revision.

`POST /api/jobs/{id}/cancel`, `/retry`, `/undo`, and `/redo` take
`{"generation": <current generation>}`. All mutations reject stale generations
with HTTP 409. Interrupted active jobs become `failed` on startup with saved
sources/corrections; retry resumes saved evidence. History records successful
model versions and supports branching after undo. Keep the chosen job ID in
the caller; never accept a response for a different active drawing.

## Evidence and export contract

The version is `hephaestus.scene.v1`; the PNG prompt version is
`architectural-evidence.v3`. `contracts.py` defines the extraction JSON Schema,
also included in OpenAPI's proposal-import request. The proposal includes:

- `job_id`, `source_hash`, `schema_version`, and `source_kind`.
- `coordinate_frame`: original dimensions, origin, downward source Y axis,
  source/pixel units, and original-image-to-preprocessed-image affine transform.
- Components with stable ID, type, floor 0, candidate footprint, label, source
  element ID/occurrence/transform, uncertainty and separate model confidence.
- Visible/hidden dimension text, parsed values/units and optional explicit
  reference endpoints. SVG dimensions alone are not meters. A recognized scale
  needs consistent visible text and reference-length evidence; contradictions
  fail validation. Hidden labels remain hidden evidence.
  Printed areas retain square units such as `m²`; an area and its proposed
  reference endpoints never establish a linear scale.
- Geometric validation issues. Passing polygon validation does not establish
  that a PNG boundary is exact or that text recognition is correct.

`POST /api/jobs/{id}/proposal` accepts
`{"generation": <current>, "proposal": <complete proposal>}`. This supports
offline fixtures and corrected geometry, with strict job/hash/kind/image-size
binding. Proposal import preserves explicit parameters, discards corrections
   for removed or retyped component IDs, and invalidates PNG review confirmation. Model
attempts are retained separately, including malformed output; current records
are available at `/attempts`. Local files preserve older attempt generations.

Scene export retains these identifiers and source polygons, plus:

- Confirmed model unit `m`; model axes are X right, Y up, Z negative source Y.
- `revision`, selectable components, per-component height/elevation, parameter
  provenance (`recognized` or `user_confirmed`), and correction history.
- `mesh.positions` as flat XYZ coordinates and `mesh.indices` as triangle
  indices. Create one Three.js `BufferGeometry` per component, set the position
  attribute and index, call `computeVertexNormals()`, and keep component ID in
  `mesh.userData`. Fit the camera to model bounds without normalizing units.
- Opening components have an empty physical mesh and a separate
  `selection_mesh`. Use that proxy for picking/highlighting; do not render it
  as a physical wall, door leaf or invented glazing. Wall meshes already
  subtract the source opening footprint at confirmed elevations.
- `dimensions.width/depth` are explicitly labeled `axis_aligned_bounds`.
  `footprint_edge_lengths` preserve actual lengths, including rotated edges.
- Provenance records actual reported model/provider, resolution,
  preprocessing, prompt/schema versions, settings, latency and token usage.
  Unknown provider GPU/dtype/quantization/revision information is not invented.

Normalized geometry JSON is the initial export, equivalent to the scene data
needed by Three.js. GLB generation is not implemented. Floors are extruded from
room footprints using confirmed thickness. No roof, site, extra floors,
furniture, finishes, window frames or door leaves are invented.

The synthetic `tests/fixtures/known_rooms.svg` has two rooms and 0.2 m walls at
confirmed scale 0.01, with door/window voids. Its solid, section and enclosed
versions were rendered in Three.js with cast/receive shadows. Rendering needs
shadow-camera bounds around the building and tuned bias; transparent materials
do not reproduce opaque-wall shadow behavior. Runtime lighting and clipping
caps remain the frontend renderer's responsibility.

## Limits and supported vector content

Uploads are capped at 10 MiB, decoded PNGs at 20 million pixels and 20,000
pixels per side. Only one PNG frame is accepted. Inference uses a white
background and resizes to at most 1536 pixels per side, with an explicit
transform. Requests have a 90 s timeout, two total malformed-output attempts,
8192 output tokens and a 2 MiB response limit. Catalog size is capped at 4 MiB;
provider errors are actionable and do not echo credentials or raw headers.

SVG supports semantic classes `Wall`, `Space`, `Column`, `Door`, `Window`,
polygon/rect/closed linear paths, and hierarchical affine transforms. Multiple
direct footprints receive separate IDs. It rejects scripts, entities, image
resources, `use`, stylesheets, active content, external references, unsupported
curved footprints and multiple path contours. Local marker references may be
retained without fetching anything. Ordinary unlabeled line art is not an
automatic semantic reconstruction. Unsupported input fails visibly.

SVG limits are 30,000 XML elements, depth 64, 2000 components, 512 vertices per
footprint and 20,000 total footprint vertices. Coordinates must be finite and
polygons simple with nonzero area. The worker limits processing to 300 s,
pending jobs to 16, total stored jobs to 1000, and correction history to 100
per job. Geometry after scaling must be non-negligible and within 10,000 m of
the model origin. This bounded single-process prototype uses local threads
for CPU work; cancellation prevents publication, while already-running native
CPU operations may finish in the background. It is not a structural-engineering
accuracy claim or a complete building reconstruction service.

## Repeatable CubeCasa experiment

The dataset is read only. Default location is repository `cubicasa5k/` when
present, otherwise `~/Downloads/cubicasa5k/`; `--root` overrides it. Leading
slashes in split entries are dataset-relative. Traversal and symlink escapes
are rejected. Outputs must stay outside the dataset.

From `backend/`:

```sh
.venv/bin/python -m app.evaluation manifest --split val --count 10 --seed 42 --output data/validation-manifest.json
.venv/bin/python -m app.evaluation manifest --split test --count 10 --seed 42 --output data/test-manifest.json
.venv/bin/python -m app.evaluation evaluate --manifest data/validation-manifest.json --output data/vector-validation-report.json
```

Manifests record sample paths, seed and split-file hash. Evaluation verifies
split membership again. The development validation run extracted 7/10 samples;
the other three reported invalid polygons or unsupported SVG content. This is
a vector extraction smoke check, not measured PNG quality. Dataset artifacts
and local reports are ignored by git and excluded from Docker context.

`F1_original.png` and `F1_scaled.png` dimensions/hashes and candidate transforms
are recorded separately. Matching dimensions never claim verified registration.
For offline PNG scoring, supply `--predictions <directory>` with `00.json`,
`01.json`, etc. in manifest order, and `--alignment-confirmations <json-file>`.
Prediction files have `sample`, `image`, `proposal`, optional `correction_count`,
`missing_data_questions`, `api_latency_seconds`, and `reported_token_usage`.
An alignment confirmation maps the sample path to
`{"confirmed": true, "source_hash": "...", "image_to_svg_transform": [a,b,c,d,e,f]}`.
Always withhold the paired SVG from the PNG predictor. The evaluator reads it
only as reference data and never makes hosted inference calls.

Metrics include per-type union IoU, boundary Hausdorff error, spatial component
omissions/extras, count deficits/extras, visible dimension-text matches,
invalid-output rate and supplied experiment operational metrics. Component
matching is greedy one-to-one footprint IoU >= 0.05, an exploratory threshold
recorded in each result. Initial reports use source-coordinate error; include
explicitly confirmed `meters_per_unit` in an alignment confirmation to report
physical error in meters. No real architectural PNG accuracy is claimed
without scored runs.

## Checks

```sh
uv pip install --python backend/.venv/bin/python --group backend/pyproject.toml:dev
cd backend
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

Tests use synthetic PNG/SVG and mocked HTTP, never API credit or dataset
uploads. The current Starlette test client emits a deprecation warning for
its httpx compatibility layer; tests remain passing.
