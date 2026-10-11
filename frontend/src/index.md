# Hephaestus — From technical drawings to architectural 3D

## Goal

Let users upload technical drawings, analyze their contents, and reconstruct architectural 3D models. Users can orbit, zoom, pan, select components, and inspect individual floors in the browser.

Main flow: **Upload drawing → Analyze → Build model → Explore in 3D**.

This is a product specification for future implementation. A UI or Three.js alone cannot interpret every drawing; image/PDF inputs require geometry extraction and recognition services.

## Design language

- Hephaestus branding and English interface copy, accessible descriptions, feedback, and prompts.
- Use the light scheme and Poppins defined in `ui.md`: warm off-white surfaces, dark readable text, cobalt accents, and fine borders.
- Keep the architectural model central. Decorative effects must not obscure structural components.
- Remove fixed glass cubes, refracted headlines, decorative slide numbers, and pagination from the workspace.
- Before upload, show “From drawing to architectural 3D”, brief instructions, and “Upload drawing”.
- Once a model is available, collapse introductory content to prioritize inspection.

## Interface layout

### Top bar

Hephaestus logo on the left; drawing name and processing status in the center; “Upload drawing” and “Export model” on the right. Enable export only for a valid model.

### Left drawing panel

- File drop zone and a keyboard-accessible file picker.
- File, PDF page, and floor selection; select the plan page to reconstruct.
- A 2D drawing preview with pan/zoom and highlighting linked to 3D selection.
- Units, drawing scale, and floor height. Display recognized values or request missing information.
- Multiple floors: add plans, assign floors, and align them using a shared origin.
- Do not ask users to enter information already recognized with sufficient confidence.

### Central 3D canvas

- The canvas occupies the largest region. Default to a white/light-gray background; an optional dark view must retain component/edge contrast.
- Automatically display and fit the reconstructed model.
- Controls: “Perspective”, “Plan”, “Elevation”, “Reset view”, and “Fit model”.
- Floor selection and visibility toggles for roofs, walls, doors, columns, floors, and dimensions.
- “Solid”, “Edges”, and “Transparent” inspection modes.
- Do not automatically orbit while users inspect, measure, or select components.

### Right properties panel

Show the selected component's type, floor, dimensions, source drawing, and available data. Allow edits to height, thickness, and position when recognition needs correction. Do not present assumed dimensions or materials as recognized facts.

### Mobile

Keep the canvas central and controls clearly labeled. Drawings and properties open in separate drawers, one at a time. Support one-finger orbit and two-finger pan/pinch zoom. Prevent horizontal page scrolling. Detailed mobile refinement follows the laptop landing release.

## Architectural model output reference

The architectural output reference shows a multi-floor building viewed from an elevated perspective, with its site, enclosing walls, slabs, roof, openings, and visible interior components.

- Default reconstruction view: “Architecture”, with a white/very light-gray canvas and surrounding controls following the light scheme in `ui.md`.
- Use neutral white/gray surfaces, thin gray edges, and light contact shadows. Avoid refraction or colors that hide drawing details.
- Walls, glazing, and selected surfaces may be translucent for interior inspection. Provide an opacity control and a readable solid mode.
- Separate walls, floors, roofs, doors, windows, columns, stairs, and site geometry when supported by the drawing.
- Draw plan lines on the site when the source provides a site plan; do not invent boundaries or landscaping.
- Initially fit the entire building/site from an elevated diagonal perspective. Support orbit, pan, zoom, and orthographic views.
- Allow hiding the roof/upper floors and applying sections to inspect lower floors. Keep components individually selectable.
- Avoid edge flicker, incorrect hidden edges, and transparency ordering that obscures selection.

References define presentation, not a building to copy into recognition results. Geometry, floor count, openings, stairs, elevations, and dimensions must come from uploaded drawings. Mark missing data and assumptions; allow supplementary elevations, sections, or parameters. The landing's prepared study model remains explicitly separate from reconstruction results.

## Inputs and reconstruction

### Target formats

- DXF: read vectors, layers, polylines, and units.
- PDF: select a page; prefer vector extraction, using recognition for scanned pages.
- PNG/JPG: recognize lines, walls, openings, and room regions; request scale confirmation when unknown.
- DWG: accept only when a suitable conversion service exists; otherwise suggest exporting DXF/PDF.
- Optional IFC/GLB/GLTF: distinguish importing an existing 3D model from reconstructing a 2D drawing.

