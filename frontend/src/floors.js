import { sceneToModel } from './backend-model.js';
import villaPreset from './villa-preset.json';
import drawingPresets from './drawing-presets.json';

// These hashes identify the two original CubeCasa images, independent of upload names.
const sampleHashes = ['8487017eb625ded98ba1b76eaa4d4def465e20c8a3552ff84b3bf6768c8f1777', '1e7d942a4878dc47b38a1da7e85cd11fd7a700bafe1c94169f23cd66cd565dd2'];

export function sampleFloorSuggestions(floors) {
  const preset = [villaPreset, ...drawingPresets].find(p => p.floors.length === floors.length
    && p.floors.every((c, i) => floors[i].number === c.number && floors[i].job?.source_hash === c.source_hash));
  if (preset) {
    const suggestions = [];
    for (const [i, floor] of floors.entries()) {
      const configuration = preset.floors[i], job = floor.job, proposal = floor.latest?.proposal;
      if (floor.number !== configuration.number || job?.source_kind !== 'svg' || job.source_hash !== configuration.source_hash
        || !['needs_information', 'ready'].includes(job.state) || proposal?.source_kind !== 'svg'
        || proposal.job_id !== job.id || proposal.source_hash !== job.source_hash) return null;
      const componentValues = {};
      for (const [element, values] of Object.entries(configuration.components)) {
        const components = proposal.components.filter(c => c.source?.element_id === element);
        if (!components.length) return null;
        for (const component of components) componentValues[component.id] = { ...values };
      }
      suggestions.push({ name: preset.name, description: preset.description,
        parameters: { ...configuration.parameters }, offsetX: configuration.offsetX, offsetY: configuration.offsetY, componentValues });
    }
    return suggestions;
  }
  if (floors.length !== 2) return null;
  const suggestions = [];
  for (const [i, floor] of floors.entries()) {
    const job = floor.job, proposal = floor.latest?.proposal;
    if (floor.number !== i + 1 || job?.source_kind !== 'png' || job.source_hash !== sampleHashes[i]
      || !['needs_information', 'ready'].includes(job.state) || proposal?.source_kind !== 'png'
      || proposal.job_id !== job.id || proposal.source_hash !== job.source_hash || proposal.coordinate_frame?.unit !== 'pixel') return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const wall of proposal.components.filter(c => c.type === 'wall')) {
      for (const [x, y] of wall.polygon) {
        if (![x, y].every(Number.isFinite)) return null;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x);
      }
    }
    const scale = 20 / (maxX - minX), origin = proposal.coordinate_frame.origin || [0, 0];
    if (![minX, minY, scale, ...origin].every(Number.isFinite) || scale < 1e-8 || scale > 1000 || origin.length !== 2) return null;
    suggestions.push({ parameters: { meters_per_unit: scale, floor_height: i ? 3.6 : 6.4,
      slab_thickness: .2, door_height: 2.1, window_height: 1.2, window_sill: .9 },
      offsetX: (origin[0] - minX) * scale, offsetY: (origin[1] - minY) * scale });
  }
  return suggestions;
}

export function groupFloorFiles(files) {
  if (!files.length || files.length > 16 || files.reduce((size, file) => size + file.size, 0) > 40 * 1024 * 1024) throw new Error('Select up to 16 drawings, 40 MB total.');
  const groups = new Map();
  for (const file of files) {
    const prefix = /^F(\d+)(?:[_. -]|$)/i.exec(file.name);
    if (!prefix || Number(prefix[1]) < 1 || Number(prefix[1]) > 100) throw new Error('Name each drawing with its floor prefix, for example F1.png, F1.svg, F2.png.');
    const kind = file.name.split('.').pop().toLowerCase();
    if (!['png', 'svg'].includes(kind)) throw new Error('Multiple-floor uploads support PNG and SVG only.');
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Each drawing must be non-empty and at most 10 MB.');
    const number = Number(prefix[1]);
    if (!groups.has(number)) groups.set(number, { number, files: [], offsetX: 0, offsetY: 0 });
    groups.get(number).files.push(file);
  }
  if (groups.size > 8) throw new Error('Select at most 8 floors per building.');
  const sorted = [...groups.values()].sort((a, b) => a.number - b.number);
  if (sorted.some((f, i) => f.number !== i + 1)) throw new Error('Use consecutive floor prefixes starting with F1. Missing floor heights cannot be inferred.');
  return sorted.map(group => {
    const vectors = group.files.filter(f => /\.svg$/i.test(f.name));
    const images = group.files.filter(f => /\.png$/i.test(f.name));
    if (vectors.length > 1) throw new Error(`F${group.number} has multiple SVG files. Select one build source per floor.`);
    if (!vectors.length && images.length > 1) throw new Error(`F${group.number} has multiple PNG files. Select one PNG or add its paired SVG.`);
    return { ...group, file: vectors[0] || images[0] };
  });
}

