import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// Vite resolves the same @/ aliases and TypeScript imports as the shipped game.
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { VoxelVolume } = await vite.ssrLoadModule('/src/art/voxel/VoxelSurface.ts');
const { voxelFruitGeometry } = await vite.ssrLoadModule('/src/art/voxel/VoxelFruit.ts');
const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');
const { plantShape, swayCurve } = await vite.ssrLoadModule('/src/plants/PlantGeometry.ts');

test('adjacent occupied cells expose ten faces and carry vertex colors, normals and sway', () => {
  const volume = new VoxelVolume();
  volume.put(0, 0, 0, 0x884422);
  volume.put(1, 0, 0, 0x884422);
  const geo = volume.geometry({ cellSize: 1, swayHeight: 2 });
  assert.equal(volume.connectedComponents(), 1);
  assert.equal(geo.getAttribute('position').count, 60, 'shared internal faces should be culled');
  assert.equal(geo.getAttribute('normal').count, 60);
  assert.equal(geo.getAttribute('color').count, 60);
  assert.equal(geo.getAttribute('swayWeight').count, 60);
  assert.equal(geo.boundingBox.min.x, 0);
  assert.equal(geo.boundingBox.max.x, 2);
  const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal');
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i + 1) - pos.getX(i), ay = pos.getY(i + 1) - pos.getY(i), az = pos.getZ(i + 1) - pos.getZ(i);
    const bx = pos.getX(i + 2) - pos.getX(i), by = pos.getY(i + 2) - pos.getY(i), bz = pos.getZ(i + 2) - pos.getZ(i);
    const dot = (ay * bz - az * by) * normal.getX(i)
      + (az * bx - ax * bz) * normal.getY(i)
      + (ax * by - ay * bx) * normal.getZ(i);
    assert.ok(dot > 0, `triangle ${i / 3} must face its outward normal`);
  }
  geo.dispose();
});

test('ordinary voxel fruit preserve the unit-diameter instancing envelope', () => {
  for (const species of ['apple', 'orange', 'watermelon']) {
    const geo = voxelFruitGeometry(species);
    const box = geo.boundingBox;
    assert.ok(box.max.x - box.min.x >= 0.88 && box.max.x - box.min.x <= 1.07, species);
    assert.ok(box.max.z - box.min.z >= 0.88 && box.max.z - box.min.z <= 1.07, species);
    assert.ok(box.min.y >= -0.55 && box.max.y <= 0.65, species);
    assert.equal(geo.getAttribute('color').count, geo.getAttribute('position').count);
    assert.equal(geo.getAttribute('normal').count, geo.getAttribute('position').count);
    assert.ok(geo.getAttribute('position').count > 500, species);
    assert.equal(geo.userData.voxelConnectedComponents, 1, species);
  }
});

test('distant voxel fruit keep their unit envelope with substantially fewer faces', () => {
  for (const species of ['apple', 'orange', 'watermelon']) {
    const near = voxelFruitGeometry(species, 20);
    const far = voxelFruitGeometry(species, 8);
    assert.ok(far.getAttribute('position').count < near.getAttribute('position').count * 0.4,
      `${species} distant fruit should materially lower rendered triangles`);
    for (const axis of ['x', 'z']) {
      const width = far.boundingBox.max[axis] - far.boundingBox.min[axis];
      assert.ok(width > 0.80 && width <= 1.12, `${species} far ${axis} envelope`);
    }
    assert.ok(far.boundingBox.min.y >= -0.55 && far.boundingBox.max.y <= 0.68);
    assert.equal(far.userData.voxelConnectedComponents, 1);
  }
});

test('joined voxel faces use one sway curve across bark and leaf colors', () => {
  const geo = voxelPlantShape('appleTree', 0, true).geometry;
  const pos = geo.getAttribute('position'), sway = geo.getAttribute('swayWeight');
  const byPoint = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    const before = byPoint.get(key);
    if (before !== undefined) assert.ok(Math.abs(before - sway.getX(i)) < 1e-8,
      'shared exposed corners must move together in the GPU wind shader');
    byPoint.set(key, sway.getX(i));
  }
});

test('voxel orchard trees preserve every harvest point and trunk collider', () => {
  for (const type of ['appleTree', 'orangeTree']) for (const variant of [0, 1, 2]) {
    const old = plantShape(type, variant, true);
    const next = voxelPlantShape(type, variant, true);
    assert.equal(next.height, old.height);
    assert.deepEqual(next.collider, old.collider);
    assert.equal(next.attachPoints.length, old.attachPoints.length);
    next.attachPoints.forEach((pt, i) => assert.ok(pt.distanceTo(old.attachPoints[i]) < 1e-8));
    assert.equal(next.geometry.userData.voxelConnectedComponents, 1, `${type} ${variant}`);
    const pos = next.geometry.getAttribute('position');
    assert.ok(pos.count / 3 <= 11000,
      `${type} ${variant} must stay within the earlier apple-tree triangle envelope`);
    const sway = next.geometry.getAttribute('swayWeight');
    assert.equal(pos.count, sway.count);
    assert.ok(next.geometry.boundingBox.min.y >= -0.01);
    assert.ok(next.geometry.boundingBox.max.y <= next.height + 0.35);
    assert.ok(Array.from(sway.array).some(weight => weight > 0.6));
    for (const pt of next.attachPoints) {
      let near = false;
      let nearestTip2 = Infinity, tipSway = 0;
      for (let i = 0; i < pos.count; i++) {
        const distance2 = (pos.getX(i) - pt.x) ** 2
          + (pos.getY(i) - pt.y) ** 2 + (pos.getZ(i) - pt.z) ** 2;
        if (distance2 < 0.26 ** 2) { near = true; break; }
      }
      assert.ok(near, `${type} ${variant} has a fruit node floating away from its surface`);
      for (let i = 0; i < pos.count; i++) {
        const distance2 = (pos.getX(i) - pt.x) ** 2
          + (pos.getY(i) - pt.y - 0.16) ** 2 + (pos.getZ(i) - pt.z) ** 2;
        if (distance2 < nearestTip2) { nearestTip2 = distance2; tipSway = sway.getX(i); }
      }
      assert.ok(tipSway >= swayCurve(pt.y, next.height) * 0.9,
        `${type} ${variant} fruit spur should follow its attached fruit in wind`);
    }
  }
});

