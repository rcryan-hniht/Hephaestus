import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4174');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#explore-demo').isVisible(), false, 'Landing actions belong only to the final phase');

  // 1. Navigation bar is removed
  const navCount = await page.locator('.nav').count();
  assert.equal(navCount, 0, 'Navigation bar must be removed');

  // 2. HEPHAESTUS brand is enlarged and uses SplitText
  const brand = page.locator('#hero-brand');
  await brand.waitFor({ state: 'visible' });
  const brandText = await brand.textContent();
  assert.equal(brandText.trim(), 'HEPHAESTUS');

  // Verify SplitText characters exist
  const splitChars = page.locator('#hero-brand .split-char');
  const charCount = await splitChars.count();
  assert.equal(charCount, 10, 'HEPHAESTUS must be split into 10 characters');

  // Check font size is enlarged (should be >= 34px)
  const fontSize = await brand.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(fontSize >= 34, `Brand font size should be large, got ${fontSize}px`);

  assert.equal(await page.locator('#visual-label, #next-chapter, #chapter-caption').count(), 0);
  const descriptionSize = await page.locator('[data-copy="0"] .chapter-description').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(descriptionSize >= 17, `Description should be enlarged, got ${descriptionSize}px`);

  // 3. Phase 2 transition via keyboard
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.body.dataset.chapter === '1');

  // Verify chapter 1 is active
  const activeChapter = await page.evaluate(() => document.body.dataset.chapter);
  assert.equal(activeChapter, '1', 'Chapter 1 (Phase 2) should be active');
  assert.equal(await page.locator('#explore-demo').isVisible(), false);

  // Verify 3D canvas is visible
  const canvas = page.locator('#landing-canvas');
  await canvas.waitFor({ state: 'visible' });
  assert.equal(await canvas.isVisible(), true, 'Landing 3D canvas should be visible in Phase 2');

  await page.waitForFunction(() => document.getElementById('landing-canvas').getAttribute('aria-label').toUpperCase().includes('3F VILLA'));

  // 4. Test workspace entry via "Upload your drawing" or "Explore a demo"
  await page.keyboard.press('PageDown'); // to works
  await page.waitForTimeout(400);
  await page.waitForFunction(() => document.body.dataset.chapter === '2' && Math.abs(scrollY - innerHeight * 2) < 1);
  const placement = await page.evaluate(() => {
    const action = document.getElementById('landing-action').getBoundingClientRect();
    const frame = document.getElementById('visual-frame').getBoundingClientRect();
    const works = document.getElementById('work-list').getBoundingClientRect();
    return { besideCanvas: action.left > frame.right, aboveWorks: action.bottom < works.top, fits: action.right <= innerWidth && works.bottom < innerHeight };
  });
  assert.deepEqual(placement, { besideCanvas: true, aboveWorks: true, fits: true });
  await page.locator('#landing-action [data-upload]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#explore-demo').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#work-list .work-item button').first().evaluate(el => el === document.activeElement), true, 'Keyboard order must follow the actions above the works');
  await page.screenshot({ path: '/tmp/hephaestus-final-actions-desktop.png' });

  const demoButton = page.locator('#explore-demo');
  await demoButton.click();
  await page.waitForTimeout(300);

  const workspaceVisible = await page.locator('#workspace').isVisible();
  assert.equal(workspaceVisible, true, 'Workspace should open on demo explore action');

  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.body.dataset.chapter === '0' && scrollY < 1);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const layout = await page.evaluate(() => ({
      sloganBottom: document.querySelector('.slogan').getBoundingClientRect().bottom,
      photoTop: document.getElementById('visual-frame').getBoundingClientRect().top,
      descriptionSize: parseFloat(getComputedStyle(document.querySelector('.chapter-description')).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.ok(layout.sloganBottom < layout.photoTop, `${width}px: enlarged slogan must stay above the photo after fonts load`);
    assert.ok(layout.descriptionSize >= 16);
    assert.equal(layout.overflow, false);
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.body.dataset.chapter === '2' && Math.abs(scrollY - innerHeight * 2) < 1);
    const mobileAction = await page.locator('#landing-action').boundingBox();
    const mobileCanvas = await page.locator('#visual-frame').boundingBox();
    const mobileWorks = await page.locator('#work-list').boundingBox();
    assert.ok(mobileAction.y > mobileCanvas.y + mobileCanvas.height);
    assert.ok(mobileAction.y + mobileAction.height < 844 && mobileAction.x + mobileAction.width <= width);
    assert.ok(mobileAction.y + mobileAction.height < mobileWorks.y && mobileWorks.y + mobileWorks.height < 844);
    await page.screenshot({ path: `/tmp/hephaestus-final-actions-${width}.png` });
    await page.locator('#explore-demo').focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.body.dataset.chapter === '0');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true, 'Focus must leave controls before the final phase hides');
    await page.locator('.skip-link').click();
    await page.waitForFunction(() => document.activeElement?.matches('#landing-action [data-upload]'));
  }

  assert.deepEqual(errors, []);
  console.log('✓ landing-ui browser test passed successfully');
} finally {
  await browser.close();
}
