import { expect, test } from 'bun:test';
import { groupFloorFiles, assembleFloors } from '../src/floors.js';

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
