import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import presets from '../src/drawing-presets.json';
import { sampleFloorSuggestions } from '../src/floors.js';

const inputs = preset => preset.floors.map(c => ({
  number: c.number,
  job: { id: `${preset.id}-${c.number}`, source_hash: c.source_hash, source_kind: 'svg', state: 'needs_information' },
  latest: { proposal: { job_id: `${preset.id}-${c.number}`, source_hash: c.source_hash, source_kind: 'svg',
    components: Object.keys(c.components).map((element, i) => ({ id: `current-${c.number}-${i}`, source: { element_id: element } })),
  } },
}));

test('drawing presets bind SVG hashes and map suggestions to current job components', () => {
  expect(presets.map(p => p.id)).toEqual(['terrace', 'portal', 'gable']);
  expect(presets.map(p => p.floors.length)).toEqual([3, 2, 3]);
  for (const preset of presets) {
    for (const floor of preset.floors) {
      const data = readFileSync(new URL(`../../backend/tests/fixtures/${preset.folder}/F${floor.number}.svg`, import.meta.url));
      expect(createHash('sha256').update(data).digest('hex')).toBe(floor.source_hash);
    }
    const floors = inputs(preset), before = JSON.stringify(floors);
    const suggestions = sampleFloorSuggestions(floors);
    expect(suggestions?.map(s => s.parameters)).toEqual(preset.floors.map(f => f.parameters));
    expect(suggestions[0].name).toBe(preset.name);
    const first = floors[0].latest.proposal.components[0];
    expect(suggestions[0].componentValues[first.id]).toEqual(preset.floors[0].components[first.source.element_id]);
    expect(JSON.stringify(floors)).toBe(before);
  }
});

test('modified, mixed, cancelled and stale drawing presets cannot activate suggestions', () => {
  for (const preset of presets) {
    for (const change of [
      f => { f[0].job.source_hash = '0'.repeat(64); },
      f => { f[0].job.source_kind = 'png'; },
      f => { f[0].job.state = 'cancelled'; },
      f => { f[0].latest.proposal.job_id = 'obsolete'; },
      f => { f[0].latest.proposal.source_hash = '0'.repeat(64); },
      f => { f[0].latest.proposal.components = []; },
      f => { f[0].number = 5; },
      f => { f.pop(); },
    ]) {
      const floors = inputs(preset); change(floors);
      expect(sampleFloorSuggestions(floors)).toBeNull();
    }
  }
});
