import { SceneView } from './scene.js';
import { sampleModel, reconstructDrawing, typeNames, drawingBounds } from './model.js';

export function createWorkspace({ reducedMotion, onClose }) {
  const $ = id => document.getElementById(id);
  const root = $('workspace'), canvas = $('workspace-canvas');
  const events = new AbortController();
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  let view, model, selected, parsed, worker, ticket = 0, lastFile, imageURL, active = false, planZoom = 1;
  let undo = [], redo = [];
  let previewTracksModel = true;
  const status = text => { $('processing-status').textContent = text; };
  const message = text => { $('drawing-message').textContent = text; };

  function ensureView() {
    if (view) return true;
    try {
      view = new SceneView(canvas, { reducedMotion: reducedMotion.matches, onSelect: selectComponent, onMeasure: text => { $('measurement').textContent = text; } });
      $('workspace-error').hidden = true; return true;
    } catch (error) {
      $('workspace-error').textContent = 'WebGL is not supported on this device. 2D drawings are still available; enable hardware acceleration for 3D.';
      $('workspace-error').hidden = false; $('model-empty').hidden = true;
      status('Could not open 3D viewport'); return false;
    }
  }
  function open() {
    active = true; root.hidden = false;
    if (view) view.resize();
  }
  function closeDrawers() {
    const focused = document.activeElement;
    const panel = focused?.closest('.panel.is-open');
    if (panel) root.querySelector(`[data-drawer="${panel.id}"]`)?.focus();
    root.querySelectorAll('.panel').forEach(p => p.classList.remove('is-open'));
    root.querySelectorAll('[data-drawer]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function cancel(text = 'Processing cancelled. Current model retained.') {
    ticket++; worker?.terminate(); worker = null; parsed = null;
    $('cancel-job').hidden = true; $('continue-build').disabled = true;
    message(text); status(model ? 'Current model retained' : 'No model loaded');
  }
  function historyState() { $('undo').disabled = !undo.length; $('redo').disabled = !redo.length; }
  function resetPreviewZoom() {
    planZoom = 1;
    for (const el of [$('plan-svg'), $('drawing-image')]) { el.style.width = '100%'; el.style.height = '100%'; }
    $('drawing-preview').scrollTo(0, 0);
  }
  function drawPlan(components, linked = true) {
    resetPreviewZoom(); previewTracksModel = linked;
    const svg = $('plan-svg'); svg.replaceChildren();
    $('drawing-image').hidden = true; $('preview-empty').hidden = true; svg.removeAttribute('hidden');
    if (!components.length) return;
    const bounds = drawingBounds(components);
    const { minX, minZ } = bounds, width = Math.max(.01, bounds.width), height = Math.max(.01, bounds.depth);
    const pad = Math.max(width, height) * .1;
    svg.setAttribute('viewBox', `${minX - pad} ${minZ - pad} ${width + 2 * pad} ${height + 2 * pad}`);
    components.forEach(c => {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', c.polygon.map(p => p.join(',')).join(' '));
      polygon.dataset.id = c.id; polygon.style.strokeWidth = String(Math.max(width, height) * .002);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = `${typeNames[c.type]} · ${c.source || c.layer || ''}`;
      polygon.append(title); svg.append(polygon);
    });
  }
  function selectComponent(component) {
    selected = component;
    $('component-select').value = component?.id || '';
    $('properties-form').hidden = !component;
    $('selection-count').textContent = component ? typeNames[component.type] : '—';
    if (component && previewTracksModel && !$('plan-svg').querySelector(`[data-id="${CSS.escape(component.id)}"]`)) {
      drawPlan(model.components.filter(c => c.floor === component.floor));
    }
    $('plan-svg').querySelectorAll('polygon').forEach(p => {
      if (previewTracksModel && p.dataset.id === component?.id) p.dataset.selected = 'true';
      else delete p.dataset.selected;
    });
    if (!component) { $('selection-info').textContent = 'Select a component to inspect dimensions and source.'; return; }
    const xs = component.polygon.map(p => p[0]), zs = component.polygon.map(p => p[1]);
    $('selection-info').textContent = `${typeNames[component.type]} · Floor ${component.floor + 1}\n${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} × ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)} × ${component.height.toFixed(2)} m\n${component.source}\n${component.assumed ? 'Height / elevation: confirmed or editable assumption.' : 'Design dimensions of sample model.'}`;
    $('component-height').value = component.height; $('component-elevation').value = component.elevation;
    $('component-x').value = 0; $('component-z').value = 0;
  }
  function updatePlanForFloor() {
    if (!model || !previewTracksModel) return;
    const floor = $('floor-select').value === 'all' ? 0 : Number($('floor-select').value);
    drawPlan(model.components.filter(c => c.floor === floor && c.type !== 'roof'));
    if (selected) selectComponent(selected);
  }
  function applyModel(next, { fit = true, clearHistory = true } = {}) {
    const updateSource = clearHistory || previewTracksModel;
    model = next;
    if (clearHistory) {
      undo = []; redo = [];
      $('floor-select').replaceChildren(new Option('All floors', 'all'), ...Array.from({ length: model.floors }, (_, i) => new Option(`Floor ${i + 1}`, String(i))));
      if (view) { view.floor = 'all'; view.hiddenTypes.clear(); }
      root.querySelectorAll('[data-type]').forEach(c => c.checked = true);
      $('section').value = 100; $('section-value').textContent = '100%';
      if (view) view.setSection(100);
    }
    const hasView = ensureView();
    if (hasView) view.setModel(model, fit);
    $('model-empty').hidden = true;
    $('model-label').hidden = false; $('model-label').textContent = model.sample ? 'DEMO MODEL · METRIC UNITS' : 'PRELIMINARY DXF MODEL · VERIFY ASSUMPTIONS';
    $('project-name').textContent = model.name;
    if (updateSource) $('file-name').textContent = model.sample ? `${model.name} / Sample design plan` : model.name;
    $('model-notes').textContent = model.warnings.join(' ');
    $('component-select').replaceChildren(new Option('Select on model or drawing', ''), ...model.components.map((c, i) => new Option(`${typeNames[c.type]} ${i + 1} · Floor ${c.floor + 1}`, c.id)));
    $('export-model').disabled = !hasView;
    if (updateSource) { previewTracksModel = true; updatePlanForFloor(); }
    selectComponent(null); historyState();
    status(hasView ? model.sample ? 'Viewing demo model' : 'Ready · Verify assumptions' : '3D unavailable · 2D preview available');
    if (fit) root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === 'perspective')));
  }
  function loadSample(index = 0) {
    cancel('Viewing sample project design plan.');
    $('retry-job').hidden = true; $('drawing-unit').value = 'm';
    applyModel(sampleModel(index));
    closeDrawers();
  }

  async function receiveFile(file) {
    if (!file) return;
    cancel(''); lastFile = file; const current = ticket;
    $('retry-job').hidden = true;
    const fail = error => { if (current !== ticket) return; status('Could not process drawing'); message(error.message); $('cancel-job').hidden = true; $('retry-job').hidden = false; };
    try {
      if (file.size > 5 * 1024 * 1024 || file.size === 0) throw new Error('Select a non-empty file up to 5 MB.');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['dxf', 'png', 'jpg', 'jpeg'].includes(extension)) throw new Error('Format not supported yet. For DWG, export to ASCII DXF.');
      status('Reading drawing…'); $('cancel-job').hidden = false;
      const buffer = await file.arrayBuffer(); if (current !== ticket) return;
      if (extension !== 'dxf') {
        const bytes = new Uint8Array(buffer);
        const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!(extension === 'png' ? png : jpeg)) throw new Error('Image content does not match file format.');
        const url = URL.createObjectURL(file), probe = new Image(); probe.src = url;
        try { await probe.decode(); } catch { URL.revokeObjectURL(url); throw new Error('Image is corrupted or cannot be read.'); }
        if (current !== ticket) { URL.revokeObjectURL(url); return; }
        if (probe.naturalWidth * probe.naturalHeight > 40000000) { URL.revokeObjectURL(url); throw new Error('Image exceeds 40 megapixel limit.'); }
        if (imageURL) URL.revokeObjectURL(imageURL); imageURL = url;
        $('drawing-image').src = url; $('drawing-image').hidden = false; $('plan-svg').setAttribute('hidden', ''); $('preview-empty').hidden = true;
        resetPreviewZoom(); previewTracksModel = false; $('file-name').textContent = file.name;
        status('Image loaded · Preview only'); message('Image vector recognition is not available yet. This image is not reconstructed into 3D; you can upload a DXF with closed contours.'); $('cancel-job').hidden = true;
        return;
      }
      status('Analyzing DXF contours…');
      worker = new Worker(new URL('./drawing-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (current !== ticket) return;
        worker.terminate(); worker = null;
        if (data.error) { fail(new Error(data.error)); return; }
        parsed = data.parsed;
        $('drawing-unit').value = parsed.unit;
        $('file-name').textContent = file.name;
        drawPlan(parsed.outlines, false);
        $('continue-build').disabled = false;
        status('Confirm units and height');
        message(`Detected ${parsed.outlines.length} contours. ${parsed.unit ? `Detected unit: ${parsed.unit}.` : 'Drawing has no unit specified.'} Confirm height below to build model automatically.`);
        $('cancel-job').hidden = false;
        if (matchMedia('(max-width: 800px)').matches) openDrawer('drawing-panel');
      };
      worker.onerror = () => { worker?.terminate(); worker = null; fail(new Error('Could not parse drawing. Please try again or select another file.')); };
      worker.postMessage(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    } catch (error) { fail(error); }
  }
  listen($('drawing-settings'), 'submit', async event => {
    event.preventDefault(); if (!parsed) return;
    const current = ticket;
    try {
      const result = reconstructDrawing(parsed, { unit: $('drawing-unit').value, height: Number($('floor-height').value), name: lastFile.name });
      status('Building model…'); $('continue-build').disabled = true;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (current !== ticket) return;
      applyModel(result); message(result.warnings.join(' ')); parsed = null; $('cancel-job').hidden = true; closeDrawers();
    } catch (error) { message(error.message); status('Verify parameters'); $('continue-build').disabled = false; }
  });
  listen($('file-input'), 'change', e => { receiveFile(e.target.files[0]); e.target.value = ''; });
  listen($('cancel-job'), 'click', () => cancel());
  listen($('retry-job'), 'click', () => receiveFile(lastFile));
  listen($('drop-zone'), 'dragover', e => { e.preventDefault(); $('drop-zone').classList.add('is-over'); });
  listen($('drop-zone'), 'dragleave', () => $('drop-zone').classList.remove('is-over'));
  listen($('drop-zone'), 'drop', e => { e.preventDefault(); $('drop-zone').classList.remove('is-over'); receiveFile(e.dataTransfer.files[0]); });
  listen($('back-home'), 'click', () => { active = false; root.hidden = true; closeDrawers(); onClose(); });
  for (const id of ['load-sample', 'empty-sample']) listen($(id), 'click', () => loadSample());
  listen($('plan-svg'), 'click', e => {
    if (!previewTracksModel || !e.target.dataset.id) return;
    if (view) view.select(e.target.dataset.id);
    else selectComponent(model?.components.find(c => c.id === e.target.dataset.id));
  });
  for (const [id, factor] of [['plan-in', 1.25], ['plan-out', .8], ['plan-fit', 0]]) listen($(id), 'click', () => {
    if (!factor) { resetPreviewZoom(); return; }
    planZoom = Math.min(5, Math.max(1, planZoom * factor));
    for (const el of [$('plan-svg'), $('drawing-image')]) { el.style.width = `${planZoom * 100}%`; el.style.height = `${planZoom * 100}%`; }
  });
  root.querySelectorAll('[data-view]').forEach(button => listen(button, 'click', () => {
    view?.setCamera(button.dataset.view); root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  listen($('fit-model'), 'click', () => view?.setCamera(view.viewName));
  root.querySelectorAll('[data-mode]').forEach(button => listen(button, 'click', () => {
    view?.setMode(button.dataset.mode); root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  const visibility = () => {
    view?.setVisibility($('floor-select').value, [...root.querySelectorAll('[data-type]:not(:checked)')].map(c => c.dataset.type));
    updatePlanForFloor();
  };
  listen($('floor-select'), 'change', visibility);
  root.querySelectorAll('[data-type]').forEach(c => listen(c, 'change', visibility));
  listen($('section'), 'input', e => { view?.setSection(e.target.value); $('section-value').textContent = `${e.target.value}%`; });
  listen($('measure'), 'click', () => {
    if (!view || !model) return;
    view.measuring = !view.measuring; view.measureStart = null;
    $('measure').setAttribute('aria-pressed', String(view.measuring));
    $('measurement').textContent = view.measuring ? 'Select two points on the model.' : 'Unit: m';
  });
  listen($('component-select'), 'change', e => {
    const c = model?.components.find(c => c.id === e.target.value);
    if (c && view) {
      $('floor-select').value = String(c.floor);
      const checkbox = root.querySelector(`[data-type="${c.type}"]`); if (checkbox) checkbox.checked = true;
      visibility(); view.select(c.id);
    } else if (view) view.select(null);
    else selectComponent(c || null);
  });
  listen($('properties-form'), 'submit', event => {
    event.preventDefault(); if (!selected || !model) return;
    const height = Number($('component-height').value), elevation = Number($('component-elevation').value), x = Number($('component-x').value), z = Number($('component-z').value);
    if (![height, elevation, x, z].every(Number.isFinite) || height < .01 || height > 100 || Math.abs(x) > 10000 || Math.abs(z) > 10000 || elevation < -100 || elevation > 1000) return;
    undo.push(structuredClone(model)); if (undo.length > 30) undo.shift(); redo = [];
    const id = selected.id;
    const next = { ...model, components: model.components.map(c => c.id === id ? { ...c, height, elevation, polygon: c.polygon.map(p => [p[0] + x, p[1] + z]), assumed: true } : c) };
    applyModel(next, { fit: false, clearHistory: false }); view?.select(id); status('Component updated');
  });
  for (const id of ['undo', 'redo']) listen($(id), 'click', () => {
    const from = id === 'undo' ? undo : redo, to = id === 'undo' ? redo : undo;
    if (!from.length) return; to.push(structuredClone(model)); applyModel(from.pop(), { fit: false, clearHistory: false });
  });
  listen($('export-model'), 'click', async () => {
    if (!view || !model) return;
    const exportingView = view, name = model.name;
    $('export-model').disabled = true;
    try {
      const binary = await exportingView.export();
      const url = URL.createObjectURL(new Blob([binary], { type: 'model/gltf-binary' }));
      const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^\p{L}\p{N}_-]/gu, '-')}.glb`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Exported GLB model');
    } catch { status('Model export failed. Please try again.'); }
    finally { $('export-model').disabled = !model || !view; }
  });
  function openDrawer(id) {
    closeDrawers(); $(id).classList.add('is-open');
    root.querySelector(`[data-drawer="${id}"]`).setAttribute('aria-expanded', 'true');
    $(id).querySelector('button')?.focus();
  }
  root.querySelectorAll('[data-drawer]').forEach(b => listen(b, 'click', () => {
    if ($(b.dataset.drawer).classList.contains('is-open')) closeDrawers(); else openDrawer(b.dataset.drawer);
  }));
  root.querySelectorAll('[data-close-drawer]').forEach(b => listen(b, 'click', closeDrawers));
  listen(root, 'keydown', e => { if (e.key === 'Escape') closeDrawers(); });
  listen(canvas, 'webglcontextlost', e => {
    e.preventDefault(); view?.dispose(); view = null;
    $('workspace-error').textContent = 'Graphics context lost. Drawings and parameters are preserved; reload the page to restore 3D.';
    $('workspace-error').hidden = false; $('export-model').disabled = true;
  });
  return {
    open, loadSample,
    render(delta) { if (active && view && !document.hidden) view.render({ active: true, delta }); },
    motionChanged() { if (view) view.controls.enableDamping = !reducedMotion.matches; },
    dispose() { ticket++; worker?.terminate(); events.abort(); view?.dispose(); if (imageURL) URL.revokeObjectURL(imageURL); },
  };
}
