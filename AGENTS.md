# HEPHAESTUS - A 3D INTERACTIVE ARCHITECTURE VISUALIZER

# Commit

- Types: `feat:`, `change:`, `del:`
- Message: short, English, professional. One line, imperative mood, no fluff.
  Examples: `feat: add spring-based thumbnail expansion`, `del: remove unused grid overlay`.
- Auto-commit after each completed fix/improvement so changes are visible
  in history — commit per logical change, not per file save.
- Do not commit broken states; run a quick check (build/lint) first when cheap.

# Frontend

JavaScript/TypeScript using bun

## Stack

- JavaScript/TypeScript, bun, Vite, and vanilla Three.js; own the scene graph directly.
- Vercel Root Directory: `frontend`; install with `bun install`, build with
  `bun run build`, output `dist`.
- Vite uses `frontend/src` as its root. The entry is `frontend/src/index.html`;
  keep JS and CSS in the existing source modules.
- Use OrbitControls for architecture orbit/pan/zoom, Raycaster for selection,
  and clipping planes for section views.
- Drive 3D motion through the render loop using clock delta.

## UI/UX

### Design brief and reference priority

Redesign Hephaestus using the visual language of `ui.md`: black surfaces,
white typography, generous negative space, Poppins, fine outlined controls,
and restrained glass refraction. Preserve the existing layout divisions,
component purposes, and drawing-to-3D workflow.

- `ui.md` defines visual inspiration and optional glass rendering details.
- `frontend/src/index.md` defines the product layout, functions, model output,
  processing states, and acceptance criteria. Preserve these requirements.
- Keep Hephaestus branding and Vietnamese product copy.
- Adapt the reference to the existing project. Its standalone HTML delivery,
  CDN dependency versions, Design World branding, fixed cube, decorative
  pagination, and slide count are not product requirements.
- This brief replaces the previous illoca / light Rosé Pine visual direction.

### Preserve layout and component purposes

#### Landing / introductory view

- Preserve the floating pill navbar: brand left, navigation in the middle,
  primary action right. Use a dark surface with a fine white border.
- Keep the large headline above the framed architecture preview, with the
  small annotations, coordinate marks, contact link, and bottom-right caption.
- Keep the thumbnail-to-expanded-scene interaction and model-opening action.
- Use architecture-related copy and the existing link/action destinations.
- Borrow the reference's typography, contrast, outlined buttons, and spacing
  within these regions; preserve their order and purpose.

#### Drawing workspace

- Top bar: Hephaestus logo left; drawing name and processing status centre;
  “Nạp bản vẽ” and “Xuất mô hình” right. Enable export only for a valid model.
- Left drawing panel: upload/drop zone, file/page/floor selection, 2D preview,
  pan/zoom, units, scale, floor height, and alignment controls.
- Centre: the largest region is the interactive architecture canvas. Keep
  perspective/plan/elevation, reset/fit, floor selection, component visibility,
  solid/edges/transparency, measurement, and section controls.
- Right properties panel: selected component type, floor, dimensions, source,
  and editable parameters. Preserve links between 2D and 3D selection.
- Keep the flow “Nạp bản vẽ → Phân tích → Dựng mô hình → Tương tác 3D”.
  Collapse introductory content once a model is available.
- Preserve undo/redo, export, cancellation, retry, and missing-data states
  described in `frontend/src/index.md`. Display actual processing feedback;
  distinguish assumptions from recognized dimensions.
- Keep controls connected to their existing actions. Add arrows or dots only
  when a real view or item selection requires them; give them clear labels.

### Color, surfaces, and typography

| Role | Treatment |
| --- | --- |
| Page / intro background | Pure black `#000000` |
| Navigation and workspace panels | Black or near-black `#111111` |
| Primary text / icons | White `#FFFFFF` |
| Large headline | Soft white `#E9E9E9` |
| Secondary text | Light gray `#A6A6A6`, readable against dark surfaces |
| Dividers / frames | White at 15–25% opacity, 1px |
| Outlined action border | White at 80–85% opacity, 1–1.5px |
| Architecture canvas | White / very light gray by default; optional dark mode |
| Architecture surfaces | White / gray with fine gray edges and light contact shadow |

- Use Poppins weights 300/400/500/600/700/800, as in `ui.md`.
- Intro headline: weight 800, tight tracking, centred, preserve the existing
  two-line hierarchy. Scale to the available region without clipping.
