import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';
const { Terrain, ROUTE_HILL, ROUTE_RAVINE, ROUTE_RAVINE_WEST } = await importBundled('src/world/Terrain.ts', 'expedition-route');

test('route grading preserves the suspended melon floor, drop and landing basin', () => {
  const terrain = new Terrain();
  // Measured from the last verified expedition baseline d5ae411.
  for (const [x, z, height] of [[8, -62, 24.253503706239883],
    [10, -57, 5.403534693315018], [15.4, -54.9, 2.7446927968017585],
    [-20, -62, 4.700874329329173]]) {
    assert.ok(Math.abs(terrain.height(x, z) - height) < 1e-9, `landing changed at ${x},${z}`);
  }
});

test('a slow-cut ridge landing has a broad walking approach from the existing farm', () => {
  const terrain = new Terrain();
  const route = [[-36,-30],[-35,-44],[-30,-53],[-31,-60],[-28,-69],[-22,-75],[-15,-77],[8,-76]];
  let worst = { degrees: 0 };
  for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1], [bx, bz] = route[i];
    const length = Math.hypot(bx - ax, bz - az);
    for (let step = 0; step <= 80; step++) for (const offset of [-1.35, 0, 1.35]) {
      const x = ax + (bx - ax) * step / 80 + (bz - az) / length * offset;
      const z = az + (bz - az) * step / 80 - (bx - ax) / length * offset;
      const degrees = Math.acos(terrain.normal(x, z).y) * 180 / Math.PI;
      if (degrees > worst.degrees) worst = { degrees, x, z };
    }
  }
  assert.ok(worst.degrees < 48, `ridge haul approach exceeds safe walking slope: ${JSON.stringify(worst)}`);
  assert.equal(terrain.height(8, -76), 30, 'the recovery approach joins the original ridge plateau');
});

test('the painted orchard-to-farm approach stays below the player climb limit across walking width', () => {
  const terrain = new Terrain();
  let worst = { degrees: 0 };
  for (let z = 4; z >= -20; z -= .4) {
    const center = -28.6 + (z - 4) * .2;
    for (const offset of [-1.35, 0, 1.35]) {
      const degrees = Math.acos(terrain.normal(center + offset, z).y) * 180 / Math.PI;
      if (degrees > worst.degrees) worst = { degrees, x: center + offset, z };
    }
  }
  assert.ok(worst.degrees < 48, `53-degree controller needs margin on mesh; worst ${JSON.stringify(worst)}`);
  assert.equal(terrain.height(-24, 22), 7.5, 'orchard terrace height stays authored');
  assert.equal(terrain.height(-36, -30), 21, 'hill farm plateau stays authored');
});

test('both lower ravine walkouts still connect to safe ground after grading the rim road', () => {
  const terrain = new Terrain();
  for (const route of [ROUTE_RAVINE, ROUTE_RAVINE_WEST]) {
    let worst = { degrees: 0 };
    for (let i = 0; i < route.length - 1; i++) for (let step = 0; step <= 60; step++) {
      const [ax, az] = route[i], [bx, bz] = route[i + 1];
      const x = ax + (bx - ax) * step / 60, z = az + (bz - az) * step / 60;
      const degrees = Math.acos(terrain.normal(x, z).y) * 180 / Math.PI;
      if (degrees > worst.degrees) worst = { degrees, x, z };
    }
    assert.ok(worst.degrees < 48, JSON.stringify(worst));
  }
});

test('the marked hill-to-ravine path is walkable in both directions', () => {
  const terrain = new Terrain();
  let worst = { degrees: 0 };
  for (let i = 6; i < ROUTE_HILL.length - 1; i++) {
    const [ax, az] = ROUTE_HILL[i], [bx, bz] = ROUTE_HILL[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    for (let step = 0; step <= 60; step++) for (const offset of [-1, 0, 1]) {
      const x = ax + (bx - ax) * step / 60 + (bz - az) / length * offset;
      const z = az + (bz - az) * step / 60 - (bx - ax) / length * offset;
      const degrees = Math.acos(terrain.normal(x, z).y) * 180 / Math.PI;
      if (degrees > worst.degrees) worst = { degrees, x, z };
    }
  }
  assert.ok(worst.degrees < 48, `marked return route exceeds safe walking slope: ${JSON.stringify(worst)}`);
});
