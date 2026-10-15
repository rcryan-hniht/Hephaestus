import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const url = process.env.TEST_URL || 'http://127.0.0.1:4174';
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.chapter === '0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 1800,
      'Landing must end at the third chapter, without a fourth scroll stop');
    await page.mouse.move(1400, 450);
    async function at(chapter, top) {
      await page.waitForFunction(([chapter, top]) => document.body.dataset.chapter === chapter && Math.abs(scrollY - top) < 1,
        [String(chapter), top]);
      await page.waitForTimeout(220); // A new gesture starts after the trackpad tail is quiet.
    }
    const input = await page.context().newCDPSession(page);
    const timestamp = Date.now() / 1000;
    await Promise.all([10, 8, 7, 4].map(deltaY => input.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 1400, y: 450, deltaX: 0, deltaY, timestamp,
    })));
    await at(1, 900);
    assert.equal(await page.locator('[data-copy]:not([inert])').count(), 1);
    await page.mouse.wheel(0, 120);
    await at(2, 1800);
    await page.evaluate(() => {
      window.visitedChapters = [];
      window.chapterObserver = new MutationObserver(() => window.visitedChapters.push(document.body.dataset.chapter));
      window.chapterObserver.observe(document.body, { attributes: true, attributeFilter: ['data-chapter'] });
    });
    await page.mouse.wheel(0, 120);
    await at(0, 0);
    const visited = await page.evaluate(() => {
      window.chapterObserver.disconnect();
      return [...new Set(window.visitedChapters)];
    });
    assert.ok(!visited.includes('1'), 'Works must blend directly into Hero, without revisiting Manifesto');
    assert.equal(await page.evaluate(() => document.body.dataset.scrollDirection), 'forward');
    await page.keyboard.press('End');
    await at(2, 1800);
    await page.mouse.wheel(0, -120);
    await at(1, 900);
    await page.mouse.wheel(0, -120);
    await at(0, 0);
    await page.keyboard.press('PageDown');
    await at(1, 900);
    await page.keyboard.press('Home');
    await at(0, 0);
    await page.locator('#explore-demo').click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.mouse.wheel(0, 400);
    assert.equal(await page.evaluate(() => document.body.dataset.chapter), '0');
    await page.locator('#back-home').click();
    await at(0, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 1688);
    await page.keyboard.press('End');
    await at(2, 1688);
    await page.mouse.wheel(0, 120);
    await at(0, 0);
    await page.keyboard.press('End');
    await at(2, 1688);
    await input.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 380, y: 650 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 380, y: 400 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await at(0, 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: three scroll stops, small trackpad deltas, direct loop, backward scroll, keyboard, resize, touch, reduced motion and workspace isolation');
} finally {
  await browser.close();
}
