// React Bits Antigravity (MIT), adapted from the supplied component for vanilla Three.js.
import * as THREE from 'three';

export function particleTarget(p, targetX, targetY, time, s) {
  const projection = 1 - p.cz / 50;
  const x = targetX * projection, y = targetY * projection;
  const dx = p.mx - x, dy = p.my - y;
  if (Math.hypot(dx, dy) >= s.magnetRadius) return { x: p.mx, y: p.my, z: p.mz * s.depthFactor };
  const angle = Math.atan2(dy, dx) + time * s.rotationSpeed;
  const wave = Math.sin(p.t * s.waveSpeed + angle) * .5 * s.waveAmplitude;
  const radius = s.ringRadius + wave + p.randomRadiusOffset * (5 / (s.fieldStrength + .1));
  return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle), z: p.mz * s.depthFactor + Math.sin(p.t) * s.waveAmplitude * s.depthFactor };
}

export function advanceParticle(p, target, delta, speed) {
  const frames = Math.min(.05, Math.max(0, delta)) * 60;
  p.t += p.speed * .5 * frames;
  const factor = 1 - (1 - speed) ** frames;
  p.cx += (target.x - p.cx) * factor;
  p.cy += (target.y - p.cy) * factor;
  p.cz += (target.z - p.cz) * factor;
}

export function createAntigravity(canvas, {
  count = 300, magnetRadius = 6, ringRadius = 7, waveSpeed = .4, waveAmplitude = 1,
  particleSize = 1.5, lerpSpeed = .05, color = '#C45C3D', autoAnimate = true,
  particleVariance = 1, rotationSpeed = 0, depthFactor = 1, pulseSpeed = 3,
  particleShape = 'capsule', fieldStrength = 10,
} = {}) {
  const settings = { magnetRadius, ringRadius, waveSpeed, waveAmplitude, lerpSpeed, rotationSpeed, depthFactor, fieldStrength };
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  camera.position.set(0, 0, 50);
  const geometry = particleShape === 'sphere' ? new THREE.SphereGeometry(.2, 16, 16)
    : particleShape === 'box' ? new THREE.BoxGeometry(.3, .3, .3)
    : particleShape === 'tetrahedron' ? new THREE.TetrahedronGeometry(.3)
    : new THREE.CapsuleGeometry(.1, .4, 4, 8);
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; scene.add(mesh);
  const dummy = new THREE.Object3D(), pointer = { x: 0, y: 0 }, virtual = { x: 0, y: 0 };
  let particles, width = 1, height = 1, time = 0, lastMove = -Infinity, drawnStatic = false, disposed = false;
  function resize() {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false);
    const oldWidth = width, oldHeight = height;
    height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 50; width = height * camera.aspect;
    if (particles) {
      particles.forEach(p => { p.mx *= width / oldWidth; p.cx *= width / oldWidth; p.my *= height / oldHeight; p.cy *= height / oldHeight; });
      pointer.x *= width / oldWidth; pointer.y *= height / oldHeight; virtual.x *= width / oldWidth; virtual.y *= height / oldHeight;
    }
    if (!particles) particles = Array.from({ length: count }, () => {
      const x = (Math.random() - .5) * width, y = (Math.random() - .5) * height, z = (Math.random() - .5) * 20;
      return { t: Math.random() * 100, speed: .01 + Math.random() / 200, mx: x, my: y, mz: z, cx: x, cy: y, cz: z, randomRadiusOffset: (Math.random() - .5) * 2 };
    });
    drawnStatic = false;
  }
  function move(event) {
    if (canvas.closest('[hidden]') || event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - .5) * width;
    pointer.y = (.5 - (event.clientY - rect.top) / rect.height) * height;
    lastMove = time;
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  window.addEventListener('pointermove', move, { passive: true }); resize();
  return {
    render(delta, reducedMotion = false) {
      if (disposed || !particles || document.hidden || (reducedMotion && drawnStatic)) return;
      if (!reducedMotion) time += Math.min(.05, Math.max(0, delta));
      let x = pointer.x, y = pointer.y;
      if (autoAnimate && time - lastMove > 2) { x = Math.sin(time * .5) * width / 4; y = Math.cos(time) * height / 4; }
      const smoothing = reducedMotion ? 1 : 1 - .95 ** (Math.min(.05, delta) * 60);
      virtual.x += (x - virtual.x) * smoothing; virtual.y += (y - virtual.y) * smoothing;
      particles.forEach((p, i) => {
        const target = particleTarget(p, virtual.x, virtual.y, time, settings);
        if (reducedMotion) { p.cx = target.x; p.cy = target.y; p.cz = target.z; }
        else advanceParticle(p, target, delta, lerpSpeed);
        const projection = 1 - p.cz / 50;
        dummy.position.set(p.cx, p.cy, p.cz); dummy.lookAt(virtual.x * projection, virtual.y * projection, p.cz); dummy.rotateX(Math.PI / 2);
        const distance = Math.hypot(p.cx - virtual.x * projection, p.cy - virtual.y * projection);
        const factor = THREE.MathUtils.clamp(1 - Math.abs(distance - ringRadius) / 10, 0, 1);
        dummy.scale.setScalar(factor * (.8 + Math.sin(p.t * pulseSpeed) * .2 * particleVariance) * particleSize);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; renderer.render(scene, camera); drawnStatic = reducedMotion;
    },
    dispose() { disposed = true; observer.disconnect(); window.removeEventListener('pointermove', move); mesh.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
