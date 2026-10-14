import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/api/jobs', route => route.abort());
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.body.dataset.chapter === '2');
  const wall = page.locator('#drift-wall');
  const drawings = await wall.locator('img').evaluateAll(images => [...new Set(images.map(image => image.src))]);
  assert.ok(drawings.length >= 20, 'Gallery needs enough distinct drawings to fill every visible frame');
  const hashes = await Promise.all(drawings.map(async src => {
    const response = await page.request.get(src);
    assert.equal(response.status(), 200);
    return createHash('sha256').update(await response.body()).digest('hex');
  }));
  assert.equal(new Set(hashes).size, hashes.length, 'Different sample names must not reuse the same image');
  const captions = await wall.locator('.drift-wall__caption').allTextContents();
  assert.ok(captions.every(caption => /^\d+\/F1_scaled\.png$/.test(caption)));
  assert.equal(await wall.locator('button, a, [tabindex]').count(), 0);
  assert.equal(await page.locator('#work-list .work-open').count(), 3);
  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    const visible = await wall.evaluate(root => {
      const bounds = root.getBoundingClientRect();
      return [...root.querySelectorAll('.drift-wall__tile')].filter(tile => {
        const r = tile.getBoundingClientRect();
        return r.right > bounds.left && r.left < bounds.right && r.bottom > bounds.top && r.top < bounds.bottom;
      }).map(tile => tile.querySelector('img').src);
    });
    assert.ok(visible.length > 0);
    assert.equal(new Set(visible).size, visible.length, 'Visible frames must contain different drawings');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  const hit = await wall.evaluate(root => {
    for (const tile of root.querySelectorAll('.drift-wall__tile')) {
      if (Number(tile.dataset.project) < 3) continue;
      const r = tile.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (document.elementFromPoint(x, y)?.closest('.drift-wall__tile') === tile)
        return { x, y, id: tile.querySelector('.drift-wall__caption').textContent.split('/')[0] };
    }
  });
  assert.ok(hit, 'An additional sample must be clickable');
  const source = page.waitForResponse(response => response.url().endsWith(`/samples/${hit.id}/source.svg`));
  const submission = page.waitForRequest(request => request.url().endsWith('/api/jobs') && request.method() === 'POST');
  await page.mouse.click(hit.x, hit.y);
  assert.equal((await source).status(), 200);
  const vector = await readFile(new URL(`../../assets/cubicasa/${hit.id}/source.svg`, import.meta.url));
  assert.ok((await submission).postDataBuffer().includes(vector), 'Clicked drawing must submit its own paired SVG');
  assert.equal(await page.locator('#workspace').isVisible(), true);
  console.log('PASS: unique visible gallery drawings, concise filenames, responsive layout and source-bound sample selection');
} finally { await browser.close(); }
