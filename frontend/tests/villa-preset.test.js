import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import preset from '../src/villa-preset.json';
import { sampleFloorSuggestions } from '../src/floors.js';

const floors = () => preset.floors.map((configuration, index) => ({
  number: index + 1,
  job: { id: `villa-${index}`, source_hash: configuration.source_hash, source_kind: 'svg', state: 'needs_information', name: 'renamed.svg' },
  latest: { proposal: { job_id: `villa-${index}`, source_hash: configuration.source_hash, source_kind: 'svg',
    components: Object.keys(configuration.components).map((element, i) => ({ id: `villa-${index}:c${i}`, source: { element_id: element } })),
  } },
}));

test('villa preset is bound to its real SVGs and maps canopy heights to current job component IDs', () => {
  for (const configuration of preset.floors) {
    const source = readFileSync(new URL(`../../backend/tests/fixtures/modern_villa/F${configuration.number}.svg`, import.meta.url));
    expect(createHash('sha256').update(source).digest('hex')).toBe(configuration.source_hash);
  }
  const inputs = floors(), before = JSON.stringify(inputs);
  const suggestions = sampleFloorSuggestions(inputs);
  expect(suggestions).not.toBeNull();
  expect(suggestions.map(s => s.parameters.floor_height)).toEqual([3.6, 3.3, 3.3, 3.0]);
  const canopy = inputs[3].latest.proposal.components.find(c => c.source.element_id === 'F4-canopy');
  expect(suggestions[3].componentValues[canopy.id]).toEqual({ height: .15, elevation: 3 });
  expect(JSON.stringify(inputs)).toBe(before);
});

test('villa suggestions reject modified sources, stale proposals and missing canopy evidence', () => {
  for (const change of [
    f => { f[0].job.source_hash = '0'.repeat(64); },
    f => { f[0].job.source_kind = 'png'; },
    f => { f[0].latest.proposal.job_id = 'obsolete'; },
    f => { f[0].latest.proposal.source_hash = '0'.repeat(64); },
    f => { f[0].job.state = 'cancelled'; },
    f => { f[0].latest = null; },
    f => { f[3].latest.proposal.components = []; },
    f => { f[3].number = 5; },
  ]) {
    const input = floors(); change(input);
    expect(sampleFloorSuggestions(input)).toBeNull();
  }
});
