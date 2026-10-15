import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  const frames = await page.evaluate(async () => {
    const { SceneView } = await import('/scene.js');
    const { createPresetShowcase } = await import('/PresetShowcase.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:900px;height:700px;z-index:9999';
    host.innerHTML = '<div style="position:absolute;inset:0"><canvas></canvas><canvas hidden></canvas></div><div><span class="preset-buttons"></span><button id="preset-pause">Pause</button></div>';
    document.body.append(host);
    const [canvas, snapshot] = host.querySelectorAll('canvas');
    const controls = host.lastElementChild;
    const view = new SceneView(canvas, { reducedMotion: true });
    const motion = { matches: false };
    const showcase = createPresetShowcase({ view, canvas, snapshot, controls, motion, onChange() {}, onError(error) { throw error; } });
    while (!showcase.ready) await new Promise(resolve => setTimeout(resolve, 10));
    const capture = () => ({ name: showcase.name, mode: view.mode, scale: view.meshes.find(m => m.userData.type === 'wall').scale.y });
    const frames = [];
    showcase.render(0, true); frames.push(capture());
    showcase.render(1, true); frames.push(capture());
    showcase.render(1.99, true); frames.push(capture());
    showcase.render(.01, true); frames.push(capture());
    showcase.render(3, true); frames.push(capture());
    showcase.render(3, true); frames.push(capture());
    // Hover and focused selectors must not interrupt the requested automatic cycle.
    host.dispatchEvent(new Event('pointerenter'));
    controls.querySelector('[data-preset="1"]').focus();
    for (let i = 0; i < 3; i++) { showcase.render(9, true); frames.push(capture()); }
    controls.querySelector('#preset-pause').click();
    showcase.render(20, true); frames.push(capture());
    controls.querySelector('#preset-pause').click();
    showcase.render(20, false); frames.push(capture());
    motion.matches = true;
    showcase.render(20, true); frames.push(capture());
    showcase.dispose(); view.dispose(); host.remove();
    return frames;
  });
  assert.ok(frames[0].scale <= .001, 'Each preset starts as a flat drawing');
  assert.ok(frames[1].scale > .001 && frames[1].scale < 1, 'Blocks rise into 3D');
  assert.deepEqual(frames.slice(0, 6).map(f => f.mode), ['solid', 'solid', 'solid', 'edges', 'transparent', 'solid']);
  assert.equal(frames[2].scale, 1, 'Construction completes during the first Solid phase');
  assert.equal(frames[5].name, 'Terrace Villa', 'Switch at nine seconds, including the slide');
  assert.ok(frames[5].scale <= .001, 'Construction restarts on every preset');
  assert.deepEqual(frames.slice(6, 9).map(f => f.name), ['Portal Villa', 'Gable Villa', '3F villa']);
  assert.deepEqual(frames[9], frames[8], 'Pause freezes the cycle');
  assert.deepEqual(frames[10], frames[9], 'Leaving Manifesto freezes the cycle');
  assert.equal(frames[11].scale, 1, 'Reduced motion shows a complete model');
  assert.equal(frames[11].name, frames[10].name);
  const slow = await browser.newPage({ reducedMotion: 'no-preference' });
  await slow.addInitScript(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 100);
    window.cancelAnimationFrame = clearTimeout;
  });
  await slow.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await slow.evaluate(() => window.scrollTo({ top: innerHeight, behavior: 'instant' }));
  await slow.locator('#preset-controls').waitFor({ state: 'visible' });
  await slow.waitForFunction(() => document.querySelector('#preset-controls [data-preset="1"]').getAttribute('aria-pressed') === 'true', null, { timeout: 11000 });
  await slow.close();
  console.log('PASS: nine-second preset cycles, 3s Solid/Wireframe/Transparent, repeated construction, hover/focus, pause and reduced motion');
} finally { await browser.close(); }
