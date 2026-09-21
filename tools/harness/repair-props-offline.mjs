// CPU-only authoring checks. Font metrics here are deliberately conservative
// fixture metrics; browser screenshots and real signLayout metrics remain required.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
const root = process.cwd(), cache = new Map();
function moduleURL(file, baseline = false) {
  file = path.resolve(root, file);
  const key = `${file}:${baseline}`;
  if (cache.has(key)) return cache.get(key);
  const old = path.join(root, 'capture/zone-repair/source-before', path.basename(file));
  const source = fs.readFileSync(baseline && fs.existsSync(old) ? old : file, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from ['"]([^'"]+)['"]/g, (_, ref) => {
    const resolved = ref.startsWith('@/') ? moduleURL(`src/${ref.slice(2)}.ts`, baseline)
      : ref.startsWith('.') ? moduleURL(path.resolve(path.dirname(file), `${ref}.ts`), baseline)
        : import.meta.resolve(ref);
    return `from ${JSON.stringify(resolved)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  cache.set(key, url); return url;
}
global.document = { createElement: () => ({ getContext: () => {
  const context = { font: '12px sans-serif', measureText(text) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 12);
    return { width: Array.from(text).length * size * 0.66 };
  } };
  return new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
} }) };
const { Terrain } = await import(moduleURL('src/world/Terrain.ts'));
const terrain = new Terrain();
const current = await import(moduleURL('src/world/Landmarks.ts'));
const before = await import(moduleURL('src/world/Landmarks.ts', true));
function build(module) {
  const colliders = [], meshes = [];
  const physics = {
    createFixed: (p, q) => ({ position: p.toArray(), rotation: q.toArray() }),
    attach: (body, desc, group) => { colliders.push({ body, shape: desc.shape, group }); return {}; },
    register() {}, createTrimesh: (p, i) => meshes.push({ p: Array.from(p), i: Array.from(i) }),
  };
  const scene = new THREE.Scene(), built = module.buildLandmarks(scene, physics, terrain);
  scene.updateMatrixWorld(true); return { built, scene, colliders, meshes };
}
const a = build(before), b = build(current);
for (const name of ['sellPad', 'shopCounter', 'kingMelonPos', 'kingMelonAnchors'])
  assert.deepEqual(b.built[name], a.built[name], `${name} unchanged`);
assert.deepEqual(b.meshes, a.meshes, 'Authored trimesh collisions unchanged');
const signAudit = [];
for (const sign of b.built.signs) {
  const data = sign.userData.signAudit;
  assert.ok(data?.id, 'Every sign has capture metadata');
  assert.equal(sign.material.side, THREE.FrontSide, `${data.id} front-only text`);
  const l = data.layout;
  for (const row of l.painted) {
    assert.ok(row.x - row.width / 2 >= l.padding.x - 0.01 && row.x + row.width / 2 <= l.width - l.padding.x + 0.01, `${data.id}: ${row.text} horizontal fit`);
    assert.ok(row.y - row.height / 2 >= l.padding.y - 0.01 && row.y + row.height / 2 <= l.height - l.padding.y + 0.01, `${data.id}: ${row.text} vertical fit`);
  }
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(sign.quaternion);
  const wording = [l.title, ...l.sourceLines].join(' ');
  const destinations = [
    ['OLD ORCHARD', -24, 22], ['WATERFALL', 34, -14],
    ['HILL FARM', -36, -30], ['THE RAVINE', 8, -62],
  ];
  for (const [name, x, z] of destinations) if (wording.includes(name) && /[←→↑↓]/.test(wording)) {
    const destination = new THREE.Vector3(x-sign.position.x, 0, z-sign.position.z);
    const right = new THREE.Vector3(1,0,0).applyQuaternion(sign.quaternion);
    if (wording.includes('←')) assert.ok(destination.dot(right) < 0, `${name}: left arrow points toward destination`);
    if (wording.includes('→')) assert.ok(destination.dot(right) > 0, `${name}: right arrow points toward destination`);
    if (wording.includes('↑')) assert.ok(destination.dot(normal) < 0, `${name}: ahead arrow leads beyond board`);
    if (wording.includes('↓')) assert.ok(destination.dot(normal) > 0, `${name}: back arrow leads toward approach`);
  }
  const ray = new THREE.Raycaster(sign.position.clone().addScaledVector(normal, 0.5), normal.clone().negate(), 0, 1);
  const hit = ray.intersectObject(b.built.mesh, false)[0];
  assert.ok(hit && hit.distance >= 0.499, `${data.id}: no support through sign centre (${hit?.distance})`);
  const poses = ['front', 'back'].map(side => {
    const distance = Math.max(2.1, data.width * 1.2), direction = side === 'front' ? 1 : -1;
    const p = sign.position.clone().addScaledVector(normal, distance * direction);
    const footY = terrain.height(p.x, p.z), eyeY = footY + 1.6;
    const dx = sign.position.x - p.x, dz = sign.position.z - p.z;
    return { side, feet: [p.x, footY + 0.02, p.z], eyeHeight: 1.6,
      yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(sign.position.y - eyeY, Math.hypot(dx, dz)),
      warning: 'Pose requires live collision/accessibility check; wall backs may be inaccessible.' };
  });
  signAudit.push({ id: data.id, name: sign.name, position: sign.position.toArray(), normal: normal.toArray(),
    width: data.width, height: data.height, layout: l, poses, centreBackingDistance: hit.distance });
}
const props = b.built.mesh.geometry.userData.authoredProps;
for (const crate of props.filter(p => p.id.startsWith('shop-crate'))) {
  const c = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(crate.matrix));
  for (const barrel of props.filter(p => p.id.startsWith('shop-barrel'))) {
    const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(barrel.matrix));
    assert.ok(Math.hypot(c.x-p.x,c.z-p.z) >= crate.details.size/Math.sqrt(2)+barrel.details.radius,
      `${crate.id} does not intersect ${barrel.id}`);
  }
}
let supportedFruit = 0, groundedPoints = 0;
for (const prop of props) {
  const d = prop.details, matrix = new THREE.Matrix4().fromArray(prop.matrix);
  for (const p of d.supports ?? []) {
    const world = new THREE.Vector3(...p).applyMatrix4(matrix);
    const gap = world.y - terrain.height(world.x, world.z);
    assert.ok(gap >= -0.031 && gap <= 0.001, `${prop.id} grounded support: ${gap}`); groundedPoints++;
  }
  for (const p of d.fruitCenters ?? []) {
    assert.ok(Math.abs(p[1] - d.fruitRadius - d.floorTop) < 1e-6, `${prop.id}: fruit on crate floor`);
    assert.ok(Math.abs(p[0]) + d.fruitRadius <= d.width / 2 && Math.abs(p[2]) + d.fruitRadius <= d.width / 2,
      `${prop.id}: fruit inside crate footprint`); supportedFruit++;
  }
}
for (const attr of Object.values(b.built.mesh.geometry.attributes))
  assert.ok(Array.from(attr.array).every(Number.isFinite), 'Props geometry finite');
const out = 'capture/zone-repair/qa'; fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/sign-capture-manifest.json`, JSON.stringify(signAudit, null, 2));
fs.writeFileSync(`${out}/prop-capture-manifest.json`, JSON.stringify(props, null, 2));
const shopOrigin = new THREE.Vector3(45, terrain.height(45, 52), 52), shopYaw = -0.9;
const exteriorViews = [
  ['shop-left-stacked-crates', [-5.6, 5.5], [-3.15, 0.92, 3.7]],
  ['shop-right-crate', [5.7, 5.6], [3.25, 0.55, 3.6]],
  ['shop-side-crate', [-6.5, -0.9], [-4.0, 0.42, -0.8]],
  ['shop-main-sign', [0, 11], [0, 3.92, 5.59]],
  ['shop-wanted-sign', [6.7, 0], [3.58, 1.72, 0]],
  ['shop-island-board', [1.7, 7.6], [3.2268, 1.15, 5.0194]],
].map(([id, localFeet, localTarget]) => {
  const p = new THREE.Vector3(localFeet[0], 0, localFeet[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopYaw).add(shopOrigin);
  p.y = terrain.height(p.x, p.z) + 0.02;
  const target = new THREE.Vector3(...localTarget).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopYaw).add(shopOrigin);
  const dx = target.x - p.x, dz = target.z - p.z;
  return { id, feet: p.toArray(), target: target.toArray(), eyeHeight: 1.6,
    yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(target.y - p.y - 1.6, Math.hypot(dx, dz)),
    settleSeconds: 2, note: 'Exterior source-derived pose; inspect live collision and occlusion.' };
});
fs.writeFileSync(`${out}/repair-qa-config.json`, JSON.stringify({ exteriorViews }, null, 2));
const report = { passed: true, signs: signAudit.length, groundedPoints, supportedFruit,
  beforeTriangles: a.built.mesh.geometry.attributes.position.count / 3,
  afterTriangles: b.built.mesh.geometry.attributes.position.count / 3,
  beforeColliders: a.colliders.length, afterColliders: b.colliders.length,
  warning: 'CPU fixture font metrics only. Real browser text measurements and front/back/normal-height visual acceptance required.' };
fs.writeFileSync(`${out}/props-offline.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
