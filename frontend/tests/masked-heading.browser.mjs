import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TEST_URL || 'http://127.0.0.1:4174';
try {
  await page.goto(url);
  const heading = page.getByRole('heading', { level: 1, name: 'From drawing. To space.' });
  await heading.waitFor({ state: 'visible' });
  assert.equal(await heading.locator('.masked-heading').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('h1 .masked-heading')].every(el => el.dataset.ready === 'true'));
  async function checkBounds() {
    const bounds = await heading.evaluate(el => [...el.querySelectorAll('.masked-heading')].map(line => {
      const rect = line.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height,
        glyphs: [...line.querySelectorAll('svg text')].map(glyph => {
          const box = glyph.getBBox(), style = getComputedStyle(glyph), context = document.createElement('canvas').getContext('2d');
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const ink = context.measureText(glyph.textContent), baseline = Number(glyph.getAttribute('y'));
          return { x: box.x, y: baseline - ink.actualBoundingBoxAscent, width: box.width, height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent };
        }) };
    }));
    for (const line of bounds) {
      assert.ok(line.left >= 0 && line.right <= page.viewportSize().width + 1);
      for (const glyph of line.glyphs) {
        assert.ok(glyph.x >= -1 && glyph.x + glyph.width <= line.width + 1, 'Glyph exceeds heading width');
        assert.ok(glyph.y >= -1 && glyph.y + glyph.height <= line.height + 1, 'Glyph exceeds heading height');
      }
    }
  }
  await checkBounds();
  const media = heading.locator('.masked-heading__media').first();
  const still = await media.getAttribute('style');
  await page.mouse.move(500, 400); await page.waitForTimeout(200);
  assert.equal(await media.getAttribute('style'), still);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const before = await media.getAttribute('style');
  await page.mouse.move(400, 420); await page.waitForTimeout(250);
  assert.notEqual(await media.getAttribute('style'), before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [[390, 844], [320, 568], [800, 600], [1440, 900]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100); await checkBounds();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.screenshot({ path: '/tmp/hephaestus-masked-heading.png' });
  await page.locator('[data-upload]').first().click();
  assert.equal(await heading.isVisible(), false);
  await page.locator('#back-home').click(); assert.equal(await heading.isVisible(), true);
  await page.locator('[data-chapter="1"]').click(); await page.locator('[data-chapter="0"]').first().click();
  assert.equal(await heading.isVisible(), true);
  assert.deepEqual(errors, []);
  const fallback = await browser.newPage({ reducedMotion: 'reduce' });
  await fallback.route('**/reference/hero.webp', route => route.abort());
  await fallback.goto(url);
  await fallback.getByRole('heading', { level: 1, name: 'From drawing. To space.' }).waitFor({ state: 'visible' });
  assert.equal(await fallback.locator('h1 [data-ready=true]').count(), 0);
  const readable = await fallback.locator('.masked-heading__measure').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).color !== 'rgba(0, 0, 0, 0)'));
  assert.equal(readable, true);
  await fallback.locator('[data-upload]').first().click();
  assert.equal(await fallback.locator('#workspace').isVisible(), true);
  console.log('PASS: MaskedHeading semantics, image mask, responsive glyph bounds, reduced motion, workspace/chapter transitions and missing-image fallback');
} finally { await browser.close(); }
