import { expect, test } from 'bun:test';
import { backendGeometry, sceneToModel, offsetProposal } from '../src/backend-model.js';
import { Vector3 } from 'three';

const job = { id: 'j', source_hash: 'a'.repeat(64), name: 'plan.svg' };
const fixture = () => ({ schema_version: 'hephaestus.scene.v1', job_id: 'j', source_hash: job.source_hash, source_kind: 'svg',
  unit: 'm', floors: 1, revision: 1, parameters: { meters_per_unit: { value: .1, provenance: 'user_confirmed' } }, warnings: [],
  components: [{ id: 'room', type: 'room', floor: 0, polygon: [[0,0],[4,0],[4,-3],[0,-3]], height: .2, elevation: -.2,
    mesh: { positions: [0,0,0,4,0,0,4,0,-3], indices: [0,1,2] }, source: { element_id: 'r', occurrence: 1 } }] });

test('preserves scene IDs, units and evidence while mapping rooms to workspace slabs', () => {
  const model = sceneToModel(fixture(), job);
  expect(model.components[0].id).toBe('room');
  expect(model.components[0].type).toBe('slab');
  expect(model.components[0].source_type).toBe('room');
  expect(model.components[0].source.element_id).toBe('r');
  expect(model.backend).toBe(true);
  expect(model.scene.revision).toBe(1);
});

test('uses backend triangles with absolute vertical coordinates instead of extruding the outline', () => {
  const model = sceneToModel(fixture(), job);
  const { geometry, proxy } = backendGeometry(model.components[0], new Vector3(2,0,-1.5));
  expect([...geometry.getAttribute('position').array]).toEqual([-2,0,1.5,2,0,1.5,2,0,-1.5]);
  expect([...geometry.index.array]).toEqual([0,1,2]);
  expect(proxy).toBe(false);
  geometry.dispose();
});

test('opening geometry is explicitly a picking proxy', () => {
  const s = fixture();
  s.components[0].type = 'door';
  s.components[0].selection_mesh = s.components[0].mesh;
  s.components[0].mesh = { positions: [], indices: [] };
  s.components.push({ ...fixture().components[0], id: 'floor' });
  const { geometry, proxy } = backendGeometry(sceneToModel(s, job).components[0], new Vector3());
  expect(proxy).toBe(true);
  expect(geometry.index.count).toBe(3);
  geometry.dispose();
});

test('rejects mismatched sources and malformed buffers before replacing a valid model', () => {
  const wrong = fixture(); wrong.job_id = 'other';
  expect(() => sceneToModel(wrong, job)).toThrow('source');
  const malformed = fixture(); malformed.components[0].mesh.indices[2] = 99;
  expect(() => sceneToModel(malformed, job)).toThrow('geometry');
  const nonfinite = fixture(); nonfinite.components[0].mesh.positions[0] = Infinity;
  expect(() => sceneToModel(nonfinite, job)).toThrow('geometry');
});

test('position corrections convert meters back to source coordinates without mutating evidence', () => {
  const proposal = { components: [{ id: 'wall', polygon: [[0,0],[40,0],[40,4],[0,4]] }] };
  const shifted = offsetProposal(proposal, 'wall', 1, -.5, .1);
  expect(shifted.components[0].polygon[0]).toEqual([10,5]);
  expect(proposal.components[0].polygon[0]).toEqual([0,0]);
});
