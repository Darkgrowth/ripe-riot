import * as THREE from 'three';
import { fruitGeometry } from '@/fruit/FruitGeometry';
import { hasVoxelFruit, voxelFruitGeometry } from '@/art/voxel/VoxelFruit';
import type { VisualMode } from '@/art/voxel/VisualMode';
import { damp } from '@/core/MathUtils';
import { gripHand } from '@/render/WorkerHands';
import { framingFor, screenHeightPctFor, type CarryClass } from '@/interaction/CarryRules';

const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * Orientation of the two grip hands.
 *
 * Carry hands are authored cupped, with fingertips up +Y and pads toward the
 * player along +Z. A small inward cant makes the palms cradle the lower sides
 * while the wrists enter from the lower corners instead of standing upright.
 */
const HAND_Q: THREE.Quaternion[] = [1, -1].map((side) => {
  return new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -side * 0.36);
});

/**
 * The fruit in your hands, drawn as a first-person PROXY.
 *
 * The world fruit keeps its true size and its true position — physics, other
 * players and every tool still see a 1.7 m Puff Melon where a 1.7 m Puff Melon
 * is. This draws a separate, framed copy in the viewmodel scene and the world
 * copy is suppressed locally, which is the only way to let the camera and the
 * simulation disagree about size without lying to either of them.
 *
 * Everything here is cosmetic. Nothing may feed back into simulation.
 */
export class CarryViewmodel {
  readonly root = new THREE.Group();
  private fruitMesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private hands: THREE.Mesh[] = [];
  private species = '';
  /** Bounding sphere of the current species' geometry, at unit diameter. */
  private geoRadius = 0.5;
  private geoCentre = new THREE.Vector3();

  /** Last computed presented radius, in metres of view space. */
  presentedRadius = 0;
  /** The screen-height percentage the last update aimed for. */
  targetHeightPct = 0;
  /**
   * Smoothed placement. The carry CLASS is discrete on purpose — the rules that
   * hang off it have to be unambiguous — but the framing must not be, or a Puff
   * Melon crossing from medium to large mid-inflation would jump 6 cm further
   * from the eye between one frame and the next.
   */
  private cur = { d: 0.55, x: 0, y: -0.2, r: 0.08 };
  private settled = false;
  /** The support hand closes around a new two-hand load instead of popping in. */
  private supportGrip = 0;

