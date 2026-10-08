import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against `bun dev` or a production preview with UI_URL set.
const browser = await chromium.launch({ headless: true });
const url = process.env.UI_URL || "http://127.0.0.1:5173";
try {
  for (const [width, height, dpr] of [[1440, 806, 1], [390, 844, 2], [320, 740, 2]]) {
    console.log(`Checking ${width}px @${dpr}x`);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /WebGL|shader|THREE|3D/.test(message.text())) errors.push(message.text());
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#caption-text").filter({ hasText: "Mở để khám phá" }).waitFor();
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))]));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.screenshot({ path: `/tmp/hephaestus-intro-${width}.png`, fullPage: true });
    const thumb = page.locator(".stage__thumb");
    const rect = await thumb.boundingBox();
    await page.mouse.move(rect.x + 100, rect.y + 100);
    await page.mouse.down();
    await page.mouse.move(rect.x + 150, rect.y + 120, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.locator(".stage.is-open").count(), 0, "drag must not open model");
    await thumb.focus();
    await page.keyboard.press("Enter");
    await page.locator(".stage.is-open").waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#canvas")).opacity === "1");
    assert.equal(await page.locator("#canvas").evaluate((canvas) => canvas === document.activeElement), true);
    assert.equal(await page.locator("#toggle-orbit").isDisabled(), true, "reduced motion must disable auto-orbit");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("+");
    await page.locator("#reset-view").click();
    await page.screenshot({ path: `/tmp/hephaestus-model-${width}.png`, fullPage: true });
    await page.locator("#close-scene").click();
    assert.equal(await thumb.evaluate((button) => button === document.activeElement), true);
    if (width < 760) {
      await page.locator(".nav__menu").click();
      assert.equal(await page.locator(".nav__menu").getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".nav__menu").getAttribute("aria-expanded"), "false");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(".nav__cta").click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#canvas")).opacity === "1");
    assert.equal(await page.locator("#toggle-orbit").getAttribute("aria-pressed"), "true");
    await page.locator("#toggle-orbit").click();
    assert.equal(await page.locator("#toggle-orbit").getAttribute("aria-pressed"), "false");
    assert.deepEqual(errors, [], `browser errors at ${width}`);
    console.log(`PASS ${width}px @${dpr}x: glass drag, keyboard open, model controls, motion, responsive layout`);
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.includes("webgl") ? null : original.call(this, type, ...args);
    };
  });
  await page.goto(url);
  await page.locator("#scene-error:not([hidden])").waitFor();
  assert.equal(await page.locator(".nav__cta").isDisabled(), true);
  assert.equal(await page.locator(".hero__title").isVisible(), true);
  console.log("PASS WebGL unavailable: readable fallback and disabled model controls");
} finally {
  await browser.close();
}
