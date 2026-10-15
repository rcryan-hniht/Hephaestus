export function createPresetShowcase({ view, canvas, snapshot, controls, motion, onChange, onError }) {
  const events = new AbortController();
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  let models = [], index = 0, elapsed = 0, transition = null, paused = false, disposed = false;
  const pause = controls.querySelector('#preset-pause');
  const buttons = controls.querySelector('.preset-buttons');
  const context = snapshot.getContext('2d');
  function finish() {
    transition = null; snapshot.hidden = true;
    canvas.style.transform = 'none'; canvas.style.opacity = '1';
  }
  function renderModel() {
    if (!models.length) return;
    const mode = motion.matches ? 'solid' : ['solid', 'edges', 'transparent'][Math.min(2, Math.floor(elapsed / 3))];
    if (view.mode !== mode) { view.setMode(mode); onChange(); }
    view.render({ progress: motion.matches ? 1 : Math.min(1, elapsed / 2.2) });
  }
  function select(next) {
    if (!models.length || next === index) return;
    finish();
    if (!motion.matches) {
      // Capture immediately after rendering; WebGL does not preserve its drawing buffer.
      view.needsRender = true; renderModel();
      snapshot.width = canvas.width; snapshot.height = canvas.height;
      context.drawImage(canvas, 0, 0);
      snapshot.hidden = false; snapshot.style.transform = 'none'; snapshot.style.opacity = '1';
      transition = 0; canvas.style.transform = 'translateX(-48px)'; canvas.style.opacity = '0';
    }
    index = next; elapsed = paused ? 2.2 : 0;
    view.setMode('solid'); view.setModel(models[index]); renderModel();
    buttons.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    onChange();
  }
  listen(pause, 'click', () => {
    paused = !paused; pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-label', paused ? 'Play preset slideshow' : 'Pause preset slideshow');
  });
  import('./prepared-presets.json').then(({ default: prepared }) => {
    if (disposed) return;
    models = prepared;
    models.forEach((model, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.preset = i; button.textContent = `0${i + 1}`;
      button.setAttribute('aria-label', `Show ${model.name}`); button.setAttribute('aria-pressed', String(i === 0));
      listen(button, 'click', () => select(i)); buttons.append(button);
    });
    view.setModel(models[0]); renderModel(); onChange();
  }).catch(error => { if (!disposed) onError(error); });
  return {
    get ready() { return models.length > 0; },
    get name() { return models[index]?.name || 'Loading villas'; },
    get modeLabel() { return { solid: 'Solid', edges: 'Wireframe', transparent: 'Transparent' }[view.mode]; },
    render(delta, active) {
      if (motion.matches && document.activeElement === pause) buttons.children[index]?.focus({ preventScroll: true });
      pause.hidden = motion.matches;
      if (motion.matches && transition !== null) finish();
      if (active && models.length && !motion.matches && !paused) {
        elapsed += delta;
        if (elapsed >= 9) {
          const remaining = elapsed % 9;
          select((index + Math.floor(elapsed / 9)) % models.length);
          elapsed = remaining;
        }
      }
      if (active && transition !== null) {
        transition = Math.min(1, transition + delta / .85);
        const eased = 1 - (1 - transition) ** 3;
        snapshot.style.transform = `translateX(${48 * eased}px)`; snapshot.style.opacity = String(1 - eased);
        canvas.style.transform = `translateX(${-48 * (1 - eased)}px)`; canvas.style.opacity = String(eased);
        if (transition === 1) finish();
      }
      renderModel();
    },
    dispose() { disposed = true; events.abort(); finish(); buttons.replaceChildren(); },
  };
}