export function assembleFloors(floors) {
  // shortcut: workspace reopening after reload is manual; add a persisted building picker when session recovery is needed.
  if (!floors.length || floors.length > 8 || floors.some(f => f.job?.state !== 'ready' || !f.scene)) throw new Error('Every floor must be ready before replacing the building.');
  if (floors.some((f, i) => f.number !== i + 1)) throw new Error('Building floors must have consecutive numbers starting with F1.');
  let elevation = 0, size = 0;
  const components = [], sources = [], warnings = [], ids = new Set();
  for (const [index, floor] of floors.entries()) {
    const height = floor.scene.parameters?.floor_height?.value;
    if (!Number.isFinite(height) || height < .5 || height > 20) throw new Error('Each floor needs a confirmed height.');
    if (![floor.offsetX, floor.offsetY].every(v => Number.isFinite(v) && Math.abs(v) <= 1000)) throw new Error('Floor alignment must be finite and within 1000 m.');
    const source = sceneToModel(floor.scene, floor.job);
    const origin = floor.scene.coordinate_frame?.origin || [0, 0], scale = floor.scene.parameters.meters_per_unit?.value;
    if (origin.length !== 2 || !origin.every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0) throw new Error('Floor alignment requires valid source coordinates and scale.');
    const transform = [floor.offsetX - origin[0] * scale, elevation, -floor.offsetY + origin[1] * scale];
    const moveMesh = mesh => mesh && { ...mesh, positions: mesh.positions.map((n, i) => n + transform[i % 3]) };
    for (const component of source.components) {
      if (ids.has(component.id)) throw new Error('Component IDs must be unique across floors.');
      ids.add(component.id);
      size += component.mesh.positions.length + (component.selection_mesh?.positions.length || 0);
      if (components.length >= 2000 || size > 2_000_000) throw new Error('Combined building is too large for this viewport.');
      components.push({ ...component, floor: index, source_floor: floor.number, job_id: floor.job.id, source_hash: floor.job.source_hash,
        local_elevation: component.elevation, elevation: component.elevation + elevation,
        polygon: component.polygon.map(([x, z]) => [x + transform[0], z + transform[2]]),
        mesh: moveMesh(component.mesh), selection_mesh: moveMesh(component.selection_mesh) });
    }
    sources.push({ number: floor.number, name: floor.job.name, transform, provenance: 'user_confirmed', scene: floor.scene,
      drawings: (floor.files || []).map(file => ({ name: file.name, size: file.size, used_for_build: file === floor.file })) });
    warnings.push(...source.warnings.map(w => `F${floor.number}: ${w}`));
    elevation += height;
  }
  const name = `Building · ${floors.map(f => `F${f.number}`).join(' + ')}`;
  const scene = { schema_version: 'hephaestus.building.v1', unit: 'm', source_kind: 'multiple', name,
    job_id: floors.map(f => f.job.id).join(':'), revision: floors.map(f => f.scene.revision).join('.'),
    floors: sources, components, parameters: {}, warnings,
    alignment: 'User-confirmed source-origin offsets; paired PNG/SVG registration is not inferred.' };
  return { name, sample: false, backend: true, multiFloor: true, unit: 'm', floors: floors.length, components, scene, job_id: scene.job_id, warnings };
}
