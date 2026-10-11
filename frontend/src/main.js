import './style.css';
import { SceneView } from './scene.js';

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.querySelector('.stage');
const viewport = document.querySelector('.stage__viewport');
const illustration = document.querySelector('.stage__illustration');
const canvas = document.getElementById('canvas');
const enter = document.getElementById('enter-studio');
const reveal = document.getElementById('reveal-model');
const error = document.getElementById('scene-error');
const planButton = document.getElementById('toggle-plan');
const steps = [...document.querySelectorAll('[data-story-step]')];
const scenes = ['studio', 'desk', 'model'];
const labels = ['BÊN TRONG MỘT Ý TƯỞNG', 'NƠI NHỮNG NÉT VẼ BẮT ĐẦU', 'TỪ Ý TƯỞNG ĐẾN HÌNH KHỐI'];
const captions = ['Một buổi chiều. Một bản vẽ. Vô vàn khả năng.', 'Kéo sang phải. Để những nét vẽ trở thành không gian.', 'Mô hình minh họa. Kéo để xoay, cuộn để thu phóng.'];
let current = 0, target = 0, progress = 0, velocity = 0;
let drag = null, view = null, failed = false, frame = 0, previousTime = 0;
const events = new AbortController();
const listen = (element, name, handler) => element.addEventListener(name, handler, { signal: events.signal });

function showError(message) {
  view?.dispose(); view = null; failed = true;
  canvas.hidden = true;
  error.textContent = message;
  error.hidden = current !== 2;
  document.querySelector('.model-tools').hidden = true;
  document.querySelector('.model-card').hidden = true;
}

function prepareModel() {
  if (view || failed) return;
  try { view = new SceneView(canvas, { reducedMotion: motion.matches }); }
  catch (cause) {
    console.warn('WebGL preview unavailable:', cause.message);
    showError('Thiết bị chưa hỗ trợ xem 3D. Bạn vẫn có thể khám phá studio và bản vẽ. Hãy bật tăng tốc đồ họa rồi tải lại trang.');
  }
}

function setScene(index, focus = false) {
  if (drag) { drag = null; stage.classList.remove('is-dragging'); }
  current = index; target = index;
  if (motion.matches) { progress = target; velocity = 0; }
  stage.dataset.scene = scenes[index];
  enter.hidden = index !== 0;
  reveal.hidden = index !== 1;
  document.querySelector('.desk-invitation').hidden = index !== 1;
  document.querySelector('.scene-coordinate').hidden = index === 2;
  document.getElementById('scene-label').textContent = labels[index];
  document.getElementById('caption-text').textContent = captions[index];
  document.getElementById('scene-count').textContent = `0${index + 1} — 03`;
  steps.forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  if (index > 0) prepareModel();
  if (index === 2) { view?.reset(); planButton.setAttribute('aria-pressed', 'false'); }
  canvas.tabIndex = index === 2 && !failed ? 0 : -1;
  error.hidden = !failed || index !== 2;
  document.querySelector('.model-tools').hidden = index !== 2 || failed;
  document.querySelector('.model-card').hidden = index !== 2 || failed;
  if (focus) {
    const control = index === 0 ? enter : index === 1 ? reveal : failed ? steps[1] : canvas;
    if (control === canvas) canvas.hidden = false;
    control.focus({ preventScroll: true });
  }
}

listen(enter, 'click', () => setScene(1, true));
listen(reveal, 'click', () => setScene(2, true));
steps.forEach(button => listen(button, 'click', () => setScene(Number(button.dataset.storyStep))));
document.querySelectorAll('[data-go-studio]').forEach(button => listen(button, 'click', event => {
  event.preventDefault(); setScene(0); enter.focus({ preventScroll: true });
  stage.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'nearest' });
}));
document.querySelectorAll('[data-go-model]').forEach(link => listen(link, 'click', event => {
  event.preventDefault(); setScene(2, true);
  stage.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'nearest' });
}));
listen(document.getElementById('reset-view'), 'click', () => { view?.reset(); planButton.setAttribute('aria-pressed', 'false'); });
listen(planButton, 'click', () => planButton.setAttribute('aria-pressed', String(view?.togglePlan() || false)));
listen(canvas, 'webglcontextlost', event => {
  event.preventDefault();
  showError('Kết nối đồ họa bị gián đoạn. Studio và bản vẽ vẫn sẵn sàng; tải lại trang để xem mô hình 3D.');
});
listen(illustration, 'error', () => {
  error.textContent = 'Ảnh studio chưa tải được. Bạn vẫn có thể dùng các bước bên dưới để mở mô hình mẫu.';
  error.hidden = false;
});

listen(viewport, 'pointerdown', event => {
  const fromHandle = current === 1 && reveal.contains(event.target);
  if (event.button !== 0 || current === 2 || (event.target.closest('button, a') && !fromHandle)) return;
  drag = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false, horizontal: 0, fromHandle };
  viewport.setPointerCapture(event.pointerId);
});
listen(viewport, 'pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.hypot(dx, dy) > 7;
  drag.horizontal = Math.abs(dx) > Math.abs(dy) ? Math.max(0, dx) : 0;
  if (current !== 1) return;
  stage.classList.toggle('is-dragging', drag.moved);
  target = 1 + Math.min(drag.horizontal / (viewport.clientWidth * .38), 1);
  if (motion.matches) { progress = target; velocity = 0; }
});
listen(viewport, 'pointerup', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const finish = drag; drag = null;
  viewport.releasePointerCapture(event.pointerId);
  stage.classList.remove('is-dragging');
  if (current === 0 && !finish.moved) setScene(1, true);
  else if (current === 1) setScene((finish.fromHandle && !finish.moved) || finish.horizontal > viewport.clientWidth * .18 ? 2 : 1);
});
const cancelDrag = () => { if (drag) { drag = null; target = current; stage.classList.remove('is-dragging'); } };
listen(viewport, 'pointercancel', cancelDrag);
listen(viewport, 'lostpointercapture', cancelDrag);
listen(motion, 'change', () => {
  if (motion.matches) { progress = target; velocity = 0; }
  if (view) view.controls.enableDamping = !motion.matches;
});

function animate(time) {
  const dt = Math.min((time - (previousTime || time)) / 1000, .05);
  previousTime = time;
  if (motion.matches) progress = target;
  else {
    velocity += ((target - progress) * 105 - velocity * 20) * dt;
    progress += velocity * dt;
    if (Math.abs(progress - target) < .0001 && Math.abs(velocity) < .001) { progress = target; velocity = 0; }
  }
  const desk = Math.min(1, Math.max(0, progress));
  const model = Math.min(1, Math.max(0, progress - 1));
  illustration.style.transform = `scale(${1 + desk * .22 + model * .2}) translate(${-desk * 3}%, ${desk * 10}%)`;
  illustration.style.opacity = failed ? '1' : String(1 - model);
  canvas.hidden = model <= .001 || failed;
  canvas.style.opacity = String(model);
  if (view && model > .001 && !document.hidden) view.render(model, current === 2 && model > .99);
  reveal.style.setProperty('--drag-progress', model);
  frame = requestAnimationFrame(animate);
}
frame = requestAnimationFrame(animate);
function dispose() { cancelAnimationFrame(frame); events.abort(); view?.dispose(); }
if (import.meta.hot) import.meta.hot.dispose(dispose);
listen(window, 'pagehide', event => { if (!event.persisted) dispose(); });
