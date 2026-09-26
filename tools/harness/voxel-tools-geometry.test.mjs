import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(async () => vite.close());
const { voxelMalletGeometry, voxelAirCannonGeometry } =
  await vite.ssrLoadModule('/src/art/voxel/VoxelTools.ts');

function inspect(geometry) {
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const normals = geometry.getAttribute('normal');
  assert.equal(positions.count, colors.count, 'every visible face needs vertex color');
  assert.equal(positions.count, normals.count, 'every visible face needs a normal');
  assert.ok(positions.count > 600, 'tool needs more than a few primitive blocks');
  assert.ok(positions.count / 3 < 25000, 'first-person tool must stay modest in triangle count');
  assert.ok(geometry.userData.voxelCount > 0);
  assert.ok(geometry.boundingBox);
  for (const value of positions.array) assert.ok(Number.isFinite(value));
  return geometry.boundingBox;
}

test('voxel mallet keeps its striking head above a grippable shaft in the approved viewmodel envelope', () => {
  const geometry = voxelMalletGeometry();
  const box = inspect(geometry);
  assert.ok(box.min.x >= 0.025 && box.max.x <= 0.29);
  assert.ok(box.min.y >= -0.15 && box.max.y <= 0.34);
  assert.ok(box.min.z >= -0.32 && box.max.z <= -0.16);
  assert.ok(box.max.y - box.min.y > 0.36, 'mallet needs a readable long shaft');
  assert.equal(geometry.userData.voxelConnectedComponents, 1);
  geometry.dispose();
});

test('voxel Air Cannon fits two hand grips and keeps the forward bore open', () => {
  const geometry = voxelAirCannonGeometry();
  const box = inspect(geometry);
  assert.ok(box.min.x >= -0.16 && box.max.x <= 0.16);
  assert.ok(box.min.y >= -0.24 && box.max.y <= 0.09);
  assert.ok(box.min.z >= -0.50 && box.max.z <= 0.01);
  assert.ok(box.max.z - box.min.z >= 0.4, 'bell and breech must read as a cannon');
  assert.equal(geometry.userData.voxelConnectedComponents, 1,
    'gauge trim, grips and reservoir must be physically attached');
  const positions = geometry.getAttribute('position');
  let muzzleVertices = 0;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getZ(i) > box.min.z + 0.001) continue;
    muzzleVertices++;
    const radius = Math.hypot(positions.getX(i) - 0.04, positions.getY(i) + 0.065);
    assert.ok(radius >= 0.045, 'the muzzle must show a hollow bore, not a closed cap');
  }
  assert.ok(muzzleVertices > 0);
  geometry.dispose();
});
