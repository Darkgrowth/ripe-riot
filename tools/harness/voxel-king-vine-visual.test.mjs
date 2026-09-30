import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { KingVine } from '../../src/boss/KingVine.ts';

const fixture = () => {
  const scene = new THREE.Scene();
  const world = { kingMelonPos: new THREE.Vector3(0, 17, 0), terrain: { height: () => 0 } };
  const game = { renderer: { scene }, get: name => name === 'world' ? world : null };
  return { game, scene };
};

test('voxel King Vine telegraphs and sweeps laterally before exposing its stem', () => {
  const { game, scene } = fixture();
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel' });
  boss.init(game);
  const root = scene.getObjectByName('King Vine');
  const body = root.getObjectByName('King Vine rooted body');
  const arm = root.getObjectByName('King Vine sweeping arm');
  const core = root.getObjectByName('King Vine exposed stem');
  const guards = [root.getObjectByName('King Vine guard left'),
    root.getObjectByName('King Vine guard right')];
  assert.ok(body && arm && core && guards.every(Boolean));
  boss.frameUpdate(0.016);
  assert.equal(core.visible, false, 'stem is sheltered outside recovery');
  boss.phase = 'telegraph';
  boss.attack = 'sweep';
  boss.heading = 0;
  boss.timeLeft = 0.4;
  boss.frameUpdate(0.016);
  const bracedYaw = arm.rotation.y;
  assert.ok(root.getObjectByName('King Vine sweep warning').visible);
  boss.phase = 'sweep';
  boss.timeLeft = 0.3;
  boss.frameUpdate(0.016);
  assert.ok(arm.rotation.y > bracedYaw + 0.4,
    'visible tendril sweeps through the warned horizontal sector');
  boss.phase = 'recover';
  boss.timeLeft = 1.4;
  boss.frameUpdate(0.016);
  assert.equal(core.visible, true);
  assert.ok(Math.abs(guards[0].rotation.y) > 0.25,
    'protective leaves open to reveal the real vulnerability window');
  boss.dispose();
});

test('voxel King Vine seed originates at and follows the real projectile', () => {
  const { game, scene } = fixture();
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel' });
  boss.init(game);
  const root = scene.getObjectByName('King Vine');
  const seed = root.getObjectByName('King Vine seed pod');
  assert.ok(seed);
  boss.phase = 'telegraph';
  boss.attack = 'seed';
  boss.timeLeft = 0.5;
  boss.frameUpdate(0.016);
  assert.ok(root.getObjectByName('King Vine seed lane').visible);
  boss.phase = 'seed';
  boss.projectile = { position: [0, 1.5, 0], velocity: [0, 0, 10],
    returned: false, age: 0 };
  boss.frameUpdate(0.016);
  assert.deepEqual(seed.getWorldPosition(new THREE.Vector3()).toArray(), [0, 1.5, 0]);
  assert.ok(new THREE.Box3().setFromObject(seed).getSize(new THREE.Vector3()).length() < 2.2,
    'pod stays visually honest relative to the 1.1m return hit tolerance');
  boss.projectile.position = [0, 1.5, 7];
  boss.frameUpdate(0.016);
  assert.deepEqual(seed.getWorldPosition(new THREE.Vector3()).toArray(), [0, 1.5, 7]);
  boss.dispose();
});

test('voxel King Vine persists subdued and a client snapshot starts settled', () => {
  const { game, scene } = fixture();
  let callbacks = 0;
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel',
    onSubdued: () => callbacks++ });
  boss.init(game);
  boss.phase = 'subdued';
  boss.health = 0;
  boss.frameUpdate(0.8);
  const root = scene.getObjectByName('King Vine');
  const body = root.getObjectByName('King Vine rooted body');
  assert.equal(root.visible, true);
  assert.ok(body.rotation.x > 0.35, 'guardian folds into a persistent remnant');
  assert.equal(root.getObjectByName('King Vine melon connector').visible, false,
    'the collapsed crown no longer has a floating connector');
  const { game: clientGame, scene: clientScene } = fixture();
  const client = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel',
    authoritative: false, onSubdued: () => callbacks++ });
  client.init(clientGame);
  assert.equal(client.applySnapshot({ ...boss.snapshot(), revision: 1 }), true);
  client.frameUpdate(0.016);
  const settled = clientScene.getObjectByName('King Vine rooted body');
  assert.ok(settled.rotation.x > 0.35);
  assert.equal(callbacks, 0, 'visual hydration never replays the reward callback');
  boss.reset();
  boss.frameUpdate(0.016);
  assert.ok(Math.abs(body.rotation.x) < 0.1, 'new attempt restores the standing guardian');
  assert.equal(root.getObjectByName('King Vine melon connector').visible, true);
  boss.dispose();
  client.dispose();
});

test('subduing King Vine folds the long paddle below eye level on the first frame', () => {
  const { game, scene } = fixture();
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel' });
  boss.init(game);
  boss.frameUpdate(0.016);
  const arm = scene.getObjectByName('King Vine sweeping arm');
  boss.phase = 'subdued';
  boss.health = 0;
  boss.frameUpdate(0.016);
  const paddleMid = arm.localToWorld(new THREE.Vector3(0, -0.12, 4.7));
  assert.ok(paddleMid.y < 1.2,
    `the 4.7 m paddle midpoint clears a standing eye immediately (y=${paddleMid.y})`);
  boss.dispose();
});

test('only the nearby sweep paddle fades, and its own material is disposed', () => {
  const { game, scene } = fixture();
  const camera = new THREE.PerspectiveCamera();
  game.renderer.camera = camera;
  const boss = new KingVine({ center: [0, 0, 0], visualStyle: 'voxel' });
  boss.init(game);
  const root = scene.getObjectByName('King Vine');
  const body = root.getObjectByName('King Vine rooted body');
  const arm = root.getObjectByName('King Vine sweeping arm');
  const bodyMaterial = body.children.find(child => child.isMesh).material;
  const armMaterial = arm.children.find(child => child.isMesh).material;
  assert.notEqual(armMaterial, bodyMaterial, 'the arm fade cannot dim the body or guard leaves');

  boss.phase = 'telegraph';
  boss.attack = 'sweep';
  boss.heading = 0;
  boss.timeLeft = 0.5;
  camera.position.set(0, 2.1, 4.7);
  boss.frameUpdate(0.016);
  camera.position.copy(arm.localToWorld(new THREE.Vector3(0, -0.12, 4.7)));
  boss.frameUpdate(0.016);
  assert.ok(armMaterial.opacity >= 0.2 && armMaterial.opacity < 0.6,
    'the paddle stays visible but cannot fill a nearby camera opaquely');
  assert.equal(bodyMaterial.opacity, 1);
  assert.equal(root.getObjectByName('King Vine sweep warning').visible, true);

  camera.position.set(0, 2.1, 20);
  boss.frameUpdate(0.016);
  assert.equal(armMaterial.opacity, 1, 'normal-distance attack silhouette stays opaque');
  const disposed = new Map([[armMaterial, 0], [bodyMaterial, 0]]);
  for (const material of disposed.keys()) material.addEventListener('dispose', () => {
    disposed.set(material, disposed.get(material) + 1);
  });
  boss.dispose();
  assert.deepEqual([...disposed.values()], [1, 1]);
});
