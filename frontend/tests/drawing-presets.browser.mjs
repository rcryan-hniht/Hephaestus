import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(30000);
  const errors = [], answers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/answers')) answers.push(request.postDataJSON());
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await page.locator('#explore-demo').click();
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__blueprintTexts = [];
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      window.__blueprintTexts.push(String(value));
      return original.call(this, value, ...args);
    };
  });
  for (const [id, count] of [['terrace', 3], ['portal', 2], ['gable', 3]]) {
    const retained = await page.locator('#model-label').textContent(), before = answers.length;
    await page.evaluate(() => { window.__blueprintTexts.length = 0; });
    await page.locator('#drawing-preset').selectOption(id);
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/buildings') && r.request().method() === 'POST');
    await page.locator('#load-drawing-preset').click();
    const response = await submitted;
    assert.equal(response.status(), 202);
    const building = await response.json();
    assert.equal(building.floors.length, count);
    assert.ok(building.floors.every(f => f.job.source_kind === 'svg'));
    await page.locator('#sample-preset').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#model-label').textContent(), retained, 'Keep model while preset waits for information');
    await page.locator('#question-floor_height').fill('3.7');
    await page.locator('#use-sample-suggestions').click();
    assert.equal(await page.locator('#question-floor_height').inputValue(), '3.7');
    assert.equal(answers.length, before, 'Suggestions must await explicit confirmation');
    await page.locator('#question-floor_height').fill(id === 'terrace' ? '3.2' : id === 'portal' ? '4.5' : '4.2');
    for (let floor = 1; floor <= count; floor++) {
      await page.locator('#source-floor').selectOption(String(floor));
      await page.locator('#api-questions').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#question-meters_per_unit').inputValue(), '0.01');
      await page.locator('#preset-component-settings').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#confirm-preset-components').isChecked(), false);
      if (floor === 1) {
        await page.locator('#preset-component-settings summary').click();
        const height = page.locator('#preset-component-settings input[data-field="height"]').first();
        const componentId = await height.getAttribute('data-component-id');
        const edited = String(Number(await height.inputValue()) - 0.1);
        await height.fill(edited);
        await page.locator('#source-floor').selectOption('2');
        await page.locator('#source-floor').selectOption('1');
        assert.equal(await page.locator(`#preset-component-settings input[data-component-id="${componentId}"][data-field="height"]`).inputValue(), edited);
        await height.fill('21');
        await page.locator('#confirm-preset-components').check();
        await page.locator('#api-questions button[type=submit]').click();
        assert.equal(answers.length, before, 'Out-of-range component values must block building');
        await height.fill(edited);
        await page.locator('#preset-component-settings summary').click();
        assert.equal(await page.locator('#preset-component-settings').getAttribute('open'), null);
        await page.locator('#api-questions button[type=submit]').click();
        assert.equal(answers.length, before, 'Unreviewed component suggestions must block building');
        assert.notEqual(await page.locator('#preset-component-settings').getAttribute('open'), null, 'Invalid review must reveal its control');
        await page.locator('#confirm-preset-components').check();
        await page.locator('#api-questions button[type=submit]').click();
        await page.waitForFunction(n => document.getElementById(`floor-status-${n}`).textContent.includes('Ready'), floor);
        assert.equal(answers.at(-1).component_values[componentId].height, Number(edited));
        continue;
      }
      await page.locator('#confirm-preset-components').check();
      await page.locator('#api-questions button[type=submit]').click();
      await page.waitForFunction(n => document.getElementById(`floor-status-${n}`).textContent.includes('Ready'), floor);
    }
    const assembled = page.waitForResponse(r => r.url().endsWith(`/api/buildings/${building.id}/scene`) && r.status() === 200);
    await page.locator('#floor-alignment button[type=submit]').click();
    const scene = await (await assembled).json();
    assert.ok(scene.components.some(c => c.type === 'stair' && c.steps >= 2));
    assert.ok(scene.components.some(c => c.type === 'roof' && c.roof_thickness > 0));
    if (id === 'gable') assert.ok(scene.components.some(c => c.type === 'roof' && c.roof_kind === 'gable'));
    await page.waitForFunction(() => document.getElementById('model-label').textContent.startsWith('RECONSTRUCTED'));
    assert.deepEqual(await page.evaluate(() => window.__blueprintTexts.filter(text =>
      /CENTRAL COURTYARD|LIVING SPACE|GALLERY \/ STUDIO|38\.4 m²|32\.0 m²|SCALE 1:100|DEMO MODEL/.test(text)
    )), [], 'Backend models must not receive demo-only blueprint labels');
    assert.equal(await page.locator('#export-model').isEnabled(), true);
    await page.locator('#fit-model').click();
    await page.screenshot({ path: `/tmp/hephaestus-drawing-preset-${id}.png` });
    await page.locator('#export-model').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('[data-export="glb"]').click();
    const bytes = await readFile(await (await downloaded).path());
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(gltf.nodes.some(n => n.extras?.type === 'roof' && n.extras.source_hash));
    assert.ok(gltf.nodes.some(n => n.extras?.type === 'stair' && n.extras.steps >= 2));
    if (id === 'gable') {
      const stair = scene.components.find(c => c.type === 'stair');
      await page.locator('#component-select').selectOption(stair.id);
      assert.equal(await page.locator('#component-steps').inputValue(), '6');
      await page.locator('#component-steps').fill('8');
      await page.locator('#properties-form button').click();
      await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 2.1.1'));
      await page.locator('#component-select').selectOption(stair.id);
      assert.equal(await page.locator('#component-steps').inputValue(), '8');
      await page.locator('#undo').click();
      await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 1.1.1'));
      await page.locator('#component-select').selectOption(stair.id);
      assert.equal(await page.locator('#component-steps').inputValue(), '6');
      await page.locator('#redo').click();
      await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 2.1.1'));
      const roof = scene.components.find(c => c.type === 'roof');
      await page.locator('#component-select').selectOption(roof.id);
      assert.equal(await page.locator('#component-roof-thickness').inputValue(), '0.2');
      await page.locator('#component-roof-thickness').fill('0.25');
      await page.locator('#properties-form button').click();
      await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 2.1.2'));
      await page.locator('#component-select').selectOption(roof.id);
      assert.equal(await page.locator('#component-roof-thickness').inputValue(), '0.25');
      await page.locator('#floor-select').selectOption('all');
      await page.locator('#section').fill('60');
      await page.screenshot({ path: '/tmp/hephaestus-gable-section.png' });
      await page.locator('#section').fill('100');
    }
  }
  const source = await page.locator('#drawing-image').getAttribute('src');
  const retained = await page.locator('#model-label').textContent();
  await page.route('**/presets/gable-villa/F2.svg', route => route.fulfill({ status: 404, body: '' }));
  await page.locator('#load-drawing-preset').click();
  await page.waitForFunction(() => document.getElementById('drawing-message').textContent.includes('preset drawing is unavailable'));
  assert.equal(await page.locator('#drawing-image').getAttribute('src'), source);
  assert.equal(await page.locator('#model-label').textContent(), retained);
  assert.equal(await page.locator('#export-model').isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-drawer="drawing-panel"]').click();
  assert.equal(await page.locator('#load-drawing-preset').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: three SVG drawing presets, explicit confirmation, reconstructed roofs/stairs, GLB, stair edits/history, failure retention and mobile controls');
} finally { await browser.close(); }
