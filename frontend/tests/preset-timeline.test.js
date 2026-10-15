import { test, expect } from 'bun:test';
import { presetState } from '../src/PresetShowcase.js';

test('a preset holds its drawing, builds, completes a full orbit and sinks before the next drawing', () => {
  expect(presetState(0)).toMatchObject({ mode: 'solid', label: 'Drawing', progress: 0, tilt: 0, rotation: 0 });
  expect(presetState(.99).progress).toBe(0);
  expect(presetState(2)).toMatchObject({ label: 'Building', progress: .5 });
  expect(presetState(3)).toMatchObject({ mode: 'solid', progress: 1, rotation: 0 });
  expect(presetState(13)).toMatchObject({ mode: 'edges', progress: 1, rotation: 120 });
  expect(presetState(23)).toMatchObject({ mode: 'transparent', progress: 1, rotation: 240 });
  expect(presetState(33)).toMatchObject({ label: 'Returning to drawing', progress: 1, rotation: 360 });
  expect(presetState(34.5)).toMatchObject({ progress: .5, tilt: .5, rotation: 360 });
  expect(presetState(36)).toMatchObject({ progress: 0, tilt: 0, rotation: 360 });
  expect(presetState(37).progress).toBe(0);
});
