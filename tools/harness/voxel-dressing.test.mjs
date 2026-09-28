import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { Terrain } = await vite.ssrLoadModule('/src/world/Terrain.ts');
const { Dressing } = await vite.ssrLoadModule('/src/world/Dressing.ts');
const { voxelDressingGeometry, VOXEL_DRESSING_KINDS } =
  await vite.ssrLoadModule('/src/art/voxel/VoxelDressing.ts');

function instances(scene, kind) {
  return scene.children.filter(child => child.isInstancedMesh &&
    (child.name === `Dressing:${kind}` || child.name === `Dressing:voxel:${kind}`));
}

function positions(mesh) {
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const found = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    found.push(`${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`);
  }
  return found;
}

test('voxel dressing shapes are batched exposed-face geometry with matching wind attributes', () => {
  assert.deepEqual([...VOXEL_DRESSING_KINDS].sort(), [
    'bush', 'bushBig', 'driftwood', 'fern', 'flowerHead', 'flowerStem',
    'grass', 'reed', 'stone',
  ]);
  for (const kind of VOXEL_DRESSING_KINDS) {
    const geo = voxelDressingGeometry(kind);
    assert.equal(geo.name, `VoxelDressing:${kind}`);
    assert.ok(geo.getAttribute('position').count > 0, kind);
    assert.equal(geo.getAttribute('position').count, geo.getAttribute('normal').count, kind);
    assert.equal(geo.getAttribute('position').count, geo.getAttribute('color').count, kind);
    if (kind === 'stone' || kind === 'driftwood')
      assert.equal(geo.getAttribute('swayWeight'), undefined, kind);
    else
      assert.equal(geo.getAttribute('position').count, geo.getAttribute('swayWeight').count, kind);
    assert.ok(geo.userData.voxelCount > 0, kind);
    assert.ok(geo.userData.voxelCount < 1000, `${kind} should stay cheap enough to instance`);
    geo.dispose();
  }
});

test('voxel route preserves seeded dressing and converts the shop approach', () => {
  const terrain = new Terrain();
  const originalScene = new THREE.Scene();
  const pilotScene = new THREE.Scene();
  const original = new Dressing();
  const pilot = new Dressing('voxel');
  original.build(originalScene, terrain);
  pilot.build(pilotScene, terrain);

  assert.deepEqual(pilot.counts, original.counts);
  assert.equal(pilot.total, original.total);
  assert.ok(pilotScene.children.length <= originalScene.children.length * 2,
    'the pilot should keep one instance batch per geometry and zone');
  let voxelCount = 0;
  let shopVoxelCount = 0;
  let hillVoxelCount = 0;
  let hillTrackVoxelCount = 0;
  for (const kind of VOXEL_DRESSING_KINDS) {
    const old = instances(originalScene, kind);
    const next = instances(pilotScene, kind);
    assert.equal(old.length, 1, kind);
    assert.ok(next.length >= 1 && next.length <= 2, kind);
    assert.deepEqual(next.flatMap(positions).sort(), positions(old[0]).sort(), kind);
    for (const mesh of next) {
      if (mesh.name.startsWith('Dressing:voxel:')) {
        voxelCount += mesh.count;
        assert.equal(mesh.geometry.name, `VoxelDressing:${kind}`);
      } else {
        assert.notEqual(mesh.geometry.name, `VoxelDressing:${kind}`);
      }
      for (const p of positions(mesh)) {
        const [x, , z] = p.split(',').map(Number);
        if (Math.hypot(x - 45, z - 52) <= 15) {
          assert.ok(mesh.name.startsWith('Dressing:voxel:'), `${mesh.name} at shop ${p}`);
          shopVoxelCount++;
        }
        if (Math.hypot(x + 24, z - 22) <= 30)
          assert.ok(mesh.name.startsWith('Dressing:voxel:'), `${mesh.name} at orchard ${p}`);
        if (Math.hypot(x + 36, z + 30) <= 16) {
          assert.ok(mesh.name.startsWith('Dressing:voxel:'), `${mesh.name} at Hill Farm ${p}`);
          hillVoxelCount++;
        }
        if (Math.hypot(x + 33, z + 18) <= 6) {
          assert.ok(mesh.name.startsWith('Dressing:voxel:'), `${mesh.name} on hill track ${p}`);
          hillTrackVoxelCount++;
        }
      }
    }
  }
  assert.ok(voxelCount > 40, 'orchard should have enough converted plants to read as voxel');
  assert.ok(shopVoxelCount > 10, 'shop should have enough dressing to read as voxel');
  assert.ok(hillVoxelCount > 10, 'Hill Farm should have enough voxel dressing to read as one area');
  assert.ok(hillTrackVoxelCount > 0,
    `the orchard-to-farm shoulder should not switch back to baseline (${hillTrackVoxelCount} details)`);
  original.dispose();
  pilot.dispose();
});
