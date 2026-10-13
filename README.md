# 🔥 HEPHAESTUS

**From Drawing to Space.**

Hephaestus is an early-stage educational technology project exploring how AI-assisted architectural drawing interpretation can bridge the gap between 2D architectural drawings and 3D spatial understanding.


---

## 📑 Table of Contents

- [Overview](#-overview)
- [The Problem](#-the-problem)
- [Our Solution](#-our-solution)
- [How It Works](#-how-it-works)
- [Key Features](#-key-features)
- [Target Users and Educational Value](#-target-users-and-educational-value)
- [Current Development Status](#-current-development-status)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [API Endpoints](#-api-endpoints)
- [Development Roadmap](#-development-roadmap)
- [Scope and Limitations](#-scope-and-limitations)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🏛️ Overview

**Hephaestus** is an early-stage project that explores how AI can help learners understand architectural space through interactive 3D visualization.

Architectural drawings communicate building layouts through lines, boundaries, dimensions, and geometric relationships. However, understanding how these two-dimensional representations correspond to a three-dimensional building can be challenging for learners who are still developing their spatial visualization skills.

Hephaestus aims to make this learning process more intuitive through an interactive web application. Its long-term vision is to interpret supported architectural drawings and reconstruct simplified 3D building models that users can rotate, zoom, and explore.

The project focuses on educational visualization rather than professional-grade architectural design or construction documentation.

**Our vision:** Make architectural space easier to understand by connecting 2D drawings with interactive 3D representations.

## 🎯 The Problem

Reading an architectural drawing requires more than recognizing lines and symbols. Learners must mentally translate a flat representation into an understanding of three-dimensional structures.

This can be challenging when learning about:

- Building layouts and spatial relationships.
- Wall boundaries and major geometric structures.
- The overall form of a building from a 2D plan.
- The relationship between an architectural drawing and its corresponding 3D representation.

Traditional drawings remain essential to architectural education. However, interactive visualization could provide learners with another way to explore and understand the spaces represented by those drawings.

Hephaestus explores how AI-assisted technology could make that transition from 2D to 3D more accessible.

## 💡 Our Solution

Hephaestus aims to develop an **AI-assisted workflow that transforms supported architectural drawings into simplified, interactive 3D building models**.

The proposed application will combine architectural drawing interpretation, geometric reconstruction, and interactive 3D visualization in a responsive web experience accessible from desktop computers and mobile devices.

The intended workflow begins with an architectural drawing. The system would interpret relevant geometric and spatial information, use that information to create a simplified representation of the building, and allow users to explore the resulting model interactively.

Rather than aiming to reproduce every architectural detail, the initial focus is on the building's overall form, major geometry, and spatial relationships.

## 🔄 How It Works

The proposed workflow consists of four stages:

**1. Input an Architectural Drawing**

Users provide an existing architectural drawing. Capturing a drawing with a phone camera is also part of the intended input experience.

**2. Interpret the Drawing**

The planned AI-assisted pipeline aims to identify relevant geometric boundaries and spatial information from supported drawings.

**3. Reconstruct a Simplified 3D Model**

The system aims to use the interpreted information to generate a simplified 3D representation of the building's overall form.

**4. Explore the Model**

Users will be able to inspect the model from different viewpoints using interactive controls such as rotation and zoom.

Future iterations may also explore a bottom-up assembly animation that visually presents the model as it is built.

**Proposed workflow:**

**2D Architectural Drawing → AI-Assisted Interpretation → Simplified 3D Reconstruction → Interactive Exploration**

This workflow describes the intended product direction. The complete automated AI-assisted reconstruction pipeline is still under development.

## 🧩 Key Features

Hephaestus is being developed incrementally. The following table distinguishes the current prototype from planned functionality.

| Feature | Description | Status |
|---|---|---|
| Interactive 3D viewer | Explore a pre-built 3D demonstration model | Available |
| 3D model interaction | Inspect the model using available viewing controls | Available in the prototype |
| Drawing preview | Preview supported PNG/JPG drawing images | Available |
| DXF geometry workflow | Generate simple geometry from a limited set of supported vector contours | Experimental |
| AI-assisted drawing interpretation | Interpret relevant geometry and spatial information from drawings | Under development |
| Automated blueprint-to-3D reconstruction | Generate a corresponding 3D model from a submitted architectural drawing | Planned |
| Mobile-camera visualization | Explore connections between physical drawings and 3D visualization | Future direction |

The current 3D demonstration uses a pre-built model to illustrate the intended interactive viewing experience. It does not demonstrate that the automated AI reconstruction pipeline has been completed.

## 🎓 Target Users and Educational Value

### Target Users

- **Architecture students** learning to interpret architectural plans and visualize building forms.
- **Civil engineering and construction-related students** developing their understanding of spatial geometry.
- **Educators** looking for interactive learning aids for architectural drawing interpretation.

### Expected Educational Value

Hephaestus aims to support architectural learning in three ways:

**Connecting 2D and 3D**

Help learners relate the lines and boundaries of an architectural drawing to the three-dimensional form they represent.

**Learning Through Interaction**

Allow learners to inspect a building model from different viewpoints rather than relying exclusively on a static drawing.

**Supporting Spatial Understanding**

Provide an additional visual learning approach for exploring building geometry and spatial relationships.

These benefits are expected outcomes, not yet validated research findings. Feedback from students and educators will be important for evaluating their educational value.

## 🚧 Current Development Status

Hephaestus is currently in the early prototype stage.

The team has created a pre-built 3D model that users can interact with to experience the intended model-viewing interface.

The repository also contains an experimental, rule-based DXF geometry workflow for generating simple geometry from certain supported vector boundaries. This workflow relies on geometric rules and assumptions; it is not an AI-powered blueprint understanding system.

The main technical objective is to develop a more capable pipeline that can interpret supported architectural drawings and generate corresponding simplified 3D models.

The current development priorities are:

- Improving the handling of architectural drawing geometry.
- Investigating AI-assisted drawing interpretation.
- Developing the automated drawing-to-3D workflow.
- Testing the generated geometry against representative drawings.
- Evaluating usability and educational value with intended users.

Formal evaluation of reconstruction accuracy and educational outcomes has not yet been established.

## 🛠️ Technology Stack

### Frontend

- **JavaScript** — application logic.
- **Vite** — frontend development server and build tooling.
- **Three.js** — interactive 3D rendering and visualization.
- **Bun** — JavaScript package management and development scripts.

### Backend

- **Python** — backend runtime.
- **FastAPI** — API framework.
- **Uvicorn** — ASGI server.
- **uv** — Python dependency management.

### Deployment and Development Tools

- **Vercel** — frontend hosting.
- **Render** — backend deployment configuration.
- **Docker** — containerization configuration.

The backend currently provides basic health and project metadata endpoints. The complete AI-assisted reconstruction pipeline is not yet available through the backend.

## 📂 Project Structure

The repository is organized into frontend and backend components.

- `backend/`
  - `main.py` — FastAPI application and API endpoints.
  - `pyproject.toml` — Python project configuration and dependencies.
  - `requirements.txt` — Python dependency list.
  - `uv.lock` — locked Python dependencies.

- `frontend/`
  - `src/main.js` — frontend entry point.
  - `src/model.js` — sample models and geometry helpers.
  - `src/scene.js` — 3D scene and viewer.
  - `src/workspace.js` — drawing and model workspace interactions.
  - `src/drawing-worker.js` — drawing parsing worker.
  - `package.json` — frontend project configuration.
  - `bun.lock` — locked frontend dependencies.

- `Dockerfile` — container build configuration.
- `render.yaml` — Render deployment configuration.
- `start.sh` — startup script.

## 🚀 Getting Started

Follow the steps below to run the frontend and backend locally.

### Prerequisites

Install the following tools:

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/)
- [Python](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/)

Use a Python version compatible with the project's current dependency configuration.

### 1. Clone the Repository

Open a terminal and run:

```bash
git clone https://github.com/rcryan-hniht/Hephaestus.git
cd Hephaestus
```

### 2. Start the Frontend

Navigate to the frontend directory:

```bash
cd frontend
bun install
bun run dev
```

Open the local URL displayed by Vite in the terminal. The default development address is usually:

`http://localhost:5173`

### 3. Start the Backend

Open a second terminal at the repository root and run:

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

The backend should then be available at:

`http://localhost:8000`

Check the service health at:

`http://localhost:8000/health`

The frontend and backend are started separately during local development.

**Note:** Running the backend does not enable AI-based drawing reconstruction. The current API provides a foundation for further development.

## 🔌 API Endpoints

The current backend exposes the following endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Returns the service health status |
| `GET` | `/api/projects` | Returns sample project metadata |

These endpoints provide basic service information. They do not currently perform AI inference or automatically convert uploaded architectural drawings into 3D models.

## 🗺️ Development Roadmap

Hephaestus will be developed incrementally, with a focus on technical feasibility and educational usefulness.

- [x] Establish the initial web application.
- [x] Create an interactive 3D demonstration experience.
- [x] Implement an experimental, constrained DXF geometry workflow.
- [ ] Improve geometric interpretation and validation.
- [ ] Develop the AI-assisted architectural drawing interpretation pipeline.
- [ ] Develop the complete drawing-to-3D reconstruction workflow.
- [ ] Test reconstruction behavior on representative architectural drawings.
- [ ] Gather feedback from students and educators.
- [ ] Evaluate usability and potential educational value.
- [ ] Explore future mobile-camera visualization.

## ⚠️ Scope and Limitations

Hephaestus is an early-stage prototype and research direction. The following limitations are important:

- The complete AI-assisted blueprint-to-3D pipeline is not implemented yet.
- PNG/JPG inputs currently support visual preview, not automatic 3D reconstruction.
- The experimental DXF workflow is limited to certain simple, closed vector boundaries.
- Complex architectural elements and relationships may not be reconstructed reliably.
- Geometric output may depend on drawing structure, units, and assumptions such as wall height and slab thickness.
- Generated geometry has not been validated for professional architectural accuracy.
- Educational benefits have not yet been confirmed through formal user studies.

Hephaestus is intended for conceptual and educational visualization. It is **not a replacement for professional CAD/BIM software, architectural expertise, structural engineering analysis, or construction documentation**.

## 🤝 Contributing

Feedback and suggestions from students, educators, architects, engineers, and developers are welcome.

Potential areas for contribution include:

- Architectural drawing interpretation.
- Geometric reconstruction and validation.
- Interactive 3D visualization.
- Responsive web interface design.
- Educational usability and evaluation.

Please use [GitHub Issues](https://github.com/rcryan-hniht/Hephaestus/issues) to report bugs, discuss ideas, or suggest improvements.

## 📄 License

A license has not yet been specified for this repository. Please check the repository for licensing updates before reusing, modifying, or redistributing the code.

---

**HEPHAESTUS — From Drawing to Space.**

*Turning architectural drawings into an interactive path toward spatial understanding.*
