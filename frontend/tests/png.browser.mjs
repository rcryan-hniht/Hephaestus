import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Use a backend whose OpenRouter client uses MockTransport; never a paid provider.
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4175');
  await page.locator('[data-upload]').first().click();
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 10; return c.toDataURL().split(',')[1]; });
  await page.locator('#file-input').setInputFiles({ name: 'mock.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('#api-questions').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#question-review_confirmed').isChecked(), false);
  await page.locator('#question-meters_per_unit').fill('.1');
  await page.locator('.question').filter({ has: page.locator('#question-floor_height') }).getByRole('button', { name: "I don't know" }).click();
  await page.getByRole('button', { name: 'Use suggestion' }).click();
  const confirmedHeight = Number(await page.locator('#question-floor_height').inputValue());
  assert.equal(await page.locator('#question-meters_per_unit').inputValue(), '.1');
  assert.equal(await page.locator('#model-label').isVisible(), false);
  await page.locator('#question-review_confirmed').check();
  await page.locator('#proposal-edit button').click();
  await page.waitForFunction(() => !document.getElementById('question-review_confirmed')?.checked && !document.getElementById('proposal-edit').hidden);
  assert.equal(await page.locator('#question-review_confirmed').isChecked(), false);
  await page.locator('#question-review_confirmed').check();
  await page.locator('#api-questions button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 1'));
  assert.equal(await page.locator('#drawing-image').isVisible(), true);
  await page.locator('#toggle-source').click();
  const id = await page.locator('#plan-svg polygon').first().getAttribute('data-id');
  await page.locator('#component-select').selectOption(id);
  assert.match(await page.locator('#plan-svg polygon').first().getAttribute('data-selected'), /true/);
  await page.locator('#component-x').fill('.05');
  await page.locator('#component-height').fill('3');
  await page.locator('#properties-form button').click();
  await page.locator('#api-questions').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#question-review_confirmed').isChecked(), false);
  assert.match(await page.locator('#model-label').textContent(), /REVISION 1/);
  await page.locator('#question-review_confirmed').check();
  await page.locator('#api-questions button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('model-label').textContent.includes('REVISION 2'));
  const jobId = id.split(':')[0];
  const scene = await (await page.request.get(`${new URL(page.url()).origin}/api/jobs/${jobId}/scene`)).json();
  assert.equal(scene.components[0].height, 3);
  assert.ok(Math.abs(scene.components[0].polygon[0][0] - .15) < 1e-8);
  assert.equal(scene.parameters.floor_height.provenance, 'user_confirmed');
  assert.equal(scene.parameters.floor_height.value, confirmedHeight);
  console.log('PASS: PNG mocked OpenRouter → review, explicit suggestion, correction → confirmed 3D model');
} finally { await browser.close(); }
