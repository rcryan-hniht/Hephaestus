import { showLandingActions } from './helpers/landing.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(30000);
  const answers = [];
  page.on('request', request => {
    if (request.url().endsWith('/answers') && request.method() === 'POST') answers.push(request.postDataJSON());
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  const submission = page.waitForResponse(response => response.url().endsWith('/api/buildings') && response.request().method() === 'POST');
  await showLandingActions(page); await page.locator('#explore-demo').click();
  assert.equal(await page.locator('#drawing-preset option[value="modern"]').textContent(), '3F villa');
  const building = await (await submission).json();
  assert.equal(building.floors.length, 4);
  assert.ok(building.floors.every(floor => floor.job.source_kind === 'svg'));
  await page.locator('#sample-preset').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#use-sample-suggestions').textContent(), 'Use villa parameters');
  assert.equal(await page.locator('#export-model').isDisabled(), true, 'Demo entry must await villa confirmation instead of opening the old model');
  await page.locator('#question-floor_height').fill('3.7');
  await page.locator('#use-sample-suggestions').click();
  assert.equal(await page.locator('#question-floor_height').inputValue(), '3.7', 'Preset must preserve user entries');
  assert.equal(answers.length, 0, 'Preset values must await explicit confirmation');
  await page.locator('#question-floor_height').fill('3.6');
  assert.equal(await page.locator('#confirm-preset-components').count(), 0);
  await page.locator('#confirm-drawing').click();
  for (let floor = 1; floor <= 4; floor++) {
    await page.waitForFunction(number => document.getElementById(`floor-status-${number}`).textContent.includes('Ready'), floor);
  }
  assert.equal(answers.length, 4);
  const canopyOverride = Object.values(answers[3].component_values).find(values => values.elevation === 3);
  assert.deepEqual(canopyOverride, { height: .15, elevation: 3 });
  const published = page.waitForResponse(response => response.url().endsWith(`/api/buildings/${building.id}/scene`) && response.status() === 200);
  await page.locator('#confirm-alignment').click();
  const scene = await (await published).json();
  assert.deepEqual(scene.floors.map(floor => floor.transform[1]), [0, 3.6, 6.9, 10.2]);
  assert.deepEqual(scene.components.filter(c => c.type === 'stair').map(c => c.source_floor), [1, 1, 2, 2, 3, 3]);
  const canopy = scene.components.find(c => c.source.element_id === 'F4-canopy');
  assert.ok(Math.abs(canopy.elevation + canopy.height - 13.2) < 1e-8);
  assert.ok(scene.components.some(c => c.source_floor === 4 && c.height === 1.1));
  assert.equal(scene.components.filter(c => c.source_floor === 4 && c.type === 'door').length, 1);
  assert.deepEqual(scene.components.filter(c => c.source_floor === 4 && c.type === 'window').map(c => c.source.element_id), ['F4-pavilion-front']);
  await page.waitForFunction(() => document.getElementById('project-name').textContent.includes('Building'));
  assert.equal(await page.locator('#export-model').isEnabled(), true);
  const component = await page.locator('#component-select option').nth(1).getAttribute('value');
  await page.locator('#component-select').selectOption(component);
  assert.equal(await page.locator('#floor-select').inputValue(), '0');
  await page.locator('[data-type="roof"]').uncheck();
  await page.locator('#section').fill('50');
  await page.locator('[data-view="plan"]').click();
  await page.getByRole('combobox', { name: 'Select component', exact: true }).selectOption({ label: 'View full architecture' });
  assert.equal(await page.locator('#floor-select').inputValue(), 'all');
  assert.equal(await page.locator('#component-select').inputValue(), '');
  assert.equal(await page.locator('#properties-form').isVisible(), false);
  assert.equal(await page.locator('#selection-count').textContent(), '—');
  assert.equal(await page.locator('[data-type]:not(:checked)').count(), 0);
  assert.equal(await page.locator('#section').inputValue(), '100');
  assert.equal(await page.locator('[data-view="perspective"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#fit-model').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/hephaestus-villa-v2-workspace.png' });
  await page.locator('[data-type="wall"]').uncheck();
  await page.locator('#section').fill('75');
  await page.screenshot({ path: '/tmp/hephaestus-modern-villa-interior-stairs.png' });
  await page.locator('[data-type="wall"]').check();
  await page.locator('#section').fill('100');
  const source = await page.locator('#drawing-image').getAttribute('src');
  await page.route('**/presets/modern-villa/F2.svg', route => route.fulfill({ status: 404, body: '' }));
  await page.locator('#load-villa-preset').click();
  await page.waitForFunction(() => document.getElementById('drawing-message').textContent.includes('preset drawing is unavailable'));
  assert.equal(await page.locator('#drawing-image').getAttribute('src'), source, 'Failed preset downloads must retain the drawing');
  assert.ok((await page.locator('#project-name').textContent()).includes('Building'));
  assert.equal(await page.locator('#export-model').isEnabled(), true, 'Failed preset downloads must retain the valid model');
  for (const id of ['empty-sample', 'load-sample']) {
    const entry = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
    await entry.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
    await showLandingActions(entry); await entry.locator('[data-upload]').first().click();
    const batch = entry.waitForResponse(r => r.url().endsWith('/api/buildings') && r.request().method() === 'POST');
    await entry.locator(`#${id}`).click();
    assert.equal((await (await batch).json()).floors.length, 4);
    await entry.locator('#use-sample-suggestions').waitFor({ state: 'visible' });
    assert.equal(await entry.locator('#export-model').isDisabled(), true);
    await entry.close();
  }
  console.log('PASS: four-drawing villa preset, preserved edits, explicit confirmation, source-bound canopy overrides and building assembly');
} finally { await browser.close(); }