test('orchard crown variants have distinct spreading, upright and windswept silhouettes', () => {
  const leafProfile = (type, variant) => {
    const shape = voxelPlantShape(type, variant, true);
    const positions = shape.geometry.getAttribute('position');
    const colors = shape.geometry.getAttribute('color');
    let minX = Infinity, maxX = -Infinity, top = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      if (colors.getY(i) < colors.getX(i) * 1.2) continue;
      minX = Math.min(minX, positions.getX(i));
      maxX = Math.max(maxX, positions.getX(i));
      top = Math.max(top, positions.getY(i));
    }
    return { width: maxX - minX, skew: maxX + minX,
      crownHeight: top - shape.collider.offset * 2 };
  };
  for (const type of ['appleTree', 'orangeTree']) {
    const spreading = leafProfile(type, 0);
    const upright = leafProfile(type, 1);
    const windswept = leafProfile(type, 2);
    assert.ok(spreading.width > upright.width * 1.15,
      `${type}: spreading crown should be visibly wider than upright`);
    assert.ok(upright.crownHeight > spreading.crownHeight + 0.15,
      `${type}: upright crown should visibly rise above spreading`);
    assert.ok(Math.abs(windswept.skew) > 0.35,
      `${type}: windswept crown should favor one side`);
  }
});

test('fruit-tree archetypes read as a pruned shelf, open boughs and a wind-shaped crown', () => {
  const profile = (variant) => {
    const shape = voxelPlantShape('appleTree', variant, true);
    const positions = shape.geometry.getAttribute('position');
    const colors = shape.geometry.getAttribute('color');
    const leaf = [], middle = [], upper = [];
    for (let i = 0; i < positions.count; i++) {
      if (colors.getY(i) < colors.getX(i) * 1.2) continue;
      const point = { x: positions.getX(i), y: positions.getY(i) };
      leaf.push(point);
      if (point.y >= 3.2 && point.y < 4.3) middle.push(point);
      if (point.y >= 4.3) upper.push(point);
    }
    const width = points => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
    return {
      upperToMiddleWidth: width(upper) / width(middle),
      lowFraction: leaf.filter(p => p.y < shape.collider.offset * 2 + 0.15).length / leaf.length,
      canopyBias: leaf.reduce((sum, p) => sum + p.x, 0) / leaf.length,
    };
  };
  const broad = profile(0), open = profile(1), wind = profile(2);
  assert.ok(broad.upperToMiddleWidth > 0.72,
    'pruned crown needs a broad upper shelf rather than a round top');
  assert.ok(open.lowFraction < 0.25,
    'open tree needs visible forked boughs below its leaf crowns');
  assert.ok(wind.canopyBias > 0.55,
    'wind-shaped tree needs most foliage on its sheltered side');
});

test('voxel melon vine retains its single saved fruit node and ground-level sway geometry', () => {
  for (const variant of [0, 1, 2]) {
    const old = plantShape('melonVine', variant, false);
    const next = voxelPlantShape('melonVine', variant, false);
    assert.equal(next.height, old.height);
    assert.deepEqual(next.collider, old.collider);
    assert.equal(next.attachPoints.length, 1);
    assert.ok(next.attachPoints[0].distanceTo(old.attachPoints[0]) < 1e-8);
    assert.equal(next.geometry.userData.voxelConnectedComponents, 1);
    assert.equal(next.geometry.getAttribute('position').count,
      next.geometry.getAttribute('swayWeight').count);
    assert.ok(next.geometry.boundingBox.max.y <= next.height + 0.05);
    assert.ok(next.geometry.boundingBox.max.x - next.geometry.boundingBox.min.x > 1.2);
    assert.ok(next.geometry.boundingBox.max.z - next.geometry.boundingBox.min.z > 1.2);
  }
});

test('approach banana fronds remain one connected swaying plant with the old collider', () => {
  for (const variant of [0, 1, 2]) {
    const old = plantShape('bananaPlant', variant, false);
    const next = voxelPlantShape('bananaPlant', variant, false);
    assert.equal(next.height, old.height);
    assert.deepEqual(next.collider, old.collider);
    assert.equal(next.geometry.userData.voxelConnectedComponents, 1,
      `banana variant ${variant} has detached leaf voxels`);
    assert.equal(next.geometry.getAttribute('position').count,
      next.geometry.getAttribute('swayWeight').count);
  }
});
