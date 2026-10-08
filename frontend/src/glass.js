import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// Screen-space, two-pass refraction adapted from ui.md. Kept inside the
// introduction; the architecture model retains readable opaque surfaces.
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vEye;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vEye = normalize(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uBackside;
  varying vec3 vNormal;
  varying vec3 vEye;
  vec3 sampleBand(vec2 uv, vec3 eye, vec3 n, float ior, float power) {
    vec3 r = refract(eye, n, 1.0 / ior);
    return texture2D(uTexture, uv + r.xy * power * 0.5).rgb;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec3 n = normalize(vNormal);
    if (uBackside > 0.5) n = -n;
    vec3 eye = normalize(vEye);
    float power = mix(0.30, 0.22, uBackside);
    vec3 color = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float slide = float(i) / 16.0 * 0.045;
      vec3 R = sampleBand(uv, eye, n, 1.15, power + slide);
      vec3 Y = sampleBand(uv, eye, n, 1.16, power + slide);
      vec3 G = sampleBand(uv, eye, n, 1.18, power + slide * 2.0);
      vec3 C = sampleBand(uv, eye, n, 1.22, power + slide * 2.5);
      vec3 B = sampleBand(uv, eye, n, 1.22, power + slide * 3.0);
      vec3 P = sampleBand(uv, eye, n, 1.22, power + slide);
      float r = R.r * 0.5;
      float y = (2.0 * Y.r + 2.0 * Y.g - Y.b) / 6.0;
      float g = G.g * 0.5;
      float c = (2.0 * C.g + 2.0 * C.b - C.r) / 6.0;
      float b = B.b * 0.5;
      float p = (2.0 * P.b + 2.0 * P.r - P.g) / 6.0;
      color += vec3(r + (2.0*p + 2.0*y - c)/3.0,
                    g + (2.0*y + 2.0*c - p)/3.0,
                    b + (2.0*c + 2.0*p - y)/3.0);
    }
    color /= 16.0;
    color = mix(vec3(dot(color, vec3(0.2125, 0.7154, 0.0721))), color, 1.08);
    vec3 light = normalize(vec3(1.0, -1.0, -1.0));
    float spec = pow(max(dot(n, normalize(light - eye)), 0.0), 90.0);
    spec += 0.6 * pow(max(dot(n, normalize(vec3(-1.0, -1.0, 1.0) - eye)), 0.0), 54.0);
    color += spec * mix(1.0, 0.35, uBackside);
    float fresnel = pow(clamp(1.0 + dot(eye, n), 0.0, 1.0), 5.0);
    color = mix(color, vec3(1.0), fresnel * mix(0.55, 0.25, uBackside));
    gl_FragColor = vec4(color + vec3(0.004, 0.005, 0.007), 1.0);
    #include <colorspace_fragment>
  }
`;

export class GlassPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.z = 10;
    this.scene = new THREE.Scene();
    this.background = new THREE.Scene();
    this.textCanvas = document.createElement("canvas");
    this.texture = new THREE.CanvasTexture(this.textCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this.texture } },
      depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(uTex, vUv);
          #include <colorspace_fragment>
        }`,
    }));
    this.quad.frustumCulled = false;
    this.background.add(this.quad);
    this.rtBack = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.rtFront = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const material = (backside, texture) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      side: backside ? THREE.BackSide : THREE.FrontSide,
      uniforms: { uTexture: { value: texture }, uResolution: { value: new THREE.Vector2() }, uBackside: { value: backside } },
    });
    this.back = material(1, this.rtBack.texture);
    this.front = material(0, this.rtFront.texture);
    this.cube = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 8, 0.12), this.front);
    this.cube.rotation.set(-0.42, 0.62, 0.18);
    this.scene.add(this.cube);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.onFonts = () => { if (!this.disposed) this.resize(); };
    document.fonts.addEventListener("loadingdone", this.onFonts);
    document.fonts.ready.then(this.onFonts);
    this.resize();
  }

  resize() {
    const w = this.canvas.parentElement.clientWidth;
    const h = this.canvas.parentElement.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rtBack.setSize(size.x, size.y);
    this.rtFront.setSize(size.x, size.y);
    this.back.uniforms.uResolution.value.copy(size);
    this.front.uniforms.uResolution.value.copy(size);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(15)) * 10;
    this.cube.scale.setScalar(Math.min(205, w * 0.47) / h * visH);
    const dpr = this.renderer.getPixelRatio();
    this.textCanvas.width = size.x;
    this.textCanvas.height = size.y;
    const ctx = this.textCanvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const fs = Math.min(h * 0.37, w * 0.25);
    ctx.font = `800 ${fs}px Poppins, sans-serif`;
    ctx.fillStyle = "#e9e9e9";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Hình", w * 0.5, h * 0.5 - fs * 0.15);
    ctx.fillText("Khối", w * 0.5, h * 0.5 + fs * 0.9);
    this.texture.needsUpdate = true;
    this.dirty = true;
  }

  render(dt, moving) {
    if (!moving && !this.dirty) return;
    this.dirty = false;
    if (moving) this.cube.rotation.y += dt * 0.12;
    const r = this.renderer;
    r.autoClear = true;
    r.setRenderTarget(this.rtBack);
    r.render(this.background, this.camera);
    r.setRenderTarget(this.rtFront);
    r.render(this.background, this.camera);
    r.autoClear = false;
    this.cube.material = this.back;
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.autoClear = true;
    r.render(this.background, this.camera);
    r.autoClear = false;
    r.clearDepth();
    this.cube.material = this.front;
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    document.fonts.removeEventListener("loadingdone", this.onFonts);
    this.cube.geometry.dispose();
    this.front.dispose();
    this.back.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
    this.texture.dispose();
    this.rtBack.dispose();
    this.rtFront.dispose();
    this.renderer.dispose();
  }
}
