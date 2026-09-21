// Offline invariants for the orchard proof and the split leaf/chip FX pool.
// Run before committing the art pass; compare gameplay contracts with HEAD.
// No renderer, browser, or live physics world is started.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root = fileURLToPath(new URL('../..', import.meta.url));
const modules = new Map();
function moduleURL(file, baseline = false) {
  file = path.resolve(root, file);
  const key = `${baseline}:${file}`;
  if (modules.has(key)) return modules.get(key);
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const source = baseline
    ? execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(file, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  js = js.replace(/from ['"]([^'"]+)['"]/g, (_, ref) => {
    const url = ref.startsWith('@/') ? moduleURL(`src/${ref.slice(2)}.ts`, baseline)
      : ref.startsWith('.') ? moduleURL(path.resolve(path.dirname(file), `${ref}.ts`), baseline)
        : import.meta.resolve(ref);
    return `from ${JSON.stringify(url)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  modules.set(key, url);
  return url;
}
const current = await import(moduleURL('src/plants/PlantGeometry.ts'));
const before = await import(moduleURL('src/plants/PlantGeometry.ts', true));
const shapeContract = s => JSON.stringify({
  attach: s.attachPoints, collider: s.collider, height: s.height,
});
let shapes = 0;
for (const type of ['appleTree', 'orangeTree']) for (let variant = 0; variant < 3; variant++) {
  const expected = shapeContract(before.plantShape(type, variant));
  for (const proof of [false, true]) {
    const shape = current.plantShape(type, variant, proof);
    assert.equal(shapeContract(shape), expected, `${type}:${variant} proof=${proof} contract`);
    for (const [name, attribute] of Object.entries(shape.geometry.attributes)) {
      assert.ok(Array.from(attribute.array).every(Number.isFinite), `${type}:${variant} ${name} finite`);
    }
    shapes++;
  }
}

const { PlantSystem } = await import(moduleURL('src/plants/Plants.ts'));
const { PlantSystem: OldPlants } = await import(moduleURL('src/plants/Plants.ts', true));
const { Rng } = await import(moduleURL('src/core/Rng.ts'));
const { ORCHARD_PROOF } = await import(moduleURL('src/world/VisualProof.ts'));
function plantFixture(Type) {
  const colliders = [];
  const physics = {
    createFixed: position => ({ position: position.clone() }),
    attach: (body, descriptor, group) => {
      colliders.push({ position: body.position, shape: descriptor.shape, group });
      return {};
    },
    register() {},
  };
  return { plants: new Type(new THREE.Scene(), physics), rng: new Rng('proof-invariant'), colliders };
}
const a = plantFixture(OldPlants), b = plantFixture(PlantSystem);
const plantContract = p => JSON.stringify({
  id: p.id, type: p.type, variant: p.variant, position: p.position,
  rotationY: p.rotationY, scale: p.scale, height: p.height, phase: p.phase,
  tint: p.tint, nodes: p.nodes,
});
// Include enough plants of both kinds on each side to exercise batch growth.
for (let i = 0; i < 240; i++) {
  const type = i % 2 ? 'orangeTree' : 'appleTree';
  const position = new THREE.Vector3(ORCHARD_PROOF.x + (i % 4 < 2 ? 0 : 40), 7.5, ORCHARD_PROOF.z);
  const pa = a.plants.plant(1000 + i, type, position, a.rng, { variant: 0 });
  const pb = b.plants.plant(1000 + i, type, position, b.rng, { variant: 0 });
  assert.equal(plantContract(pb), plantContract(pa), `plant ${i} identity/nodes/random state`);
}
assert.equal(a.rng.next(), b.rng.next(), 'plant placement consumes identical RNG stream');
assert.equal(JSON.stringify(a.colliders), JSON.stringify(b.colliders), 'plant collider transforms/shapes unchanged');
assert.equal(a.plants.count, b.plants.count, 'plant count unchanged');

const { ImpactFX } = await import(moduleURL('src/fx/ImpactFX.ts'));
const actions = new Map(), handlers = new Map(), scene = new THREE.Scene();
const fx = new ImpactFX();
fx.init({
  get: name => name === 'world' ? { terrain: { height: () => 0 } }
    : { wind: new THREE.Vector3(1, 0, 0), get: () => ({ position: new THREE.Vector3(0, 5, 0), radius: 0.2 }) },
  renderer: { scene },
  bus: { on: (name, fn) => handlers.set(name, fn) },
  debug: { addProbe() {}, addAction: (name, fn) => actions.set(name, fn) },
});
const chips = scene.getObjectByName('ImpactFX'), leaves = scene.getObjectByName('PickupLeaves');
const leafPick = () => handlers.get('fruit:detached')({ fruitId: 1, cause: 'hand' });
const burst = n => actions.get('fx.burst')(0, 5, 0, n);
leafPick(); burst(10); fx.frameUpdate();
assert.equal(leaves.count, 5); assert.equal(chips.count, 10);
fx.fixedStep(3); fx.frameUpdate();
assert.equal(leaves.count + chips.count, 0, 'last expiry clears both meshes');
burst(10); fx.frameUpdate();
assert.equal(chips.count, 10); assert.equal(leaves.count, 0, 'recycled leaves do not become leaf-shaped chips');
fx.fixedStep(3); fx.frameUpdate();
leafPick(); fx.frameUpdate();
assert.equal(chips.count, 0); assert.equal(leaves.count, 5, 'recycled chips can become leaves');
fx.fixedStep(3); fx.frameUpdate();
burst(480); fx.frameUpdate();
assert.equal(chips.count + leaves.count, 480, 'overflow stays bounded');
assert.equal(leaves.count, 0, 'overflow resets particle material kind');
leafPick(); fx.frameUpdate();
assert.equal(chips.count, 475); assert.equal(leaves.count, 5, 'mixed overflow compacts each mesh');
burst(5); fx.frameUpdate();
assert.equal(chips.count, 480); assert.equal(leaves.count, 0, 'overwriting live leaves resets their material kind');
actions.get('fx.enable')(false);
const emitted = fx.spawned;
burst(12); leafPick(); assert.equal(fx.spawned, emitted, 'disabled FX emits nothing');
fx.fixedStep(3); fx.frameUpdate();
assert.equal(chips.count + leaves.count, 0, 'disabled FX still expires existing particles');
let disposed = 0;
for (const object of [chips, leaves]) for (const resource of [object.geometry, object.material]) {
  resource.addEventListener('dispose', () => disposed++);
}
fx.dispose();
assert.equal(scene.children.length, 0); assert.equal(disposed, 4, 'both meshes release geometry/material');
console.log(`Visual invariants PASS: ${shapes} shapes; 240 plants including batch growth; matching IDs, nodes, colliders and RNG; FX mixing, expiry, reuse, overflow, disable and disposal.`);
