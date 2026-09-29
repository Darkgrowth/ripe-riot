import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { importBundled } from './import-bundled.mjs';

const [{ PhysicsWorld }, { Terrain }, { PropBuilder }, { buildMelonReceiver }, { Groups }, { STAND_HEIGHT, PLAYER_RADIUS }] = await Promise.all([
  importBundled('src/physics/PhysicsWorld.ts', 'receiver-physics'),
  importBundled('src/world/Terrain.ts', 'receiver-terrain'),
  importBundled('src/world/PropBuilder.ts', 'receiver-builder'),
  importBundled('src/world/MelonReceiver.ts', 'receiver-world'),
  importBundled('src/physics/Layers.ts', 'receiver-layers'),
  importBundled('src/player/PlayerDimensions.ts', 'receiver-player-size'),
]);
await PhysicsWorld.load();

function fixture(receiver) {
  const physics = new PhysicsWorld(); physics.init();
  const terrain = new Terrain(); terrain.build(new THREE.Scene(), physics);
  const props = new PropBuilder(physics);
  if (receiver) buildMelonReceiver(props, terrain);
  const geometry = props.finish();
  return { physics, terrain, close() { geometry?.dispose(); terrain.dispose(); physics.world.free(); } };
}

test('visible receiver arrests a real 2600kg sphere inside the unchanged extraction volume', () => {
  for (const receiver of [false, true]) {
    const f = fixture(receiver), p = f.physics;
    try {
      // Position observed during the ridge haul, with representative incoming
      // motion. This is a physics fixture, separate from ordinary-input proof.
      const ball = p.createDynamic(new THREE.Vector3(.4, 24.8, -54.5),
        { linearDamping: .12, angularDamping: .35, ccd: true, canSleep: true });
      p.attach(ball, RAPIER.ColliderDesc.ball(5.6).setFriction(.85).setRestitution(.06).setMass(2600), Groups.fruit);
      ball.setLinvel({ x: 6, y: -3, z: 8 }, true);
      for (let step = 0; step < 1800; step++) p.step();
      const at = ball.translation(), velocity = ball.linvel();
      const inPad = Math.hypot(at.x - 10.42774038, at.z + 56.52040618) < 15
        && at.y > .6789162 && at.y < 16.9989162;
      assert.equal(inPad, receiver, JSON.stringify({ receiver, at }));
      if (receiver) {
        assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) < 1.6, 'the timbers physically stop it');
        assert.ok(f.terrain.height(at.x, at.z) > 0, 'the catch remains on dry ground');
      }
    } finally { f.close(); }
  }
});

test('the existing east walkout has player clearance beneath the catch rails', () => {
  const f = fixture(true);
  try {
    f.physics.step();
    const x = 14.5;
    // Follow the downhill floor as the character does; a horizontal cast at
    // the highest floor height would lift the player into the lowest rail.
    for (let z = -43; z < -35; z += .25) {
      const y = f.terrain.height(x, z) + STAND_HEIGHT / 2 + .1;
      const nextY = f.terrain.height(x, z + .25) + STAND_HEIGHT / 2 + .1;
      const hit = f.physics.world.castShape({ x, y, z },
        { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: nextY - y, z: .25 },
        new RAPIER.Capsule((STAND_HEIGHT - 2 * PLAYER_RADIUS) / 2, PLAYER_RADIUS),
        0, 1, true, undefined, Groups.player);
      // Do not format the Rapier world on failure: it retains a large WASM heap.
      assert.ok(hit === null, `player clearance at z=${z}, hit time=${hit?.time_of_impact ?? 'none'}`);
    }
  } finally { f.close(); }
});
