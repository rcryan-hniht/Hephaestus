import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TEST_URL || 'http://127.0.0.1:4174';
try {
  await page.goto(url); await page.keyboard.press('End');
  await page.waitForFunction(() => document.body.dataset.chapter === '2');
  const wall = page.locator('#drift-wall'); await wall.waitFor({ state: 'visible' });
  async function checkVisiblePairs() {
    const visible = await wall.evaluate(root => {
      const bounds = root.getBoundingClientRect(), keys = [];
      for (const tile of root.querySelectorAll('.drift-wall__tile')) {
        const box = tile.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom && document.elementFromPoint(x, y)?.closest('.drift-wall__tile') === tile) keys.push(`${tile.dataset.project}:${tile.dataset.kind}`);
      }
      return [...keys];
    });
    assert.ok(visible.length > 0);
    assert.equal(new Set(visible).size, visible.length, 'Visible frames must show distinct sample drawings');
  }
  await wall.evaluate(async root => {
    await Promise.all([...new Set([...root.querySelectorAll('img')].map(image => image.src))].map(async src => { const image = new Image(); image.src = src; await image.decode(); }));
  });
  assert.equal(await wall.locator('.drift-wall__col').count(), 5);
  assert.equal(await wall.locator('button, a, [tabindex]').count(), 0, 'Repeated tiles must not duplicate keyboard controls');
  const items = await wall.locator('.drift-wall__tile').evaluateAll(nodes => [...new Set(nodes.map(node => `${node.dataset.project}:${node.dataset.kind}`))]);
  assert.ok(items.length >= 20);
  assert.equal(await wall.locator('img[data-kind=model]').count(), 0);
  assert.equal(await page.locator('#landing-canvas').isVisible(), false, 'CubeCasa gallery must not display the prepared demo behind its drawings');
  assert.equal(await wall.locator('img').evaluateAll(nodes => nodes.every(image => new URL(image.src).pathname.startsWith('/samples/'))), true);
  await checkVisiblePairs();
  assert.ok(await wall.locator('.drift-wall__tile').count() < 100);
  const track = wall.locator('.drift-wall__track').first();
  const still = await track.getAttribute('style'); await page.mouse.move(500, 450); await page.waitForTimeout(200);
  assert.equal(await track.getAttribute('style'), still);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(200);
  assert.notEqual(await track.getAttribute('style'), still);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const hit = await wall.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    for (const tile of root.querySelectorAll('.drift-wall__tile')) {
      const box = tile.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom && document.elementFromPoint(x, y)?.closest('.drift-wall__tile') === tile) return { x, y, id: tile.querySelector('.drift-wall__caption').textContent.split('/')[0] };
    }
  });
  assert.ok(hit, 'A sample tile must remain clickable');
  const submission = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.status() === 202);
  await page.mouse.click(hit.x, hit.y);
  const job = await (await submission).json();
  assert.equal(job.source_kind, 'svg');
  const vector = await readFile(new URL(`../../assets/cubicasa/${hit.id}/source.svg`, import.meta.url));
  assert.equal(job.source_hash, createHash('sha256').update(vector).digest('hex'));
  assert.equal(await page.locator('#workspace').isVisible(), true);
  await page.locator('#api-questions').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#project-name').textContent(), `${hit.id}.svg`);
  assert.equal(await page.locator('#question-meters_per_unit').inputValue(), '');
  assert.equal(await page.locator('#question-floor_height').inputValue(), '');
  assert.equal(await page.locator('#model-label').isVisible(), false);
  await page.locator('#back-home').click();
  await page.keyboard.press('Home'); await wall.waitFor({ state: 'hidden' });
  await page.keyboard.press('End');
  await wall.waitFor({ state: 'visible' });
  assert.equal(await wall.locator('.drift-wall__col').count(), 5);
  await page.screenshot({ path: '/tmp/hephaestus-drift-wall.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await wall.isVisible(), true);
  assert.equal(await wall.locator('.drift-wall__col').count(), 3);
  await checkVisiblePairs();
  assert.deepEqual(errors, []);
  const fallback = await browser.newPage({ reducedMotion: 'reduce' });
  await fallback.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); }; });
  await fallback.goto(url); await fallback.keyboard.press('End');
  await fallback.waitForFunction(() => document.body.dataset.chapter === '2');
  assert.equal(await fallback.locator('#work-list .work-open').count(), 3);
  assert.equal(await fallback.locator('#drift-wall img[data-kind="drawing"]').count() > 0, true);
  assert.equal(await fallback.locator('#drift-wall img[data-kind="model"]').count(), 0);
  await fallback.locator('#work-list .work-open').nth(1).click();
  await fallback.locator('#api-questions').waitFor({ state: 'visible' });
  assert.equal(await fallback.locator('#model-label').isVisible(), false);
  await fallback.locator('#back-home').click();
  await fallback.route('**/samples/13852/source.svg', route => route.fulfill({ status: 404, body: '' }));
  await fallback.locator('#work-list .work-open').nth(1).click();
  await fallback.waitForFunction(() => document.getElementById('drawing-message').textContent.includes('SVG is unavailable'));
  assert.equal(await fallback.locator('#retry-job').isVisible(), false);
  console.log('PASS: CubeCasa PNG drawings, paired SVG questions, drift, reduced motion, exact sample action, stable copies and mobile');
} finally { await browser.close(); }
