# 🔨 HEPHAESTUS

### From Blueprint to Reality.

**Turn 2D building blueprints into interactive 3D structural models — powered by AI.**

Hephaestus is an AI-powered application in development that aims to transform building blueprints into three-dimensional structural visualizations. Using a smartphone camera, users capture a blueprint and send it to a server for AI-based reconstruction. The resulting model is designed to appear directly over the blueprint on the phone screen, then assemble from the ground up.

> 💡 **A blueprint should not only be something you read. It should be something you can see come alive.**

---

## 📑 Table of Contents

* [🏛️ About the Project](#️-about-the-project)
* [🎯 The Problem](#-the-problem)
* [✨ Key Features](#-key-features)
* [⚙️ How It Works](#️-how-it-works)
* [🏗️ Structural Visualization](#️-structural-visualization)
* [🤖 AI Reconstruction Philosophy](#-ai-reconstruction-philosophy)
* [👥 Who Is It For?](#-who-is-it-for)
* [📱 Initial Scope](#-initial-scope)
* [🛠️ Technology](#️-technology)
* [🚧 Development Status](#-development-status)
* [🔮 Future Possibilities](#-future-possibilities)
* [📜 Project Vision](#-project-vision)

---

## 🏛️ About the Project

In architecture and civil engineering, a building blueprint communicates a structure through two-dimensional drawings, symbols, dimensions, and technical conventions. Understanding how these elements come together in three dimensions often requires spatial reasoning and experience.

**Hephaestus aims to bridge that gap.**

By combining smartphone-based image capture with AI-driven reconstruction, the project aims to make structural visualization more intuitive and accessible. Instead of relying exclusively on a flat drawing, users will be able to view a reconstructed 3D representation of the building and examine its overall structure from different angles.

The name *Hephaestus* comes from Greek mythology: the god of craftsmanship, metalworking, and forging — a fitting inspiration for a tool designed to bring structures to life.

## 🎯 The Problem

Reading a building plan is not always the same as understanding the building itself.

* 📐 **Spatial interpretation:** Translating multiple 2D representations into a mental 3D structure can be challenging.
* 🧱 **Structural comprehension:** Understanding the relationships between walls, floors, levels, and stairs requires spatial reasoning.
* 🔄 **Limited perspective:** A static drawing cannot directly provide the freedom to rotate and inspect a complete 3D representation.
* 🎓 **Learning curve:** Students may benefit from seeing how a structure takes shape instead of relying solely on technical drawings.

Hephaestus aims to make this process more visual, tangible, and intuitive.

## ✨ Key Features

### 📷 1. Capture a Blueprint

Use the smartphone camera to capture a physical building blueprint or an image of a blueprint.

The initial workflow is designed around camera capture rather than direct import of CAD, DWG, or PDF files.

### 🧠 2. AI-Powered 3D Reconstruction

The captured image is sent to a server, where the project's AI system is intended to interpret the available drawing information and reconstruct a corresponding 3D structural model.

The goal is to preserve the structure represented by the blueprint as faithfully as the available information allows.

### 🏗️ 3. Watch the Building Assemble

Rather than simply displaying a completed model with a fade-in effect, Hephaestus aims to present a **bottom-up assembly animation**.

The structure will progressively emerge from the base upward, creating the impression that the building is being assembled layer by layer.

### 🔄 4. Explore the Model

After assembly, users will be able to:

* Rotate the entire building through 360 degrees.
* Zoom in to examine structural details.
* Zoom out to understand the overall form.
* View the reconstructed structure from different perspectives.

The interaction is designed around the building as one complete model, rather than selecting individual components to inspect their properties.

## ⚙️ How It Works

The intended workflow is straightforward:

**Capture → Reconstruct → Assemble → Explore**

1. **Capture:** The user points a smartphone camera at a blueprint and captures an image.
2. **Upload:** The image is transmitted to the server.
3. **Interpret:** The AI system analyzes the available drawing information.
4. **Reconstruct:** The server generates a corresponding 3D structural model.
5. **Visualize:** The model is displayed over the blueprint image on the phone screen.
6. **Assemble:** The building progressively forms from the bottom upward.
7. **Explore:** The user rotates and zooms the completed model.

This describes the intended product workflow; actual capabilities depend on the implementation and the quality and readability of the input drawing.

## 🏗️ Structural Visualization

Hephaestus focuses on **understanding a building's overall structure**, not producing a photorealistic architectural presentation.

The intended model emphasizes major structural forms, such as:

* 🧱 Walls and partitions where identifiable.
* 🏢 Floors and building levels.
* 🪜 Stairs and connections between levels.
* 🚪 Major openings and other structural features when they can be interpreted from the drawing.
* 🏠 Other major building forms when sufficient information is available.

The objective is to make the building's form and spatial relationships easier to understand.

Detailed furniture placement, interior decoration, realistic materials, and photorealistic rendering are not the project's primary focus.

## 🤖 AI Reconstruction Philosophy

### Faithful reconstruction — not automated redesign.

Hephaestus is intended to reconstruct what the AI can interpret from the provided blueprint. It is **not intended to act as an architectural or engineering design checker**.

The AI should not independently decide that a design is incorrect and silently modify it. Nor is automatically optimizing or redesigning the building part of the core objective.

The intended division of responsibility is:

| Hephaestus                                    | Human designer or engineer                       |
| --------------------------------------------- | ------------------------------------------------ |
| Interpret available drawing information       | Assess whether the original design is correct    |
| Reconstruct a corresponding 3D representation | Identify potential design or construction issues |
| Present the structure visually                | Make professional judgments and decisions        |

AI reconstruction can be limited by image quality, drawing conventions, missing dimensions, ambiguity, and information that is not visible in the source image. A generated model should therefore be treated as a visualization aid, not as proof that a building design is safe, compliant, or construction-ready.

## 👥 Who Is It For?

### 🎓 Engineering Students

Hephaestus aims to help students develop spatial understanding by connecting technical drawings with a visual representation of the structure.

### 👷 Engineers and Building Professionals

The project also aims to provide professionals with another way to visualize and communicate the overall form of a building represented by a blueprint.

The application is intended to support human understanding and evaluation, not replace professional expertise.

## 📱 Initial Scope

The initial product direction prioritizes a focused, smartphone-based experience.

| Area              | Initial direction                           |
| ----------------- | ------------------------------------------- |
| Primary platform  | Android                                     |
| Input method      | Smartphone camera capture                   |
| Input content     | Physical blueprints or images of blueprints |
| AI processing     | Server-side reconstruction                  |
| Output            | Interactive 3D structural visualization     |
| Model interaction | Whole-model rotation and zoom               |
| Animation         | Progressive, bottom-up assembly             |
| Primary focus     | Structural form and spatial comprehension   |

Direct CAD/DWG/PDF import, individual component editing, automated design validation, and photorealistic interior visualization are not requirements of the initial scope.

Support for different blueprint types is an intended goal, with particular emphasis on drawings used by engineering students and professionals. The practical range of supported drawings will depend on the AI system's capabilities.

## 🛠️ Technology

The current repository contains a web frontend and a Python backend.

| Component                | Current technical direction                             |
| ------------------------ | ------------------------------------------------------- |
| Frontend                 | Vite                                                    |
| Frontend package manager | Bun                                                     |
| Backend                  | Python                                                  |
| AI reconstruction        | Project-specific AI system, intended to run server-side |
| Initial client platform  | Android-focused product direction                       |

The exact AI architecture, model framework, and complete production deployment design have not yet been established in this project description.

### 💻 Frontend — Local Development

Prerequisites: [Bun](https://bun.sh/)

```bash
cd frontend
bun install
bun run dev
```

Vite will print a local development URL in the terminal, typically `http://localhost:5173/`.

Keep the development server running while using the local frontend.

### 🐍 Backend — Development

The backend directory contains Python project files and dependency definitions. Backend startup instructions should match the actual server entry point and configuration in the repository; frontend startup alone does not establish that the complete application or AI pipeline is operational.

## 🚧 Development Status

**Hephaestus is under development.**

The repository is the starting point for building the broader application described in this document. The features and workflows above represent the project's intended direction; they should not be interpreted as confirmation that the AI reconstruction pipeline, 3D generation, assembly animation, or complete Android experience is already implemented.

Implementation details and supported capabilities may evolve as development progresses.

## 🔮 Future Possibilities

Depending on technical feasibility and project priorities, Hephaestus may eventually explore:

* 📚 Broader support for different types of building blueprints.
* 🧩 Improved reconstruction of complex structural relationships.
* 📏 Better use of dimensions and other drawing annotations.
* 📲 A more complete mobile experience for students and professionals.
* ⚡ Faster reconstruction and smoother interactive visualization.

These are potential future directions, not promises of committed features.

## 📜 Project Vision

Hephaestus is built around a simple idea:

> **Make the transition from a two-dimensional drawing to a three-dimensional understanding of a building feel natural.**

A blueprint contains more than lines on a page. It represents a structure that can be understood, explored, and visualized.

Hephaestus aims to help people see that structure come alive.

---

*Hephaestus — From Blueprint to Reality.*
