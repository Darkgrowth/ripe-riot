import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Groups, QueryMask } from '../../src/physics/Layers.ts';
import { KingVine } from '../../src/boss/KingVine.ts';
import { importBundled } from './import-bundled.mjs';

const { PhysicsWorld } = await importBundled('src/physics/PhysicsWorld.ts', 'king-vine-clearance-physics');
const { PlayerController } = await importBundled('src/player/PlayerController.ts', 'king-vine-clearance-player');

test('King Vine rooted body keeps the player camera outside and releases its collider', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel' });
  boss.init({
    physics,
    renderer: { scene },
    get: name => name === 'world' ? { terrain: { height: () => 0 } } : null,
  });
  physics.step();

  const origin = new THREE.Vector3(0, 1.5, 3);
  const direction = new THREE.Vector3(0, 0, -1);
  const hit = physics.raycast(origin, direction, 3, QueryMask.solid);
  assert.ok(hit, 'the solid encounter body prevents a first-person eye entering the trunk');
  assert.ok(hit.distance > 1.5 && hit.distance < 2.5,
    'clearance is close to the visible trunk, leaving the stem in mallet reach');

  const floor = physics.createFixed(new THREE.Vector3(0, -0.25, 0));
  physics.attach(floor, RAPIER.ColliderDesc.cuboid(6, 0.25, 6), Groups.world);
  const player = new PlayerController(physics, 1, new THREE.Vector3(0, 0.1, 3));
  const forward = { moveX: 0, moveZ: 1, sprint: false, crouch: false,
    jump: false, jumpPressed: false };
  for (let i = 0; i < 180; i++) {
    player.step(forward, 1 / 60);
    physics.step();
  }
  assert.ok(player.position.z > 1.3 && player.position.z < 1.7,
    `walking into the guardian stops outside its bark (z=${player.position.z})`);

  boss.dispose();
  assert.equal(physics.raycast(origin, direction, 3, QueryMask.solid), null,
    'unloading the encounter removes its solid body');
});

test('a subdued guardian keeps low remnant collision without an invisible standing trunk', async () => {
  await PhysicsWorld.load();
  for (const visualStyle of ['voxel', 'baseline']) {
    const physics = new PhysicsWorld();
    physics.init();
    const scene = new THREE.Scene();
    const boss = new KingVine({ center: [0, 0, 0], visualStyle });
    boss.init({ physics, renderer: { scene },
      get: name => name === 'world' ? { terrain: { height: () => 0 } } : null });
    physics.step();
    const high = new THREE.Vector3(0, 2.6, 3);
    const low = new THREE.Vector3(0, 0.6, 3);
    const toward = new THREE.Vector3(0, 0, -1);
    assert.ok(physics.raycast(high, toward, 3, QueryMask.solid),
      `${visualStyle} standing body protects its eye-height silhouette`);

    boss.phase = 'subdued';
    boss.health = 0;
    boss.frameUpdate(0.8);
    physics.step();
    assert.equal(physics.raycast(high, toward, 3, QueryMask.solid), null,
      `${visualStyle} fallen body has no invisible full-height blocker`);
    assert.ok(physics.raycast(low, toward, 3, QueryMask.solid),
      `${visualStyle} rooted remnant still has ground-level collision`);

    boss.reset();
    boss.frameUpdate(0.016);
    physics.step();
    assert.ok(physics.raycast(high, toward, 3, QueryMask.solid),
      `${visualStyle} reset restores standing clearance`);
    boss.dispose();
  }
});
