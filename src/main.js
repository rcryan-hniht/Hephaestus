import "./style.css";
import { SceneView } from "./scene.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const stage = document.querySelector(".stage");
const thumb = document.querySelector(".stage__thumb");
const canvas = document.getElementById("canvas");
const caption = document.getElementById("caption-text");
const openButtons = document.querySelectorAll("[data-open-scene]");

const view = new SceneView(canvas, { reducedMotion });

// the card frame follows the same spring as the 3D scissor window,
// so the model unfolds out of the card instead of behind it
view.onProgress = (p, vp) => {
  const e = Math.min(Math.max(p, 0), 1);
  thumb.style.left = `${vp.x}px`;
  thumb.style.top = `${vp.y}px`;
  thumb.style.width = `${vp.w}px`;
  thumb.style.height = `${vp.h}px`;
  thumb.style.borderRadius = `${(1 - e) * 10}px`;
  thumb.style.opacity = `${1 - e * e}`;
  // shadow grows with the card, per the style spec
  const s = 2 + e * 18;
  const a = 0.08 + e * 0.1;
  thumb.style.boxShadow = `0 ${s * 0.25}px ${s}px rgba(25, 23, 36, ${a})`;
};

let isOpen = false;

function openScene() {
  if (isOpen) return;
  isOpen = true;
  stage.classList.add("is-open");
  thumb.classList.add("is-open");
  view.open();
  view.orbiting = !reducedMotion;
  caption.textContent = "left-drag to orbit — scroll to zoom";
  canvas.focus({ preventScroll: true });
}

openButtons.forEach((b) => b.addEventListener("click", openScene));
