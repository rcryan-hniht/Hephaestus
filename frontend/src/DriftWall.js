// React Bits DriftWall, adapted from the supplied component for the shared render loop.
import './DriftWall.css';

const columnFactor = (index, variance) => 1 + variance * (((index * .6180339887 + .35) % 1) * 2 - 1);

export function createDriftWall(root, { items, onSelect, columns = 5, tileWidth = 200, tileHeight = 132,
  gap = 18, radius = 6, tilt = 16, turn = -14, roll = 0, perspective = 1200, depth = 120,
  speed = 42, direction = 'up', variance = .45, parallax = .6, pauseOnHover = false,
  lift = 64, fade = .3, dim = .8, grayscale = false, overlayColor = '#FAFAFA',
} = {}) {
  if (!items?.length) throw new Error('DriftWall needs sample drawing or model images.');
  const events = new AbortController(), motion = matchMedia('(prefers-reduced-motion: reduce)');
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  const plane = document.createElement('div'); plane.className = 'drift-wall__plane';
  root.classList.add('drift-wall'); root.replaceChildren(plane);
  // The stable project list provides keyboard actions; repeated visual tiles add no tab stops.
  root.setAttribute('aria-hidden', 'true');
  for (const [key, value] of Object.entries({ 'tile-w': `${tileWidth}px`, 'tile-h': `${tileHeight}px`, gap: `${gap}px`, radius: `${radius}px`, perspective: `${perspective}px`, lift: `${lift}px`, dim, gray: grayscale ? 1 : 0, overlay: overlayColor, edge: `${(1 - fade) * 100}%` })) root.style.setProperty(`--dw-${key}`, value);
  let wallHovered = false, hoveredCol = -1, selected = 0, reduced, alive = true;
  const pointer = { x: 0, y: 0 }, damped = { x: 0, y: 0 };
  let cols = [];
  function resize() {
    if (!alive) return;
    const height = root.clientHeight || root.parentElement.clientHeight || 600;
    const width = root.clientWidth || root.parentElement.clientWidth || innerWidth;
    const count = innerWidth <= 800 ? Math.min(columns, 3) : columns;
    const fittedHeight = Math.min(tileHeight, Math.max(24, height / 2 - gap));
    root.style.setProperty('--dw-tile-w', `${Math.min(tileWidth, width / count - gap)}px`);
    root.style.setProperty('--dw-tile-h', `${fittedHeight}px`);
    if (cols.length !== count) {
      plane.replaceChildren(); hoveredCol = -1;
      cols = Array.from({ length: count }, (_, index) => {
        const element = document.createElement('div'); element.className = 'drift-wall__col';
        const track = document.createElement('div'); track.className = 'drift-wall__track'; element.append(track); plane.append(element);
        const entries = items.filter((_, i) => i % count === index);
        if (!entries.length) entries.push(items[index % items.length]);
        const copyHeight = entries.length * (fittedHeight + gap);
        return { track, entries, copyHeight, copies: 0, offset: copyHeight * ((index * .37) % 1), velocity: 0,
          baseVelocity: speed * columnFactor(index, variance) * (direction === 'up' ? 1 : -1) * (index % 2 ? -1 : 1) };
      });
    }
    cols.forEach((col, index) => {
      const copyHeight = col.entries.length * (fittedHeight + gap);
      col.offset *= copyHeight / col.copyHeight; col.copyHeight = copyHeight;
      const copies = Math.max(2, Math.ceil(height * 1.6 / col.copyHeight) + 1);
      if (copies === col.copies) return;
      col.copies = copies; col.track.replaceChildren();
      for (let copy = 0; copy < copies; copy++) for (const item of col.entries) {
        const tile = document.createElement('div'); tile.className = 'drift-wall__tile'; tile.dataset.col = index; tile.dataset.project = item.project; tile.dataset.kind = item.kind; tile.title = `${item.title} · Open sample drawing`;
        const inner = document.createElement('span'); inner.className = 'drift-wall__inner';
        const image = new Image(); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false; image.dataset.kind = item.kind;
        image.addEventListener('error', () => { image.hidden = true; caption.textContent = `${item.title} / Drawing unavailable`; }, { once: true });
        const overlay = document.createElement('span'); overlay.className = 'drift-wall__overlay';
        const caption = document.createElement('span'); caption.className = 'drift-wall__caption'; caption.textContent = item.title;
        inner.append(image, overlay, caption); tile.append(inner); col.track.append(tile);
      }
    });
    select(selected);
  }
  function select(project) { selected = project; root.querySelectorAll('.drift-wall__tile').forEach(tile => tile.classList.toggle('is-selected', Number(tile.dataset.project) === project)); }
  listen(root, 'pointerenter', () => { wallHovered = true; });
  listen(root, 'pointerleave', () => { wallHovered = false; hoveredCol = -1; pointer.x = pointer.y = 0; root.querySelectorAll('.is-active').forEach(tile => tile.classList.remove('is-active')); });
  listen(root, 'pointermove', event => {
    const rect = root.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width - .5; pointer.y = (event.clientY - rect.top) / rect.height - .5;
    const hit = event.target.closest('.drift-wall__tile'); hoveredCol = hit ? Number(hit.dataset.col) : -1;
    root.querySelectorAll('.is-active').forEach(tile => { if (tile !== hit) tile.classList.remove('is-active'); }); hit?.classList.add('is-active');
  });
  listen(root, 'click', event => { const tile = event.target.closest('.drift-wall__tile'); if (tile) onSelect?.(Number(tile.dataset.project)); });
  const observer = new ResizeObserver(resize); observer.observe(root); resize();
  return {
    select,
    render(delta) {
      if (!alive || root.closest('[hidden]') || document.hidden) return;
      const reduce = motion.matches || (navigator.hardwareConcurrency || 8) <= 4;
      if (reduce !== reduced) { reduced = reduce; root.classList.toggle('drift-wall--reduced', reduce); }
      const dt = Math.min(.05, Math.max(0, delta)), damp = 1 - Math.exp(-dt / .12);
      damped.x += (pointer.x * parallax * 8 - damped.x) * damp; damped.y += (-pointer.y * parallax * 8 - damped.y) * damp;
      plane.style.transform = reduced ? 'translate(-50%, -50%)' : `translate(-50%, -50%) scale(1.18) rotateX(${tilt + damped.y}deg) rotateY(${turn + damped.x}deg) rotateZ(${roll}deg) translateZ(${-depth}px)`;
      cols.forEach((col, index) => {
        if (!reduced) {
          const target = (wallHovered && pauseOnHover) || hoveredCol === index ? 0 : col.baseVelocity;
          col.velocity += (target - col.velocity) * (1 - Math.exp(-dt / (target === 0 ? .16 : .28)));
          col.offset = ((col.offset + col.velocity * dt) % col.copyHeight + col.copyHeight) % col.copyHeight;
        }
        col.track.style.transform = `translate3d(0, ${reduced ? 0 : -col.offset}px, 0)`;
      });
    },
    dispose() { alive = false; events.abort(); observer.disconnect(); root.replaceChildren(); },
  };
}
