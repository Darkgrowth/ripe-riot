import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import { Terrain } from './Terrain';
import { Ocean } from './Ocean';
import { buildLandmarks, type BuiltLandmarks } from './Landmarks';

export interface Landmark {
  id: string;
  label: string;
  position: THREE.Vector3;
  /** Rough radius used for "you are near X" checks and spawn zoning. */
  radius: number;
}

/**
 * Island 1. Owns the terrain, the sea, and the authored landmark table that
 * everything else (spawning, navigation, the shop, the legendary) refers to by
 * name rather than by hard-coded coordinates.
 */
export class Sunpatch implements System {
  readonly name = 'world';
  terrain = new Terrain();
  ocean = new Ocean();
  landmarks = new Map<string, Landmark>();
  root = new THREE.Group();
  built!: BuiltLandmarks;

  init(g: Game): void {
    this.root.name = 'Sunpatch';
    g.renderer.scene.add(this.root);
    this.terrain.build(g.renderer.scene, g.physics, true);
    this.ocean.build(g.renderer.scene, this.terrain, g.renderer.sunDir);
    this.defineLandmarks();
    this.built = buildLandmarks(g.renderer.scene, g.physics, this.terrain);
    g.renderer.refreshEnvironment(true);
    g.bus.emit('world:ready', { seed: g.seed });

    g.debug?.addAction('world.info', () => ({
      sellPad: v3(this.sellPad), sellRadius: this.sellRadius,
      shopCounter: v3(this.shopCounter), kingMelon: v3(this.kingMelonPos),
      spawn: v3(this.spawnPoint),
      landmarks: Object.fromEntries([...this.landmarks.values()]
        .map((l) => [l.id, { pos: v3(l.position), radius: l.radius, label: l.label }])),
    }));
  }

  /** Where fruit is sold. */
  get sellPad(): THREE.Vector3 { return this.built.sellPad; }
  get sellRadius(): number { return this.built.sellRadius; }
  get shopCounter(): THREE.Vector3 { return this.built.shopCounter; }
  get kingMelonPos(): THREE.Vector3 { return this.built.kingMelonPos; }

  private defineLandmarks(): void {
    const add = (id: string, label: string, x: number, z: number, radius: number, yOffset = 0) => {
      const y = this.terrain.height(x, z) + yOffset;
      this.landmarks.set(id, { id, label, position: new THREE.Vector3(x, y, z), radius });
    };
    add('dock', 'The Dock', 58, 62, 14);
    add('shop', 'Shop Shed', 45, 52, 8);
    add('orchard', 'Old Orchard', -24, 22, 26);
    add('palmBeach', 'Palm Beach', -58, 58, 22);
    add('waterfall', 'Waterfall Basin', 34, -14, 17);
    add('hillFarm', 'Hill Farm', -36, -30, 16);
    add('caveOrchard', 'Cave Orchard', 62, -8, 12);
    add('ridge', 'High Ridge', 0, -78, 14);
    add('ravine', 'The Ravine', 8, -62, 16);
  }

  at(id: string): Landmark {
    const l = this.landmarks.get(id);
    if (!l) throw new Error(`Unknown landmark: ${id}`);
    return l;
  }

  /** Ground position with a small standing offset. */
  groundAt(x: number, z: number, offset = 0.1): THREE.Vector3 {
    return new THREE.Vector3(x, this.terrain.height(x, z) + offset, z);
  }

  get spawnPoint(): THREE.Vector3 {
    // On the deck, facing back toward the island and the shop.
    return new THREE.Vector3(60.5, this.terrain.height(60.5, 70) + 2.4, 70);
  }

  frameUpdate(_dt: number, _alpha: number): void {
    // Ocean animation is driven from the render clock so it keeps moving while
    // the simulation is paused for a screenshot.
    this.ocean.update(performance.now() / 1000);
  }
}

function v3(v: THREE.Vector3): [number, number, number] {
  return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
}
