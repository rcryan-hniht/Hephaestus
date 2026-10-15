import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  const { frames, departures } = await page.evaluate(async () => {
    const { SceneView } = await import('/scene.js');
    const { createPresetShowcase } = await import('/PresetShowcase.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:900px;height:700px;z-index:9999';
    host.innerHTML = '<div style="position:absolute;inset:0"><canvas></canvas><canvas hidden></canvas></div>';
    document.body.append(host);
    const [canvas, snapshot] = host.querySelectorAll('canvas');
    const view = new SceneView(canvas, { reducedMotion: true });
    const motion = { matches: false }, departures = [];
    const setModel = view.setModel.bind(view);
    view.setModel = model => {
      if (view.model) departures.push({ progress: view.buildProgress, scales: view.meshes.map(m => m.scale.y) });
      setModel(model);
    };
    const showcase = createPresetShowcase({ view, canvas, snapshot, motion, onChange() {}, onError(error) { throw error; } });
    const deadline = performance.now() + 10000;
    while (!showcase.ready) {
      if (performance.now() > deadline) throw new Error('Preset data did not load');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const capture = () => {
      const offset = view.camera.position.clone().sub(view.controls.target);
      return { name: showcase.name, mode: view.mode, scales: view.meshes.map(m => m.scale.y), shadows: view.meshes.filter(m => m.castShadow).length, label: showcase.modeLabel,
        angle: Math.atan2(offset.x, offset.z) * 180 / Math.PI, vertical: offset.y / offset.length(),
        incomingX: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).m41,
        outgoingX: new DOMMatrixReadOnly(getComputedStyle(snapshot).transform).m41,
        incomingOpacity: Number(getComputedStyle(canvas).opacity), outgoingOpacity: Number(getComputedStyle(snapshot).opacity) };
    };
    const frames = [];
    for (const delta of [0, 2, 1, 12, 12, 12, 1.5, 1.5, .5]) {
      showcase.render(delta, true); frames.push(capture());
    }
    for (let i = 0; i < 3; i++) { showcase.render(42, true); frames.push(capture()); }
    showcase.render(20, false); frames.push(capture());
    motion.matches = true;
    showcase.render(20, true); frames.push(capture());
    showcase.dispose(); view.dispose(); host.remove();
    return { frames, departures };
  });
  const flat = frame => frame.scales.every(scale => scale <= .001);
  const full = frame => frame.scales.every(scale => scale === 1);
  assert.ok(flat(frames[0]) && frames[0].vertical > .99, 'Begin with an overhead drawing');
  assert.equal(frames[0].shadows, 0, 'Collapsed blocks do not leave ghost shadows on the drawing');
  assert.ok(new Set(frames[1].scales).size > 1 && !full(frames[1]) && !flat(frames[1]), 'Blocks rise individually');
  assert.deepEqual(frames.slice(2, 5).map(f => f.mode), ['solid', 'edges', 'transparent']);
  assert.ok(frames.slice(2, 6).every(full), 'All sides are shown with complete geometry');
  assert.ok(Math.abs(frames[3].angle - 93) < .01 && Math.abs(frames[4].angle + 147) < .01 && Math.abs(frames[5].angle + 27) < .01, 'Complete a full 360-degree orbit');
  assert.ok(new Set(frames[6].scales).size > 1 && !full(frames[6]) && !flat(frames[6]), 'Blocks sink individually before switching');
  assert.ok(departures.every(d => d.progress === 0 && d.scales.every(scale => scale <= .001)), 'Outgoing model is completely flat before fading');
  assert.equal(frames[7].name, 'Terrace Villa');
  assert.ok(flat(frames[7]) && flat(frames[8]) && frames[8].vertical > .99, 'Incoming drawing stays flat throughout the fade');
  assert.equal(frames[8].incomingX, 0); assert.equal(frames[8].outgoingX, 0);
  assert.ok(frames[8].incomingOpacity > 0 && frames[8].incomingOpacity < 1 && frames[8].outgoingOpacity < 1, 'Drawing-to-drawing crossfade has no swipe');
  assert.deepEqual(frames.slice(9, 12).map(f => f.name), ['Portal Villa', 'Gable Villa', '3F villa']);
  assert.deepEqual(frames[12], frames[11], 'Leaving Manifesto freezes the cycle');
  assert.ok(full(frames[13]) && frames[13].name === frames[12].name, 'Reduced motion keeps a complete static model');
  const slow = await browser.newPage({ reducedMotion: 'no-preference' });
  await slow.addInitScript(() => {
    // Sparse frames with an accelerated wall clock keep the 42-second regression quick.
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now() * 5), 100);
    window.cancelAnimationFrame = clearTimeout;
  });
  await slow.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  await slow.evaluate(() => window.scrollTo({ top: innerHeight, behavior: 'instant' }));
  await slow.waitForFunction(() => document.getElementById('visual-label').textContent.includes('3F VILLA'));
  await slow.waitForFunction(() => document.getElementById('visual-label').textContent.includes('TERRACE VILLA'), null, { timeout: 12000 });
  await slow.close();
  console.log('PASS: full orbit, individual rise/sink, drawing-to-drawing fade, preset loop, wall-clock timing and reduced motion');
} finally { await browser.close(); }
