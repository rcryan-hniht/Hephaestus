import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneView {
  constructor(canvas, { reducedMotion = false, onSelect = () => {}, onMeasure = () => {} } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect; this.onMeasure = onMeasure;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#F0F0F0');
    this.perspective = new THREE.PerspectiveCamera(35, 1, .1, 2000);
    this.orthographic = new THREE.OrthographicCamera(-15, 15, 15, -15, .1, 2000);
    this.camera = this.perspective;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = .09;
    this.controls.maxPolarAngle = Math.PI * .495;
    this.controls.enabled = false;
    this.needsRender = true;
    this.controls.addEventListener('change', () => { this.needsRender = true; });
    this.controls.addEventListener('start', () => { this.interacted = true; });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8b8b81, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(-15, 28, 18); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = .06;
    this.scene.add(light); this.light = light;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    this.raycaster = new THREE.Raycaster();
    this.meshes = []; this.mode = 'solid'; this.hiddenTypes = new Set(); this.floor = 'all';
    this.abort = new AbortController();
    const listen = (name, fn) => canvas.addEventListener(name, fn, { signal: this.abort.signal });
    listen('pointerdown', e => { this.down = { x: e.clientX, y: e.clientY }; });
    listen('pointerup', e => {
      if (!this.controls.enabled || !this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const hit = this.raycaster.intersectObjects(this.meshes.filter(m => m.visible), false).find(h => !this.section || this.clip.distanceToPoint(h.point) >= 0);
      if (this.measuring && hit) {
        if (!this.measureStart) { this.measureStart = hit.point.clone(); this.onMeasure('Chọn điểm thứ hai trên mô hình.'); }
        else { this.onMeasure(`${this.measureStart.distanceTo(hit.point).toFixed(2)} m`); this.measureStart = null; }
      } else this.select(hit?.object.userData.id || null);
    });
    listen('keydown', e => {
      if (!this.controls.enabled) return;
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (e.key === 'Escape') { this.select(null); return; }
      if (['+', '=', '-'].includes(e.key)) {
        const factor = e.key === '-' ? 1.1 : .9;
        if (this.camera.isOrthographicCamera) { this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom / factor, .2, 20); this.camera.updateProjectionMatrix(); }
        else offset.multiplyScalar(factor).clampLength(this.controls.minDistance, this.controls.maxDistance);
      } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), e.key === 'ArrowLeft' ? -.1 : .1);
      else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        const s = new THREE.Spherical().setFromVector3(offset); s.phi = THREE.MathUtils.clamp(s.phi + (e.key === 'ArrowUp' ? -.1 : .1), .02, Math.PI * .495); offset.setFromSpherical(s);
      } else return;
      e.preventDefault(); this.camera.position.copy(this.controls.target).add(offset); this.controls.update();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  clear() {
    this.group.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.group.clear(); this.meshes = [];
  }

  setModel(model, fit = true) {
    this.clear(); this.buildProgress = undefined; this.needsRender = true; this.renderer.shadowMap.needsUpdate = true; this.model = model; this.selected = null; this.measureStart = null;
    const points = model.components.flatMap(c => c.polygon);
    const box = new THREE.Box3(); points.forEach(([x, z]) => box.expandByPoint(new THREE.Vector3(x, 0, z)));
    const origin = !fit && this.origin ? this.origin : box.getCenter(new THREE.Vector3());
    this.origin = origin;
    for (const c of model.components) {
      const shape = new THREE.Shape(c.polygon.map(([x, z]) => new THREE.Vector2(x - origin.x, -(z - origin.z))));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: c.height, bevelEnabled: false, steps: 1 });
      geometry.rotateX(-Math.PI / 2);
      const color = { wall: '#dfdfd8', slab: '#c6c6bf', roof: '#e6e6df', column: '#f7f7f2', window: '#85928f' }[c.type];
      const material = new THREE.MeshStandardMaterial({ color, roughness: .85, side: THREE.DoubleSide, transparent: c.type === 'window', opacity: c.type === 'window' ? .5 : 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = c.elevation;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { ...c, baseColor: color, sourceUnit: 'm' };
      mesh.name = c.id;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: '#535650', transparent: true, opacity: .28 }));
      edge.name = 'edges'; mesh.add(edge);
      this.group.add(mesh); this.meshes.push(mesh);
    }
    this.bounds = new THREE.Box3().setFromObject(this.group);
    const size = this.bounds.getSize(new THREE.Vector3());
    this.span = Math.max(size.x, size.y, size.z, 1);
    const shadow = this.light.shadow.camera;
    Object.assign(shadow, { left: -this.span, right: this.span, top: this.span, bottom: -this.span, far: this.span * 6 }); shadow.updateProjectionMatrix();
    this.light.position.set(-this.span, this.span * 2, this.span);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(this.span * 4, this.span * 4), new THREE.ShadowMaterial({ opacity: .09 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.04; ground.receiveShadow = true; ground.name = 'ground'; this.group.add(ground);
    this.controls.minDistance = this.span * .25; this.controls.maxDistance = this.span * 6;
    this.perspective.far = this.span * 20; this.orthographic.far = this.span * 20;
    this.setMode(this.mode); this.setVisibility(this.floor, this.hiddenTypes); this.setSection(this.sectionValue ?? 100);
    if (fit) this.setCamera('perspective');
  }

  setCamera(view = 'perspective') {
    if (!this.bounds) return;
    this.viewName = view;
    this.camera = view === 'perspective' ? this.perspective : this.orthographic;
    this.controls.object = this.camera;
    this.camera.up.set(0, 1, 0); this.camera.zoom = 1;
    const center = this.bounds.getCenter(new THREE.Vector3());
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const distance = this.span * 2.2 / Math.min(1, aspect);
    if (view === 'plan') { this.camera.up.set(0, 0, -1); this.camera.position.copy(center).add(new THREE.Vector3(0, distance, .001)); }
    else if (view === 'elevation') this.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    else this.camera.position.copy(center).add(new THREE.Vector3(distance * .72, distance * .55, distance * .9));
    this.controls.target.copy(center); this.controls.enableRotate = view === 'perspective';
    this.resize(); this.controls.update();
    if (view === 'perspective') this.homePose = { camera: this.camera.position.clone(), target: center.clone() };
  }

  morphHome(progress) {
    if (!this.homePose) return;
    if (!this.returnPose) this.returnPose = { camera: this.camera.position.clone(), target: this.controls.target.clone() };
    this.camera.position.lerpVectors(this.returnPose.camera, this.homePose.camera, progress);
    this.controls.target.lerpVectors(this.returnPose.target, this.homePose.target, progress);
    this.controls.update(); this.needsRender = true;
  }

  setMode(mode) {
    this.mode = mode; this.needsRender = true;
    this.meshes.forEach(mesh => {
      mesh.material.wireframe = mode === 'edges';
      mesh.material.transparent = mode === 'transparent' || mesh.userData.type === 'window';
      mesh.material.opacity = mode === 'transparent' ? .22 : mesh.userData.type === 'window' ? .5 : 1;
      mesh.material.depthWrite = mode !== 'transparent';
      mesh.material.needsUpdate = true;
    });
  }
  setVisibility(floor, hiddenTypes = this.hiddenTypes) {
    this.needsRender = true; this.renderer.shadowMap.needsUpdate = true;
    this.floor = floor; this.hiddenTypes = new Set(hiddenTypes);
    this.meshes.forEach(m => { m.visible = (floor === 'all' || m.userData.floor === Number(floor)) && !this.hiddenTypes.has(m.userData.type); });
    if (this.selected && !this.meshes.find(m => m.userData.id === this.selected)?.visible) this.select(null);
    this.measureStart = null;
  }
  setSection(value) {
    this.needsRender = true; this.renderer.shadowMap.needsUpdate = true;
    this.sectionValue = Number(value); this.section = this.sectionValue < 100;
    if (!this.bounds) return;
    this.clip.constant = this.bounds.min.y + (this.bounds.max.y - this.bounds.min.y) * this.sectionValue / 100;
    this.meshes.forEach(m => {
      m.material.clippingPlanes = this.section ? [this.clip] : [];
      m.children.forEach(e => { e.material.clippingPlanes = this.section ? [this.clip] : []; });
    });
  }
  select(id) {
    this.selected = id; this.needsRender = true;
    this.meshes.forEach(m => m.material.emissive.set(m.userData.id === id ? '#c45c3d' : '#000000'));
    this.onSelect(this.model?.components.find(c => c.id === id) || null);
  }
  render({ progress = 1, active = false, orbit = false, delta = 0 } = {}) {
    if (this.buildProgress !== progress) {
      this.buildProgress = progress;
      const delays = { column: .08, wall: .18, slab: .42, window: .62, roof: .82 };
      this.meshes.forEach(mesh => {
        const start = delays[mesh.userData.type] || 0;
        const rise = THREE.MathUtils.clamp((progress - start) / (1 - start), .001, 1);
        mesh.scale.y = rise;
        mesh.position.y = mesh.userData.elevation * rise;
        const baseOpacity = this.mode === 'transparent' ? .22 : mesh.userData.type === 'window' ? .5 : 1;
        mesh.material.opacity = baseOpacity * Math.min(1, progress * 5);
        mesh.material.transparent = progress < 1 || this.mode === 'transparent' || mesh.userData.type === 'window';
      });
      this.needsRender = true; this.renderer.shadowMap.needsUpdate = true;
    }
    this.controls.enabled = active;
    if (orbit && !this.interacted) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta * .07);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.controls.update();
    if (this.needsRender) { this.renderer.render(this.scene, this.camera); this.needsRender = false; }
  }
  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false); this.needsRender = true;
    this.perspective.aspect = width / height; this.perspective.updateProjectionMatrix();
    const half = (this.span || 15) * .72;
    this.orthographic.left = -half * Math.max(1, width / height); this.orthographic.right = -this.orthographic.left;
    this.orthographic.top = half * Math.max(1, height / width); this.orthographic.bottom = -this.orthographic.top;
    this.orthographic.updateProjectionMatrix();
  }
  async export() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const output = new THREE.Group(); output.name = this.model.name;
    output.userData = { sample: this.model.sample, unit: 'm', sourceOrigin: this.origin.toArray(), warnings: this.model.warnings };
    this.meshes.forEach(m => {
      const copy = new THREE.Mesh(m.geometry, m.material.clone());
      copy.material.clippingPlanes = []; copy.material.wireframe = false;
      copy.name = m.name; copy.position.copy(m.position); copy.userData = { ...m.userData }; output.add(copy);
    });
    try { return await new GLTFExporter().parseAsync(output, { binary: true }); }
    finally { output.children.forEach(m => m.material.dispose()); }
  }
  dispose() {
    this.abort.abort(); this.resizeObserver.disconnect(); this.controls.dispose(); this.clear();
    this.light.shadow.map?.dispose(); this.renderer.dispose();
  }
}
