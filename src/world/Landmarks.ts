import * as THREE from 'three';
import { PropBuilder, signTexture } from './PropBuilder';
import { Palette } from '@/render/Palette';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { Rng } from '@/core/Rng';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const PLANK = C(0xc09461);
const PLANK_DARK = C(0x9a713f);
const POST = C(0x7d5733);
const WALL = C(0xd9bd8c);
const ROOF = C(0xc25a45);
const ROOF_DARK = C(0x9c4436);
const METAL = C(0x99a3ad);
const METAL_DARK = C(0x5d666f);
const CANVAS_RED = C(0xd8604a);
const CANVAS_CREAM = C(0xf2e3c2);
const CRATE = C(0xb8895a);
const ROPE = C(0xd6bd8a);
const STONE = C(0x8d8577);
const HULL = C(0x4b7fa8);
const HULL_DARK = C(0x2f5b7d);

/** Collision radius of the King Melon; the mesh is built to match. */
export const KING_MELON_RADIUS = 5.6;

export interface BuiltLandmarks {
  mesh: THREE.Mesh;
  signs: THREE.Mesh[];
  /** World-space centre of the sell pad. */
  sellPad: THREE.Vector3;
  sellRadius: number;
  shopCounter: THREE.Vector3;
  kingMelon: THREE.Mesh;
  kingMelonPos: THREE.Vector3;
  /** Vine anchor points on the ravine rim, all above the melon. */
  kingMelonAnchors: THREE.Vector3[];
}

/**
 * All of Sunpatch's built content: the dock you arrive at, the shed you sell
 * to, the awful little boat, and the King Melon you cannot possibly harvest yet
 * but will spend the next several hours thinking about.
 */
