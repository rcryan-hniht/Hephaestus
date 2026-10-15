export function presetState(seconds) {
  const progress = Math.max(0, Math.min(1, (seconds - 1) / 2, (36 - seconds) / 3));
  const mode = seconds < 13 ? 'solid' : seconds < 23 ? 'edges' : 'transparent';
  const label = seconds < 1 ? 'Drawing' : seconds < 3 ? 'Building' : seconds >= 33 ? 'Returning to drawing'
    : { solid: 'Solid', edges: 'Wireframe', transparent: 'Transparent' }[mode];
  return { progress, tilt: progress, mode, label, rotation: Math.max(0, Math.min(30, seconds - 3)) * 12 };
}

export function createPresetShowcase({ view, canvas, snapshot, motion, onChange, onError }) {
  let models = [], index = 0, elapsed = 0, transition = null, disposed = false, label = 'Drawing';
  const context = snapshot.getContext('2d');
  function finish() {
    transition = null; snapshot.hidden = true;
    canvas.style.transform = 'none'; canvas.style.opacity = '1';
  }
  function renderModel() {
    if (!models.length) return;
    const state = presetState(elapsed), mode = motion.matches ? 'solid' : state.mode;
    const nextLabel = motion.matches ? 'Solid' : state.label;
    if (view.mode !== mode || label !== nextLabel) {
      if (view.mode !== mode) view.setMode(mode);
      label = nextLabel; onChange();
    }
    if (!motion.matches) {
      const offset = view.homePose.camera.clone().sub(view.homePose.target);
      const angle = (-27 + state.rotation) * Math.PI / 180;
      offset.applyAxisAngle(view.camera.up, angle - Math.atan2(offset.x, offset.z));
      const top = offset.clone().set(0, offset.length(), offset.length() * .03);
      offset.lerpVectors(top, offset.clone(), state.tilt * state.tilt * (3 - 2 * state.tilt));
      view.camera.position.copy(view.homePose.target).add(offset); view.controls.update();
    }
    view.render({ progress: motion.matches ? 1 : state.progress, stagger: true });
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
      transition = 0; canvas.style.opacity = '0';
    }
    index = next; elapsed = 0;
    view.setMode('solid'); view.setModel(models[index]); renderModel();
    onChange();
  }
  import('./prepared-presets.json').then(({ default: prepared }) => {
    if (disposed) return;
    models = prepared;
    view.setModel(models[0]); renderModel(); onChange();
  }).catch(error => { if (!disposed) onError(error); });
  return {
    get ready() { return models.length > 0; },
    get name() { return models[index]?.name || 'Loading villas'; },
    get modeLabel() { return label; },
    render(delta, active) {
      if (motion.matches && transition !== null) finish();
      if (active && models.length && !motion.matches) {
        elapsed += delta;
        if (elapsed >= 36) {
          const remaining = elapsed % 36;
          select((index + Math.floor(elapsed / 36)) % models.length);
          elapsed = remaining;
        }
      }
      if (active && transition !== null) {
        transition = Math.min(1, elapsed);
        const eased = 1 - (1 - transition) ** 3;
        snapshot.style.opacity = String(1 - eased);
        canvas.style.opacity = String(eased);
        if (transition === 1) finish();
      }
      renderModel();
    },
    dispose() { disposed = true; finish(); },
  };
}
