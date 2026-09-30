import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { importBundled } from './import-bundled.mjs';

const [{ PhysicsWorld }, { Groups }, { findStandingGround, findSafeLanding }] = await Promise.all([
  importBundled('src/physics/PhysicsWorld.ts', 'safe-landing-physics'),
  importBundled('src/physics/Layers.ts', 'safe-landing-layers'),
  importBundled('src/player/SafeLanding.ts', 'safe-landing-query'),
]);
await PhysicsWorld.load();

function fixture({ height = () => 1, slope = 0 } = {}) {
  const physics = new PhysicsWorld();
  physics.init();
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope);
  const ground = physics.createFixed(new THREE.Vector3(0, 0, 0), rotation);
  physics.attach(ground, RAPIER.ColliderDesc.cuboid(20, 0.25, 20), Groups.world);
  physics.step();
  return {
    physics, terrain: { height }, playerBody: null, playerCollider: null,
    close() { physics.world.free(); },
  };
}

test('standing query accepts dry level terrain and rejects water', () => {
  const dry = fixture();
  const wet = fixture({ height: () => 0 });
  try {
    const standing = findStandingGround(dry, 0, 0);
    assert.ok(standing, 'dry floor is a viable standing location');
    assert.ok(Math.abs(standing.y - 0.37) < 0.01, 'standing foot is placed just above the floor');
    assert.equal(findStandingGround(wet, 0, 0), null, 'water cannot be a landing target');
  } finally { dry.close(); wet.close(); }
});

test('standing query rejects steep slopes and occupied capsules', () => {
  const slope = fixture({ slope: Math.PI / 3 });
  const blocked = fixture();
  try {
    const obstacle = blocked.physics.createFixed(new THREE.Vector3(2, 1, 0));
    blocked.physics.attach(obstacle, RAPIER.ColliderDesc.cuboid(0.5, 0.7, 0.5), Groups.plant);
    blocked.physics.step();
    assert.equal(findStandingGround(slope, 0, 0), null, 'a 60-degree surface is unsafe');
    assert.equal(findStandingGround(blocked, 2, 0), null, 'the worker capsule must fit at the target');
    assert.ok(findStandingGround(blocked, 4, 0), 'an unobstructed neighbor remains valid');
  } finally { slope.close(); blocked.close(); }
});

test('encounter query prefers the teammate-directed dry target within the clearing', () => {
  const world = fixture();
  try {
    const target = findSafeLanding(world, {
      desired: { x: 3, z: 2 }, center: { x: 0, z: 0 }, maxRadius: 8,
      fallback: { x: 0, z: 0 },
    });
    assert.ok(target);
    assert.equal(target.x, 3);
    assert.equal(target.z, 2);
    assert.ok(Math.hypot(target.x, target.z) <= 8);
  } finally { world.close(); }
});

test('encounter query skips a blocked aim and stays inside its radius', () => {
  const world = fixture();
  try {
    const obstacle = world.physics.createFixed(new THREE.Vector3(3, 1, 0));
    world.physics.attach(obstacle, RAPIER.ColliderDesc.cuboid(0.7, 0.7, 0.7), Groups.plant);
    world.physics.step();
    const target = findSafeLanding(world, {
      desired: { x: 3, z: 0 }, center: { x: 0, z: 0 }, maxRadius: 6,
      fallback: { x: 0, z: 0 },
    });
    assert.ok(target, 'a nearby safe spot should be found');
    assert.ok(Math.hypot(target.x - 3, target.z) >= 1.0, 'the blocked capsule was skipped');
    assert.ok(Math.hypot(target.x, target.z) <= 6, 'the throw stays in the clearing');
  } finally { world.close(); }
});

test('encounter query falls back only to a verified dry location inside its radius', () => {
  const world = fixture({ height: (x, z) => Math.hypot(x, z) < 0.2 ? 1 : 0 });
  try {
    const target = findSafeLanding(world, {
      desired: { x: 4, z: 0 }, center: { x: 0, z: 0 }, maxRadius: 6,
      fallback: { x: 0, z: 0 },
    });
    assert.ok(target);
    assert.equal(target.x, 0);
    assert.equal(target.z, 0);
    assert.equal(findSafeLanding(world, {
      desired: { x: 4, z: 0 }, center: { x: 0, z: 0 }, maxRadius: 6,
      fallback: { x: 10, z: 0 },
    }), null, 'out-of-bounds fallback cannot put the player outside the encounter');
  } finally { world.close(); }
});

test('encounter query rejects nonfinite coordinates and unsafe terrain', () => {
  const wet = fixture({ height: () => 0 });
  try {
    assert.equal(findSafeLanding(wet, {
      desired: { x: Infinity, z: 0 }, center: { x: 0, z: 0 }, maxRadius: 6,
      fallback: { x: 0, z: 0 },
    }), null);
    assert.equal(findSafeLanding(wet, {
      desired: { x: 1, z: 0 }, center: { x: 0, z: 0 }, maxRadius: 6,
      fallback: { x: 0, z: 0 },
    }), null, 'no unsafe sea-floor fallback is returned');
  } finally { wet.close(); }
});
