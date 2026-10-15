export async function showLandingActions(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.body.dataset.chapter === '2' && Math.abs(scrollY - innerHeight * 2) < 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
