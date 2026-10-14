import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TEST_URL || 'http://127.0.0.1:4174';
try {
  await page.goto(url); await page.locator('[data-chapter="2"]').click();
  const wall = page.locator('#drift-wall'); await wall.waitFor({ state: 'visible' });
  async function checkVisiblePairs() {
    const visible = await wall.evaluate(root => {
      const bounds = root.getBoundingClientRect(), keys = new Set();
      for (const tile of root.querySelectorAll('.drift-wall__tile')) {
        const box = tile.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom && document.elementFromPoint(x, y)?.closest('.drift-wall__tile') === tile) keys.add(`${tile.dataset.project}:${tile.dataset.kind}`);
      }
      return [...keys];
    });
    assert.equal(visible.length, 6, `The frame crops sample pairs: ${visible.join(', ')}`);
  }
  await wall.evaluate(async root => {
    await Promise.all([...new Set([...root.querySelectorAll('img')].map(image => image.src))].map(async src => { const image = new Image(); image.src = src; await image.decode(); }));
  });
  assert.equal(await wall.locator('.drift-wall__col').count(), 5);
  assert.equal(await wall.locator('button, a, [tabindex]').count(), 0, 'Repeated tiles must not duplicate keyboard controls');
  const items = await wall.locator('.drift-wall__tile').evaluateAll(nodes => [...new Set(nodes.map(node => `${node.dataset.project}:${node.dataset.kind}`))]);
  assert.equal(items.length, 6);
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
    for (const tile of root.querySelectorAll('[data-project="1"]')) {
      const box = tile.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom && document.elementFromPoint(x, y)?.closest('.drift-wall__tile') === tile) return { x, y };
    }
  });
  assert.ok(hit, 'A sample tile must remain clickable'); await page.mouse.click(hit.x, hit.y);
  assert.equal(await page.locator('#workspace').isVisible(), true);
  assert.equal(await page.locator('#project-name').textContent(), 'A Modest Home');
  await page.locator('#back-home').click();
  await page.locator('[data-chapter="0"]').first().click(); await wall.waitFor({ state: 'hidden' });
  await page.locator('[data-chapter="2"]').click();
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
  await fallback.goto(url); await fallback.locator('[data-chapter="2"]').click();
  assert.equal(await fallback.locator('#work-list .work-open').count(), 3);
  assert.equal(await fallback.locator('#drift-wall img[data-kind="drawing"]').count() > 0, true);
  assert.equal(await fallback.locator('#drift-wall img[data-kind="model"]').count(), 0);
  await fallback.locator('#work-list .work-open').nth(1).click();
  assert.equal(await fallback.locator('#workspace-error').isVisible(), true);
  console.log('PASS: DriftWall real sample drawings/models, drift, reduced motion, exact project action, stable copies, mobile and WebGL fallback');
} finally { await browser.close(); }