- Body and navigation: weights 400/500; lighter supporting copy with selective
  bold emphasis. Keep annotations small and secondary.
- Use `clamp(20px, 6.95vw, 120px)` as a landing spacing reference, not as fixed
  padding inside the workspace's functional panels.
- Buttons use clear outlines and lightly rounded corners (about 6px); primary
  actions may use white fill with black text. Hover can invert these colors.
- Use visible keyboard focus. Status and selection must have text or shape
  cues in addition to color.
- Keep backgrounds solid. Chromatic fringes belong only to the glass effect.
- Replace the page-wide light grid with the black background. A subtle grid
  inside a drawing viewport is allowed when it helps orientation.

### Motion / thumbnail reveal

- Start the introductory architecture preview at roughly 280–320px wide with
  simplified geometry and low detail.
- On the existing enter/focus/click trigger, expand it into its canvas using
  one spring-driven `progress` value from 0 to 1.
- Animate position, width, height, scale, and radius together. Use this same
  value for edge opacity, secondary geometry, camera distance, and depth cues.
- Thumbnail reveal is approximately 0.8s; detail reveal 0.6–1.0s, with subtle
  overshoot and no excessive bounce.
- On dark surfaces, use a fine rim and progressively stronger contact/depth
  cues. Keep actual architecture shadows subtle on its light viewport.
- Begin slow introductory orbit only after expansion; pause on user drag.
  Keep the expanded state when that improves navigation.
- In the drawing workspace, automatically fit the model after reconstruction.
  Keep it stable while users inspect, measure, or select components.
- Clamp frame delta to 0.05s. Respect `prefers-reduced-motion`: show the final
  state directly, disable idle drift and inertia, preserve direct controls.
- UI hover transitions may use the reference's 0.25s color inversion and
  0.35s underline wipe; 3D animation remains in the render loop.

### Glass effect from ui.md

- Glass is an optional introductory accent confined to the preview region.
  Preserve the actual architectural model and the surrounding layout.
- When used, follow `ui.md` for rounded geometry, front/back refraction passes,
  render targets, restrained chromatic dispersion, and bright bevel edges.
- Text intended to refract must be drawn into a CanvasTexture; wait for fonts
  and redraw when the viewport or fonts change. Provide equivalent accessible
  HTML text. Keep the main headline in its existing region.
- Keep effect overlays transparent to pointer events except actual controls.
- Preserve recognizable components in the workspace. Use ordinary material
  opacity for inspection transparency instead of applying refraction to the
  entire building. Derive model geometry from the uploaded drawing.
- If the effect or WebGL fails, preserve the headline, upload action, and 2D
  preview with a clear fallback message.

### Responsive layout and accessibility

- Preserve the same hierarchy at smaller widths; avoid copying `ui.md`'s
  absolute desktop coordinates into the workspace.
- On mobile, keep the canvas central. Open drawings and properties in labeled
  drawers, one at a time, leaving useful model space visible.
- Keep upload, export, and view controls reachable. Collapse navigation into
  an accessible menu if needed rather than silently removing functionality.
- Support one-finger orbit and two-finger pan/pinch zoom on the canvas.
- Scope touch handling to the interactive viewport. Avoid horizontal page
  scrolling, overlapping controls, and clipped functional text.
- Provide accessible names, keyboard access, visible focus, loading/error
  feedback via aria-live, and a semantic heading for rendered headline text.

### 3D scene conventions

- Use WebGLRenderer with antialiasing and pixel ratio capped at 2.
- Observe the canvas container with ResizeObserver; update camera aspect,
  renderer size, and any render targets/textures together.
- Preserve real model units and component IDs. Fit the camera to the model's
  bounding box; retain separate selectable components and source metadata.
- Use readable neutral architecture shading and fine edges, with controllable
  transparency. Keep decorative lighting subordinate to structural clarity.
- Dispose geometries, materials, textures, render targets, controls, renderer,
  and listeners when replacing scenes or tearing down.

# Backend

python 3.14+ using uv

add lib in venv using

```
uv pip install
```

# Architecture

## Agents

- Planning agent: Fable.
- Subagents (implementation, search, review): Sonnet and Haiku.
  - Sonnet: implementation and multi-file changes.
  - Haiku: quick lookups, small mechanical edits, file searches.

# Deployment

deploy frontend on Vercel
deploy backend on Render
