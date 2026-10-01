import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { Sunpatch } from './Sunpatch';
import { Terrain } from './Terrain';
import { PropBuilder, signTexture, finishWorldSign } from './PropBuilder';
import { smoothstep, fbm2 } from '@/core/MathUtils';
import { paintVoxelClearingTerrain } from '@/art/voxel/VoxelClearingTerrain';
import { voxelFruitGeometry } from '@/art/voxel/VoxelFruit';
import { ORCHARD_RUN } from './OrchardLayout';
import type { VisualMode } from '@/art/voxel/VisualMode';

/** Compact island terrace. The low plum bank drains into the same clearing. */
export class OrchardTerrain extends Terrain {
  override height(x: number, z: number): number {
    const r = Math.hypot(x + 23, z - 24);
    const terrace = 7.5 * (1 - smoothstep(30, 48, r)) - 7 * smoothstep(40, 58, r);
    const bank = 2.5 * Math.exp(-(((x + 35) / 5) ** 2) - ((z - 25) / 6) ** 2);
    const texture = fbm2(x * .08, z * .08, 2, 711) * .13 * (1 - smoothstep(29, 44, r));
    return terrace + bank + texture;
  }
}

/** Uses Sunpatch's world contract, with only the authored harvest clearing. */
export class OrchardClearing extends Sunpatch {
  override readonly orchardRun = true;
  readonly safeRadius = ORCHARD_RUN.safeRadius;
  override terrain = new OrchardTerrain();
  private g!: Game;
  private cratePoint = new THREE.Vector3();
  private cargo = new THREE.Group();
  private cargoSignature = '';
  private sign!: THREE.Mesh;
  private props!: THREE.Mesh;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 });

  constructor(private readonly mode: VisualMode = 'voxel') { super(false, mode); }

  override init(g: Game): void {
    this.g = g;
    this.root.name = 'Orchard Run';
    g.renderer.scene.add(this.root);
    this.terrain.build(g.renderer.scene, g.physics, true);
    if (this.mode === 'voxel') paintVoxelClearingTerrain(this.terrain);
    this.ocean.build(g.renderer.scene, this.terrain, g.renderer.sunDir);
    this.cratePoint.copy(this.groundAt(...ORCHARD_RUN.crate, .12));
    for (const [id, label, x, z, radius] of [
      ['dock', 'Extraction Crate', -7, 27, 6], ['shop', 'Safe Apron', -7, 27, 6],
      ['orchard', 'Greedy Grove', -23, 24, 22], ['hillFarm', 'Plum Bank', -34, 25, 7],
      ['waterfall', 'Sticky Pocket', -29, 17, 7], ['palmBeach', 'Orchard Shore', -3, 38, 7],
      ['ridge', 'Orchard Edge', -40, 25, 8], ['ravine', 'Orchard Edge', -40, 25, 8],
      ['caveOrchard', 'Sticky Pocket', -29, 17, 7],
    ] as const) this.landmarks.set(id, { id, label, position: this.groundAt(x, z, 0), radius });
    this.buildCrate();
    this.root.add(this.cargo);
    g.renderer.refreshEnvironment(true);
    g.bus.emit('world:ready', { seed: g.seed });
    g.debug?.addAction('world.info', () => ({ orchardRun: true, sellPad: this.sellPad.toArray(),
      sellRadius: this.sellRadius, safeRadius: this.safeRadius, spawn: this.spawnPoint.toArray(),
      shopCounter: this.shopCounter.toArray(), landmarks: Object.fromEntries([...this.landmarks]
        .map(([id, l]) => [id, { pos: l.position.toArray(), radius: l.radius, label: l.label }])) }));
    g.debug?.addAction('world.respawn', () => { this.spawnPlayer(g.player); return this.spawnPoint.toArray(); });
  }

  override get sellPad(): THREE.Vector3 { return this.cratePoint; }
  override get sellRadius(): number { return 1.9; }
  override get shopCounter(): THREE.Vector3 { return this.cratePoint; }
  override get spawnPoint(): THREE.Vector3 { return this.groundAt(...ORCHARD_RUN.spawn, .14); }
  override get spawnYaw(): number { return Math.PI / 2; }
  override get spawnPitch(): number { return -.09; }
  override setExpeditionStage(): void { /* This clearing has no chapter gates. */ }

  private buildCrate(): void {
    const b = new PropBuilder(this.g.physics);
    const wood = new THREE.Color(0xb88c55), pale = new THREE.Color(0xd2b47d);
    const dark = new THREE.Color(0x65543c), green = new THREE.Color(0x547b64);
    const p = this.cratePoint;
    b.translate(p.x, p.y, p.z);
    // Low open bin: produce can be rolled in and players can reach both sides.
    b.roundedBox(4.1, .12, 4.1, .035, dark, true, [0, -.06, 0]);
    for (let i = 0; i < 8; i++) b.box(.47, .06, 3.95, i % 2 ? wood : pale, false,
      [-1.75 + i * .5, .035, 0]);
    for (const x of [-2, 2]) {
      b.roundedBox(.17, .35, 4.1, .025, wood, true, [x, .19, 0]);
      for (const z of [-1.9, 1.9]) b.roundedBox(.23, .52, .23, .03, dark, true, [x, .25, z]);
    }
    b.roundedBox(3.9, .35, .16, .025, wood, true, [0, .19, -2]);
    // An open front avoids obstructing a rolling Boulder Plum or the E approach.
    for (const z of [-1.2, 1.2]) b.roundedBox(.14, 2.9, .14, .02, dark, true, [2.25, 1.45, z]);
    b.roundedBox(1.1, .12, 3.3, .025, green, false, [2.25, 3, 0]);
    const texture = signTexture(['BANK FRUIT · E', '$500 CREW TARGET'],
      { title: 'EXTRACTION', bg: '#213e32', fg: '#f5e4b5', accent: '#d8b96a', h: 320 });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.35),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
    this.sign.position.set(p.x + 2.21, p.y + 2.1, p.z);
    // Face the orchard approach (-X) rather than away from the playable clearing.
    this.sign.rotation.y = -Math.PI / 2;
    finishWorldSign(b, this.sign, 3, 1.35, texture, 'orchard-extraction');
    this.root.add(this.sign);
    const backSign = this.sign.clone();
    backSign.name = 'Extraction sign from arrival';
    backSign.position.x += .10;
    backSign.rotation.y = Math.PI / 2;
    this.root.add(backSign);
    b.reset();
    // Small crates and a striped work tarp mark safety at a glance.
    for (const [x, z] of [[-3, 2.5], [-3, 3.7]]) {
      b.push().translate(p.x + x, p.y, p.z + z);
      b.roundedBox(.95, .7, .85, .04, wood, true, [0, .35, 0]);
      for (const y of [.14, .5]) b.box(1.01, .12, .9, pale, false, [0, y, 0]);
      b.pop();
    }
    // Several boundary rails frame the compact grove without a forced route.
    for (const [x, z, angle] of [[-12, 40, .4], [-27, 42, -.25], [-42, 31, 1.2],
      [-41, 12, .8], [-28, 6, .1]]) {
      b.push().translate(x, this.terrain.height(x, z), z).rotateY(angle);
      for (const side of [-1, 1]) b.roundedBox(.18, 1.2, .18, .025, dark, true, [side * 2.8, .6, 0]);
      for (const y of [.45, .95]) b.roundedBox(5.8, .14, .14, .025, wood, true, [0, y, 0]);
      b.pop();
    }
    this.props = new THREE.Mesh(b.finish()!, this.material);
    this.props.castShadow = this.props.receiveShadow = true;
    this.root.add(this.props);
  }

  override frameUpdate(): void {
    this.ocean.update(performance.now() / 1000);
    if (!this.g.has('extraction')) return;
    const run = this.g.get<{ netState(): { banked: number; secured: Array<[number, number]>; cargo?: Record<string, number> } }>('extraction').netState();
    const signature = `${run.banked}:${run.secured?.length ?? 0}`;
    if (signature === this.cargoSignature) return;
    this.cargoSignature = signature;
    this.cargo.clear();
    const cargoSpecies = Object.entries(run.cargo ?? {}).flatMap(([species, count]) =>
      Array.from({ length: Math.min(24, count) }, () => species)).slice(0, 24);
    const count = Math.min(24, Math.max(0, run.secured?.length ?? Math.ceil(run.banked / 50)));
    for (let i = 0; i < count; i++) {
      const species = cargoSpecies[i] ?? (i % 3 === 0 ? 'watermelon' : i % 2 ? 'orange' : 'apple');
      const f = new THREE.Mesh(voxelFruitGeometry(species, 8), this.material);
      f.scale.setScalar(i % 3 === 0 ? .65 : .45);
      f.position.set(this.cratePoint.x - 1.2 + (i % 5) * .55,
        this.cratePoint.y + .38 + Math.floor(i / 10) * .38,
        this.cratePoint.z - 1 + (Math.floor(i / 5) % 2) * .75);
      f.castShadow = true; this.cargo.add(f);
    }
  }
}
