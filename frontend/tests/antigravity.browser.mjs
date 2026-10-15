import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); Object.defineProperty(navigator, 'deviceMemory', { value: 8 });
  const upload = WebGL2RenderingContext.prototype.bufferSubData;
  WebGL2RenderingContext.prototype.bufferSubData = function(target, offset, data, ...args) {
    if (this.canvas.id === 'antigravity-canvas' && data.length === 300 * 16) window.particleMatrices = Array.from(data);
    return upload.call(this, target, offset, data, ...args);
  };
});
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4174');
  const canvas = page.locator('#antigravity-canvas');
  assert.equal(await page.locator('#glow-cursor').count(), 0);
  await page.mouse.move(150, 450); await page.waitForTimeout(300);
  const first = await canvas.screenshot();
  await page.mouse.move(700, 600); await page.waitForTimeout(300);
  assert.equal(first.equals(await canvas.screenshot()), false);
  await page.screenshot({ path: '/tmp/hephaestus-antigravity.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  const still = await canvas.screenshot();
  await page.mouse.move(500, 200); await page.waitForTimeout(300);
  assert.equal(still.equals(await canvas.screenshot()), true);
  await page.locator('[data-upload]').first().click(); assert.equal(await canvas.isVisible(), false);
  await page.locator('#back-home').click(); assert.equal(await canvas.isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const visibleParticles = await page.evaluate(() => {
    const matrices = window.particleMatrices; let visible = 0;
    for (let i = 0; i < matrices.length; i += 16) {
      const halfHeight = Math.tan(35 * Math.PI / 360) * (50 - matrices[i + 14]);
      if (Math.abs(matrices[i + 12]) < halfHeight * innerWidth / innerHeight && Math.abs(matrices[i + 13]) < halfHeight) visible++;
    }
    return visible;
  });
  assert.ok(visibleParticles > 150, `Only ${visibleParticles} particles stayed in the resized viewport`);
  assert.deepEqual(errors, []);
  const fallback = await browser.newPage({ reducedMotion: 'reduce' });
  await fallback.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); }; });
  await fallback.goto(process.env.TEST_URL || 'http://127.0.0.1:4174');
  assert.equal(await fallback.locator('#antigravity-canvas').isVisible(), false);
  await fallback.locator('#explore-demo').click();
  await fallback.locator('#sample-preset').waitFor({ state: 'visible' });
  await fallback.locator('#use-sample-suggestions').click();
  await fallback.locator('#confirm-drawing').click();
  await fallback.waitForFunction(() => !document.getElementById('confirm-alignment').disabled);
  await fallback.locator('#confirm-alignment').click();
  await fallback.locator('#workspace-error').waitFor({ state: 'visible' });
  assert.equal(await fallback.locator('#export-model').isDisabled(), true);
  assert.equal(await fallback.locator('#drawing-image').isVisible(), true);
  console.log('PASS: Antigravity pointer movement, static reduced motion, workspace isolation, resize and WebGL fallback');
} finally { await browser.close(); }
