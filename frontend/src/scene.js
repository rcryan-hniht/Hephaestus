import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The building is a study model, not a reconstruction of an uploaded file.
export class SceneView {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#104ab2');
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 32;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.02;
    this.controls.enabled = false;
    this.controls.enablePan = true;
    this.scene.add(new THREE.HemisphereLight('#f6f1df', '#6385bb', 2.6));
    const sun = new THREE.DirectionalLight('#fff8e8', 3.1);
    sun.position.set(-8, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 45 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.materials = {
      paper: new THREE.MeshStandardMaterial({ color: '#e7e2d3', roughness: 1 }),
      wall: new THREE.MeshStandardMaterial({ color: '#e6e9e4', roughness: .95 }),
      slab: new THREE.MeshStandardMaterial({ color: '#d4dfdf', roughness: .95 }),
      blue: new THREE.MeshStandardMaterial({ color: '#426993', roughness: .8 }),
      glass: new THREE.MeshStandardMaterial({ color: '#7d9eab', roughness: .4, metalness: .1, transparent: true, opacity: .7 }),
      green: new THREE.MeshStandardMaterial({ color: '#496853', roughness: 1, flatShading: true }),
      bark: new THREE.MeshStandardMaterial({ color: '#6e7161', roughness: 1 }),
      edge: new THREE.LineBasicMaterial({ color: '#30567d', transparent: true, opacity: .38 }),
    };
    this.build();
    this.reset();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.onKey = event => {
      if (!this.controls.enabled) return;
      const offset = this.camera.position.clone().sub(this.controls.target);
      const angle = { ArrowLeft: -.13, ArrowRight: .13 }[event.key];
      if (angle !== undefined) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      else if (['+', '='].includes(event.key)) offset.multiplyScalar(.9);
      else if (event.key === '-') offset.multiplyScalar(1.1);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + (event.key === 'ArrowUp' ? -.1 : .1), .02, Math.PI * .46);
        offset.setFromSpherical(spherical);
      } else return;
      event.preventDefault();
      offset.clampLength(this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    };
    canvas.addEventListener('keydown', this.onKey);
  }

  box(parent, size, position, material, edges = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), this.materials.edge));
    return mesh;
  }

  build() {
    const { paper, wall, slab, blue, glass, green, bark } = this.materials;
    this.box(this.scene, [80, .2, 80], [0, -.23, 0], new THREE.MeshBasicMaterial({ color: '#104ab2' }), false);
    const sheet = this.box(this.scene, [13.6, .025, 11.8], [0, -.085, 0], paper);
    sheet.rotation.y = -.12;
    const plan = document.createElement('canvas');
    plan.width = 1536; plan.height = 1280;
    const ctx = plan.getContext('2d');
    ctx.fillStyle = '#e9e5d9'; ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.strokeStyle = '#6f889826'; ctx.lineWidth = 1;
    for (let x = 40; x < 1536; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1280); ctx.stroke(); }
    for (let y = 40; y < 1280; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1536, y); ctx.stroke(); }
    ctx.strokeStyle = '#52749280'; ctx.lineWidth = 2;
    ctx.strokeRect(80, 90, 1376, 1090);
    ctx.strokeRect(190, 220, 1156, 840);
    ctx.strokeRect(390, 330, 660, 625);
    ctx.strokeRect(550, 480, 340, 320);
    ctx.setLineDash([8, 7]); ctx.strokeRect(300, 250, 840, 790); ctx.setLineDash([]);
    for (let x = 390; x <= 1050; x += 110) {
      ctx.beginPath(); ctx.moveTo(x, 280); ctx.lineTo(x, 320); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(370, 300); ctx.lineTo(1070, 300); ctx.stroke();
    ctx.fillStyle = '#527492'; ctx.font = '14px monospace';
    ctx.fillText('HEPHAESTUS / COURTYARD STUDY', 100, 125);
    ctx.fillText('CONCEPT 001 — NOT TO SCALE', 1050, 1140);
    this.planTexture = new THREE.CanvasTexture(plan);
    this.planTexture.colorSpace = THREE.SRGBColorSpace;
    const planMesh = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 11.7), new THREE.MeshStandardMaterial({ map: this.planTexture, roughness: 1 }));
    planMesh.rotation.x = -Math.PI / 2;
    planMesh.rotation.z = .12;
    planMesh.position.y = -.064;
    planMesh.receiveShadow = true;
    this.scene.add(planMesh);

    this.arch = new THREE.Group();
    this.scene.add(this.arch);
    const ring = (y, height, material) => {
      this.box(this.arch, [1.35, height, 5.6], [-2.18, y, 0], material);
      this.box(this.arch, [1.35, height, 5.6], [2.18, y, 0], material);
      this.box(this.arch, [3, height, 1.2], [0, y, -2.2], material);
      this.box(this.arch, [3, height, 1.2], [0, y, 2.2], material);
    };
    ring(.06, .12, slab);
    // Five floors around an open courtyard, with separate structural pieces.
    for (let floor = 0; floor < 5; floor++) {
      const base = floor * 1.15;
      ring(base + 1.15, .14, slab);
      for (const x of [-2.72, -1.5, 1.5, 2.72]) {
        for (const z of [-2.63, 2.63]) this.box(this.arch, [.14, 1.02, .14], [x, base + .58, z], wall);
      }
      for (const x of [-2.78, 2.78]) {
        for (let panel = 0; panel < 5; panel++) {
          const z = -2.12 + panel * 1.05;
          const solid = (floor + panel) % 3 === 0;
          this.box(this.arch, [.1, .98, 1.01], [x, base + .62, z], solid ? wall : glass);
          this.box(this.arch, [.12, 1.03, .045], [x, base + .62, z + .51], blue, false);
        }
      }
      for (const z of [-2.73, 2.73]) {
        for (let panel = 0; panel < 5; panel++) {
          const x = -2.22 + panel * 1.11;
          this.box(this.arch, [1.04, floor === 0 ? .8 : .58, .08], [x, base + .65, z], glass);
          if (floor > 0) this.box(this.arch, [1.07, .28, .1], [x, base + .26, z], wall);
        }
      }
      for (const x of [-1.51, 1.51]) this.box(this.arch, [.08, .42, 3.1], [x, base + .89, 0], wall);
      for (const z of [-1.6, 1.6]) this.box(this.arch, [3, .42, .08], [0, base + .89, z], wall);
      if (floor > 0) {
        this.box(this.arch, [6.15, .12, .6], [0, base + .08, 2.99], slab);
        this.box(this.arch, [6.12, .045, .045], [0, base + .64, 3.24], blue);
        for (let x = -3; x <= 3; x += .4) this.box(this.arch, [.025, .53, .025], [x, base + .36, 3.24], blue, false);
      }
    }
    ring(5.91, .32, wall);
    this.box(this.arch, [1.2, .65, 1.25], [-2, 6.08, -1.85], wall);
    this.box(this.arch, [2.8, .08, 2.9], [0, .12, 0], paper);
    for (const [x, z, scale] of [[-4.2, 2.8, 1], [4.4, 2.4, .85], [-3.9, -3.7, .8], [4.5, -3.4, 1.05], [.2, .1, .7]]) {
      const group = new THREE.Group();
      group.position.set(x, 0, z); group.scale.setScalar(scale);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.05, .08, .95, 7), bark);
      trunk.position.y = .46; trunk.castShadow = true; group.add(trunk);
      for (const [px, py, pz, radius] of [[0, 1.25, 0, .62], [.32, 1.08, .15, .43], [-.33, 1.05, -.1, .45]]) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), green);
        crown.position.set(px, py, pz); crown.scale.y = .8; crown.castShadow = true; group.add(crown);
      }
      this.scene.add(group);
    }
    // Small drawing tools retain the tabletop setting when the camera moves in.
    this.box(this.scene, [.07, .07, 4.8], [6.35, -.015, -.8], blue);
    const notes = this.box(this.scene, [2.2, .03, 1.55], [-5.2, -.02, -4.8], paper);
    notes.rotation.y = -.24;
  }

  reset() {
    this.planView = false;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(12.6, 11.8, 15.5);
    this.controls.target.set(0, 2.25, 0);
    this.controls.update();
  }

  togglePlan() {
    if (this.planView) { this.reset(); return false; }
    this.planView = true;
    this.camera.position.set(0, 23, .1);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    return true;
  }

  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  render(progress, active) {
    this.arch.scale.y = .02 + .98 * progress;
    this.controls.enabled = active;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.onKey);
    const geometries = new Set(), materials = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
      object.shadow?.map?.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.planTexture.dispose();
    this.renderer.dispose();
  }
}