export function buildLandmarks(scene: THREE.Scene, physics: PhysicsWorld, terrain: Terrain): BuiltLandmarks {
  const b = new PropBuilder(physics);
  const rng = new Rng('props');
  const signs: THREE.Mesh[] = [];

  const ground = (x: number, z: number) => terrain.height(x, z);

  // ---- THE DOCK ------------------------------------------------------------
  // Runs from the shore out over the water, which is what makes arriving read
  // as arriving rather than spawning.
  const dockX = 58, dockZ = 62;
  const dockY = ground(dockX, dockZ);
  const dockDir = Math.atan2(1, 0.75);             // out toward open water
  b.reset().translate(dockX, 0, dockZ).rotateY(dockDir);

  const deckLen = 26, deckW = 5.2, deckY = dockY + 0.35;
  b.push();
  b.translate(0, deckY, 0);
  // Deck planks, laid individually so the boards read at close range.
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const z = -2 + t * deckLen;
    const shade = rng.range(0, 1);
    b.box(deckW, 0.16, deckLen / 18 - 0.06,
      shade > 0.5 ? PLANK : PLANK_DARK, false, [0, 0, z]);
  }
  // One collider for the whole deck instead of eighteen.
  b.box(deckW, 0.16, deckLen, PLANK, true, [0, -0.001, -2 + deckLen / 2]);
  b.pop();

  // Posts down into the water.
  for (let i = 0; i < 6; i++) {
    const z = -1 + (i / 5) * (deckLen - 2);
    for (const side of [-1, 1]) {
      b.push();
      const px = side * (deckW / 2 - 0.35);
      const h = deckY + 3.6;
      b.cylinder(0.19, 0.22, h, 6, POST, true, [px, deckY - h / 2 + 0.1, z]);
      b.pop();
    }
  }
  // Railing on the outer half, so nobody walks straight off in the dark.
  for (const side of [-1, 1]) {
    b.push();
    b.translate(side * (deckW / 2 - 0.2), deckY, 0);
    b.box(0.1, 0.1, deckLen - 8, POST, false, [0, 1.0, 6]);
    for (let i = 0; i < 5; i++) {
      b.box(0.13, 1.0, 0.13, POST, false, [0, 0.5, 3 + i * 2.6]);
    }
    b.pop();
  }

  // ---- THE TERRIBLE LITTLE BOAT -------------------------------------------
  b.push();
  b.translate(-4.4, deckY - 0.55, 16).rotateY(0.22);
  const hullPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    hullPts.push(new THREE.Vector2(0.05 + Math.sin(t * Math.PI * 0.92) * 1.05, t * 1.15));
  }
  const hull = new THREE.LatheGeometry(hullPts, 10);
  hull.scale(1, 1, 2.5);
  b.mesh(hull, (y) => (y < 0.55 ? HULL_DARK : HULL));
  b.box(2.0, 0.12, 0.7, PLANK, false, [0, 1.05, -0.6]);   // thwart
  b.box(2.0, 0.12, 0.7, PLANK, false, [0, 1.05, 1.1]);
  b.cylinder(0.09, 0.09, 1.9, 5, POST, false, [0.55, 1.35, 0.3]);  // a single sad oar
  b.box(0.62, 0.55, 0.5, METAL_DARK, false, [0, 1.15, -2.5]);      // outboard motor
  b.cylinder(0.06, 0.06, 0.5, 5, METAL, false, [0, 1.0, -2.9]);
  b.pop();

  // ---- SIGN AT THE DOCK HEAD ----------------------------------------------
  b.push();
  b.translate(1.9, deckY, -1.2).rotateY(-0.5);
  b.cylinder(0.09, 0.11, 2.6, 6, POST, true, [0, 1.3, 0]);
  b.pop();
  signs.push(makeSign(
    new THREE.Vector3(
      dockX + Math.cos(-dockDir) * 1.9 * 0 + Math.sin(dockDir) * 1.9,
      deckY + 2.15,
      dockZ + Math.cos(dockDir) * 1.9),
    dockDir - 0.5, 2.3, 1.5,
    signTexture(['PICK FRUIT.', 'SELL FRUIT.', 'BUY BETTER STUFF.'], { title: 'SUNPATCH' }),
  ));

  // ---- SHOP SHED + SELL PAD -----------------------------------------------
  const shopX = 45, shopZ = 52;
  const shopY = ground(shopX, shopZ);
  const shopRot = -0.9;
  b.reset().translate(shopX, shopY, shopZ).rotateY(shopRot);

  // Shed body.
  b.box(6.4, 3.2, 5.0, WALL, true, [0, 1.6, 0]);
  // Roof: two slabs, hipped.
  b.push().translate(0, 3.25, 0);
  b.push().translate(0, 0.42, -1.35).rotateX(-0.42);
  b.box(7.2, 0.22, 3.2, ROOF, false); b.pop();
  b.push().translate(0, 0.42, 1.35).rotateX(0.42);
  b.box(7.2, 0.22, 3.2, ROOF_DARK, false); b.pop();
  b.pop();
  // Counter opening facing the dock.
  b.push().translate(0, 0, 2.55);
  b.box(5.0, 0.22, 1.5, PLANK, true, [0, 1.15, 0.5]);        // counter top
  b.box(5.0, 1.05, 0.2, PLANK_DARK, true, [0, 0.52, 1.15]);  // counter front
  b.pop();
  // Striped awning over the counter.
  b.push().translate(0, 2.55, 3.15).rotateX(0.5);
  for (let i = 0; i < 7; i++) {
    b.box(0.86, 0.07, 1.9, i % 2 ? CANVAS_RED : CANVAS_CREAM, false, [-2.58 + i * 0.86, 0, 0]);
  }
  b.pop();
  b.cylinder(0.07, 0.07, 2.5, 5, POST, false, [-2.5, 1.25, 3.9]);
  b.cylinder(0.07, 0.07, 2.5, 5, POST, false, [2.5, 1.25, 3.9]);

  // Crates and barrels round the back, purely so the place looks used.
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const r = rng.range(3.6, 6.2);
    const s = rng.range(0.62, 0.92);
    b.push().translate(Math.sin(a) * r, s / 2, Math.cos(a) * r).rotateY(rng.range(0, 3.14));
    b.box(s, s, s, CRATE, true);
    b.pop();
  }
  for (let i = 0; i < 3; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    b.push().translate(Math.sin(a) * 5.4, 0.45, Math.cos(a) * 5.4);
    b.cylinder(0.36, 0.36, 0.9, 8, METAL, true);
    b.pop();
  }

  // The sell pad: a painted square with a weighing frame over it.
  const sellLocal = new THREE.Vector3(0, 0, 5.4);
  b.push().translate(sellLocal.x, 0, sellLocal.z);
  b.box(4.2, 0.10, 4.2, C(0xe0c887), true, [0, 0.05, 0]);
  for (const [ox, oz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) {
    b.box(0.2, 0.12, 0.2, C(0xd05a3c), false, [ox, 0.13, oz]);
  }
  // Weighing gantry.
  b.cylinder(0.09, 0.09, 3.0, 6, METAL_DARK, true, [-2.0, 1.5, 0]);
  b.cylinder(0.09, 0.09, 3.0, 6, METAL_DARK, true, [2.0, 1.5, 0]);
  b.box(4.4, 0.16, 0.16, METAL, false, [0, 3.0, 0]);
  b.box(0.9, 0.6, 0.14, METAL_DARK, false, [0, 2.55, 0]);
  b.pop();

  const sellPad = new THREE.Vector3(sellLocal.x, 0, sellLocal.z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));

  signs.push(makeSign(
    new THREE.Vector3(0, 3.55, 3.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
      .add(new THREE.Vector3(shopX, shopY, shopZ)),
    shopRot, 3.4, 1.15,
    signTexture(['SELL HERE  •  BUY THINGS'], { title: "MERV'S SUPPLY", h: 200, w: 640 }),
  ));

  const shopCounter = new THREE.Vector3(0, 1.4, 3.4)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));

  // ---- SCATTERED ROCKS ----------------------------------------------------
  const rockRng = new Rng('rocks');
  for (let i = 0; i < 46; i++) {
    const a = rockRng.range(0, Math.PI * 2);
    const r = rockRng.range(18, 88);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = ground(x, z);
    if (y < 1.0 || y > 34) continue;
    const s = rockRng.range(0.45, 2.3);
    b.reset().translate(x, y + s * 0.28, z).rotateY(rockRng.range(0, 6.28))
      .rotateZ(rockRng.range(-0.3, 0.3)).scale(1, rockRng.range(0.5, 0.9), 1);
    b.sphere(s, 0, STONE, s > 1.0);
  }

  // ---- WATERFALL BASIN DRESSING -------------------------------------------
  b.reset().translate(34, ground(34, -14), -14);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.push().translate(Math.cos(a) * 11, 0.2, Math.sin(a) * 11).rotateY(a);
    b.sphere(rng.range(1.1, 2.0), 0, STONE, true);
    b.pop();
  }

  // ---- THE KING MELON -----------------------------------------------------
  // Hangs over the ravine, deliberately visible from most of the island.
  //
  // The anchors are chosen FIRST and the melon is hung below the lowest of
  // them. Doing it the other way round put every anchor beneath the fruit,
  // which meant four enormous vines that could not hold up anything at all.
  const kmX = 8, kmZ = -62;
  // Anchors are SEARCHED for rather than assumed: each quadrant is sampled for
  // its highest ground within reach, because hand-picked rim coordinates landed
  // on low ground and produced four enormous vines running downward from the
  // fruit, which of course could not hold it up at all.
  const kingMelonAnchors: THREE.Vector3[] = [];
  for (let q = 0; q < 4; q++) {
    let best: THREE.Vector3 | null = null;
    for (let s2 = 0; s2 < 9; s2++) {
      const a = (q / 4) * Math.PI * 2 + Math.PI / 4 + (s2 - 4) * 0.12;
      for (const r of [20, 24, 28, 32]) {
        const ax = kmX + Math.cos(a) * r;
        const az = kmZ + Math.sin(a) * r;
        const ay = ground(ax, az);
        if (!best || ay > best.y) best = new THREE.Vector3(ax, ay, az);
      }
    }
    if (best) kingMelonAnchors.push(best.setY(best.y + 4.5));
  }
  const lowestAnchor = Math.min(...kingMelonAnchors.map((a) => a.y));
  const ravineFloor = ground(kmX, kmZ);
  // Hang it well below every anchor and well above the floor, so the vines
  // genuinely suspend it and there is real ravine left to fall into.
  const kmY = Math.max(ravineFloor + KING_MELON_RADIUS + 9, lowestAnchor - 14);
  // If the rims were not tall enough to give that clearance, lift the anchors
  // instead of lowering the fruit into the ground.
  for (const a of kingMelonAnchors) a.y = Math.max(a.y, kmY + 12);
  const kingMelonPos = new THREE.Vector3(kmX, kmY, kmZ);
  const kingMelon = buildKingMelon(kingMelonPos);
  scene.add(kingMelon);

  // The vines themselves belong to LegendaryHarvestSystem: they are real rope
  // constraints that can be cut, not decoration, so they are not baked in here.

  const merged = b.finish()!;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.04, flatShading: true,
  });
  mat.name = 'props';
  mat.envMapIntensity = 0.6;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'Props';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  for (const s of signs) scene.add(s);

  return {
    mesh, signs, sellPad, sellRadius: 3.2, shopCounter,
    kingMelon, kingMelonPos, kingMelonAnchors,
  };
}

