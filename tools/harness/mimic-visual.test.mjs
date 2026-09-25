import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EncounterVisual } from '../../src/enemies/EncounterVisuals.ts';

const state = (phase, timeLeft = 0, health = 3) => ({
  kind: 'mimic', position: [0, 0, 0], heading: 0, phase, timeLeft, health,
  baited: false, capturedVictimId: null, captureTimeLeft: 0,
});

for (const style of ['polygon', 'block']) {
  test(`${style} Mimic has the same rooted split-shell anatomy and readable poses`, () => {
    const scene = new THREE.Scene();
    const visual = new EncounterVisual('mimic', scene, style);
    const anatomy = visual.root.getObjectByName('Mimic anatomy');
    const upper = visual.root.getObjectByName('Mimic upper rind');
    const lower = visual.root.getObjectByName('Mimic lower rind');
    const roots = visual.root.getObjectByName('Mimic roots');
    const body = visual.root.getObjectByName('Mimic body');
    assert.ok(anatomy && upper && lower && roots,
      'rind halves and four supporting roots are articulated parts, not face decals');
    assert.equal(roots.children.length, 4);

    visual.update(state('idle'), 0, 0.016);
    const closed = upper.rotation.x;
    visual.update(state('warn', 0.12), 0, 0.65);
    assert.ok(upper.rotation.x < closed - 0.2, 'wind-up opens the actual upper rind');
    visual.update(state('attack', 0.7), 0, 0.15);
    visual.update(state('stagger', 0.4, 2), 0, 0.08);
    assert.ok(Math.abs(body.rotation.z) > 0.08, 'hit interrupts with a body reaction');
    assert.equal(visual.root.getObjectByName('Mimic chips')?.visible, true);
    visual.update(state('recover', 0.8, 2), 0, 0.2);
    assert.ok(upper.rotation.x < -0.1, 'miss or hit exposes the mouth during recovery');
    visual.update(state('defeated', 0, 0), 0, 0.05);
    assert.equal(visual.root.visible, true, 'defeat leaves a readable collapse before harvest');
    visual.update(state('defeated', 0, 0), 0, 2.3);
    assert.equal(visual.root.visible, false);
    visual.dispose();
  });
}

test('A/B anatomy fits the same hitbox scale while block detail stays batched', () => {
  const results = [];
  for (const style of ['polygon', 'block']) {
    const visual = new EncounterVisual('mimic', new THREE.Scene(), style);
    visual.update(state('idle'), 0, 0);
    const anatomy = visual.root.getObjectByName('Mimic anatomy');
    assert.ok(anatomy, 'each style exposes one comparable creature anatomy');
    const box = new THREE.Box3().setFromObject(anatomy);
    const size = box.getSize(new THREE.Vector3());
    let meshes = 0;
    anatomy.traverse(o => { if (o.isMesh) meshes++; });
    results.push({ size, meshes, visual });
  }
  assert.ok(Math.abs(results[0].size.x - results[1].size.x) < 0.28);
  assert.ok(Math.abs(results[0].size.y - results[1].size.y) < 0.28);
  assert.ok(Math.abs(results[0].size.z - results[1].size.z) < 0.28);
  assert.ok(results[1].meshes <= 24,
    `block parts must be batched, got ${results[1].meshes} individual meshes`);
  assert.ok(results[1].visual.root.getObjectByName('Mimic upper rind')
    .getObjectByName('Mimic block upper batch'));
  results.forEach(r => r.visual.dispose());
});
