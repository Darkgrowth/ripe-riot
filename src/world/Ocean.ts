import * as THREE from 'three';
import { Palette } from '@/render/Palette';
import type { Terrain } from './Terrain';
import { clamp } from '@/core/MathUtils';

const VERT = /* glsl */`
uniform float uTime;
uniform float uWave;
attribute float aDepth;      // metres of water at this vertex (>=0)
varying float vDepth;
varying vec3 vWorld;
varying float vFoam;
varying float vDist;

void main() {
  vDepth = aDepth;
  vec3 p = position;
  float shore = 1.0 - clamp(aDepth / 3.5, 0.0, 1.0);
  // Three cheap directional waves; damped as the water gets shallow.
  float w =
      sin(p.x * 0.085 + uTime * 1.05) * 0.34
    + sin(p.y * 0.061 - uTime * 0.83) * 0.28
    + sin((p.x + p.y) * 0.041 + uTime * 1.5) * 0.20;
  w *= uWave * mix(0.25, 1.0, clamp(aDepth / 4.0, 0.0, 1.0));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  // Fade displacement with distance. At 5 m per segment the wave pattern
  // aliases into horizontal banding once it is far enough away to be
  // under-sampled; flattening it there is both cheaper and better looking.
  float camDist = distance(wp.xyz, cameraPosition);
  float detailFade = 1.0 - smoothstep(70.0, 260.0, camDist);
  wp.y += w * detailFade;
  vDist = camDist;
  vWorld = wp.xyz;
  vFoam = shore;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uTime;
uniform vec3 uSunDir;
varying float vDepth;
varying vec3 vWorld;
varying float vFoam;
varying float vDist;

void main() {
  float detailFade = 1.0 - smoothstep(70.0, 260.0, vDist);
  float d = clamp(vDepth / 9.0, 0.0, 1.0);
  vec3 col = mix(uShallow, uDeep, pow(d, 0.7));

  // Animated foam band along the shoreline.
  float band = smoothstep(0.55, 1.0, vFoam);
  float ripple = sin(vWorld.x * 0.55 + vWorld.z * 0.45 + uTime * 1.7) * 0.5 + 0.5;
  float foam = band * (0.45 + 0.55 * mix(0.5, ripple, detailFade));
  col = mix(col, uFoam, foam * 0.85);

  // Broad specular sheet so the sea is not a flat colour.
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vec3(
    sin(vWorld.x * 0.22 + uTime * 1.1) * 0.055 * detailFade,
    1.0,
    cos(vWorld.z * 0.19 - uTime * 0.9) * 0.055 * detailFade));
  vec3 hv = normalize(normalize(uSunDir) + v);
  float spec = pow(max(dot(n, hv), 0.0), 90.0) * detailFade;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  col += vec3(1.0, 0.97, 0.9) * spec * 1.6;
  col = mix(col, vec3(0.72, 0.88, 0.95), fres * 0.35);

  float alpha = mix(0.80, 0.97, d);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ocean {
  mesh!: THREE.Mesh;
  private uniforms!: Record<string, THREE.IUniform>;

  build(scene: THREE.Scene, terrain: Terrain, sunDir: THREE.Vector3): void {
    const size = 900;
    const seg = 180;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    // PlaneGeometry is built in XY; we rotate it flat, so its local y is world z.
    const pos = geo.getAttribute('position');
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      const inRange = Math.abs(x) < terrain.extent / 2 && Math.abs(z) < terrain.extent / 2;
      const h = inRange ? terrain.height(x, z) : -18;
      depth[i] = clamp(-h, 0, 20);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime: { value: 0 },
      uWave: { value: 1.0 },
      uDeep: { value: Palette.oceanDeep.clone() },
      uShallow: { value: Palette.oceanShallow.clone() },
      uFoam: { value: Palette.foam.clone() },
      uSunDir: { value: sunDir.clone() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'Ocean';
    this.mesh.position.y = 0;
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(elapsed: number, waveScale = 1): void {
    if (!this.uniforms) return;
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uWave.value = waveScale;
  }

  setSun(dir: THREE.Vector3): void {
    if (this.uniforms) (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  }
}
