import "./style.css";
import { SceneView } from "./scene.js";
import { GlassPreview } from "./glass.js";

const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const stage = document.querySelector(".stage");
const thumb = document.querySelector(".stage__thumb");
const canvas = document.getElementById("canvas");
const glassCanvas = document.getElementById("glass");
const caption = document.getElementById("caption-text");
const openButtons = document.querySelectorAll("[data-open-scene]");
const tools = document.querySelector(".stage__tools");
const orbitButton = document.getElementById("toggle-orbit");
const nav = document.querySelector(".nav");
const menuButton = document.querySelector(".nav__menu");
let view, glass, isOpen = false;
let previewDrag = null;
let previewMoved = false;

thumb.addEventListener("pointerdown", (event) => {
  if (!glass || isOpen) return;
  previewMoved = false;
  previewDrag = { x: event.clientX, y: event.clientY, distance: 0 };
  thumb.setPointerCapture(event.pointerId);
});
thumb.addEventListener("pointermove", (event) => {
  if (!previewDrag || !glass) return;
  const dx = event.clientX - previewDrag.x;
  const dy = event.clientY - previewDrag.y;
  previewDrag.distance += Math.abs(dx) + Math.abs(dy);
  previewMoved = previewDrag.distance > 5;
  glass.cube.rotation.y += dx * 0.008;
  glass.cube.rotation.x += dy * 0.008;
  glass.dirty = true;
  previewDrag.x = event.clientX;
  previewDrag.y = event.clientY;
});
thumb.addEventListener("pointerup", () => { previewDrag = null; });
thumb.addEventListener("pointercancel", () => { previewDrag = null; previewMoved = true; });

function setMenu(open) {
  nav.classList.toggle("menu-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
}
menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
nav.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { setMenu(false); menuButton.focus(); }
});
nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));

function setOrbit(enabled) {
  view.orbiting = enabled && !motionPreference.matches;
  orbitButton.setAttribute("aria-pressed", String(view.orbiting));
  orbitButton.textContent = view.orbiting ? "Dừng tự xoay" : "Tự xoay";
  orbitButton.disabled = motionPreference.matches;
  orbitButton.title = motionPreference.matches ? "Đã tắt theo tùy chọn giảm chuyển động" : "";
}

function setOpen(open) {
  if (!view || isOpen === open) return;
  isOpen = open;
  stage.classList.toggle("is-open", open);
  thumb.disabled = open;
  thumb.tabIndex = open ? -1 : 0;
  tools.hidden = !open;
  canvas.tabIndex = open ? 0 : -1;
  document.getElementById("view-label").textContent = open ? "Mô hình kiến trúc mẫu" : "Từ ý tưởng đến hình khối";
  caption.textContent = open ? "Kéo để xoay / Cuộn để thu phóng" : "Mở để khám phá mô hình kiến trúc mẫu";
  setOrbit(open);
  if (open) {
    view.open();
    canvas.focus({ preventScroll: true });
    setMenu(false);
  } else {
    view.close();
    thumb.style.visibility = "visible";
    thumb.focus({ preventScroll: true });
  }
}

function showError() {
  view?.dispose();
  glass?.dispose();
  view = glass = null;
  const error = document.getElementById("scene-error");
  error.textContent = "Không thể mở không gian 3D. Hãy bật tăng tốc đồ họa hoặc thử trình duyệt hỗ trợ WebGL.";
  error.hidden = false;
  thumb.hidden = true;
  tools.hidden = true;
  glassCanvas.hidden = canvas.hidden = true;
  document.querySelector(".stage__intro").hidden = true;
  caption.textContent = "Không gian 3D chưa khả dụng";
  openButtons.forEach((button) => {
    if (button.tagName === "BUTTON") button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  });
}

try {
  view = new SceneView(canvas, { reducedMotion: motionPreference.matches });
  glass = new GlassPreview(glassCanvas);
  view.onProgress = (p, vp, dt) => {
    const progress = Math.min(Math.max(p, 0), 1);
    thumb.style.left = `${vp.x}px`;
    thumb.style.top = `${vp.y}px`;
    thumb.style.width = `${vp.w}px`;
    thumb.style.height = `${vp.h}px`;
    thumb.style.borderRadius = `${12 * (1 - progress)}px`;
    thumb.style.opacity = `${1 - progress}`;
    thumb.style.visibility = progress === 1 ? "hidden" : "visible";
    canvas.style.opacity = `${progress}`;
    glassCanvas.style.opacity = `${1 - progress}`;
    if (progress < 1) glass.render(dt, !motionPreference.matches && !document.hidden && !previewDrag);
  };
  caption.textContent = "Mở để khám phá mô hình kiến trúc mẫu";
} catch (error) {
  console.error("Không thể khởi tạo 3D:", error);
  showError();
}

openButtons.forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  if (button === thumb && previewMoved && event.detail > 0) {
    previewMoved = false;
    return;
  }
  setOpen(true);
}));
document.getElementById("close-scene").addEventListener("click", () => setOpen(false));
document.getElementById("reset-view").addEventListener("click", () => view?.reset());
orbitButton.addEventListener("click", () => { if (view) setOrbit(!view.orbiting); });

const onMotionChange = () => {
  if (!view) return;
  view.reducedMotion = motionPreference.matches;
  if (isOpen) view.open(); else view.close();
  setOrbit(false);
};
motionPreference.addEventListener("change", onMotionChange);
for (const element of [canvas, glassCanvas]) {
  element.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    showError();
  });
}
function dispose() {
  view?.dispose();
  glass?.dispose();
  motionPreference.removeEventListener("change", onMotionChange);
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener("pagehide", (event) => { if (!event.persisted) dispose(); });
