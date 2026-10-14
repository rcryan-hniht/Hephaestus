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

  // 3. Phase 2 transition via next chapter or wheel
  await page.locator('#next-chapter').click();
  await page.waitForFunction(() => document.body.dataset.chapter === '1');

  // Verify chapter 1 is active
  const activeChapter = await page.evaluate(() => document.body.dataset.chapter);
  assert.equal(activeChapter, '1', 'Chapter 1 (Phase 2) should be active');

  // Verify 3D canvas is visible
  const canvas = page.locator('#landing-canvas');
  await canvas.waitFor({ state: 'visible' });
  assert.equal(await canvas.isVisible(), true, 'Landing 3D canvas should be visible in Phase 2');

  // Wait for automatic 3D extrusion to progress
  await page.waitForTimeout(1800);

  // 4. Test workspace entry via "Upload your drawing" or "Explore a demo"
  await page.locator('#next-chapter').click(); // to works
  await page.waitForTimeout(400);
  await page.locator('#next-chapter').click(); // back to hero
  await page.waitForTimeout(400);

  const demoButton = page.locator('#explore-demo');
  await demoButton.click();
  await page.waitForTimeout(300);

  const workspaceVisible = await page.locator('#workspace').isVisible();
  assert.equal(workspaceVisible, true, 'Workspace should open on demo explore action');

  assert.deepEqual(errors, []);
  console.log('✓ landing-ui browser test passed successfully');
} finally {
  await browser.close();
}
