import { showLandingActions } from './helpers/landing.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const hashes = ['8487017eb625ded98ba1b76eaa4d4def465e20c8a3552ff84b3bf6768c8f1777', '1e7d942a4878dc47b38a1da7e85cd11fd7a700bafe1c94169f23cd66cd565dd2'];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
let recognized = true, writes = 0;
const errors = []; page.on('pageerror', e => errors.push(e.message));
const keys = ['meters_per_unit', 'floor_height', 'slab_thickness', 'door_height', 'window_height', 'window_sill', 'review_confirmed'];
const job = i => ({ id: `sample-${i}`, generation: 1, state: 'needs_information', name: `F${i + 1}_sample.png`,
 source_kind: 'png', source_hash: recognized ? hashes[i] : '0'.repeat(64), parameters: {}, suggestions: {},
 questions: keys.map(key => ({ key, message: `Confirm ${key}`, component_ids: [] })), has_model: false });
try {
 // Mock only the API boundary; run the real workspace and drawing controls.
 await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  let response;
  if (path === '/api/buildings' && request.method() === 'POST') response = { id: 'sample-building', generation: 1,
   floors: [0,1].map(i => ({ number: i + 1, job: job(i) })) };
  else if (path.endsWith('/proposal')) {
   const i = Number(path.match(/sample-(\d)/)[1]);
   response = { generation: 1, proposal: { job_id: job(i).id, source_hash: job(i).source_hash, source_kind: 'png',
    coordinate_frame: { width: 300, height: 200, unit: 'pixel' },
    components: [{ id: `sample-${i}:wall`, type: 'wall', polygon: i ? [[10,30],[50,30],[50,70],[10,70]] : [[100,20],[200,20],[200,120],[100,120]] }] } };
  } else if (path.endsWith('/cancel')) response = {};
  else if (request.method() === 'POST') { writes++; response = {}; }
  else throw new Error(`Unexpected API request: ${path}`);
  await route.fulfill({ status: path === '/api/buildings' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(response) });
 });
 await page.goto(process.env.TEST_URL || 'http://localhost:3000');
 await showLandingActions(page); await page.locator('[data-upload]').first().click();
 const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; return c.toDataURL().split(',')[1]; }), 'base64');
 const files = [1,2].map(n => ({ name: `F${n}_sample.png`, mimeType: 'image/png', buffer: png }));
 await page.locator('#file-input').setInputFiles(files);
 await page.locator('#use-sample-suggestions').waitFor({ state: 'visible' });
 await page.locator('#question-floor_height').fill('7');
 await page.locator('#floor-1-x').fill('0');
 await page.locator('#use-sample-suggestions').click();
 assert.equal(Number(await page.locator('#question-meters_per_unit').inputValue()), .2);
 assert.equal(Number(await page.locator('#question-floor_height').inputValue()), 7, 'manual height retained');
 assert.equal(Number(await page.locator('#question-door_height').inputValue()), 2.1);
 assert.equal(Number(await page.locator('#floor-1-x').inputValue()), 0, 'manually entered zero retained');
 assert.equal(Number(await page.locator('#floor-1-y').inputValue()), -4);
 assert.equal(Number(await page.locator('#floor-2-x').inputValue()), -5);
 assert.equal(Number(await page.locator('#floor-2-y').inputValue()), -15);
 assert.equal(await page.locator('#question-review_confirmed').isChecked(), false);
 await page.locator('#source-floor').selectOption('2');
 assert.equal(Number(await page.locator('#question-meters_per_unit').inputValue()), .5);
 assert.equal(Number(await page.locator('#question-floor_height').inputValue()), 3.6);
 assert.equal(Number(await page.locator('#question-slab_thickness').inputValue()), .2);
 assert.equal(await page.locator('#question-review_confirmed').isChecked(), false);
 assert.equal(writes, 0, 'sample selection never confirms parameters or builds automatically');
 assert.equal(await page.locator('#model-label').isVisible(), false);
 recognized = false; await page.locator('#file-input').setInputFiles(files);
 await page.waitForFunction(() => document.getElementById('building-summary').textContent.includes('received'));
 assert.equal(await page.locator('#sample-preset').isVisible(), false, 'matching filenames do not activate presets for other images');
 assert.deepEqual(errors, []);
 console.log('PASS: source-bound sample preset fills both floors, preserves manual values/offsets and requires explicit review/build');
} finally { await browser.close(); }
