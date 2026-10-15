# Hephaestus

> _From drawing. To space._

## Introduction

Hephaestus is an interactive architecture visualizer that helps you explore floor plans in 3D. Upload a drawing, confirm its dimensions, and inspect the model alongside the original plan.

_Imagination is beginning, hephaestus brings it closer._

## Who is it for?

- **Architecture and design students** learning to read plans and understand spaces.
- **Construction learners** exploring building layouts and components.
- **Educators** demonstrating how 2D drawings become 3D forms.
- **Anyone interested in architecture** who wants to explore sample houses.

## Features

- Reconstruct PNG and semantic SVG floor plans with confirmed dimensions.
- Combine multiple floor drawings into one building.
- Explore four villa presets: **3F villa**, **Terrace Villa**, **Portal Villa**, and **Gable Villa**, with explicit roof and internal stair geometry.
- Watch drawings rise into rotating 3D models in the construction showcase.
- Orbit, pan, zoom, measure, and inspect models in solid, wireframe, transparent, or section views.
- Edit component parameters, undo/redo changes, and export GLB or scene JSON. Native `.blend` export requires Blender on the backend.

## Download and run

Install [Git](https://git-scm.com/), [Bun](https://bun.sh/), [Python 3.14+](https://www.python.org/), and [uv](https://docs.astral.sh/uv/), then run:

```sh
git clone https://github.com/rcryan-hniht/Hephaestus.git
cd Hephaestus
./start.sh
```

Open **http://localhost:3000**. The launcher installs dependencies and starts the frontend and backend. Press `Ctrl+C` to stop them.

You can also use **Code → Download ZIP** on GitHub, extract the project, and run `./start.sh` in its folder.

Start with a villa preset to try reconstruction without an AI key. PNG reconstruction requires a local CubiCasa checkpoint or explicitly configured OpenRouter access; see the [backend setup guide](backend/README.md).

Hephaestus is a learning and research prototype, not a structural engineering tool.
