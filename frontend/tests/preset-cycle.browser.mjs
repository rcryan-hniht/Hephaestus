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
    host.innerHTML = '<div style="position:absolute;inset:0"><canvas></canvas><canvas hidden></canvas></div>';
    document.body.append(host);
    const [canvas, snapshot] = host.querySelectorAll('canvas');
    const view = new SceneView(canvas, { reducedMotion: true });
    const motion = { matches: false };
    const showcase = createPresetShowcase({ view, canvas, snapshot, motion, onChange() {}, onError(error) { throw error; } });
    while (!showcase.ready) await new Promise(resolve => setTimeout(resolve, 10));
    const capture = () => {
      const offset = view.camera.position.clone().sub(view.controls.target);
      return { name: showcase.name, mode: view.mode, scale: view.meshes.find(m => m.userData.type === 'wall').scale.y,
        angle: Math.atan2(offset.x, offset.z) * 180 / Math.PI,
        incomingX: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).m41,
        outgoingX: new DOMMatrixReadOnly(getComputedStyle(snapshot).transform).m41,
        incomingOpacity: Number(getComputedStyle(canvas).opacity), outgoingOpacity: Number(getComputedStyle(snapshot).opacity) };
    };
    const frames = [];
    showcase.render(0, true); frames.push(capture());
    showcase.render(1, true); frames.push(capture());
    showcase.render(1.99, true); frames.push(capture());
    showcase.render(.01, true); frames.push(capture());
    showcase.render(3, true); frames.push(capture());
    showcase.render(2.99, true); showcase.render(.01, true); frames.push(capture());
    for (let i = 0; i < 3; i++) { showcase.render(9, true); frames.push(capture()); }
    showcase.render(20, false); frames.push(capture());
    motion.matches = true;
    showcase.render(20, true); frames.push(capture());
    showcase.dispose(); view.dispose(); host.remove();
    return frames;
  });
  assert.ok(frames[0].scale <= .001, 'Each preset starts as a flat drawing');
  assert.ok(frames[1].scale > .001 && frames[1].scale < 1, 'Blocks rise into 3D');
  assert.ok(Math.abs(frames[0].angle + 27) < .01, 'Begin 27 degrees left of the front');
  assert.ok(Math.abs(frames[1].angle - frames[0].angle - 6) < .01, 'Orbit six degrees per second');
  assert.ok(Math.abs(frames[4].angle - 9) < .01, 'Rotation continues through mode changes');
  assert.ok(Math.abs(frames[5].angle + 27) < .01, 'Next preset starts its own sweep');
  assert.equal(frames[5].incomingX, 0, 'Incoming preset stays centered');
  assert.equal(frames[5].outgoingX, 0, 'Outgoing preset stays centered');
  assert.ok(frames[5].incomingOpacity > 0 && frames[5].incomingOpacity < 1 && frames[5].outgoingOpacity < 1, 'Presets fade without sliding');
  assert.deepEqual(frames.slice(0, 6).map(f => f.mode), ['solid', 'solid', 'solid', 'edges', 'transparent', 'solid']);
  assert.equal(frames[2].scale, 1, 'Construction completes during the first Solid phase');
  assert.equal(frames[5].name, 'Terrace Villa', 'Switch at nine seconds, including the fade');
  assert.ok(frames[5].scale <= .001, 'Construction restarts on every preset');
  assert.deepEqual(frames.slice(6, 9).map(f => f.name), ['Portal Villa', 'Gable Villa', '3F villa']);
  assert.deepEqual(frames[9], frames[8], 'Leaving Manifesto freezes the cycle');
  assert.equal(frames[10].scale, 1, 'Reduced motion shows a complete model');
  assert.equal(frames[10].name, frames[9].name);
  const slow = await browser.newPage({ reducedMotion: 'no-preference' });
  await slow.addInitScript(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 100);
    window.cancelAnimationFrame = clearTimeout;
  });
  await slow.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await slow.evaluate(() => window.scrollTo({ top: innerHeight, behavior: 'instant' }));
  await slow.waitForFunction(() => document.getElementById('visual-label').textContent.includes('3F VILLA'));
  await slow.waitForFunction(() => document.getElementById('visual-label').textContent.includes('TERRACE VILLA'), null, { timeout: 11000 });
  await slow.close();
  console.log('PASS: nine-second preset cycles, 3s Solid/Wireframe/Transparent, repeated construction and reduced motion');
} finally { await browser.close(); }
