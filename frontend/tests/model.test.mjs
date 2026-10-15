import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDXF, reconstructDrawing, phaseAt } from '../src/model.js';
const dxf = (layer = 'WALL', closed = 1) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n${layer}\n70\n${closed}\n90\n4\n10\n0\n20\n0\n10\n4000\n20\n0\n10\n4000\n20\n200\n10\n0\n20\n200\n0\nENDSEC\n0\nEOF\n`;
test('closed DXF wall uses recognized units and supplied height', () => {
  const parsed = parseDXF(dxf());
  assert.equal(parsed.unit, 'mm');
  const model = reconstructDrawing(parsed, { unit: parsed.unit, height: 3.2 });
  assert.equal(model.components.length, 1);
  assert.deepEqual(model.components[0].polygon, [[0, 0], [4, 0], [4, .2], [0, .2]]);
  assert.equal(model.components[0].height, 3.2);
  assert.match(model.components[0].source, /WALL/);
  assert.equal(model.sample, false);
});
test('unsupported, open, malformed, and curved geometry cannot produce success', () => {
  for (const text of ['hello', dxf('FURNITURE'), dxf('WALL', 0), dxf().replace('4000', 'NaN'), dxf().replace('90\n4', '42\n.5\n90\n4')]) {
    assert.throws(() => parseDXF(text));
  }
  const parsed = parseDXF(dxf());
  assert.throws(() => reconstructDrawing(parsed, { unit: '', height: 3 }));
  assert.throws(() => reconstructDrawing(parsed, { unit: 'm', height: -1 }));
});
test('scroll morph reverses and resolves to identical hero at loop boundary', () => {
  assert.equal(phaseAt(0, 1000).chapter, 0);
  assert.equal(phaseAt(1000, 1000).chapter, 1);
  assert.equal(phaseAt(2000, 1000).chapter, 2);
  assert.deepEqual(phaseAt(3000, 1000), phaseAt(0, 1000));
  assert.ok(phaseAt(2850, 1000).mix > phaseAt(2700, 1000).mix);
  assert.equal(phaseAt(2800, 1000, true).mix, 0);
});
