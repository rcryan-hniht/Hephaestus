export function createPresetShowcase({ view, canvas, snapshot, controls, motion, onChange, onError }) {
  const events = new AbortController();
  const listen = (el, name, fn) => el.addEventListener(name, fn, { signal: events.signal });
  const host = controls.parentElement;
  let models = [], index = 0, elapsed = 0, transition = null, paused = false, hovered = host.matches(':hover'), disposed = false;
  const pause = controls.querySelector('#preset-pause');
  const buttons = controls.querySelector('.preset-buttons');
  const context = snapshot.getContext('2d');
  function finish() {
    transition = null; snapshot.hidden = true;
    canvas.style.transform = 'none'; canvas.style.opacity = '1';
  }
  function select(next) {
    if (!models.length || next === index) return;
    finish();
    if (!motion.matches) {
      // Capture immediately after rendering; WebGL does not preserve its drawing buffer.
      view.needsRender = true; view.render();
      snapshot.width = canvas.width; snapshot.height = canvas.height;
      context.drawImage(canvas, 0, 0);
      snapshot.hidden = false; snapshot.style.transform = 'none'; snapshot.style.opacity = '1';
      transition = 0; canvas.style.transform = 'translateX(-48px)'; canvas.style.opacity = '0';
    }
    index = next; elapsed = 0;
    view.setModel(models[index]); view.render();
    buttons.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    onChange();
  }
  listen(pause, 'click', () => {
    paused = !paused; pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-label', paused ? 'Play preset slideshow' : 'Pause preset slideshow');
  });
  listen(host, 'pointerenter', () => { hovered = true; });
  listen(host, 'pointerleave', () => { hovered = false; });
  import('./prepared-presets.json').then(({ default: prepared }) => {
    if (disposed) return;
    models = prepared;
    models.forEach((model, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.preset = i; button.textContent = `0${i + 1}`;
      button.setAttribute('aria-label', `Show ${model.name}`); button.setAttribute('aria-pressed', String(i === 0));
      listen(button, 'click', () => select(i)); buttons.append(button);
    });
    view.setModel(models[0]); view.render(); onChange();
  }).catch(error => { if (!disposed) onError(error); });
  return {
    get ready() { return models.length > 0; },
    get name() { return models[index]?.name || 'Loading villas'; },
    render(delta, active) {
      if (motion.matches && document.activeElement === pause) buttons.children[index]?.focus({ preventScroll: true });
      pause.hidden = motion.matches;
      if (motion.matches && transition !== null) finish();
      if (transition !== null) {
        transition = Math.min(1, transition + delta / .85);
        const eased = 1 - (1 - transition) ** 3;
        snapshot.style.transform = `translateX(${48 * eased}px)`; snapshot.style.opacity = String(1 - eased);
        canvas.style.transform = `translateX(${-48 * (1 - eased)}px)`; canvas.style.opacity = String(eased);
        if (transition === 1) finish();
      } else if (active && models.length && !motion.matches && !paused && !hovered && !controls.contains(document.activeElement)) {
        elapsed += delta;
        if (elapsed >= 5.5) select((index + 1) % models.length);
      }
      view.render();
    },
    dispose() { disposed = true; events.abort(); finish(); buttons.replaceChildren(); },
  };
}
