import * as THREE from 'three';
import { Sky } from './Sky';
import { Palette } from './Palette';
import { clamp, damp } from '@/core/MathUtils';

export interface FrameStats {
  /** Mean perceived luminance, 0..1. */
  mean: number;
  /** Fraction of neighbouring pixel pairs that differ by < 1.5%. High = featureless. */
  flat: number;
  /** Std-dev of luminance. Low = washed out or empty. */
  contrast: number;
  /** Number of distinct hue buckets (of 12) holding >1% of pixels. */
  hueSpread: number;
  /** Fraction of pixels darker than 2% — a proxy for "the screen is black". */
  black: number;
  /** Fraction of pixels brighter than 98%. */
  blown: number;
  histogram: number[];
}

/**
 * Owns the WebGL renderer, the main scene graph root, camera and sun.
 * Also provides numeric frame statistics, so automated visual checks can triage
 * hundreds of frames without anyone having to look at hundreds of images.
 */
export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sky = new Sky();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;

  /** Half-extent of the shadow ortho box; smaller = crisper shadows. */
  shadowRadius = 56;
  private shadowTarget = new THREE.Vector3();
  private baseFov = 76;
  private fovOffset = 0;
  private statsTarget: THREE.WebGLRenderTarget | null = null;
  private statsBuf: Uint8Array | null = null;
  readonly canvas: HTMLCanvasElement;
  private pixelRatioCap = 1.75;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: true, // needed for the capture harness
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(Palette.skyHorizon, 1);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.12, 3000);
    this.camera.position.set(0, 3, 0);

    this.fog = new THREE.FogExp2(Palette.fog.getHex(), 0.0022);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh);

    this.sun = new THREE.DirectionalLight(Palette.sunLight, 2.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.setShadowExtent(this.shadowRadius);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(Palette.skyHorizon, Palette.grassDark, 0.42);
    this.scene.add(this.hemi);

    this.setSunAngle(58, 38);
    this.resize();
  }

  private setShadowExtent(r: number): void {
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.updateProjectionMatrix();
  }

  /** elevation and azimuth in degrees. */
  setSunAngle(elevationDeg: number, azimuthDeg: number): void {
    const e = THREE.MathUtils.degToRad(elevationDeg);
    const a = THREE.MathUtils.degToRad(azimuthDeg);
    const dir = new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
    this.sky.setSun(dir);
    this.sunDir.copy(dir);
  }

  readonly sunDir = new THREE.Vector3(0.4, 0.7, 0.55).normalize();

  /** Keep the shadow frustum centred a little ahead of the viewer. */
  updateSunFollow(focus: THREE.Vector3, forward: THREE.Vector3): void {
    this.shadowTarget.copy(focus).addScaledVector(forward, this.shadowRadius * 0.32);
    this.shadowTarget.y = focus.y;
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(this.sunDir, 110);
    this.sun.target.updateMatrixWorld();
  }

  /** Additive FOV offset used for sprint/impulse kicks. */
  setFovOffset(v: number): void { this.fovOffset = v; }

  updateCameraFov(dt: number): void {
    const target = this.baseFov + this.fovOffset;
    this.camera.fov = damp(this.camera.fov, target, 9, dt);
    this.camera.updateProjectionMatrix();
  }

  resize(width?: number, height?: number): void {
    const w = width ?? this.canvas.clientWidth ?? window.innerWidth;
    const h = height ?? this.canvas.clientHeight ?? window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setPixelRatioCap(v: number): void {
    this.pixelRatioCap = clamp(v, 0.5, 3);
    this.resize();
  }

  render(): void {
    // Keep the sky sphere centred on the camera and large enough to enclose it.
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.mesh.scale.setScalar(this.camera.far * 0.5);
    this.renderer.render(this.scene, this.camera);
  }

  refreshEnvironment(force = false): void {
    this.sky.updateEnvironment(this.renderer, this.scene, force);
  }

  // ---- numeric visual triage ---------------------------------------------
  /**
   * Render a tiny copy of the current view and reduce it to a handful of
   * numbers. Cheap enough to call every frame in a test; precise enough to spot
   * a black screen, an untextured flat wall, or a washed-out horizon without
   * anyone opening an image.
   */
  frameStats(w = 96, h = 54): FrameStats {
    if (!this.statsTarget || this.statsTarget.width !== w || this.statsTarget.height !== h) {
      this.statsTarget?.dispose();
      this.statsTarget = new THREE.WebGLRenderTarget(w, h, {
        depthBuffer: true, format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      });
      this.statsBuf = new Uint8Array(w * h * 4);
    }
    const buf = this.statsBuf!;
    const prevTarget = this.renderer.getRenderTarget();
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.mesh.scale.setScalar(this.camera.far * 0.5);
    this.renderer.setRenderTarget(this.statsTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.statsTarget, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(prevTarget);

    const n = w * h;
    const lum = new Float32Array(n);
    const histogram = new Array(16).fill(0);
    const hueBuckets = new Array(12).fill(0);
    let sum = 0, black = 0, blown = 0;
    for (let i = 0; i < n; i++) {
      const r = buf[i * 4] / 255, g = buf[i * 4 + 1] / 255, b = buf[i * 4 + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = l; sum += l;
      histogram[Math.min(15, (l * 16) | 0)]++;
      if (l < 0.02) black++;
      if (l > 0.98) blown++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 0.06) {
        let hue: number;
        if (mx === r) hue = ((g - b) / (mx - mn) + 6) % 6;
        else if (mx === g) hue = (b - r) / (mx - mn) + 2;
        else hue = (r - g) / (mx - mn) + 4;
        hueBuckets[Math.min(11, Math.floor((hue / 6) * 12))]++;
      }
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) { const d = lum[i] - mean; varSum += d * d; }

    let pairs = 0, flatPairs = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x + 1 < w) { pairs++; if (Math.abs(lum[i] - lum[i + 1]) < 0.015) flatPairs++; }
        if (y + 1 < h) { pairs++; if (Math.abs(lum[i] - lum[i + w]) < 0.015) flatPairs++; }
      }
    }
    const hueSpread = hueBuckets.filter((c) => c > n * 0.01).length;
    return {
      mean: +mean.toFixed(4),
      flat: +(flatPairs / Math.max(1, pairs)).toFixed(4),
      contrast: +Math.sqrt(varSum / n).toFixed(4),
      hueSpread,
      black: +(black / n).toFixed(4),
      blown: +(blown / n).toFixed(4),
      histogram,
    };
  }

  get info() {
    const i = this.renderer.info;
    return {
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
    };
  }
}
