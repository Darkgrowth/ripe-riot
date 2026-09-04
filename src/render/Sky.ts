import * as THREE from 'three';
import { Palette } from './Palette';

const VERT = /* glsl */`
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // force to far plane
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vWorldDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uHaze;
uniform float uStars;
uniform float uTime;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;

// Cheap hash for a star field; only used at night.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vWorldDir);
  float h = d.y;

  // Sky body: horizon -> zenith with a soft, slightly non-linear ramp.
  float up = clamp(h, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));

  // Below the horizon fades to a muted ground haze so cliff-edge views read.
  float down = clamp(-h, 0.0, 1.0);
  sky = mix(sky, uGround, smoothstep(0.0, 0.35, down));

  // Sun disc + broad glow.
  float cosA = dot(d, normalize(uSunDir));
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, cosA);
  float glow = pow(max(cosA, 0.0), 24.0) * 0.35 + pow(max(cosA, 0.0), 6.0) * 0.12;
  sky += uSunColor * (disc * 2.2 + glow);

  // Clouds. A drifting FBM sheet projected onto a dome — one of the cheapest
  // things in the frame and the single biggest difference between "a gradient"
  // and "a sky". Two thresholds rather than one: a soft body plus a tighter
  // core, which is what gives cumulus a lit top instead of a grey smear.
  if (uCloud > 0.001) {
    float ch = max(h, 0.035);
    vec2 cuv = (d.xz / ch) * 0.42 + vec2(uTime * 0.0042, uTime * 0.0021);
    float n = fbm(cuv);
    float body = smoothstep(0.46, 0.74, n);
    float core = smoothstep(0.58, 0.90, n);
    // Fade out at the horizon, where the dome projection stretches to mush.
    float cover = body * uCloud * smoothstep(0.015, 0.16, h);
    vec3 cloudCol = mix(uCloudShade, uCloudLit, core);
    cloudCol += uSunColor * pow(max(cosA, 0.0), 7.0) * 0.30;
    sky = mix(sky, cloudCol, cover);
  }

  // Horizon haze band keeps distant terrain sitting in atmosphere.
  sky = mix(sky, uHorizon, uHaze * exp(-abs(h) * 7.0));

  if (uStars > 0.001) {
    vec3 sp = floor(d * 260.0);
    float s = hash13(sp);
    float star = step(0.9975, s) * uStars * (0.5 + 0.5 * hash13(sp + 7.0));
    sky += vec3(star) * clamp(h * 3.0, 0.0, 1.0);
  }

  gl_FragColor = vec4(sky, 1.0);
}`;

export class Sky {
  mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envDirty = true;

  constructor() {
    this.uniforms = {
      uZenith: { value: Palette.skyZenith.clone() },
      uHorizon: { value: Palette.skyHorizon.clone() },
      uGround: { value: Palette.skyGround.clone() },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
      uSunColor: { value: Palette.sunDisc.clone() },
      uSunSize: { value: 0.006 },
      uHaze: { value: 0.55 },
      uStars: { value: 0.0 },
      uTime: { value: 0.0 },
      uCloud: { value: 0.78 },
      uCloudLit: { value: new THREE.Color().setHex(0xfdfcf6, THREE.SRGBColorSpace) },
      uCloudShade: { value: new THREE.Color().setHex(0xb9cfdd, THREE.SRGBColorSpace) },
    };
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'Sky';
    this.mesh.scale.setScalar(1);

    // The env scene reuses the same shader so reflections match the visible sky.
    const envMesh = new THREE.Mesh(geo, material);
    envMesh.frustumCulled = false;
    this.envScene.add(envMesh);
  }

  setSun(dir: THREE.Vector3): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir).normalize();
    this.envDirty = true;
  }

  /** Blend the whole sky toward night. t = 0 day, 1 night. */
  setNight(t: number): void {
    const u = this.uniforms;
    (u.uZenith.value as THREE.Color).copy(Palette.skyZenith).lerp(Palette.nightZenith, t);
    (u.uHorizon.value as THREE.Color).copy(Palette.skyHorizon).lerp(Palette.nightHorizon, t);
    (u.uGround.value as THREE.Color).copy(Palette.skyGround).lerp(Palette.nightZenith, t);
    u.uStars.value = Math.max(0, t * 1.2 - 0.2);
    u.uCloud.value = 0.78 * (1 - t * 0.75);
    u.uHaze.value = 0.55 * (1 - t * 0.6);
    this.envDirty = true;
  }

  setHaze(v: number): void { this.uniforms.uHaze.value = v; this.envDirty = true; }

  /** Drift the cloud sheet. Called from the render clock, so it keeps moving
   *  while the simulation is paused for a screenshot. */
  setTime(t: number): void { this.uniforms.uTime.value = t; }

  /** 0 = clear sky, 1 = heavy cover. */
  setCloudCover(v: number): void { this.uniforms.uCloud.value = v; this.envDirty = true; }

  get horizonColor(): THREE.Color { return this.uniforms.uHorizon.value as THREE.Color; }

  /** Build (or rebuild) an environment map so MeshStandardMaterial gets sane IBL. */
  updateEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, force = false): void {
    if (!this.envDirty && !force) return;
    this.envDirty = false;
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.pmrem.compileEquirectangularShader();
    }
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 100);
    scene.environment = this.envTarget.texture;
    prev?.dispose();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
