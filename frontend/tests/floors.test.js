import { expect, test } from 'bun:test';
import { groupFloorFiles, assembleFloors, sampleFloorSuggestions } from '../src/floors.js';

const file = name => ({ name, size: 100 });
const floor = (id, number, height) => ({ number, offsetX: 0, offsetY: 0, job: { id, source_hash: id.repeat(64).slice(0,64), name: `F${number}.svg`, state: 'ready' }, scene: {
  schema_version: 'hephaestus.scene.v1', job_id: id, source_hash: id.repeat(64).slice(0,64), source_kind: 'svg', unit: 'm', revision: 1,
  parameters: { floor_height: { value: height, provenance: 'user_confirmed' }, meters_per_unit: { value: .01, provenance: 'user_confirmed' } },
  components: [{ id: `${id}:wall`, type: 'wall', floor: 0, polygon: [[0,0],[4,0],[4,-1],[0,-1]], height, elevation: 0, source_polygon: [[0,0],[400,0],[400,100],[0,100]], mesh: { positions: [0,0,0,4,0,0,4,height,-1], indices: [0,1,2] }, source: { element_id: 'Wall' } }],
} });

test('groups numeric floor prefixes and prefers paired SVG while retaining PNG', () => {
 const files = ['F2_scaled.png','F1_original.png','F3.svg','F1.svg','F2.svg','F1_scaled.png'].map(file);
 const groups = groupFloorFiles(files);
 expect(groups.map(f => f.number)).toEqual([1,2,3]);
 expect(groups[0].file.name).toBe('F1.svg');
 expect(groups[0].files.map(f => f.name)).toEqual(['F1_original.png','F1.svg','F1_scaled.png']);
 expect(groups[1].file.name).toBe('F2.svg');
});

test('does not silently assign unnumbered files or ambiguous build sources', () => {
 expect(() => groupFloorFiles([file('plan.png'),file('F2.svg')])).toThrow('F1');
 expect(() => groupFloorFiles([file('F1.svg'),file('F1_model.svg')])).toThrow('multiple SVG');
 expect(() => groupFloorFiles([file('F1_original.png'),file('F1_scaled.png')])).toThrow('multiple PNG');
 expect(() => groupFloorFiles([file('F1.dxf'),file('F2.svg')])).toThrow('PNG');
 expect(() => groupFloorFiles([file('F0.svg'),file('F2.svg')])).toThrow('F1');
});

test('stacks confirmed floor heights and transforms meshes without altering original evidence', () => {
 const first = floor('a',1,3), second = floor('b',2,2.8); second.offsetX = 1; second.offsetY = .5;
 const assembled = assembleFloors([first,second]);
 expect(assembled.floors).toBe(2);
 expect(assembled.components[1].id).toBe('b:wall');
 expect(assembled.components[1].floor).toBe(1);
 expect(assembled.components[1].elevation).toBe(3);
 expect(assembled.components[1].polygon[0]).toEqual([1,-.5]);
 expect(assembled.components[1].mesh.positions).toEqual([1,3,-.5,5,3,-.5,5,5.8,-1.5]);
 expect(second.scene.components[0].mesh.positions).toEqual([0,0,0,4,0,0,4,2.8,-1]);
 expect(assembled.scene.schema_version).toBe('hephaestus.building.v1');
 expect(assembled.scene.floors[1].scene.source_hash).toBe('b'.repeat(64));
 expect(assembled.scene.floors[1].transform).toEqual([1,3,-.5]);
 expect(assembled.scene.floors[1].provenance).toBe('user_confirmed');
});

test('rejects incomplete floors and nonfinite alignment rather than publishing a partial replacement', () => {
 const a = floor('a',1,3), b = floor('b',2,3);
 b.job.state = 'failed'; expect(() => assembleFloors([a,b])).toThrow('ready');
 b.job.state = 'ready'; b.offsetX = NaN; expect(() => assembleFloors([a,b])).toThrow('alignment');
 b.offsetX = 0; b.scene.parameters.floor_height.value = null; expect(() => assembleFloors([a,b])).toThrow('height');
});


test('rejects gaps instead of assigning an absent floor zero height', () => {
 expect(() => groupFloorFiles([file('F1.svg'), file('F3.svg')])).toThrow('consecutive');
 expect(() => assembleFloors([floor('a',1,3), floor('b',3,3)])).toThrow('consecutive');
});

test('normalizes each source viewBox origin before applying confirmed alignment', () => {
 const a = floor('a',1,3), b = floor('b',2,3);
 b.scene.coordinate_frame = { origin: [500,500] };
 b.scene.components[0].polygon = [[5,-5],[9,-5],[9,-6],[5,-6]];
 b.scene.components[0].mesh.positions = [5,0,-5,9,0,-5,9,3,-6];
 const model = assembleFloors([a,b]);
 expect(model.components[1].polygon).toEqual(a.scene.components[0].polygon);
 expect(model.components[1].mesh.positions).toEqual([0,3,0,4,3,0,4,6,-1]);
 expect(model.scene.floors[1].transform).toEqual([-5,3,5]);
 expect(b.scene.components[0].polygon[0]).toEqual([5,-5]);
});

const sampleHashes = ['8487017eb625ded98ba1b76eaa4d4def465e20c8a3552ff84b3bf6768c8f1777', '1e7d942a4878dc47b38a1da7e85cd11fd7a700bafe1c94169f23cd66cd565dd2'];
const sampleFloors = () => sampleHashes.map((hash, i) => ({
 number: i + 1, job: { id: `sample-${i}`, source_hash: hash, source_kind: 'png', state: 'needs_information' },
 latest: { proposal: { job_id: `sample-${i}`, source_hash: hash, source_kind: 'png', coordinate_frame: { unit: 'pixel' },
  components: [{ type: 'wall', polygon: i ? [[10,30],[50,30],[50,70],[10,70]] : [[100,20],[200,20],[200,120],[100,120]] }] } },
}));

test('sample suggestions derive a 20 m wall span and remove image margins using current footprints', () => {
 const floors = sampleFloors(), before = JSON.stringify(floors);
 const suggestions = sampleFloorSuggestions(floors);
 expect(JSON.stringify(floors)).toBe(before);
 expect(suggestions[0].parameters.meters_per_unit).toBe(.2);
 expect(suggestions[1].parameters.meters_per_unit).toBe(.5);
 expect(suggestions.map(s => [s.offsetX, s.offsetY])).toEqual([[-20,-4],[-5,-15]]);
 expect(suggestions[0].parameters.floor_height + suggestions[1].parameters.floor_height).toBe(10);
 floors[0].latest.proposal.components[0].polygon = [[100,20],[300,20],[300,120],[100,120]];
 expect(sampleFloorSuggestions(floors)[0].parameters.meters_per_unit).toBe(.1);
});

test('sample suggestions require the exact source pair and current source-bound PNG proposals', () => {
 for (const change of [
  f => { f[0].job.source_hash = '0'.repeat(64); },
  f => { f[0].latest.proposal.job_id = 'obsolete'; },
  f => { f[0].latest.proposal.source_hash = '0'.repeat(64); },
  f => { f[0].job.source_kind = 'svg'; },
  f => { f[0].latest = null; },
  f => { f[0].job.state = 'extracting'; },
  f => { f[0].latest.proposal.components[0].polygon = [[1,1],[1,2],[1,3]]; },
 ]) {
  const floors = sampleFloors(); change(floors); expect(sampleFloorSuggestions(floors)).toBeNull();
 }
 expect(sampleFloorSuggestions(sampleFloors().slice(0,1))).toBeNull();
});
