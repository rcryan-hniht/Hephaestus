import { showLandingActions } from './helpers/landing.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now() * 5), 33);
    window.cancelAnimationFrame = clearTimeout;
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.getElementById('landing-canvas').getAttribute('aria-label').toUpperCase().includes('3F VILLA'));
  assert.equal(await page.locator('#preset-controls, #preset-pause').count(), 0, 'Showcase has no control bar');
  await page.waitForFunction(() => document.getElementById('landing-canvas').getAttribute('aria-label').toUpperCase().includes('TERRACE VILLA'), null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('preset-snapshot').hidden);
  await page.screenshot({ path: '/tmp/hephaestus-manifesto-no-bar.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.getElementById('landing-canvas').getAttribute('aria-label').toUpperCase().endsWith('SOLID'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#preset-controls').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.body.dataset.chapter === '2');
  await showLandingActions(page); await page.locator('#explore-demo').click();
  assert.equal(await page.locator('#workspace').isVisible(), true);
  assert.deepEqual(errors, []);
  const failed = await browser.newPage({ reducedMotion: 'reduce' });
  await failed.route('**/prepared-presets.json*', route => route.abort());
  await failed.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await failed.keyboard.press('PageDown');
  await failed.locator('#landing-error').waitFor({ state: 'visible' });
  assert.equal(await failed.locator('[data-upload]').first().isEnabled(), true);
  await failed.close();
  console.log('PASS: automatic showcase without a control bar, reduced motion, mobile, fallback and workspace isolation');
} finally { await browser.close(); }
