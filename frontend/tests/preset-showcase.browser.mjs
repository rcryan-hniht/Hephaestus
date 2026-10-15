import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await page.locator('#next-chapter').click();
  await page.locator('#preset-controls').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#preset-controls [data-preset]').length === 4);
  assert.match(await page.locator('#visual-label').textContent(), /PRESET SHOWCASE.*3F VILLA/);
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => document.querySelector('#preset-controls [data-preset="1"]').getAttribute('aria-pressed') === 'true', null, { timeout: 15000 });
  await page.locator('#preset-pause').click();
  for (const [index, name] of ['3F VILLA', 'TERRACE VILLA', 'PORTAL VILLA', 'GABLE VILLA'].entries()) {
    await page.locator(`#preset-controls [data-preset="${index}"]`).click();
    await page.waitForFunction(() => document.getElementById('preset-snapshot').hidden);
    assert.ok((await page.locator('#visual-label').textContent()).endsWith(name));
    await page.screenshot({ path: `/tmp/hephaestus-manifesto-preset-${index}.png` });
  }
  await page.locator('#preset-controls [data-preset="0"]').click();
  await page.waitForFunction(() => document.getElementById('preset-snapshot').hidden);
  await page.locator('#preset-controls [data-preset="1"]').click();
  await page.waitForFunction(() => !document.getElementById('preset-snapshot').hidden);
  const slide = await page.locator('#landing-canvas').evaluate(el => ({ x: new DOMMatrixReadOnly(getComputedStyle(el).transform).m41, opacity: Number(getComputedStyle(el).opacity) }));
  assert.ok(slide.x < 0 && slide.opacity < 1, 'New model enters from the left while fading in');
  await page.waitForFunction(() => document.getElementById('preset-snapshot').hidden);
  await page.mouse.move(10, 10);
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(6500);
  assert.equal(await page.locator('#preset-controls [aria-pressed="true"]').getAttribute('data-preset'), '1', 'Paused showcase stays still');
  await page.locator('#preset-controls [data-preset="1"]').focus();
  await page.evaluate(() => {
    document.documentElement.style.scrollSnapType = 'none';
    window.scrollTo({ top: innerHeight * 1.3, behavior: 'instant' });
  });
  await page.waitForFunction(() => document.activeElement === document.getElementById('next-chapter'));
  await page.evaluate(() => {
    window.scrollTo({ top: innerHeight, behavior: 'instant' });
    document.documentElement.style.scrollSnapType = '';
  });
  await page.locator('#preset-pause').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.activeElement !== document.getElementById('preset-pause'));
  await page.locator('#preset-controls [data-preset="3"]').click();
  assert.equal(await page.locator('#preset-snapshot').isHidden(), true);
  assert.equal(await page.locator('#landing-canvas').evaluate(el => el.style.transform), 'none');
  await page.mouse.move(10, 10);
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(6500);
  assert.equal(await page.locator('#preset-controls [aria-pressed="true"]').getAttribute('data-preset'), '3', 'Reduced motion disables automatic changes');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#preset-controls').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#next-chapter').click();
  await page.waitForFunction(() => document.body.dataset.chapter === '2');
  assert.equal(await page.locator('#preset-controls').isVisible(), false);
  await page.locator('#explore-demo').click();
  assert.equal(await page.locator('#workspace').isVisible(), true);
  assert.deepEqual(errors, []);
  const failed = await browser.newPage({ reducedMotion: 'reduce' });
  await failed.route('**/prepared-presets.json*', route => route.abort());
  await failed.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await failed.locator('#next-chapter').click();
  await failed.locator('#landing-error').waitFor({ state: 'visible' });
  assert.equal(await failed.locator('#preset-controls').isVisible(), false);
  assert.equal(await failed.locator('[data-upload]').first().isEnabled(), true);
  await failed.close();
  console.log('PASS: four complete villa presets, automatic fade/slide, pause, manual selection, reduced motion, mobile and workspace isolation');
} finally { await browser.close(); }
