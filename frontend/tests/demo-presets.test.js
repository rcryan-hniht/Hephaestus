import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPresets, demoPresetModel } from '../src/demo-presets.js';
import { presetGeometry } from '../src/scene.js';
import { Vector3 } from 'three';

test('three reference villas are distinct, metric and explicitly designed demos', () => {
  assert.deepEqual(demoPresets.map(p => p.id), ['terrace', 'portal', 'gable']);
  const models = demoPresets.map(p => demoPresetModel(p.id));
  assert.equal(new Set(models.map(m => JSON.stringify(m.components))).size, 3);
  for (const model of models) {
    assert.equal(model.sample, true);
    assert.equal(model.unit, 'm');
    assert.match(model.warnings.join(' '), /approximate/i);
    assert.equal(new Set(model.components.map(c => c.id)).size, model.components.length);
    assert.ok(model.components.every(c => c.floor < model.floors && c.height > 0 && c.polygon.length >= 3));
    assert.ok(model.components.some(c => c.label.includes('Step')));
    assert.ok(model.components.some(c => c.label.includes('Balcony glazing')));
  }
  models[0].components[0].height = 99;
  assert.notEqual(demoPresetModel('terrace').components[0].height, 99);
  assert.throws(() => demoPresetModel('missing'));
});

test('gable has two pitched roof planes and triangular glazing; editing preserves the profile', () => {
  const model = demoPresetModel('gable');
  const roofs = model.components.filter(c => c.type === 'roof' && c.profile);
  assert.equal(roofs.length, 2);
  const glass = model.components.find(c => c.label === 'Gable glazing');
  assert.equal(glass.profile.length, 3);
  for (const component of [...roofs, glass]) {
    const geometry = presetGeometry(component, new Vector3(2, 0, 3));
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new Vector3());
    assert.ok(Math.abs(size.y - component.height) < 1e-5);
    assert.ok(size.x > 4 && size.z > 0);
    assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
    const moved = presetGeometry({ ...component, height: component.height * 2, polygon: component.polygon.map(([x,z]) => [x + 1, z - 2]) }, new Vector3(2,0,3));
    moved.computeBoundingBox();
    assert.ok(Math.abs(moved.boundingBox.max.y - size.y * 2) < 1e-5);
    assert.ok(Math.abs(moved.boundingBox.min.x - geometry.boundingBox.min.x - 1) < 1e-5);
    assert.ok(Math.abs(moved.boundingBox.min.z - geometry.boundingBox.min.z + 2) < 1e-5);
    geometry.dispose(); moved.dispose();
  }
});
