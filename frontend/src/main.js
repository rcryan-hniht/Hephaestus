import './style.css';
import { SceneView } from './scene.js';
import { projects, sampleModel, phaseAt } from './model.js';
import { createWorkspace } from './workspace.js';

const $ = id => document.getElementById(id);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const events = new AbortController();
const listen = (element, name, fn) => element.addEventListener(name, fn, { signal: events.signal });
const frame = $('visual-frame'), canvas = $('landing-canvas'), copies = [...document.querySelectorAll('[data-copy]')];
const glow = $('glow-cursor');
let pointerX = -300, pointerY = -300, glowX = -300, glowY = -300;
if (glow && !motion.matches) {
  listen(window, 'pointermove', e => { pointerX = e.clientX; pointerY = e.clientY; });
  listen(document, 'pointerleave', () => { pointerX = -300; pointerY = -300; });
}
let scene, raf, previous = 0, expanded = false, expansion = 0, velocity = 0, currentProject = 0;
let workspaceOpen = false, returnFocus, savedScroll = 0, chapter = 0, height = innerHeight, dirty = true;
let lastWidth = 0, lastHeight = 0;
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
  const preview = document.createElement('button'); preview.type = 'button'; preview.setAttribute('aria-label', `Xem trước ${model.name}`);
  const title = document.createElement('strong'); title.textContent = model.name;
  const detail = document.createElement('small'); detail.textContent = projects[index].note;
  const source = document.createElement('small'); source.textContent = 'Mặt bằng mẫu → mô hình 3D'; preview.append(title, detail, source);
  const open = document.createElement('button'); open.type = 'button'; open.className = 'work-open'; open.textContent = '↗'; open.setAttribute('aria-label', `Khám phá mẫu ${model.name}`);
  listen(preview, 'click', () => setProject(index)); listen(open, 'click', () => openWorkspace(index));
  item.append(svg, preview, open); $('work-list').append(item);
});
function setProject(index) {
  currentProject = index; scene?.setModel(projectModels[index]);
  document.querySelectorAll('.work-item').forEach((item, i) => item.dataset.active = String(i === index)); dirty = true;
}
function showFallback() {
  scene?.dispose(); scene = null;
  $('landing-error').textContent = 'Không thể mở 3D trên thiết bị này. Bạn vẫn có thể nạp và xem bản vẽ 2D.';
  $('landing-error').hidden = false; canvas.hidden = true;
}
try { scene = new SceneView(canvas, { reducedMotion: motion.matches }); scene.setModel(projectModels[0]); }
catch { showFallback(); }
listen(canvas, 'webglcontextlost', e => { e.preventDefault(); showFallback(); });
function expand() { if (!expanded && scene) { expanded = true; $('expand-preview').setAttribute('aria-expanded', 'true'); dirty = true; } }
listen($('expand-preview'), 'pointerenter', expand);
listen($('expand-preview'), 'focus', expand);
listen($('expand-preview'), 'click', () => { expand(); canvas.focus({ preventScroll: true }); });
listen($('open-preview'), 'click', () => openWorkspace(currentProject));
listen(window, 'scroll', () => { dirty = true; });
listen(window, 'resize', () => {
  const progress = scrollY / height; height = innerHeight;
  $('story').style.height = `${height * 4}px`; document.querySelector('.story-sticky').style.height = `${height}px`;
  if (!workspaceOpen) window.scrollTo(0, progress * height);
  dirty = true;
});
listen(motion, 'change', () => {
  expansion = motion.matches ? 1 : expanded ? 1 : 0; velocity = 0;
  if (scene) scene.controls.enableDamping = !motion.matches;
  workspace.motionChanged(); dirty = true;
});
$('story').style.height = `${height * 4}px`; document.querySelector('.story-sticky').style.height = `${height}px`;
if (motion.matches) { expanded = true; expansion = 1; }
const lerp = (a, b, t) => a + (b - a) * t;
function layout() {
  const width = innerWidth, short = height < 620, mobile = width <= 800 && !short;
  let offset = scrollY;
  if (offset >= height * 3 - .5) { offset = Math.max(0, offset - height * 3); window.scrollTo(0, offset); }
  const state = phaseAt(offset, height, motion.matches);
  chapter = state.mix >= .5 ? state.next : state.chapter;
  const { mix, next } = state, from = state.chapter;
  document.body.dataset.chapter = String(chapter);
  const e = Math.max(0, Math.min(1.04, expansion));
  const heroW = lerp(Math.min(300, width * .72), mobile ? width * .88 : Math.min(720, width * .48), e);
  const heroH = lerp(Math.min(190, height * .28), Math.min(height * (short ? .28 : .32), mobile ? 260 : 320), e);
  const heroY = mobile ? height * .43 : height * (short ? .38 : .39);
  const positions = mobile ? [
    { x: (width - heroW) / 2, y: heroY, w: heroW, h: heroH, r: 5 },
    { x: width * .06, y: height * .49, w: width * .88, h: height * .30, r: 3 },
    { x: width * .06, y: height * .34, w: width * .88, h: height * .28, r: 2 },
  ] : [
    { x: (width - heroW) / 2, y: heroY, w: heroW, h: heroH, r: 5 },
    { x: width * .44, y: height * (short ? .25 : .23), w: width * .51, h: height * (short ? .46 : .54), r: 2 },
    { x: width * .05, y: height * .42, w: width * .59, h: height * (short ? .29 : .38), r: 2 },
  ];
  const a = positions[from], b = positions[next];
  const visualProgress = motion.matches ? 0 : Math.min(1, mix * 1.2);
  const x = lerp(a.x, b.x, visualProgress), y = lerp(a.y, b.y, visualProgress), w = lerp(a.w, b.w, visualProgress), h = lerp(a.h, b.h, visualProgress);
  frame.style.transform = `translate(${x}px,${y}px)`; frame.style.width = `${w}px`; frame.style.height = `${h}px`; frame.style.borderRadius = `${lerp(a.r, b.r, visualProgress)}px`;
  if (Math.abs(w - lastWidth) > .5 || Math.abs(h - lastHeight) > .5) { scene?.resize(); lastWidth = w; lastHeight = h; }
  const copyPositions = mobile ? [{ x: 0, y: height * .17 }, { x: width * .06, y: height * .17 }, { x: width * .06, y: height * .16 }] : [{ x: 0, y: height * .16 }, { x: width * .065, y: height * .28 }, { x: width * .05, y: height * .17 }];
  const forward = next > from || (from === 2 && next === 0);
  copies.forEach((copy, i) => {
    const visible = i === chapter;
    copy.inert = !visible; copy.setAttribute('aria-hidden', String(!visible));
    const weight = i === from ? 1 - mix : i === next ? mix : 0;
    const shift = motion.matches ? 0 : (i === from ? -mix : 1 - mix) * 45;
    copy.style.opacity = String(motion.matches ? Number(i === from) : Math.max(0, (weight - .25) / .75));
    copy.style.transform = `translate(${copyPositions[i].x}px,${copyPositions[i].y + (weight ? shift : 0)}px)`;
    copy.style.clipPath = weight > 0 ? (forward ? `inset(${Math.max(0, (1 - weight) * 35)}% 0 0 0)` : `inset(0 0 ${Math.max(0, (1 - weight) * 35)}% 0)`) : 'inset(100% 0 0 0)';
  });
  const worksWeight = from === 2 ? 1 - mix : next === 2 ? mix : 0;
  const works = $('work-list');
  works.style.opacity = String(works.contains(document.activeElement) ? 1 : Math.max(0, worksWeight * 2 - 1));
  works.style.pointerEvents = chapter === 2 ? '' : 'none';
  works.inert = chapter !== 2 && !works.contains(document.activeElement); works.setAttribute('aria-hidden', String(works.inert));
  works.style.top = mobile ? `${height * .64}px` : `${height * .43}px`;
  works.style.transform = `translateY(${motion.matches ? 0 : (1 - worksWeight) * 30}px)`;
  const action = $('landing-action'), actionW = action.offsetWidth;
  const actionPositions = mobile ? [
    { x: (width - actionW) / 2, y: heroY + heroH + 16 },
    { x: (width - actionW) / 2, y: height * .83 },
    { x: (width - actionW) / 2, y: height * .85 }
  ] : [
    { x: (width - actionW) / 2, y: Math.min(height * .84, heroY + heroH + (short ? 16 : 24)) },
    { x: width * .065, y: height * .80 },
    { x: width * .05, y: height * .85 }
  ];
  if (short) actionPositions.forEach(p => { p.y = height * .78; });
  const actionProgress = Math.max(0, Math.min(1, (mix - .12) / .88));
  action.style.transform = `translate(${lerp(actionPositions[from].x, actionPositions[next].x, actionProgress)}px,${lerp(actionPositions[from].y, actionPositions[next].y, actionProgress)}px)`;
  $('action-note').textContent = ['Từ mặt bằng đến một góc nhìn mới.', 'Nạp bản vẽ. Xác nhận thông số. Khám phá.', 'Cuộn tiếp để trở về nơi ý tưởng bắt đầu.'][chapter];
  $('chapter-caption').textContent = ['Khởi đầu một không gian', 'Từ đường nét đến chiều sâu', 'Trở về khởi đầu'][chapter];
  $('annotation-text').textContent = ['BẢN VẼ / KHÔNG GIAN', 'ĐƯỜNG NÉT / CHIỀU SÂU', 'MẶT BẰNG / MÔ HÌNH'][chapter];
  const annotation = document.querySelector('.scene-annotation');
  annotation.style.opacity = String((from === 0 ? 1 - mix : next === 0 ? mix : 0) * .85);
  annotation.style.top = `${heroY + heroH * .45}px`;
  $('visual-label').textContent = chapter === 1 ? 'MINH HỌA QUÁ TRÌNH HÌNH THÀNH' : `MÔ HÌNH MẪU / ${projects[currentProject].name.toUpperCase()}`;
  const interactive = chapter !== 1 && (expanded || chapter === 2) && mix === 0;
  $('expand-preview').hidden = expanded || chapter !== 0 || !scene;
  $('open-preview').hidden = !interactive || !scene;
  canvas.tabIndex = interactive && scene ? 0 : -1;
  canvas.classList.toggle('is-interactive', interactive);
  if (from === 2 && mix > 0) scene?.morphHome(mix);
  else if (scene?.returnPose) { scene.morphHome(from === 2 ? 0 : 1); scene.returnPose = null; }
  const local = offset / height;
  const growth = from === 1 ? Math.min(1, .03 + (local - 1) / .4) : next === 1 ? 1 - mix * .97 : 1;
  return { progress: motion.matches ? 1 : growth, active: interactive, orbit: !motion.matches && chapter === 0 && !scene?.interacted };
}
let renderState = { progress: 1, active: false };
function animate(time) {
  const delta = Math.min((time - (previous || time)) / 1000, .05); previous = time;
  if (!workspaceOpen) {
    if (glow && !motion.matches) {
      glowX += (pointerX - glowX) * .12;
      glowY += (pointerY - glowY) * .12;
      glow.style.transform = `translate(${glowX}px,${glowY}px)`;
    }
    const target = expanded ? 1 : 0;
    if (motion.matches) expansion = target;
    else if (Math.abs(expansion - target) > .0001 || Math.abs(velocity) > .001) {
      velocity += ((target - expansion) * 140 - velocity * 22) * delta; expansion += velocity * delta;
      if (Math.abs(target - expansion) < .001 && Math.abs(velocity) < .01) { expansion = target; velocity = 0; }
      dirty = true;
    }
    if (dirty) { renderState = layout(); dirty = false; }
    if (!document.hidden) scene?.render({ ...renderState, delta });
  } else workspace.render(delta);
  raf = requestAnimationFrame(animate);
}
raf = requestAnimationFrame(animate);
function dispose() { cancelAnimationFrame(raf); events.abort(); scene?.dispose(); workspace.dispose(); }
if (import.meta.hot) import.meta.hot.dispose(dispose);
listen(window, 'pagehide', e => { if (!e.persisted) dispose(); });
