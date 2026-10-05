import * as THREE from "three";

/**
 * One `progress` value (0 = thumbnail, 1 = full scene) drives every
 * reveal effect: edge opacity, detail-mesh scale/opacity, shadow
 * strength, camera distance. No independent animations.
 */

const P = {
  page: "#ffffff",
  text: "#575279",
  subtle: "#797593",
  iris: "#907aa9",
  irisSoft: "#c4a7e7",
  pine: "#286983",
  love: "#eb6f92",
  gold: "#ea9d34",
  overlay: "#f2e9e1",
  base: "#191724",
};

/** 3-step gradient map for MeshToonMaterial */
function gradientMap(steps = 3) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 200 + 55);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  return tex;
}

export class SceneView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {boolean} opts.reducedMotion
   */
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.progress = 0;          // spring position (0..1)
    this.velocity = 0;          // spring velocity
    this.target = 0;            // where the spring is heading
    this.orbiting = false;      // auto-orbit flag
    this.lastInteract = 0;      // ms of last user drag
    this.disposed = false;
    // animated render viewport (px, css units) — the 3D content unfolds
    // together with the card frame instead of spilling behind it
    this._vp = { x: 0, y: 0, w: 0, h: 0 };
    this._size = { w: 0, h: 0 };

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement);
    this._resize();

    this._clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  /** called every frame with (progress, viewportRectInCssPx) */
  onProgress = null;

  /* ── setup ─────────────────────────────────────────────── */

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null; // page grid shows through

    const hemi = new THREE.HemisphereLight(0xffffff, 0xf2e9e1, 1.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 8, 5);
    this.scene.add(key);

    const g = gradientMap(3);
    this._toon = (hex) => new THREE.MeshToonMaterial({ color: hex, gradientMap: g });

    this._buildArchitecture();
  }

  /** flat architectural volumes: slab -> wedge -> wing -> columns -> roof */
  _buildArchitecture() {
    const arch = new THREE.Group();
    this.scene.add(arch);
    this.arch = arch;

    // massing meshes — always present (thumbnail state shows silhouettes)
    const masses = new THREE.Group();
    arch.add(masses);
    this.masses = masses;

    // detail meshes — hidden at thumbnail, revealed by progress
    const details = new THREE.Group();
    arch.add(details);
    this.details = details;

    const mat = {
      slab: this._toon(P.overlay),
      wedge: this._toon(P.pine),
      wing: this._toon(P.iris),
      roof: this._toon(P.base),
      column: this._toon(P.irisSoft),
      window: this._toon(P.love),
      stair: this._toon(P.subtle),
      gold: this._toon(P.gold),
    };

    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    // base slab
    const slab = box(6.4, 0.5, 5, mat.slab);
    slab.position.y = 0.25;
    masses.add(slab);

    // main wedge body (pine)
    const wedge = box(3.6, 2.4, 2.8, mat.wedge);
    wedge.position.set(-0.7, 1.7, 0);
    wedge.rotation.y = 0.06;
    masses.add(wedge);

    // cantilevered wing (iris), overlapping the wedge
    const wing = box(3.4, 1.1, 2.2, mat.wing);
    wing.position.set(1.8, 2.2, 0.4);
    masses.add(wing);

    // roof plane (dark)
    const roof = box(4.2, 0.22, 3.0, mat.roof);
    roof.position.set(-0.7, 3.05, 0);
    roof.rotation.y = 0.06;
    masses.add(roof);

    // ── detail layer: columns, windows, stair, chimney ──────
    this._detailParts = [];

    const addDetail = (obj, { delay = 0 } = {}) => {
      obj.userData.delay = delay;
      obj.scale.setScalar(0.001);
      // collect every material in the subtree so groups work too
      const mats = [];
      obj.traverse((o) => {
        if (o.material) {
          o.material.transparent = true;
          o.material.opacity = 0;
          mats.push(o.material);
        }
      });
      obj.userData.mats = mats;
      details.add(obj);
      this._detailParts.push(obj);
    };

    // piloti columns under the wing
    for (let i = 0; i < 3; i++) {
      const col = box(0.22, 1.7, 0.22, mat.column);
      col.position.set(2.6, 0.9, -0.7 + i * 0.85);
      addDetail(col, { delay: 0.1 * i });
    }

    // window band on the wedge (love accent)
    const win = box(2.6, 0.6, 0.08, mat.window);
    win.position.set(-0.7, 1.8, 1.42);
    win.rotation.y = 0.06;
    addDetail(win, { delay: 0.15 });

    const win2 = box(0.08, 1.4, 1.6, mat.window);
    win2.position.set(-2.56, 1.8, 0);
    addDetail(win2, { delay: 0.3 });

    // outdoor stair stepping down off the slab's front edge
    const stairGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const step = box(1.4, 0.16, 0.34, mat.stair);
      step.position.set(1.6, 0.4 - i * 0.14, 2.7 + i * 0.36);
      stairGroup.add(step);
    }
    addDetail(stairGroup, { delay: 0.25 });

    // gold marker on the roof — a tiny beacon
    const beacon = box(0.18, 0.5, 0.18, mat.gold);
    beacon.position.set(0.9, 3.4, -0.6);
    addDetail(beacon, { delay: 0.45 });

    // ── edges: fade in with progress ─────────────────────────
    this._edges = [];
    const edgeMat = new THREE.LineBasicMaterial({
      color: P.base,
      transparent: true,
      opacity: 0,
    });
    this.edgeMat = edgeMat;
    for (const m of [...masses.children]) {
      const eg = new THREE.EdgesGeometry(m.geometry, 20);
      const ls = new THREE.LineSegments(eg, edgeMat);
      ls.position.copy(m.position);
      ls.rotation.copy(m.rotation);
      // parent to masses so edges follow the massing's scale settle
      masses.add(ls);
      this._edges.push(ls);
    }

    // ── ground shadow (flat blob) ────────────────────────────
    const shadowTex = this._blobTexture();
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 6.2), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.2, 0.01, 0.3);
    arch.add(shadow);
  }

  _blobTexture() {
    const size = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = P.base;
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, size * 0.44, size * 0.34, -0.15, 0, Math.PI * 2);
    ctx.fill();
    // feather edge by drawing scaled-down ellipses at lower alpha
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.ellipse(size / 2, size / 2, size * (0.48 + i * 0.03), size * (0.37 + i * 0.03), -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    // spherical orbit params, animated by progress
    this._cam = {
      theta: -0.55,  // azimuth
      phi: 1.12,     // polar
      radius: 13,    // distance
    };
    this._camTarget = { ...this._cam };
    this._updateCamera();
  }

  _initControls() {
    // lightweight custom orbit: pointer drag + wheel zoom
    const c = this.canvas;
    this._onDown = (e) => {
      c.setPointerCapture(e.pointerId);
      this._drag = { x: e.clientX, y: e.clientY, theta: this._cam.theta, phi: this._cam.phi };
      this.lastInteract = performance.now();
    };
    this._onMove = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._cam.theta = this._drag.theta - dx * 0.006;
      this._cam.phi = THREE.MathUtils.clamp(this._drag.phi - dy * 0.005, 0.35, 1.45);
      this.lastInteract = performance.now();
    };
    this._onUp = () => { this._drag = null; };
    this._onWheel = (e) => {
      e.preventDefault();
      this._cam.radius = THREE.MathUtils.clamp(this._cam.radius + e.deltaY * 0.01, 8, 30);
      this.lastInteract = performance.now();
    };

    c.addEventListener("pointerdown", this._onDown);
    c.addEventListener("pointermove", this._onMove);
    c.addEventListener("pointerup", this._onUp);
    c.addEventListener("pointercancel", this._onUp);
    c.addEventListener("wheel", this._onWheel, { passive: false });
  }

  /* ── public API ────────────────────────────────────────── */

  /** start the spring toward 1 (open) or 0 (closed) */
  open() {
    this.target = 1;
    if (this.reducedMotion) {
      this.progress = 1;
      this.velocity = 0;
      this._applyProgress();
    }
  }

  close() {
    this.target = 0;
    if (this.reducedMotion) {
      this.progress = 0;
      this.velocity = 0;
      this._applyProgress();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this._onDown);
    c.removeEventListener("pointermove", this._onMove);
    c.removeEventListener("pointerup", this._onUp);
    c.removeEventListener("pointercancel", this._onUp);
    c.removeEventListener("wheel", this._onWheel);

    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.edgeMat.dispose();
    this.renderer.dispose();
  }

  /* ── internals ─────────────────────────────────────────── */

  _resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this._size = { w, h };
    this.renderer.setSize(w, h, false);
    this._applyViewport();
    this._updateCamera();
  }

  /**
   * The render viewport grows from a centered 300×225 card to the full
   * canvas, driven by the same spring progress as every other reveal.
   */
  _applyViewport() {
    const { w, h } = this._size;
    if (!w || !h) return;
    const p = THREE.MathUtils.clamp(this.progress, 0, 1);
    const e = p * p * (3 - 2 * p);
    const tw = Math.min(300, w - 24);
    const th = tw * 0.75;
    const vw = THREE.MathUtils.lerp(tw, w, e);
    const vh = THREE.MathUtils.lerp(th, h, e);
    this._vp = { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
  }

  _updateCamera() {
    const { theta, phi, radius } = this._cam;
    const p = THREE.MathUtils.clamp(this.progress, 0, 1);
    // camera framing follows the render viewport, not the canvas
    const aspect = this._vp.w ? this._vp.w / this._vp.h : 1;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // thumbnail: closer, higher; full: pulled back
    const dist = radius * THREE.MathUtils.lerp(0.9, 1, p);
    const y = radius * Math.cos(phi);
    const planar = Math.sqrt(Math.max(0, dist * dist - y * y));
    this.camera.position.set(
      Math.sin(theta) * planar,
      y,
      Math.cos(theta) * planar
    );
    this.camera.lookAt(0, THREE.MathUtils.lerp(1.2, 1.6, p), 0);
  }

  _applyProgress() {
    const p = this.progress;
    const ease = (t) => t * t * (3 - 2 * t); // smoothstep for effects

    this._applyViewport();

    // edges fade in
    this.edgeMat.opacity = 0.75 * ease(p);

    // details pop in staggered by their delay
    for (const mesh of this._detailParts) {
      const d = mesh.userData.delay ?? 0;
      const local = THREE.MathUtils.clamp((p - d) / (1 - d), 0, 1);
      const s = ease(local);
      mesh.scale.setScalar(Math.max(0.001, s));
      for (const m of mesh.userData.mats) m.opacity = s;
    }

    // shadow deepens
    this.shadowMat.opacity = THREE.MathUtils.lerp(0.16, 0.42, ease(p));

    // masses subtly settle: slight scale-down from thumbnail to full
    const ms = THREE.MathUtils.lerp(1.06, 1, ease(p));
    this.masses.scale.setScalar(ms);

    this._updateCamera();
  }

  _stepSpring(dt) {
    if (this.reducedMotion) return;
    // damped spring with mild overshoot
    const k = 90;
    const damping = 13;
    const force = (this.target - this.progress) * k - this.velocity * damping;
    this.velocity += force * dt;
    this.progress += this.velocity * dt;
    this.progress = THREE.MathUtils.clamp(this.progress, -0.2, 1.2);
    if (Math.abs(this.velocity) < 0.0005 && Math.abs(this.target - this.progress) < 0.0005) {
      this.progress = this.target;
      this.velocity = 0;
    }
  }

  _stepOrbit(dt, now) {
    if (this.reducedMotion || !this.orbiting) return;
    if (this.progress < 0.95) return; // orbit only after the reveal completes
    if (this._drag || now - this.lastInteract < 2000) return;
    this._cam.theta += 0.05 * dt; // very slow
  }

  _loop() {
    if (this.disposed) return;
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const now = performance.now();

    this._stepSpring(dt);
    this._stepOrbit(dt, now);

    // only re-apply when moving
    if (this.progress !== this._lastApplied) {
      this._applyProgress();
      this._lastApplied = this.progress;
    } else {
      this._updateCamera();
    }

    if (this.onProgress) this.onProgress(this.progress, this._vp);

    // scissor: render only inside the animated viewport window
    const pr = this.renderer.getPixelRatio();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(
      this._vp.x * pr,
      (this._size.h - this._vp.y - this._vp.h) * pr,
      this._vp.w * pr,
      this._vp.h * pr
    );
    this.renderer.setViewport(
      this._vp.x * pr,
      (this._size.h - this._vp.y - this._vp.h) * pr,
      this._vp.w * pr,
      this._vp.h * pr
    );
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._loop);
  }
}
