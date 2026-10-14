import { BufferGeometry, Float32BufferAttribute } from 'three';

function validateMesh(mesh) {
  if (!mesh || !Array.isArray(mesh.positions) || !Array.isArray(mesh.indices)
    || mesh.positions.length % 3 || mesh.indices.length % 3
    || mesh.positions.some(n => !Number.isFinite(n) || Math.abs(n) > 20000)
    || mesh.indices.some(i => !Number.isInteger(i) || i < 0 || i >= mesh.positions.length / 3)) {
    throw new Error('Invalid model geometry returned by the drawing API.');
  }
}

export function sceneToModel(scene, job) {
  if (scene.schema_version !== 'hephaestus.scene.v1' || scene.unit !== 'm'
    || scene.job_id !== job.id || scene.source_hash !== job.source_hash) {
    throw new Error('Model schema, units or source do not match the uploaded drawing.');
  }
  if (!Array.isArray(scene.components) || !scene.components.length || scene.components.length > 2000) throw new Error('Model component limit exceeded.');
  const ids = new Set(); let size = 0, hasGeometry = false;
  const components = scene.components.map(c => {
    if (!['room','wall','column','door','window'].includes(c.type) || typeof c.id !== 'string' || ids.has(c.id)
      || c.floor !== 0 || !Number.isFinite(c.height) || c.height <= 0 || !Number.isFinite(c.elevation)
      || !Array.isArray(c.polygon) || c.polygon.length < 3
      || c.polygon.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n)))) throw new Error('Invalid model component returned by the drawing API.');
    ids.add(c.id); validateMesh(c.mesh);
    if (c.selection_mesh) validateMesh(c.selection_mesh);
    const opening = ['door','window'].includes(c.type);
    if (opening && (!c.selection_mesh?.indices.length || c.mesh.indices.length)) throw new Error('Invalid opening geometry returned by the drawing API.');
    size += c.mesh.positions.length + (c.selection_mesh?.positions.length || 0);
    hasGeometry ||= c.mesh.indices.length > 0;
    return { ...c, type: c.type === 'room' ? 'slab' : c.type, source_type: c.type, backendGeometry: true, opening };
  });
  if (size > 2_000_000 || !hasGeometry) throw new Error('Model geometry is empty or too large for this viewport.');
  return { name: job.name, sample: false, backend: true, job_id: scene.job_id, source_hash: scene.source_hash,
    unit: 'm', floors: 1, components, scene,
    warnings: [...(scene.warnings || []), ...(scene.validation_issues || []).map(text => `Source evidence: ${text}`)] };
}

export function backendGeometry(component, origin) {
  const proxy = component.opening;
  const data = proxy ? component.selection_mesh : component.mesh;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  geometry.translate(-origin.x, 0, -origin.z);
  geometry.computeVertexNormals();
  return { geometry, proxy };
}

export function sourceDescription(component, name = '') {
  if (typeof component.source === 'string') return component.source;
  return [name, component.source?.element_id, component.source?.occurrence == null ? null : `element ${component.source.occurrence}`].filter(Boolean).join(' / ');
}

export function offsetProposal(proposal, id, x, z, scale) {
  if (![x,z,scale].every(Number.isFinite) || scale <= 0) throw new Error('Position edits require confirmed drawing scale.');
  const result = structuredClone(proposal);
  const component = result.components.find(c => c.id === id);
  if (!component) throw new Error('Component is missing from this drawing.');
  component.polygon = component.polygon.map(([a,b]) => [a + x / scale, b - z / scale]);
  return result;
}
