import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { backendGeometry } from './backend-model.js';

export function presetGeometry(component, origin) {
  const minX = Math.min(...component.polygon.map(p => p[0])), minZ = Math.min(...component.polygon.map(p => p[1]));
  const depth = Math.max(...component.polygon.map(p => p[1])) - minZ;
  const profileHeight = Math.max(...component.profile.map(p => p[1]));
  const shape = new THREE.Shape(component.profile.map(([x,y]) => new THREE.Vector2(x + minX - origin.x, y * component.height / profileHeight)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, minZ - origin.z);
  return geometry;
}

function createBlueprintTexture(model, origin, span) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  const size = Math.max(span * 2.2, 16);
  const toCanvas = (wx, wz) => [1024 + (wx / (size / 2)) * 1024, 1024 + (wz / (size / 2)) * 1024];

  // Warm drafting paper background
  ctx.fillStyle = '#fafaf7';
  ctx.fillRect(0, 0, 2048, 2048);

  // Outer drafting border
  ctx.strokeStyle = '#cfcfc4'; ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, 1976, 1976);
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, 1952, 1952);

  // Fine 1-meter architectural grid
  ctx.strokeStyle = '#ecece5'; ctx.lineWidth = 1;
  const gridCount = Math.floor(size / 2);
  for (let i = -gridCount; i <= gridCount; i++) {
    const [gx] = toCanvas(i, 0); const [, gy] = toCanvas(0, i);
    if (gx > 55 && gx < 1993) { ctx.beginPath(); ctx.moveTo(gx, 55); ctx.lineTo(gx, 1993); ctx.stroke(); }
    if (gy > 55 && gy < 1993) { ctx.beginPath(); ctx.moveTo(55, gy); ctx.lineTo(1993, gy); ctx.stroke(); }
  }

  // Major 5-meter structural grid
  ctx.strokeStyle = '#deded4'; ctx.lineWidth = 1.5;
  for (let i = -gridCount; i <= gridCount; i += 5) {
    const [gx] = toCanvas(i, 0); const [, gy] = toCanvas(0, i);
    if (gx > 55 && gx < 1993) { ctx.beginPath(); ctx.moveTo(gx, 55); ctx.lineTo(gx, 1993); ctx.stroke(); }
    if (gy > 55 && gy < 1993) { ctx.beginPath(); ctx.moveTo(55, gy); ctx.lineTo(1993, gy); ctx.stroke(); }
  }

  // Draw 2D architectural components
  const floorComponents = model.components.filter(c => (c.floor ?? 0) === 0);

  // Slabs
  floorComponents.filter(c => c.type === 'slab').forEach(c => {
    const pts = c.polygon.map(([x, z]) => toCanvas(x - origin.x, z - origin.z));
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath(); ctx.fillStyle = '#f0f0ea'; ctx.fill();
    ctx.strokeStyle = '#b8b8ae'; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // Walls with architectural pochè
  floorComponents.filter(c => c.type === 'wall').forEach(c => {
    const pts = c.polygon.map(([x, z]) => toCanvas(x - origin.x, z - origin.z));
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath(); ctx.fillStyle = '#dfdfd6'; ctx.fill();
    ctx.strokeStyle = '#3e413a'; ctx.lineWidth = 2.5; ctx.stroke();
  });

  // Columns
  floorComponents.filter(c => c.type === 'column').forEach(c => {
    const pts = c.polygon.map(([x, z]) => toCanvas(x - origin.x, z - origin.z));
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath(); ctx.fillStyle = '#282b26'; ctx.fill();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.stroke();
  });

  // Windows
  floorComponents.filter(c => c.type === 'window').forEach(c => {
    const pts = c.polygon.map(([x, z]) => toCanvas(x - origin.x, z - origin.z));
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath(); ctx.fillStyle = '#e4ecea'; ctx.fill();
    ctx.strokeStyle = '#60726e'; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // Room annotations
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#3a3d36'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(model.demoPreset ? 'DESIGN STUDY' : 'CENTRAL COURTYARD', 1024, 1024);
  ctx.font = '13px monospace'; ctx.fillStyle = '#7a7d75';
  ctx.fillText(model.demoPreset ? 'APPROXIMATE DESIGN DIMENSIONS' : '±0.000 FL · OPEN AIR', 1024, 1050);

  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#3a3d36';
  ctx.fillText(model.demoPreset ? model.name.toUpperCase() : 'LIVING SPACE', 1024, 720);
  ctx.font = '12px monospace'; ctx.fillStyle = '#7a7d75';
  ctx.fillText(model.demoPreset ? 'PREPARED REFERENCE VILLA' : '38.4 m²', 1024, 740);

  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#3a3d36';
  ctx.fillText(model.demoPreset ? 'SCHEMATIC SITE PLAN' : 'GALLERY / STUDIO', 1024, 1320);
  ctx.font = '12px monospace'; ctx.fillStyle = '#7a7d75';
  ctx.fillText(model.demoPreset ? 'NOT A RECONSTRUCTED DRAWING' : '32.0 m²', 1024, 1340);

  // Exterior dimension lines & ticks
  const halfW = (model.width || 12) / 2, halfD = (model.depth || 10) / 2;
  const [bMinX, bMinZ] = toCanvas(-halfW, -halfD);
  const [bMaxX, bMaxZ] = toCanvas(halfW, halfD);

  const dimTopY = bMinZ - 36;
  ctx.strokeStyle = '#6a6d65'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(bMinX, dimTopY); ctx.lineTo(bMaxX, dimTopY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bMinX - 7, dimTopY + 7); ctx.lineTo(bMinX + 7, dimTopY - 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bMaxX - 7, dimTopY + 7); ctx.lineTo(bMaxX + 7, dimTopY - 7); ctx.stroke();
  ctx.font = '15px monospace'; ctx.fillStyle = '#2a2d26';
  ctx.fillText(`${(model.width || 12).toFixed(2)} m`, (bMinX + bMaxX) / 2, dimTopY - 14);

  const dimLeftX = bMinX - 36;
  ctx.beginPath(); ctx.moveTo(dimLeftX, bMinZ); ctx.lineTo(dimLeftX, bMaxZ); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dimLeftX - 7, bMinZ + 7); ctx.lineTo(dimLeftX + 7, dimMinY => dimLeftX - 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dimLeftX - 7, bMaxZ + 7); ctx.lineTo(dimLeftX + 7, bMaxZ - 7); ctx.stroke();
  ctx.save(); ctx.translate(dimLeftX - 16, (bMinZ + bMaxZ) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${(model.depth || 10).toFixed(2)} m`, 0, 0); ctx.restore();

  // Grid axis bubbles
  const bubbleY = dimTopY - 50;
  ['A', 'B', 'C', 'D'].forEach((axis, idx) => {
    const ax = bMinX + (idx / 3) * (bMaxX - bMinX);
    ctx.beginPath(); ctx.arc(ax, bubbleY, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(axis, ax, bubbleY);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#aaa';
    ctx.beginPath(); ctx.moveTo(ax, bubbleY + 16); ctx.lineTo(ax, dimTopY); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Architectural Title Block
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#555850'; ctx.lineWidth = 1.5;
  ctx.fillRect(1440, 1840, 530, 136); ctx.strokeRect(1440, 1840, 530, 136);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(model.demoPreset ? 'HEPHAESTUS · ARCHITECTURAL DESIGN PRESET' : 'HEPHAESTUS · ARCHITECTURAL RECONSTRUCTION', 1460, 1868);
  ctx.font = '12px monospace'; ctx.fillStyle = '#666';
  ctx.fillText(`PROJECT: ${(model.name || 'DEMO MODEL').toUpperCase()}`, 1460, 1892);
  ctx.fillText(model.demoPreset ? 'SHEET: SCHEMATIC SITE PLAN · METRIC DESIGN STUDY' : 'SHEET: F1 / DETAILED FLOOR PLAN · SCALE 1:100', 1460, 1914);
  ctx.fillText(model.demoPreset ? 'SOURCE: DESIGNED FROM VISUAL REFERENCE' : 'SOURCE: 2D TECHNICAL DRAWING TO 3D SPACE', 1460, 1936);

  // North arrow
  ctx.beginPath(); ctx.arc(1900, 110, 28, 0, Math.PI * 2);
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.moveTo(1900, 88); ctx.lineTo(1893, 116); ctx.lineTo(1900, 111); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.beginPath(); ctx.moveTo(1900, 88); ctx.lineTo(1907, 116); ctx.lineTo(1900, 111); ctx.closePath(); ctx.stroke();
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 1900, 78);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return { texture, size };
}

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
    light.shadow.normalBias = .015; light.shadow.bias = -.00015;
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
      const hit = this.raycaster.intersectObjects(this.meshes.filter(m => m.visible && (!this.measuring || !m.userData.selectionOnly)), false).find(h => !this.section || this.clip.distanceToPoint(h.point) >= 0);
      if (this.measuring && hit) {
        if (!this.measureStart) { this.measureStart = hit.point.clone(); this.onMeasure('Select second point on model.'); }
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
    this.blueprintTexture?.dispose(); this.blueprintTexture = null;
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
      let geometry, proxy = false;
      if (c.backendGeometry) ({ geometry, proxy } = backendGeometry(c, origin));
      else if (model.demoPreset && c.profile) geometry = presetGeometry(c, origin);
      else {
        const shape = new THREE.Shape(c.polygon.map(([x, z]) => new THREE.Vector2(x - origin.x, -(z - origin.z))));
        geometry = new THREE.ExtrudeGeometry(shape, { depth: c.height, bevelEnabled: false, steps: 1 });
        geometry.rotateX(-Math.PI / 2);
      }
      const color = model.demoPreset && c.color || { wall: '#dfdfd8', slab: '#c6c6bf', roof: '#e6e6df', column: '#f7f7f2', window: '#85928f', door: '#c45c3d' }[c.type];
      const material = new THREE.MeshStandardMaterial({ color, roughness: .85, side: THREE.DoubleSide,
        transparent: proxy || c.type === 'window', opacity: proxy ? 0 : c.type === 'window' ? .5 : 1,
        colorWrite: !proxy, depthWrite: !proxy });
      if (model.demoPreset) {
        material.roughness = c.finish === 'metal' ? .35 : c.finish === 'glass' ? .15 : .85;
        material.metalness = c.finish === 'metal' ? .35 : 0;
        if (c.finish === 'light') material.emissive.set(c.color);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = c.backendGeometry ? 0 : c.elevation;
      mesh.castShadow = !proxy && !(model.demoPreset && c.type === 'window'); mesh.receiveShadow = !proxy;
      const { mesh: _mesh, selection_mesh: _selection, ...metadata } = c;
      mesh.userData = { ...metadata, baseColor: color, sourceUnit: 'm', selectionOnly: proxy };
      mesh.name = c.id;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: '#535650', transparent: true, opacity: .28 }));
      edge.name = 'edges'; mesh.add(edge);
      edge.visible = !proxy;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    this.bounds = new THREE.Box3().setFromObject(this.group);
    const size = this.bounds.getSize(new THREE.Vector3());
    this.span = Math.max(size.x, size.y, size.z, 1);
    const shadow = this.light.shadow.camera;
    Object.assign(shadow, { left: -this.span, right: this.span, top: this.span, bottom: -this.span, far: this.span * 6 }); shadow.updateProjectionMatrix();
    this.light.position.set(-this.span, this.span * 2, this.span);

    // Architectural detailed 2D drawing plane
    const { texture: bpTexture, size: bpSize } = createBlueprintTexture(model, origin, this.span);
    this.blueprintTexture = bpTexture;
    const bpGeom = new THREE.PlaneGeometry(bpSize, bpSize);
    const bpMat = new THREE.MeshBasicMaterial({ map: bpTexture, depthWrite: true });
    const bpMesh = new THREE.Mesh(bpGeom, bpMat);
    bpMesh.rotation.x = -Math.PI / 2; bpMesh.position.y = this.bounds.min.y - 0.005; bpMesh.name = 'blueprint';
    this.group.add(bpMesh);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(bpSize, bpSize), new THREE.ShadowMaterial({ opacity: .12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = this.bounds.min.y; ground.receiveShadow = true; ground.name = 'ground'; this.group.add(ground);
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
      if (mesh.userData.selectionOnly) return;
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
      m.material.clipShadows = this.section;
      m.children.forEach(e => { e.material.clippingPlanes = this.section ? [this.clip] : []; });
    });
  }
  select(id) {
    this.selected = id; this.needsRender = true;
    this.meshes.forEach(m => {
      const selected = m.userData.id === id;
      m.material.emissive.set(selected ? '#c45c3d' : this.model.demoPreset && m.userData.finish === 'light' ? m.userData.color : '#000000');
      if (m.userData.selectionOnly) {
        m.material.colorWrite = selected; m.material.opacity = selected ? .16 : 0;
        m.children.forEach(edge => { edge.visible = selected; });
      }
    });
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
        mesh.position.y = mesh.userData.backendGeometry ? 0 : mesh.userData.elevation * rise;
        const edge = mesh.getObjectByName('edges');
        if (edge) edge.material.opacity = 0.28 * Math.min(1, progress * 4);
        if (mesh.userData.selectionOnly) return;
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
    output.userData = { sample: this.model.sample, unit: 'm', sourceOrigin: this.origin.toArray(), warnings: this.model.warnings,
      ...(this.model.demoPreset ? { demoPreset: this.model.demoPreset } : {}),
      ...(this.model.backend ? { schema_version: this.model.scene.schema_version, job_id: this.model.job_id,
        source_hash: this.model.source_hash, revision: this.model.scene.revision, parameters: this.model.scene.parameters,
        coordinate_frame: this.model.scene.coordinate_frame,
        ...(this.model.multiFloor ? { alignment: this.model.scene.alignment, floors: this.model.scene.floors.map(f => ({ number: f.number, name: f.name, transform: f.transform, provenance: f.provenance, drawings: f.drawings,
          job_id: f.scene.job_id, source_hash: f.scene.source_hash, revision: f.scene.revision, parameters: f.scene.parameters, coordinate_frame: f.scene.coordinate_frame })) } : {}),
        openings: this.model.components.filter(c => c.opening).map(({ mesh, selection_mesh, ...metadata }) => metadata) } : {}) };
    this.meshes.forEach(m => {
      if (m.userData.selectionOnly) return;
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
