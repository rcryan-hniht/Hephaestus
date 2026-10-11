import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const url = process.env.UI_URL || 'http://127.0.0.1:5173';
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.stage[data-scene="studio"]').waitFor({ timeout: 5000 });
    await page.waitForFunction(() => {
      const image = document.querySelector('.stage__illustration');
      return image.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#enter-studio').focus();
    await page.keyboard.press('Enter');
    await page.locator('.stage[data-scene="desk"]').waitFor();
    const stage = await page.locator('.stage__viewport').boundingBox();
    const x = stage.x + stage.width * 0.35, y = stage.y + stage.height * 0.55;
    for (const distance of [0.08, 0.4]) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + stage.width * distance, y, { steps: 12 });
      await page.mouse.up();
      assert.equal(await page.locator('.stage').getAttribute('data-scene'), distance < 0.1 ? 'desk' : 'model');
    }
    await page.locator('#reset-view').click();
    await page.locator('#toggle-plan').click();
    assert.equal(await page.locator('#toggle-plan').getAttribute('aria-pressed'), 'true');
    await page.locator('#toggle-plan').click();
    await page.screenshot({ path: `/tmp/hephaestus-story-model-${width}.png` });
    await page.locator('[data-story-step="0"]').click();
    await page.locator('.stage[data-scene="studio"]').waitFor();
    await page.screenshot({ path: `/tmp/hephaestus-story-studio-${width}.png` });
    await page.locator('#enter-studio').click();
    await page.locator('#reveal-model').focus();
    await page.keyboard.press('Enter');
    await page.locator('.stage[data-scene="model"]').waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}×${height}: three scenes, drag, snap-back, keyboard, model controls`);
    await page.close();
  }
  const animated = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await animated.goto(url, { waitUntil: 'domcontentloaded' });
  await animated.locator('#enter-studio').click();
  const handle = await animated.locator('.drag-hint__handle').boundingBox();
  await animated.mouse.move(handle.x + 20, handle.y + 20);
  await animated.mouse.down();
  await animated.mouse.move(handle.x + 90, handle.y + 20, { steps: 5 });
  await animated.mouse.up();
  assert.equal(await animated.locator('.stage').getAttribute('data-scene'), 'desk');
  await animated.locator('#reveal-model').click();
  await animated.waitForFunction(() => document.querySelector('#canvas').style.opacity === '1');
  await animated.locator('#canvas').focus();
  await animated.keyboard.press('ArrowRight');
  await animated.keyboard.press('+');
  await animated.locator('[data-story-step="0"]').click();
  await animated.waitForFunction(() => document.querySelector('#canvas').hidden);
  console.log('PASS animated reveal, short handle drag and reverse');
  await animated.close();

  const page = await browser.newPage();
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto(url);
  await page.locator('#enter-studio').click();
  await page.locator('#reveal-model').click();
  await page.locator('#scene-error:not([hidden])').waitFor();
  assert.equal(await page.locator('.hero__title').isVisible(), true);
  assert.equal(await page.locator('.stage__illustration').isVisible(), true);
  await page.locator('[data-story-step="0"]').click();
  await page.locator('.stage[data-scene="studio"]').waitFor();
  console.log('PASS WebGL fallback');
} finally { await browser.close(); }
