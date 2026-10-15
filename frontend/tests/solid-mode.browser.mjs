import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4176');
  const result = await page.evaluate(async () => {
    const { SceneView } = await import('/scene.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:900px;height:700px;z-index:9999';
    host.innerHTML = '<canvas style="width:100%;height:100%"></canvas>';
    document.body.append(host);
    const view = new SceneView(host.firstElementChild, { reducedMotion: true });
    view.setModel({ backend: true, name: 'Shadow regression', components: [
      { id: 'floor', type: 'slab', floor: 0, elevation: 0, height: .2, polygon: [[-8, -8], [8, -8], [8, 8], [-8, 8]] },
      { id: 'wall', type: 'wall', floor: 0, elevation: .2, height: 4, polygon: [[-3, -3], [3, -3], [3, -2.6], [-3, -2.6]] },
    ] });
    view.render();
    view.setMode('edges');
    view.setVisibility('all');
    view.render();
    const wireframe = view.canvas.toDataURL();
    view.setMode('solid');
    const invalidated = view.renderer.shadowMap.needsUpdate;
    view.render();
    const stale = view.canvas.toDataURL();
    view.renderer.shadowMap.needsUpdate = true;
    view.needsRender = true;
    view.render();
    const fresh = view.canvas.toDataURL();
    view.select('wall');
    view.render();
    const selected = view.canvas.toDataURL();
    view.dispose();
    host.remove();
    return { invalidated, changed: stale !== fresh, wireframeVisible: wireframe !== fresh, selectionVisible: selected !== fresh };
  });
  assert.equal(result.changed, false, 'Solid must match a freshly generated solid shadow');
  assert.equal(result.invalidated, true, 'Switching to Solid must regenerate shadow maps');
  assert.equal(result.wireframeVisible, true, 'Wireframe remains distinct from Solid');
  assert.equal(result.selectionVisible, true, 'Selection remains visible in Solid');
  console.log('PASS: Solid restores correct shadows, with Wireframe and selection preserved');
} finally { await browser.close(); }
