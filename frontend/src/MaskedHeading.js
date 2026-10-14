// React Bits MaskedHeading, adapted from the supplied component for vanilla DOM.
import { gsap } from 'gsap';
import './MaskedHeading.css';

let nextId = 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createMaskedHeading(root, {
  text = root.textContent, src = '', fillScale = 1.25, parallax = 26, drift = 18,
  brightness = 1, saturation = 1, grayscale = false, reveal = 'rise', trigger = 'view',
  duration = 1.1, stagger = .09, textScale,
} = {}) {
  const original = root.textContent, originalFontSize = root.style.fontSize;
  const clipId = `masked-heading-${++nextId}`, svgNS = 'http://www.w3.org/2000/svg';
  const measure = document.createElement('span'); measure.className = 'masked-heading__measure';
  const defs = document.createElementNS(svgNS, 'svg'); defs.classList.add('masked-heading__defs'); defs.setAttribute('aria-hidden', 'true'); defs.setAttribute('focusable', 'false');
  const clip = document.createElementNS(svgNS, 'clipPath'); clip.id = clipId; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const definitions = document.createElementNS(svgNS, 'defs'); definitions.append(clip); defs.append(definitions);
  const words = String(text).split(/\s+/).filter(Boolean).map((word, index) => {
    if (index) measure.append(' ');
    const box = document.createElement('span'); box.className = 'masked-heading__word'; box.append(word);
    const base = document.createElement('i'); base.className = 'masked-heading__baseline'; box.append(base); measure.append(box);
    const glyph = document.createElementNS(svgNS, 'text'); glyph.textContent = word; clip.append(glyph);
    return { box, base, glyph };
  });
  const layer = document.createElement('span'); layer.className = 'masked-heading__reveal'; layer.setAttribute('aria-hidden', 'true');
  const clipped = document.createElement('span'); clipped.className = 'masked-heading__clip'; clipped.style.clipPath = `url(#${clipId})`;
  const media = document.createElement('span'); media.className = 'masked-heading__media';
  const image = new Image(); image.className = 'masked-heading__source'; image.alt = ''; image.draggable = false;
  media.append(image); clipped.append(media); layer.append(clipped);
  root.classList.add('masked-heading'); root.replaceChildren(measure, defs, layer);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController(), glyphs = words.map(word => word.glyph);
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  let alive = true, ready = false, requested = trigger === 'mount', played = false, active = true, tween, clock = 0;
  let reduced = motion.matches;
  const offset = { x: 0, y: 0, tx: 0, ty: 0 };
  function place() {
    if (!alive) return;
    const maxX = Math.max(0, (fillScale - 1) * root.clientWidth / 2);
    const maxY = Math.max(0, (fillScale - 1) * root.clientHeight / 2);
    media.style.transform = `translate3d(${clamp(offset.x, -maxX, maxX).toFixed(2)}px, ${clamp(offset.y, -maxY, maxY).toFixed(2)}px, 0) scale(${fillScale})`;
  }
  function sync() {
    if (!alive) return;
    if (textScale !== undefined) root.style.fontSize = `${clamp(root.clientWidth * textScale, 20, 200).toFixed(1)}px`;
    const style = getComputedStyle(measure);
    for (const { box, base, glyph } of words) {
      glyph.setAttribute('x', box.offsetLeft); glyph.setAttribute('y', base.offsetTop);
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing']) glyph.style[property] = style[property];
    }
    place();
  }
  function settle() {
    tween?.kill(); tween = null;
    gsap.set(glyphs, { y: 0 }); gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
  }
  function play() {
    if (!alive || !ready || !active || !requested || (played && trigger !== 'hover')) return;
    played = true;
    if (motion.matches || reveal === 'none') { settle(); return; }
    tween?.kill();
    if (reveal === 'rise') {
      gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
      tween = gsap.fromTo(glyphs, { y: parseFloat(getComputedStyle(root).fontSize) * 1.15 }, { y: 0, duration, stagger, ease: 'power4.out', overwrite: 'auto' });
    } else if (reveal === 'wipe') {
      gsap.set(glyphs, { y: 0 });
      tween = gsap.fromTo(layer, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration, ease: 'power3.inOut' });
    } else tween = gsap.fromTo(layer, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration, ease: 'power3.out' });
  }
  const observer = new ResizeObserver(sync); observer.observe(root);
  const intersection = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { requested = true; play(); intersection.disconnect(); }
  }, { threshold: .25 });
  if (trigger === 'view') intersection.observe(root);
  if (trigger === 'hover') listen(root, 'pointerenter', () => { requested = true; play(); });
  listen(root, 'pointermove', event => {
    if (motion.matches || parallax <= 0) return;
    const rect = root.getBoundingClientRect();
    offset.tx = -clamp((event.clientX - rect.left) / (rect.width || 1) * 2 - 1, -1, 1) * parallax;
    offset.ty = -clamp((event.clientY - rect.top) / (rect.height || 1) * 2 - 1, -1, 1) * parallax;
  });
  listen(root, 'pointerleave', () => { offset.tx = 0; offset.ty = 0; });
  listen(image, 'load', () => {
    if (!alive) return;
    sync(); ready = true; root.dataset.ready = 'true'; settle(); play();
  });
  listen(image, 'error', () => { ready = false; delete root.dataset.ready; settle(); });
  media.style.filter = `brightness(${brightness}) saturate(${saturation})${grayscale ? ' grayscale(1)' : ''}`;
  sync(); document.fonts?.ready.then(sync).catch(() => {});
  if (src) image.src = src;
  return {
    render(delta) {
      if (!alive) return;
      const visible = !document.hidden && !root.closest('[hidden], [aria-hidden="true"]');
      if (visible !== active) { active = visible; if (active) { tween?.resume(); play(); } else tween?.pause(); }
      if (motion.matches !== reduced) {
        reduced = motion.matches;
        if (reduced) { settle(); offset.x = offset.y = offset.tx = offset.ty = 0; place(); }
      }
      if (!active || !ready || reduced) return;
      const dt = clamp(delta, 0, .05); clock += dt;
      const ease = 1 - Math.exp(-dt / .18);
      offset.x += (offset.tx + Math.sin(clock * .21) * drift - offset.x) * ease;
      offset.y += (offset.ty + Math.cos(clock * .17) * drift * .6 - offset.y) * ease;
      place();
    },
    dispose() {
      alive = false; events.abort(); observer.disconnect(); intersection.disconnect(); tween?.kill();
      gsap.killTweensOf(glyphs); gsap.killTweensOf(layer);
      root.classList.remove('masked-heading'); delete root.dataset.ready; root.style.fontSize = originalFontSize; root.textContent = original;
    },
  };
}
