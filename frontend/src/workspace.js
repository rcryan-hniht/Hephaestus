import { SceneView } from './scene.js';
import { API_BASE, apiRequest, createJobClient } from './api.js';
import { sceneToModel, sourceDescription, offsetProposal } from './backend-model.js';
import { groupFloorFiles, assembleFloors } from './floors.js';
import { sampleModel, reconstructDrawing, typeNames, drawingBounds } from './model.js';

export function createWorkspace({ reducedMotion, onClose }) {
  const $ = id => document.getElementById(id);
  const root = $('workspace'), canvas = $('workspace-canvas');
  const events = new AbortController();
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  let view, model, selected, parsed, worker, ticket = 0, lastFile, imageURL, active = false, planZoom = 1;
  let undo = [], redo = [];
  let previewTracksModel = true, proposal, sourceJob, sourceOutlines = false, pendingFit = false, apiBusy = false;
  const singleDrafts = new Map();
  let drafts = singleDrafts, floors = [], arrangementConfirmed = false;
  let previewEpoch = 0;
  let building = null;
  let fillSuggestions = false;
    const stageNames = { queued: 'Queued', extracting: 'Extracting drawing evidence', awaiting_ai_result: 'Analyzing image', validating: 'Validating geometry', building: 'Building model', needs_information: 'Confirm missing information', ready: 'Ready · Confirmed parameters', failed: 'Failed', cancelled: 'Cancelled' };
  const questionSpecs = {
    meters_per_unit: ['Meters per source unit', 1e-8, 1000], floor_height: ['Floor height (m)', .5, 20],
    slab_thickness: ['Slab thickness (m)', .01, 2], door_height: ['Door height (m)', .2, 10],
    window_height: ['Window height (m)', .1, 10], window_sill: ['Window sill height (m)', 0, 10],
    review_confirmed: ['I reviewed and corrected the candidate footprints'],
  };
  const singleApi = createJobClient({ onUpdate: updateJob, onError: apiError });
  let api = singleApi;
  function hasSourceModel() { return model?.backend && (model.job_id === api.job?.id || model.multiFloor && model.scene.floors.some(f => f.scene.job_id === api.job?.id)); }
  function canEditBackend() { return hasSourceModel() && ['ready', 'failed'].includes(api.job.state) && !apiBusy; }
  function canEditComponent() { return canEditBackend() && (!model.multiFloor || selected?.job_id === api.job.id); }
  function componentScene(component) { return model.multiFloor ? model.scene.floors.find(f => f.scene.job_id === component.job_id).scene : model.scene; }
  function apiError(error) {
    message(error.message); $('drawing-message').dataset.error = 'true'; status(`Drawing request failed${model ? ' · Model retained' : ''}`);
    $('retry-job').hidden = !lastFile && !api.job; $('retry-job').textContent = 'Reconnect / refresh';
    $('drawing-message').focus({ preventScroll: true }); historyState();
  }
  async function apiAction(action, payload) {
    if (apiBusy) return;
    const drawingTicket = ticket, client = api;
    if (action === 'proposal') { drafts.delete('review_confirmed'); const review = $('question-review_confirmed'); if (review) review.checked = false; }
    apiBusy = true; historyState();
    if (floors.length) renderFloorStatus();
    $('api-questions').querySelectorAll('button').forEach(b => b.disabled = true);
    $('proposal-edit').querySelector('button').disabled = true;
    try { await client.action(action, payload); }
    catch (error) { apiError(error); }
    finally {
      if (drawingTicket !== ticket || client !== api) return;
      apiBusy = false; historyState();
      $('api-questions').querySelectorAll('button').forEach(b => b.disabled = false);
      $('proposal-edit').querySelector('button').disabled = false;
      if (floors.length) renderFloorStatus();
    }
  }
  function showSource() {
    if (!imageURL) return;
    sourceOutlines = false; resetPreviewZoom();
    $('drawing-image').hidden = false; $('plan-svg').setAttribute('hidden', ''); $('preview-empty').hidden = true;
    $('toggle-source').textContent = 'View extracted outlines';
  }
  function drawSource() {
    if (!proposal) return;
    drawPlan(proposal.components.map(c => ({ ...c, type: c.type === 'room' ? 'slab' : c.type })), hasSourceModel() && api.job?.state === 'ready');
    sourceOutlines = true; $('toggle-source').textContent = 'View original drawing';
    if (selected) selectComponent(selected);
  }
  function renderQuestions(job) {
    const form = $('api-questions');
    form.querySelectorAll('input').forEach(input => drafts.set(input.name, input.type === 'checkbox' ? input.checked : input.value));
    form.replaceChildren(); form.hidden = job.state !== 'needs_information';
    if (form.hidden) return;
    for (const q of job.questions) {
      const spec = questionSpecs[q.key]; if (!spec) throw new Error('Unsupported required drawing parameter. Update the frontend.');
      const row = document.createElement('div'); row.className = 'question';
      const label = document.createElement('label'); label.textContent = q.key === 'meters_per_unit' && job.source_kind === 'png' ? 'Scale (meters per pixel)' : spec[0];
      const input = document.createElement('input'); input.id = `question-${q.key}`; input.name = q.key; input.required = true;
      input.type = q.key === 'review_confirmed' ? 'checkbox' : 'number';
      if (input.type === 'checkbox') input.checked = drafts.get(q.key) === true;
      else { input.min = spec[1]; input.max = spec[2]; input.step = 'any'; input.value = drafts.get(q.key) ?? ''; }
      if (fillSuggestions && input.type !== 'checkbox' && input.value === '' && Number.isFinite(job.suggestions[q.key]?.value)) input.value = job.suggestions[q.key].value;
      const note = document.createElement('small'); note.id = `note-${q.key}`; note.textContent = q.message + (q.key === 'meters_per_unit' ? ' Example: a measured span of 100 source units equals 1 m → enter 0.01, not 1.' : '');
      input.setAttribute('aria-describedby', note.id); label.append(input); row.append(label, note);
      if (q.key !== 'review_confirmed') {
        const unknown = document.createElement('button'); unknown.type = 'button'; unknown.className = 'text-button'; unknown.textContent = "I don't know";
        unknown.addEventListener('click', () => apiAction('answers', { unknown: [q.key] })); row.append(unknown);
        const suggestion = job.suggestions[q.key];
        if (suggestion) {
          const reason = document.createElement('small'); reason.textContent = `${suggestion.value === null ? '' : `Suggested: ${suggestion.value}. `}${suggestion.reason} Requires your confirmation.`; row.append(reason);
          if (suggestion.value !== null) {
            const use = document.createElement('button'); use.type = 'button'; use.className = 'text-button'; use.textContent = 'Use suggestion';
            use.addEventListener('click', () => { input.value = suggestion.value; input.focus(); }); row.append(use);
          }
        }
      }
      form.append(row);
    }
    fillSuggestions = false;
    const useAll = document.createElement('button'); useAll.type = 'button'; useAll.className = 'button'; useAll.textContent = 'Use all suggestions';
    useAll.addEventListener('click', () => { fillSuggestions = true; void apiAction('answers', { unknown: job.questions.filter(q => q.key !== 'review_confirmed').map(q => q.key) }); });
    const hint = document.createElement('small'); hint.textContent = 'Fill missing values only. Your entries and the footprint review checkbox are preserved.';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button button--white'; submit.textContent = 'Confirm and build'; form.append(useAll, hint, submit);
  }
  async function updateJob({ job, proposal: nextProposal, scene }) {
    sourceJob = job.id;
    // SVG images are displayed only after the backend rejects active/external content.
    if (job.source_kind === 'svg' && !imageURL && lastFile && (!floors.length || $('source-drawing').value === lastFile.name)) {
      imageURL = URL.createObjectURL(new Blob([lastFile], { type: 'image/svg+xml' })); $('drawing-image').src = imageURL; showSource();
    }
    if (nextProposal) {
      proposal = nextProposal;
      $('toggle-source').hidden = !imageURL;
      if (sourceOutlines) drawSource();
      const candidate = $('candidate-select').value;
      $('candidate-select').replaceChildren(...proposal.components.map(c => new Option(`${c.type} · ${c.id}`, c.id)));
      if (proposal.components.some(c => c.id === candidate)) $('candidate-select').value = candidate;
      updateCandidate();
    }
    renderQuestions(job);
    $('proposal-edit').hidden = !['needs_information', 'failed'].includes(job.state) || !proposal;
    if (!floors.length && scene && (model?.job_id !== job.id || model.scene.revision !== scene.revision)) {
      const replacement = model?.job_id !== job.id;
      applyModel(sceneToModel(scene, job), { preserveSource: true, fit: replacement, clearHistory: replacement });
    }
    $('cancel-job').hidden = ['ready', 'failed', 'cancelled'].includes(job.state);
    $('retry-job').hidden = !['failed', 'cancelled'].includes(job.state); $('retry-job').textContent = 'Retry processing';
    status(`${stageNames[job.state]}${model && ['failed', 'cancelled'].includes(job.state) ? ' · Current model retained' : ''}${job.state === 'ready' && !view ? ' · 3D unavailable' : ''}`);
    message(job.error ? `${job.error.message} ${model ? 'The previous valid model remains available.' : ''}` : job.state === 'needs_information' ? 'Review the original and extracted outlines. Confirm only values you can establish; suggestions stay editable until you confirm.' : job.state === 'ready' ? 'Model built from validated drawing evidence. Source and confirmed parameters are included in scene JSON.' : stageNames[job.state]);
    if (job.error) $('drawing-message').dataset.error = 'true';
    historyState();
    if (job.state === 'needs_information' && matchMedia('(max-width: 800px)').matches && active && !$('drawing-panel').classList.contains('is-open')) openDrawer('drawing-panel');
    if (floors.length) {
      renderFloorStatus();
      if (job.state === 'ready') message('This floor is ready. Confirm the other floors and their alignment to assemble the building.');
    }
  }
  function updateCandidate() {
    const c = proposal?.components.find(c => c.id === $('candidate-select').value);
    $('candidate-polygon').value = c ? JSON.stringify(c.polygon) : '';
  }
  const status = text => { $('processing-status').textContent = text; };
  const message = text => { $('drawing-message').textContent = text; delete $('drawing-message').dataset.error; };

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
    if (view) { view.resize(); if (pendingFit) { view.setCamera('perspective'); pendingFit = false; } }
  }
  function closeDrawers() {
    const focused = document.activeElement;
    const panel = focused?.closest('.panel.is-open');
    if (panel) root.querySelector(`[data-drawer="${panel.id}"]`)?.focus();
    root.querySelectorAll('.panel').forEach(p => p.classList.remove('is-open'));
    root.querySelectorAll('[data-drawer]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function cancel(text = 'Processing cancelled. Current model retained.') {
    ticket++; previewEpoch++; worker?.terminate(); worker = null; parsed = null;
    if (building) void apiRequest(`/api/buildings/${building.id}/cancel`, { method: 'POST', json: { generation: building.generation } }).catch(() => {});
    building = null;
    void singleApi.stop(); floors.forEach(f => { void f.client.stop(); });
    floors = []; api = singleApi; drafts = singleDrafts; arrangementConfirmed = false;
    $('floor-sources').hidden = true; $('floor-alignment').hidden = true;
    proposal = null; sourceJob = null; apiBusy = false; drafts.clear(); fillSuggestions = false;
    $('api-questions').hidden = true; $('proposal-edit').hidden = true; $('toggle-source').hidden = true;
    $('cancel-job').hidden = true; $('continue-build').disabled = true;
    message(text); status(model ? 'Current model retained' : 'No model loaded');
  }
  function historyState() {
    $('undo').disabled = model?.backend ? !canEditBackend() || !api.job?.can_undo : !undo.length;
    $('redo').disabled = model?.backend ? !canEditBackend() || !api.job?.can_redo : !redo.length;
    $('properties-form').querySelectorAll('input, button').forEach(el => el.disabled = Boolean(model?.backend && !canEditComponent()));
  }
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
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = `${typeNames[c.type]} · ${sourceDescription(c) || c.layer || ''}`;
      polygon.append(title); svg.append(polygon);
    });
  }
  function selectComponent(component) {
    if (component && model?.multiFloor) {
      const floor = floors.find(f => f.job?.id === component.job_id);
      if (floor && floor.client !== api && !apiBusy) activateFloor(floor);
    }
    selected = component;
    $('component-select').value = component?.id || '';
    $('properties-form').hidden = !component;
    $('selection-count').textContent = component ? typeNames[component.type] : '—';
    if (component && !model?.backend && previewTracksModel && !$('plan-svg').querySelector(`[data-id="${CSS.escape(component.id)}"]`)) {
      drawPlan(model.components.filter(c => c.floor === component.floor));
    }
    $('plan-svg').querySelectorAll('polygon').forEach(p => {
      if (previewTracksModel && p.dataset.id === component?.id) p.dataset.selected = 'true';
      else delete p.dataset.selected;
    });
    if (!component) { $('selection-info').textContent = 'Select a component to inspect dimensions and source.'; return; }
    const xs = component.polygon.map(p => p[0]), zs = component.polygon.map(p => p[1]);
    $('selection-info').textContent = `${typeNames[component.type]} · Floor ${component.source_floor ?? component.floor + 1}\n${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} × ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)} × ${component.height.toFixed(2)} m\n${sourceDescription(component, model.name)}\n${model.backend ? `Validated drawing evidence. Parameters: ${Object.entries(componentScene(component).parameters).map(([k,v]) => `${k.replaceAll('_', ' ')}: ${v.value} (${v.provenance})`).join('; ')}${component.opening ? ' · Opening void, no inferred glazing or door leaf.' : ''}${model.multiFloor ? ' · Elevation edits are relative to this floor.' : ''}` : component.assumed ? 'Height / elevation: confirmed or editable assumption.' : 'Design dimensions of sample model.'}`;
    $('component-height').value = component.height; $('component-elevation').value = (component.local_elevation ?? component.elevation) + (model.backend && component.source_type === 'room' ? component.height : 0);
    $('component-height').max = model.backend ? 20 : 100; $('component-elevation').min = model.backend ? 0 : -100; $('component-elevation').max = model.backend ? 20 : 1000;
    historyState();
    $('component-x').value = 0; $('component-z').value = 0;
  }
  function updatePlanForFloor() {
    if (!model || !previewTracksModel || model.backend) return;
    const floor = $('floor-select').value === 'all' ? 0 : Number($('floor-select').value);
    drawPlan(model.components.filter(c => c.floor === floor && c.type !== 'roof'));
    if (selected) selectComponent(selected);
  }
  function applyModel(next, { fit = true, clearHistory = true, preserveSource = false } = {}) {
    const updateSource = !preserveSource && (clearHistory || previewTracksModel);
    model = next;
    if (clearHistory) {
      undo = []; redo = [];
      $('floor-select').replaceChildren(new Option('All floors', 'all'), ...Array.from({ length: model.floors }, (_, i) => new Option(`Floor ${model.multiFloor ? model.scene.floors[i].number : i + 1}`, String(i))));
      if (view) { view.floor = 'all'; view.hiddenTypes.clear(); }
      root.querySelectorAll('[data-type]').forEach(c => c.checked = true);
      $('section').value = 100; $('section-value').textContent = '100%';
      if (view) view.setSection(100);
    }
    const hasView = ensureView();
    if (hasView) { view.setModel(model, fit && active); pendingFit = fit && !active; }
    $('model-empty').hidden = true;
    $('model-label').hidden = false; $('model-label').textContent = model.backend ? `RECONSTRUCTED ${model.multiFloor ? `${model.floors} FLOORS` : model.scene.source_kind.toUpperCase()} · ${model.name} · REVISION ${model.scene.revision}` : model.sample ? 'DEMO MODEL · METRIC UNITS' : 'PRELIMINARY DXF MODEL · VERIFY ASSUMPTIONS';
    $('project-name').textContent = model.name;
    if (updateSource) $('file-name').textContent = model.sample ? `${model.name} / Sample design plan` : model.name;
    $('model-notes').textContent = model.warnings.join(' ');
    $('component-select').replaceChildren(new Option('Select on model or drawing', ''), ...model.components.map((c, i) => new Option(`${typeNames[c.type]} ${i + 1} · Floor ${c.source_floor ?? c.floor + 1}`, c.id)));
    $('export-model').disabled = !hasView; $('export-scene').hidden = !model.backend;
    if (updateSource) { previewTracksModel = true; sourceOutlines = false; updatePlanForFloor(); }
    else if (sourceOutlines) drawSource();
    $('drawing-settings').hidden = Boolean(model.backend);
    selectComponent(null); historyState();
    status(hasView ? model.sample ? 'Viewing demo model' : 'Ready · Verify assumptions' : '3D unavailable · 2D preview available');
    if (fit) root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === 'perspective')));
  }
  function loadSample(index = 0) {
    cancel('Viewing sample project design plan.');
    $('drawing-settings').hidden = false;
    $('retry-job').hidden = true; $('drawing-unit').value = 'm';
    applyModel(sampleModel(index));
    closeDrawers();
  }

  async function loadDatasetSample(sample) {
    cancel('Loading paired CubeCasa SVG. Scale and height need confirmation.');
    lastFile = null;
    const current = ticket; $('retry-job').hidden = true;
    $('file-name').textContent = sample.name; status('Loading sample drawing');
    try {
      const response = await fetch(sample.source);
      if (!response.ok) throw new Error('The local CubeCasa sample SVG is unavailable. Restore its assets or upload your own drawing.');
      const drawing = await response.blob();
      if (current !== ticket) return;
      await receiveFile(new File([drawing], `${sample.name}.svg`, { type: 'image/svg+xml' }));
    } catch (error) { if (current === ticket) apiError(error); }
  }

  function renderFloorStatus() {
    for (const floor of floors) $('floor-status-' + floor.number).textContent = `F${floor.number} · ${floor.error ? 'Request failed; select this floor to retry' : stageNames[floor.job?.state] || 'Reading drawing'}`;
    $('floor-alignment').querySelector('button').disabled = apiBusy || floors.some(f => f.job?.state !== 'ready');
    $('source-floor').disabled = apiBusy;
  }
  async function publishBuilding() {
    if (!building || !arrangementConfirmed || floors.some(f => f.job?.state !== 'ready')) return;
    const current = ticket, buildingId = building.id;
    const revisions = floors.map(f => f.scene?.revision).join('.');
    try {
      const next = assembleFloors(floors);
      const sameSources = model?.multiFloor && model.job_id === next.job_id;
      if (sameSources && model.scene.alignment_revision === building.generation && model.scene.revision === next.scene.revision && JSON.stringify(model.scene.floors.map(f => f.transform)) === JSON.stringify(next.scene.floors.map(f => f.transform))) return;
      const scene = await apiRequest(`/api/buildings/${buildingId}/scene`);
      if (current !== ticket || building?.id !== buildingId || revisions !== floors.map(f => f.scene?.revision).join('.')) return;
      if (scene.building_id !== buildingId || scene.schema_version !== 'hephaestus.building.v1' || scene.floors.length !== floors.length || scene.floors.some((f, i) => f.number !== floors[i].number || f.scene.job_id !== floors[i].job.id || f.scene.source_hash !== floors[i].job.source_hash || f.scene.revision !== floors[i].scene.revision || JSON.stringify(f.transform) !== JSON.stringify(next.scene.floors[i].transform))) throw new Error('Assembled building does not match the selected floor sources. Refresh before exporting.');
      next.scene = scene; next.source_hash = scene.source_hash;
      applyModel(next, { preserveSource: true, fit: !sameSources, clearHistory: !sameSources });
      status(`Ready · ${next.floors} confirmed floors${view ? '' : ' · 3D unavailable'}`);
      message('Building assembled from individually validated drawings and confirmed floor alignment.');
    } catch (error) { if (current === ticket) apiError(error); }
  }
  async function displayFloorDrawing(floor, name) {
    const epoch = ++previewEpoch, current = ticket;
    const file = floor.files.find(f => f.name === name); if (!file) return;
    if (imageURL) URL.revokeObjectURL(imageURL); imageURL = null;
    $('drawing-image').removeAttribute('src'); $('drawing-image').hidden = true;
    $('plan-svg').setAttribute('hidden', ''); $('preview-empty').hidden = false;
    sourceOutlines = false; previewTracksModel = false;
    // SVG previews are allowed only after successful source validation at submission.
    if (/\.svg$/i.test(file.name) && !floor.job) return;
    const url = URL.createObjectURL(file);
    try {
      if (/\.png$/i.test(file.name)) {
        const probe = new Image(); probe.src = url; await probe.decode();
        if (probe.naturalWidth * probe.naturalHeight > 20_000_000) throw new Error('PNG reference exceeds 20 megapixels.');
      }
      if (epoch !== previewEpoch || current !== ticket) { URL.revokeObjectURL(url); return; }
      imageURL = url; $('drawing-image').src = url; showSource();
      $('file-name').textContent = file.name; $('toggle-source').hidden = !proposal;
    } catch (error) {
      URL.revokeObjectURL(url);
      if (epoch === previewEpoch && current === ticket) message(`Drawing preview unavailable: ${error.message}`);
    }
  }
  function activateFloor(floor) {
    if (apiBusy) return;
    $('api-questions').querySelectorAll('input').forEach(input => drafts.set(input.name, input.type === 'checkbox' ? input.checked : input.value));
    $('api-questions').replaceChildren();
    api = floor.client; drafts = floor.drafts; fillSuggestions = false;
    proposal = floor.latest?.proposal; sourceJob = floor.job?.id; lastFile = floor.file;
    $('source-floor').value = String(floor.number);
    $('source-drawing').replaceChildren(...floor.files.map(f => new Option(f.name, f.name)));
    $('source-drawing').value = floor.file.name;
    $('source-files').textContent = `Build source: ${floor.file.name}${/\.svg$/i.test(floor.file.name) ? ' · SVG vector evidence' : ' · PNG inference'}. ${floor.files.length} drawing(s) retained.`;
    $('file-name').textContent = floor.file.name; $('drawing-settings').hidden = true;
    $('api-questions').hidden = true; $('proposal-edit').hidden = true; $('retry-job').hidden = true;
    $('toggle-source').hidden = true; $('cancel-job').hidden = false;
    selectComponent(null);
    void displayFloorDrawing(floor, floor.file.name);
    if (floor.latest) void updateJob(floor.latest);
    else { status(`F${floor.number} · Reading drawing`); message('Preparing this floor. Other floors continue independently.'); }
    if (floor.error) apiError(floor.error);
    renderFloorStatus();
  }
  async function receiveFiles(files) {
    if (!files.length) return;
    if (files.length === 1) { await receiveFile(files[0]); return; }
    let groups;
    try { groups = groupFloorFiles(files); }
    catch (error) { message(error.message); status('Check floor filenames · Current model retained'); return; }
    cancel(''); const current = ticket;
    floors = groups.map(floor => {
      const entry = { ...floor, drafts: new Map() };
      entry.client = createJobClient({
        onUpdate: async update => {
          if (current !== ticket) return;
          entry.latest = update; entry.job = update.job; entry.error = null;
          if (update.scene) entry.scene = update.scene;
          if (api === entry.client) await updateJob(update);
          renderFloorStatus(); publishBuilding();
        },
        onError: error => {
          if (current !== ticket) return;
          entry.error = error;
          if (api === entry.client) apiError(error);
          renderFloorStatus();
        },
      });
      return entry;
    });
    $('source-floor').replaceChildren(...floors.map(f => new Option(`F${f.number}`, String(f.number))));
    $('floor-sources').hidden = false; $('floor-alignment').hidden = false;
    const offsets = $('floor-offsets'); offsets.replaceChildren();
    for (const floor of floors) {
      const row = document.createElement('div'); row.className = 'floor-offset';
      const name = document.createElement('p'); name.id = `floor-status-${floor.number}`; row.append(name);
      for (const [axis, title] of [['x', 'X'], ['y', 'Y plan']]) {
        const label = document.createElement('label'); label.textContent = `F${floor.number} offset ${title} (m)`;
        const input = document.createElement('input'); input.id = `floor-${floor.number}-${axis}`; input.type = 'number'; input.min = -1000; input.max = 1000; input.step = 'any'; input.required = true; input.value = 0;
        label.append(input); row.append(label);
      }
      offsets.append(row);
    }
    activateFloor(floors[0]);
    const body = new FormData(); files.forEach(file => body.append('files', file));
    $('building-summary').textContent = `${files.length} drawings · ${floors.length} floors · Uploading batch`;
    try {
      const submitted = await apiRequest('/api/buildings', { method: 'POST', body });
      if (current !== ticket) { void apiRequest(`/api/buildings/${submitted.id}/cancel`, { method: 'POST', json: { generation: submitted.generation } }).catch(() => {}); return; }
      if (submitted.floors.length !== floors.length || submitted.floors.some((f, i) => f.number !== floors[i].number || f.job.name !== floors[i].file.name)) throw new Error('Batch floor assignment does not match the selected files.');
      building = submitted;
      $('building-summary').textContent = `${files.length} drawings · ${floors.length} floors received`;
      await Promise.all(floors.map((floor, i) => floor.client.attach(submitted.floors[i].job)));
    } catch (error) {
      if (current !== ticket) return;
      floors.forEach(f => { f.error = error; }); renderFloorStatus(); apiError(error);
      $('building-summary').textContent = 'Batch rejected · Selected drawings retained locally';
    }
  }

  async function receiveFile(file) {
    if (!file) return;
    cancel(''); lastFile = file; const current = ticket;
    if (imageURL) URL.revokeObjectURL(imageURL); imageURL = null;
    $('drawing-image').removeAttribute('src'); $('drawing-image').hidden = true; $('plan-svg').setAttribute('hidden', ''); $('preview-empty').hidden = false;
    previewTracksModel = false; sourceOutlines = false; $('file-name').textContent = file.name; $('project-name').textContent = file.name; historyState();
    $('retry-job').hidden = true;
    const fail = error => { if (current !== ticket) return; status('Could not process drawing'); message(error.message); $('cancel-job').hidden = true; $('retry-job').hidden = false; };
    try {
      if (file.size > 10 * 1024 * 1024 || file.size === 0) throw new Error('Select a non-empty file up to 10 MB.');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['dxf', 'svg', 'png', 'jpg', 'jpeg'].includes(extension)) throw new Error('Format not supported yet. For DWG, export to ASCII DXF.');
      $('drawing-settings').hidden = extension !== 'dxf';
      if (extension === 'dxf' && file.size > 5 * 1024 * 1024) throw new Error('DXF file limit is 5 MB.');
      status('Reading drawing…'); $('cancel-job').hidden = false;
      if (extension === 'svg') { await api.start(file); return; }
      const buffer = await file.arrayBuffer(); if (current !== ticket) return;
      if (extension !== 'dxf') {
        const bytes = new Uint8Array(buffer);
        const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!(extension === 'png' ? png : jpeg)) throw new Error('Image content does not match file format.');
        const url = URL.createObjectURL(file), probe = new Image(); probe.src = url;
        try { await probe.decode(); } catch { URL.revokeObjectURL(url); throw new Error('Image is corrupted or cannot be read.'); }
        if (current !== ticket) { URL.revokeObjectURL(url); return; }
        if (probe.naturalWidth * probe.naturalHeight > 20000000) { URL.revokeObjectURL(url); throw new Error('Image exceeds 20 megapixel limit.'); }
        if (imageURL) URL.revokeObjectURL(imageURL); imageURL = url;
        $('drawing-image').src = url; $('drawing-image').hidden = false; $('plan-svg').setAttribute('hidden', ''); $('preview-empty').hidden = true;
        resetPreviewZoom(); previewTracksModel = false; $('file-name').textContent = file.name;
        if (png) { await api.start(file); return; }
        status('Image loaded · Preview only'); message('JPG is preview-only. Upload PNG for hosted AI extraction or semantic SVG for vector reconstruction.'); $('cancel-job').hidden = true;
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
  listen($('api-questions'), 'submit', event => {
    event.preventDefault();
    const values = Object.fromEntries([...$('api-questions').querySelectorAll('input')].map(i => [i.name, i.type === 'checkbox' ? i.checked : Number(i.value)]));
    void apiAction('answers', { values });
  });
  listen($('toggle-source'), 'click', () => { if (sourceOutlines) showSource(); else drawSource(); });
  listen($('candidate-select'), 'change', () => {
    updateCandidate(); drawSource();
    $('plan-svg').querySelectorAll('polygon').forEach(p => { if (p.dataset.id === $('candidate-select').value) p.dataset.selected = 'true'; else delete p.dataset.selected; });
  });
  listen($('proposal-edit'), 'submit', event => {
    event.preventDefault(); if (!proposal || apiBusy) return;
    try {
      const corrected = structuredClone(proposal), c = corrected.components.find(c => c.id === $('candidate-select').value);
      c.polygon = JSON.parse($('candidate-polygon').value);
      void apiAction('proposal', { proposal: corrected });
    } catch { apiError(new Error('Enter a polygon as a JSON array of [x, y] source coordinates.')); }
  });
  listen($('export-scene'), 'click', () => {
    if (!model?.backend) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(model.scene, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${model.job_id}-revision-${model.scene.revision}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  listen($('file-input'), 'change', e => { void receiveFiles([...e.target.files]); e.target.value = ''; });
  listen($('source-floor'), 'change', event => activateFloor(floors.find(f => f.number === Number(event.target.value))));
  listen($('source-drawing'), 'change', event => { const floor = floors.find(f => f.client === api); if (floor) void displayFloorDrawing(floor, event.target.value); });
  listen($('floor-alignment'), 'input', () => { arrangementConfirmed = false; });
  listen($('floor-alignment'), 'submit', async event => {
    event.preventDefault();
    if (!building) return;
    const current = ticket;
    for (const floor of floors) { floor.offsetX = Number($(`floor-${floor.number}-x`).value); floor.offsetY = Number($(`floor-${floor.number}-y`).value); }
    $('floor-alignment').querySelector('button').disabled = true;
    try {
      const aligned = await apiRequest(`/api/buildings/${building.id}/alignment`, { method: 'POST', json: { generation: building.generation, offsets: floors.map(f => ({ number: f.number, x: f.offsetX, y: f.offsetY })) } });
      if (current !== ticket) return;
      building = aligned; arrangementConfirmed = true; await publishBuilding();
    } catch (error) { if (current === ticket) apiError(error); }
    finally { if (current === ticket) renderFloorStatus(); }
  });
  listen($('cancel-job'), 'click', () => { if (api.job) void apiAction('cancel'); else cancel(); });
  listen($('retry-job'), 'click', () => { if (!api.job) { if (floors.length) void receiveFiles(floors.flatMap(f => f.files)); else void receiveFile(lastFile); } else if (['failed', 'cancelled'].includes(api.job.state)) void apiAction('retry'); else void api.refresh(); });
  listen($('drop-zone'), 'dragover', e => { e.preventDefault(); $('drop-zone').classList.add('is-over'); });
  listen($('drop-zone'), 'dragleave', () => $('drop-zone').classList.remove('is-over'));
  listen($('drop-zone'), 'drop', e => { e.preventDefault(); $('drop-zone').classList.remove('is-over'); void receiveFiles([...e.dataTransfer.files]); });
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
  listen($('properties-form'), 'submit', async event => {
    event.preventDefault(); if (!selected || !model) return;
    const height = Number($('component-height').value), elevation = Number($('component-elevation').value), x = Number($('component-x').value), z = Number($('component-z').value);
    if (![height, elevation, x, z].every(Number.isFinite) || height < .01 || height > 100 || Math.abs(x) > 10000 || Math.abs(z) > 10000 || elevation < -100 || elevation > 1000) return;
    if (model.backend) {
      if (!canEditComponent()) return;
      const component_values = { [selected.id]: { height, elevation } };
      if (x || z) {
        try { await apiAction('proposal', { proposal: offsetProposal(proposal, selected.id, x, z, componentScene(selected).parameters.meters_per_unit.value), component_values }); }
        catch (error) { apiError(error); }
      } else await apiAction('answers', { component_values });
      return;
    }
    undo.push(structuredClone(model)); if (undo.length > 30) undo.shift(); redo = [];
    const id = selected.id;
    const next = { ...model, components: model.components.map(c => c.id === id ? { ...c, height, elevation, polygon: c.polygon.map(p => [p[0] + x, p[1] + z]), assumed: true } : c) };
    applyModel(next, { fit: false, clearHistory: false }); view?.select(id); status('Component updated');
  });
  for (const id of ['undo', 'redo']) listen($(id), 'click', () => {
    if (model?.backend) { if (canEditBackend()) void apiAction(id); return; }
    const from = id === 'undo' ? undo : redo, to = id === 'undo' ? redo : undo;
    if (!from.length) return; to.push(structuredClone(model)); applyModel(from.pop(), { fit: false, clearHistory: false });
  });
  function closeExport(restoreFocus = false) {
    const wasOpen = !$('export-options').hidden;
    $('export-options').hidden = true; $('export-model').setAttribute('aria-expanded', 'false');
    if (wasOpen && restoreFocus) $('export-model').focus();
  }
  listen($('export-model'), 'click', async () => {
    if (!view || !model) return;
    if (!$('export-options').hidden) { closeExport(); return; }
    $('export-options').hidden = false; $('export-model').setAttribute('aria-expanded', 'true');
    $('export-options').querySelector('[data-export="glb"]').focus();
    const blend = $('export-options').querySelector('[data-export="blend"]'); blend.disabled = true;
    $('blend-note').textContent = 'Checking Blender availability…';
    try {
      const capabilities = await apiRequest('/api/capabilities');
      blend.disabled = !capabilities.blender_available;
      $('blend-note').textContent = blend.disabled ? 'Blender is unavailable on this server.' : 'Native Blender project or portable GLB.';
    } catch { $('blend-note').textContent = 'Server unavailable. GLB can still be exported.'; }
  });
  listen(document, 'pointerdown', event => { if (!event.target.closest('.export-control')) closeExport(); });
  $('export-options').querySelectorAll('[data-export]').forEach(button => listen(button, 'click', async () => {
    if (!view || !model) return;
    const exportingView = view, name = model.name, format = button.dataset.export;
    closeExport(true); $('export-model').disabled = true;
    try {
      const binary = await exportingView.export();
      let blob;
      if (format === 'blend') {
        const response = await fetch(`${API_BASE}/api/export/blend`, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: binary });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.detail || `Blender conversion failed (${response.status})`);
        }
        blob = await response.blob();
      } else blob = new Blob([binary], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${name.replace(/[^\p{L}\p{N}_-]/gu, '-') || 'model'}.${format}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status(`Exported .${format} model`);
    } catch (error) { status(`Export failed: ${error.message}`); }
    finally { $('export-model').disabled = !model || !view; }
  }));
  function openDrawer(id) {
    closeDrawers(); $(id).classList.add('is-open');
    root.querySelector(`[data-drawer="${id}"]`).setAttribute('aria-expanded', 'true');
    $(id).querySelector('button')?.focus();
  }
  root.querySelectorAll('[data-drawer]').forEach(b => listen(b, 'click', () => {
    if ($(b.dataset.drawer).classList.contains('is-open')) closeDrawers(); else openDrawer(b.dataset.drawer);
  }));
  root.querySelectorAll('[data-close-drawer]').forEach(b => listen(b, 'click', closeDrawers));
  listen(root, 'keydown', e => { if (e.key === 'Escape') { closeExport(true); closeDrawers(); } });
  listen(canvas, 'webglcontextlost', e => {
    e.preventDefault(); view?.dispose(); view = null;
    $('workspace-error').textContent = 'Graphics context lost. Drawings and parameters are preserved; reload the page to restore 3D.';
    $('workspace-error').hidden = false; $('export-model').disabled = true;
  });
  return {
    open, loadSample, loadDatasetSample,
    render(delta) { if (active && view && !document.hidden) view.render({ active: true, delta }); },
    motionChanged() { if (view) view.controls.enableDamping = !reducedMotion.matches; },
    dispose() { void singleApi.stop(); floors.forEach(f => { void f.client.stop(); }); ticket++; previewEpoch++; worker?.terminate(); events.abort(); view?.dispose(); if (imageURL) URL.revokeObjectURL(imageURL); },
  };
}
