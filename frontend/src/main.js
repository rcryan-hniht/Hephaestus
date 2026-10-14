import './style.css';
import { SceneView } from './scene.js';
import { projects, sampleModel, phaseAt } from './model.js';
import { createWorkspace } from './workspace.js';
import { createAntigravity } from './Antigravity.js';
import { createMaskedHeading } from './MaskedHeading.js';

const $ = id => document.getElementById(id);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const events = new AbortController();
const listen = (element, name, fn) => element.addEventListener(name, fn, { signal: events.signal });
const frame = $('visual-frame'), canvas = $('landing-canvas'), copies = [...document.querySelectorAll('[data-copy]')];
const particlesCanvas = $('antigravity-canvas');
let antigravity;
let scene, sceneFailed = false, raf, previous = 0, currentProject = 0;
let workspaceOpen = false, returnFocus, savedScroll = 0, chapter = 0, height = innerHeight, dirty = true;
let lastWidth = 0, lastHeight = 0, lastOffset = scrollY;
const photo = $('hero-photograph');
const maskedHeadings = [...document.querySelectorAll('h1 > span')].map(root => createMaskedHeading(root, { src: photo.getAttribute('src'), brightness: .65 }));
if ((navigator.hardwareConcurrency || 8) > 4 && (navigator.deviceMemory || 8) > 4) {
  try { antigravity = createAntigravity(particlesCanvas); } catch { particlesCanvas.hidden = true; }
} else particlesCanvas.hidden = true;
const workspace = createWorkspace({ reducedMotion: motion, onClose() {
  workspaceOpen = false; $('landing').hidden = false; document.body.style.overflow = '';
  window.scrollTo(0, savedScroll); returnFocus?.focus({ preventScroll: true }); dirty = true;
} });
function openWorkspace(sample) {
  if (!workspaceOpen) { returnFocus = document.activeElement; savedScroll = scrollY; }
  workspaceOpen = true; $('landing').hidden = true; document.body.style.overflow = 'hidden';
  workspace.open(); if (sample !== undefined) workspace.loadSample(sample);
  $('back-home').focus();
}
document.querySelectorAll('[data-upload]').forEach(b => listen(b, 'click', () => { openWorkspace(); $('file-input').click(); }));
document.querySelectorAll('[data-workspace]').forEach(b => listen(b, 'click', () => openWorkspace()));
function goChapter(index) {
  $('nav-links').classList.remove('is-open'); $('menu-toggle').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: index * height, behavior: 'instant' }); dirty = true;
}
document.querySelectorAll('[data-chapter]').forEach(a => listen(a, 'click', e => { e.preventDefault(); goChapter(Number(a.dataset.chapter)); }));
listen($('next-chapter'), 'click', () => goChapter(chapter === 2 ? 3 : chapter + 1));
listen($('explore-demo'), 'click', () => openWorkspace(0));
listen($('menu-toggle'), 'click', () => {
  const open = !$('nav-links').classList.contains('is-open'); $('nav-links').classList.toggle('is-open', open); $('menu-toggle').setAttribute('aria-expanded', String(open));
});
listen($('nav-links'), 'keydown', e => { if (e.key === 'Escape') { $('nav-links').classList.remove('is-open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); $('menu-toggle').focus(); } });
const projectModels = projects.map((_, i) => sampleModel(i));
projectModels.forEach((model, index) => {
  const item = document.createElement('div'); item.className = 'work-item'; item.dataset.active = String(index === 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '-9 -9 18 18'); svg.setAttribute('aria-hidden', 'true');
  model.components.filter(c => c.floor === 0 && c.type !== 'window').forEach(c => {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); polygon.setAttribute('points', c.polygon.map(p => p.join(',')).join(' ')); svg.append(polygon);
  });
  const preview = document.createElement('button'); preview.type = 'button'; preview.setAttribute('aria-label', `Preview ${model.name}`);
  const title = document.createElement('strong'); title.textContent = model.name;
  const detail = document.createElement('small'); detail.textContent = projects[index].note;
  const source = document.createElement('small'); source.textContent = 'Sample plan → 3D model'; preview.append(title, detail, source);
  const open = document.createElement('button'); open.type = 'button'; open.className = 'work-open'; open.textContent = '↗'; open.setAttribute('aria-label', `Explore ${model.name}`);
  listen(preview, 'click', () => setProject(index)); listen(open, 'click', () => openWorkspace(index));
  item.append(svg, preview, open); $('work-list').append(item);
});
function setProject(index) {
  currentProject = index; scene?.setModel(projectModels[index]);
  document.querySelectorAll('.work-item').forEach((item, i) => item.dataset.active = String(i === index)); dirty = true;
}
function showFallback() {
  scene?.dispose(); scene = null; sceneFailed = true;
  $('landing-error').textContent = '3D viewing is unavailable on this device. You can still upload and preview 2D drawings.';
  canvas.hidden = true;
}
function prepareScene() {
  if (scene || sceneFailed) return;
  try { scene = new SceneView(canvas, { reducedMotion: motion.matches }); scene.setModel(projectModels[currentProject]);
    scene.controls.enableZoom = false; scene.controls.enablePan = false; canvas.style.touchAction = 'pan-y'; }
  catch { showFallback(); }
}
listen(canvas, 'webglcontextlost', e => { e.preventDefault(); showFallback(); dirty = true; });
listen(photo, 'error', () => { photo.hidden = true; $('reference-fallback').hidden = false; });
if (photo.complete && !photo.naturalWidth) { photo.hidden = true; $('reference-fallback').hidden = false; }
listen($('open-preview'), 'click', () => openWorkspace(currentProject));
listen(window, 'scroll', () => { dirty = true; });
function fitIntro() {
  const marker = document.querySelector('.morph-word'), word = marker.firstElementChild;
  const fontSize = parseFloat(getComputedStyle(word).fontSize);
  const safeWidth = word.offsetWidth + fontSize * .18 * word.textContent.length;
  const scale = Math.min(.28, marker.clientWidth / (safeWidth * 1.35 * 5.25));
  marker.style.setProperty('--start-scale', String(scale));
  marker.style.setProperty('--word-step', `${(marker.clientWidth - safeWidth * scale * 1.35) / 4}px`);
}
fitIntro();
listen(window, 'resize', () => {
  fitIntro();
  const progress = scrollY / height; height = innerHeight;
  $('story').style.height = `${height * 4}px`; document.querySelector('.story-sticky').style.height = `${height}px`;
  if (!workspaceOpen) window.scrollTo(0, progress * height);
  dirty = true;
});
listen(motion, 'change', () => {
  if (scene) scene.controls.enableDamping = !motion.matches;
  workspace.motionChanged(); dirty = true;
});
$('story').style.height = `${height * 4}px`; document.querySelector('.story-sticky').style.height = `${height}px`;
const lerp = (a, b, t) => a + (b - a) * t;
function layout() {
  const width = innerWidth, compact = height < 620, mobile = width <= 800 && (!compact || width < height);
  let offset = scrollY;
  if (offset >= height * 3 - .5) { offset = Math.max(0, offset - height * 3); window.scrollTo(0, offset); }
  const { chapter: from, next, mix } = phaseAt(offset, height, motion.matches);
  chapter = mix >= .5 ? next : from;
  document.body.dataset.chapter = String(chapter);
  if (Math.abs(offset - lastOffset) > .5) document.body.dataset.scrollDirection = offset > lastOffset ? 'forward' : 'backward';
  lastOffset = offset;
  const margin = width * (mobile ? .06 : .075);
  const navBottom = document.querySelector('.nav').getBoundingClientRect().bottom;
  const top = navBottom + (mobile || compact ? 20 : 38), bottom = height - (compact ? 42 : mobile ? 48 : 72);
  const action = $('landing-action');
  const slogan = action.querySelector('.slogan');
  slogan.style.visibility = chapter === 0 ? 'visible' : 'hidden';
  slogan.setAttribute('aria-hidden', String(chapter !== 0));
  // Measure the actual text and actions instead of positioning a visual over them.
  const copyHeights = copies.map(c => c.offsetHeight), actionHeight = action.offsetHeight;
  const heroActionHeight = actionHeight + slogan.offsetHeight + 16;
  const heroCopyY = mobile ? top : Math.max(top, (top + bottom - copyHeights[0] - heroActionHeight - (compact ? 14 : 28)) / 2);
  const manifestoCopyY = mobile ? top : Math.max(top, (top + bottom - copyHeights[1] - actionHeight - (compact ? 14 : 28)) / 2);
  const copyPositions = [
    { x: margin, y: heroCopyY },
    { x: margin, y: manifestoCopyY },
    { x: margin, y: top },
  ];
  const heroActionY = heroCopyY + copyHeights[0] + (compact ? 14 : mobile ? 16 : 28);
  const manifestoActionY = manifestoCopyY + copyHeights[1] + (compact ? 14 : mobile ? 16 : 26);
  const photoY = mobile ? heroActionY + heroActionHeight + 20 : top;
  const photoH = Math.max(100, bottom - photoY);
  const worksY = top + copyHeights[2] + (mobile ? 16 : 24);
  const worksListH = $('work-list').offsetHeight;
  const worksFrameH = mobile ? Math.max(100, bottom - worksY - worksListH - actionHeight - 34) : Math.max(compact ? 70 : 110, bottom - worksY - actionHeight - 20);
  const visualPositions = mobile ? [
    { x: margin, y: photoY, w: width * .88, h: photoH },
    { x: margin, y: manifestoActionY + actionHeight + 18, w: width * .88, h: Math.max(100, bottom - manifestoActionY - actionHeight - 18) },
    { x: margin, y: worksY, w: width * .88, h: worksFrameH },
  ] : [
    { x: width * .55, y: top, w: width * .375, h: bottom - top },
    { x: width * .48, y: Math.max(top, height * .22), w: width * .445, h: Math.max(120, Math.min(height * .54, bottom - Math.max(top, height * .22))) },
    { x: margin, y: worksY, w: width * .525, h: worksFrameH },
  ];
  const a = visualPositions[from], b = visualPositions[next];
  const w = lerp(a.w, b.w, mix), h = lerp(a.h, b.h, mix);
  frame.style.transform = `translate(${lerp(a.x, b.x, mix)}px,${lerp(a.y, b.y, mix)}px)`;
  frame.style.width = `${w}px`; frame.style.height = `${h}px`;
  frame.style.borderRadius = `${lerp(from === 0 ? 2 : 6, next === 0 ? 2 : 6, mix)}px`;
  if (Math.abs(w - lastWidth) > .5 || Math.abs(h - lastHeight) > .5) { scene?.resize(); lastWidth = w; lastHeight = h; }
  copies.forEach((copy, i) => {
    const visible = i === chapter;
    copy.inert = !visible; copy.setAttribute('aria-hidden', String(!visible));
    const weight = i === from ? 1 - mix : i === next ? mix : 0;
    copy.style.visibility = weight > 0 ? 'visible' : 'hidden';
    copy.style.opacity = '1';
    const shift = motion.matches ? 0 : i === from ? -mix * 42 : (1 - mix) * 42;
    copy.style.transform = `translate(${copyPositions[i].x}px,${copyPositions[i].y + (weight ? shift : 0)}px)`;
    copy.style.clipPath = motion.matches ? 'none' : i === from ? `inset(0 0 ${mix * 100}% 0)` : `inset(${(1 - mix) * 100}% 0 0 0)`;
    copy.style.mixBlendMode = mix > 0 ? 'multiply' : 'normal';
  });
  const heroWeight = from === 0 ? 1 - mix : next === 0 ? mix : 0;
  const modelWeight = 1 - heroWeight;
  const photoMask = from === 0 ? `inset(0 0 ${mix * 100}% 0)` : next === 0 ? `inset(${(1 - mix) * 100}% 0 0 0)` : 'inset(100% 0 0 0)';
  photo.style.clipPath = motion.matches ? heroWeight ? 'none' : 'inset(100% 0 0 0)' : photoMask;
  frame.dataset.photo = String(heroWeight >= .5);
  if (modelWeight > 0) { canvas.hidden = false; prepareScene(); }
  canvas.hidden = !scene || modelWeight <= 0;
  $('landing-error').hidden = !sceneFailed || modelWeight <= 0;
  $('reference-fallback').style.opacity = String(heroWeight);
  $('visual-label').textContent = heroWeight >= .5 ? 'ARCHITECTURE / A NEW PERSPECTIVE' : chapter === 1 ? 'CONSTRUCTION PROCESS DEMO' : `DEMO MODEL / ${projects[currentProject].name.toUpperCase()}`;
  const interactive = chapter === 2 && mix === 0 && !!scene;
  $('open-preview').hidden = !interactive;
  canvas.tabIndex = interactive ? 0 : -1; canvas.classList.toggle('is-interactive', interactive);
  const worksWeight = from === 2 ? 1 - mix : next === 2 ? mix : 0;
  const works = $('work-list');
  if (chapter !== 2 && works.contains(document.activeElement)) {
    (width <= 800 ? $('menu-toggle') : document.querySelector('[data-chapter="2"]')).focus({ preventScroll: true });
  }
  works.style.visibility = worksWeight > 0 ? 'visible' : 'hidden';
  works.style.opacity = String(worksWeight);
  works.inert = chapter !== 2; works.setAttribute('aria-hidden', String(works.inert));
  works.style.top = `${mobile ? worksY + worksFrameH + 12 : compact ? top + Math.max(0, (bottom - top - worksListH) / 2) : worksY + Math.max(0, (worksFrameH - worksListH) / 2)}px`;
  works.style.transform = `translateY(${motion.matches ? 0 : (1 - worksWeight) * 24}px)`;
  const actionPositions = [
    { x: margin, y: heroActionY },
    { x: margin, y: manifestoActionY },
    { x: margin, y: mobile ? worksY + worksFrameH + worksListH + 22 : worksY + worksFrameH + 20 },
  ];
  action.style.transform = `translate(${lerp(actionPositions[from].x, actionPositions[next].x, mix)}px,${lerp(actionPositions[from].y, actionPositions[next].y, mix)}px)`;
  $('action-note').textContent = ['From floor plan to a new perspective.', 'Upload drawing. Confirm scale. Explore.', 'Scroll further to return where ideas begin.'][chapter];
  $('chapter-caption').textContent = ['Beginning a space', 'From line to depth', 'Return to beginning'][chapter];
  const annotation = document.querySelector('.scene-annotation');
  annotation.style.opacity = String(heroWeight); annotation.style.top = `${Math.max(top, heroCopyY - 42)}px`;
  if (from === 2 && mix > 0) scene?.morphHome(mix);
  else if (scene?.returnPose) { scene.morphHome(from === 2 ? 0 : 1); scene.returnPose = null; }
  const local = offset / height;
  const growth = from === 1 ? Math.min(1, .03 + (local - 1) / .4) : next === 1 ? Math.max(.03, 1 - mix) : 1;
  return { progress: motion.matches ? 1 : growth, active: interactive, orbit: !motion.matches && interactive && !scene?.interacted, visible: modelWeight > 0 };
}
let renderState = { progress: 1, active: false };
function animate(time) {
  const delta = Math.min((time - (previous || time)) / 1000, .05); previous = time;
  maskedHeadings.forEach(heading => heading.render(delta));
  if (!workspaceOpen) {
    antigravity?.render(delta, motion.matches);
    if (dirty) { renderState = layout(); dirty = false; }
    if (!document.hidden && renderState.visible) scene?.render({ ...renderState, delta });
  } else workspace.render(delta);
  raf = requestAnimationFrame(animate);
}
document.fonts.ready.then(() => { fitIntro(); dirty = true; });
raf = requestAnimationFrame(animate);
function dispose() { cancelAnimationFrame(raf); events.abort(); maskedHeadings.forEach(heading => heading.dispose()); antigravity?.dispose(); scene?.dispose(); workspace.dispose(); }
if (import.meta.hot) import.meta.hot.dispose(dispose);
listen(window, 'pagehide', e => { if (!e.persisted) dispose(); });