function makeSign(pos: THREE.Vector3, rotY: number, w: number, h: number,
  tex: THREE.CanvasTexture): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(pos);
  mesh.rotation.y = rotY;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'Sign';
  return mesh;
}

/** The aspirational object. It has to look absurd from 150 metres away. */
function buildKingMelon(pos: THREE.Vector3): THREE.Mesh {
  const r = KING_MELON_RADIUS;
  const body = new THREE.SphereGeometry(1, 40, 28);
  body.scale(r * 1.08, r * 0.9, r * 1.08);
  const light = new THREE.Color().setHex(0x76bd45, THREE.SRGBColorSpace);
  const dark = new THREE.Color().setHex(0x24581f, THREE.SRGBColorSpace);
  const pos3 = body.getAttribute('position');
  const col = new Float32Array(pos3.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos3.count; i++) {
    const x = pos3.getX(i), y = pos3.getY(i), z = pos3.getZ(i);
    const theta = Math.atan2(z, x);
    const stripe = Math.sin(theta * 8) + Math.sin(y * 0.55) * 0.35;
    c.copy(light).lerp(dark, THREE.MathUtils.smoothstep(stripe, -0.2, 0.45));
    c.multiplyScalar(1 - Math.pow(Math.abs(y) / (KING_MELON_RADIUS * 0.9), 4) * 0.22);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.02,
  });
  mat.name = 'kingMelon';
  const mesh = new THREE.Mesh(body, mat);
  mesh.position.copy(pos);
  mesh.name = 'KingMelon';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
