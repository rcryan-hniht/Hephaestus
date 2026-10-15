export async function confirmVilla(page) {
  await page.locator('#use-sample-suggestions').waitFor({ state: 'visible' });
  await page.locator('#use-sample-suggestions').click();
  await page.locator('#confirm-drawing').click();
  await page.waitForFunction(() => !document.getElementById('confirm-alignment').disabled);
  await page.locator('#confirm-alignment').click();
  await page.waitForFunction(() => !document.getElementById('export-model').disabled);
}