List only implemented formats in the file picker. Validate actual format, size, and read errors at the input boundary. Obtain limits from the service configuration.

### Automated pipeline

1. Receive and validate the file; display the original drawing.
2. Extract geometry or recognize components according to the input type.
3. Normalize units, scale, orientation, and origin.
4. Recognize walls, doors, windows, columns, floors, and room regions where the source permits.
5. Extrude wall footprints, cut door openings, and position columns/slabs using established values.
6. Align floors with shared coordinates and elevations; build roofs/stairs only when supported by data.
7. Return geometry and metadata for display, selection, and source comparison.

When sufficient data is available, finish automatically without an additional “Render” step. When essential information is missing, preserve the preview and ask only for the missing values, such as scale or floor height, then continue.

One 2D plan usually cannot fully define a 3D building. Label default values “Assumption” and allow editing. Never substitute a sample building for uploaded-file content and report reconstruction success.

## Model interaction

- Left-drag orbit, right-drag/pan controls, and wheel zoom.
- Raycast component selection with highlighting and properties.
- Linked 2D/3D selection when source metadata exists.
- Floor/component visibility and isolation.
- Measurement in confirmed real units. Do not report real measurements without a known scale.
- Adjustable section planes.
- Parameter edits update the model and support undo/redo.
- Export the current model as GLB, preserving component structure and necessary metadata.

## States and feedback

| State | Feedback and actions |
| --- | --- |
| No file | Upload area and supported formats; a sample model only when the user chooses the example experience |
| Uploading | File name, real upload progress where available, and cancellation |
| Analyzing | Current processing stage, with the 2D drawing retained for comparison |
| Needs information | Highlight uncertain regions; request scale/height or recognition corrections |
| Building | Reconstruction status; do not invent percentages without service progress |
| Ready | Fit the camera and enable inspection/export |
| Failed | Actionable explanation, retry or a different file; retain the original drawing |

When replacing a file, retain the existing model until a valid replacement is available. Cancel or ignore stale tasks so they cannot replace the active drawing. Save parameter corrections in project state before rebuilding.

## Implementation requirements

- Frontend: JavaScript/TypeScript, Bun, Vite, and vanilla Three.js.
- OrbitControls for orbit/pan/zoom, Raycaster for selection, and clipping planes for sections.
- Backend: Python 3.14+ and uv; perform heavy file conversion/recognition outside the browser render loop.
- Define an asynchronous job API: submit file, receive job ID, query/cancel processing, and fetch model results. This contract is required work, not an assertion that the API already exists.
- Results include geometry, component IDs/types/floors, units, assumptions, and source file/page/geometry links where available.
- Do not merge the entire building into a single mesh and lose component selection, visibility, or editing.
- Preserve real dimensions; fit the camera to the bounding box instead of normalizing model dimensions to one unit.
- Antialiasing, pixel ratio capped at 2, and ResizeObserver on the canvas container.
- Clear white/gray architecture shading, fine edges, controlled transparency, and subtle contact shadows; no full-building refraction shader.
- Use a Web Worker for heavy browser-side parsing when appropriate.
- Dispose geometries, materials, textures, renderer, controls, and listeners on replacement or teardown.
- Retain the 2D preview and show English feedback when WebGL is unavailable.
- Respect reduced motion, visible focus, accessible control names, and aria-live processing feedback.

The real reconstruction flow is not constrained by the old “standalone HTML without a backend” requirement. Any standalone prototype must explicitly describe simulated features and supported formats.

## Acceptance criteria

- A supported drawing with sufficient data automatically generates corresponding geometry.
- Missing scale or height triggers a targeted request or a clearly labeled assumption.
- Validate known-size drawings by comparing footprints, openings, floor counts, and 3D dimensions against the source. Report discrepancies rather than claiming absolute accuracy.
- Users can orbit, pan, zoom, select components, toggle floors, measure, and export.
- Invalid files, unsupported formats, cancellation, and errors have clear states.
- Stale results cannot replace newer drawings; edits and undo update the correct model.
- Desktop/mobile layouts avoid horizontal overflow and correctly resize the canvas.
- Output uses readable architectural shading, fine edges, and optional transparency. Details remain traceable to input data.
- Do not present a fixed cube or prepared study model as a recognition result.