  constructor(handMaterial: THREE.Material,
    private readonly visualMode: VisualMode = 'baseline') {
    this.root.name = 'CarryModel';
    this.root.visible = false;

    // The fruit needs its own material: the tool material is flat-shaded, and a
    // faceted apple next to a smooth one on the ground reads as two objects.
    // Vertex colours carry the species' own painting; `color` multiplies the
    // per-fruit variant and damage tint over it, exactly as instanceColor does
    // in the world batch.
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.02,
      flatShading: visualMode === 'voxel',
    });
    this.material.name = 'carry-proxy';

    this.fruitMesh = new THREE.Mesh(this.geometryFor('apple'), this.material);
    this.fruitMesh.name = 'CarryFruit';
    this.root.add(this.fruitMesh);
    this.setSpecies('apple');

    for (let i = 0; i < 2; i++) {
      const m = gripHand(handMaterial, i === 0 ? 1 : -1);
      m.name = `CarryHand:${i === 0 ? 'left' : 'right'}`;
      this.hands.push(m);
      this.root.add(m);
    }
  }

  private setSpecies(species: string): void {
    if (species === this.species) return;
    this.species = species;
    const geo = this.geometryFor(species);
    this.fruitMesh.geometry = geo;
    const bs = geo.boundingSphere;
    // Normalising by the real bounding sphere rather than by "unit diameter" is
    // what makes the screen-height cap true for a banana bunch and a stemmed
    // apple, not only for the species that happen to be balls.
    this.geoRadius = bs ? Math.max(0.1, bs.radius) : 0.5;
    this.geoCentre.copy(bs ? bs.center : _zero);
  }

  private geometryFor(species: string): THREE.BufferGeometry {
    if (this.visualMode === 'voxel' && hasVoxelFruit(species))
      return voxelFruitGeometry(species);
    return fruitGeometry(species);
  }

  /**
   * Place the proxy for this frame.
   *
   * @param cls        carry class, which picks the framing
   * @param diameter   the fruit's TRUE diameter, which picks the screen size
   * @param aspect     viewport aspect, so lateral placement survives a resize
   * @param fovDeg     the viewmodel camera's vertical FOV
   * @param sway       view-space offset from bob, lag and throw wind-up
   * @param spin       orientation, already in view space
   */
  update(dt: number, cls: CarryClass, diameter: number, species: string, tint: THREE.Color,
    emissive: number, aspect: number, fovDeg: number,
    sway: THREE.Vector3, spin: THREE.Quaternion): void {
    const swapped = species !== this.species;
    this.setSpecies(species);
    this.material.color.copy(tint);
    this.material.emissive.setRGB(emissive * 0.55, emissive * 0.55, emissive * 0.55);

    const f = framingFor(cls);
    const d = f.distance;
    // Projection factor: an object of half-height h at distance d lands at
    // NDC y = h * F / d. Everything below is that one relation, rearranged.
    const F = 1 / Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);

    const pct = screenHeightPctFor(diameter, cls);
    this.targetHeightPct = pct;
    const prWant = (pct / 100) * d / F;

    // Put the TOP of the fruit exactly where the framing says, then let the
    // rest of it hang below. Sizing from the top edge rather than the centre is
    // the whole trick: it means a bigger fruit grows DOWNWARD out of frame
    // instead of upward into the crosshair.
    const ndcTop = (f.topPct / 100) * 2 - 1;
    const yWant = (ndcTop * d) / F - prWant;
    const halfWidth = (d * aspect) / F;
    const xWant = f.lateral * halfWidth;

    const c = this.cur;
    if (!this.settled || swapped) {
      this.settled = true;
      c.d = d; c.x = xWant; c.y = yWant; c.r = prWant;
    } else {
      // Fast enough that inflation reads as inflation, slow enough that a class
      // boundary is a movement rather than a cut.
      c.d = damp(c.d, d, 9, dt);
      c.x = damp(c.x, xWant, 9, dt);
      c.y = damp(c.y, yWant, 9, dt);
      c.r = damp(c.r, prWant, 9, dt);
    }
    const pr = c.r;
    const x = c.x;
    const y = c.y;
    this.presentedRadius = pr;

    this.fruitMesh.scale.setScalar(pr / this.geoRadius);
    this.fruitMesh.quaternion.copy(spin);
    // Re-centre on the bounding sphere: a banana bunch's origin is not its
    // middle, and framing its origin would hang half of it off the bottom.
    _c.copy(this.geoCentre).multiplyScalar(pr / this.geoRadius).applyQuaternion(spin);
    this.fruitMesh.position.set(x, y, -c.d).sub(_c).add(sway);

    // Hands hug the presented sphere, so a bigger fruit spreads them further
    // apart — but they never get bigger themselves.
    // Proportional to distance, so a glove is the same size on screen whichever
    // class is in frame: hands do not grow with the fruit, which is exactly how
    // a player reads that the fruit is big.
    const handScale = 0.62 * (d / 0.40) * 0.58;
    const two = f.hands === 2;
    this.supportGrip = damp(this.supportGrip, two ? 1 : 0, 14, dt);
    const load = Math.min(1, Math.max(0, (f.heft - 1) / .9));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const h = this.hands[i];
      h.visible = side === -1 || this.supportGrip > .015;
      if (!h.visible) continue;
      h.scale.setScalar(handScale * (side === 1 ? this.supportGrip : 1));
      // The broad palm sits at the near-lower surface, with curled fingertips
      // climbing into contact. In the one-hand pose the right hand supports the
      // lower-right side, with its thumb visible opposing the fingers; placing
      // it directly underneath hid the glove and made the fruit sit on a post.
      h.position.set(
        x - side * pr * (two ? 0.66 - load * .04 : 0.48),
        y - pr * (two ? 0.50 - load * .06 : 0.64)
          - (side === 1 ? (1 - this.supportGrip) * .045 : 0),
        -c.d + pr * (two ? 0.72 : 0.79),
      ).add(sway);
      h.quaternion.copy(HAND_Q[i]);
      // More of a heavy fruit's weight is caught at its side. A slight wrist
      // turn makes the cupped pads face inward without changing fruit framing.
      h.rotateX(-load * .07);
      h.rotateY(side * load * .06);
    }
  }

  /** Forget the smoothed placement, so the next pickup snaps into frame
   *  rather than sliding in from wherever the last one was. */
  reset(): void { this.settled = false; this.supportGrip = 0; }

  dispose(): void {
    this.material.dispose();
    for (const h of this.hands) h.geometry.dispose();
  }
}

const _c = new THREE.Vector3();
const _zero = new THREE.Vector3();
