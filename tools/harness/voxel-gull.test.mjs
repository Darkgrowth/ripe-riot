import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false, port: 0 }, appType: 'custom' });
after(async () => vite.close());
const { IslandCharacters } = await vite.ssrLoadModule('/src/world/IslandCharacters.ts');

function build(mode) {
  const previous = globalThis.window;
  globalThis.window = { __RIPE_VISUAL_MODE: mode };
  try {
    const characters = new IslandCharacters();
    characters.buildGull();
    return characters;
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('voxel gull keeps its animated pivots while giving body, face, and wings joined voxel silhouettes', () => {
  const bird = build('voxel');
  assert.equal(bird.gull.name, 'SunpatchGull');
  assert.deepEqual(bird.gullHead.position.toArray(), [0, 0.4, 0.19]);
  assert.equal(bird.wings.length, 2);
  for (const [index, wing] of bird.wings.entries()) {
    assert.deepEqual(wing.position.toArray(), [index === 0 ? -0.15 : 0.15, 0.32, -0.02]);
    const mesh = wing.children[0];
    assert.equal(mesh.name, 'GullVoxelWing');
    assert.equal(mesh.geometry.userData.voxelConnectedComponents, 1);
    const box = mesh.geometry.boundingBox;
    assert.ok(box.max.x - box.min.x >= 0.68, 'flapping wing must retain broad span');
    assert.ok(box.max.z - box.min.z >= 0.30, 'wing must read from below as well as from the side');
    assert.ok(mesh.geometry.getAttribute('position').count < 18000, 'single wing stays inexpensive');
  }
  const body = bird.gull.getObjectByName('GullVoxelBody');
  const face = bird.gullHead.getObjectByName('GullVoxelFace');
  assert.ok(body);
  assert.ok(face);
  assert.equal(body.geometry.userData.voxelConnectedComponents, 1);
  assert.equal(face.geometry.userData.voxelConnectedComponents, 1);
  assert.ok(body.geometry.boundingBox.min.z <= -0.53, 'tail must identify the bird from the side');
  assert.ok(face.geometry.boundingBox.max.z >= 0.32, 'forward beak must identify the head');
  assert.ok(body.geometry.boundingBox.min.y <= 0, 'feet remain at the perch level');
  assert.ok(body.geometry.getAttribute('position').count < 25000, 'one batched body stays inexpensive');
  for (const geometry of [body.geometry, face.geometry, ...bird.wings.map(w => w.children[0].geometry)]) {
    assert.equal(geometry.getAttribute('position').count, geometry.getAttribute('color').count);
    assert.equal(geometry.getAttribute('position').count, geometry.getAttribute('normal').count);
  }
});

test('non-voxel mode preserves the original gull artwork', () => {
  const bird = build('classic');
  assert.ok(bird.gull.getObjectByName('GullBody'));
  assert.ok(bird.gullHead.getObjectByName('GullFace'));
  assert.equal(bird.wings.length, 2);
});
