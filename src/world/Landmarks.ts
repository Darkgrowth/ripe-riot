import * as THREE from 'three';
import { PropBuilder, signTexture, finishWorldSign } from './PropBuilder';
import { Palette } from '@/render/Palette';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { Rng } from '@/core/Rng';
import { buildAnchorCrags, buildIslandWorksites } from './IslandWorksites';
import { buildKingMelonGeometry } from './KingMelonGeometry';
import { buildGroveArch } from './GroveArch';
import { voxelRockGeometry } from '@/art/voxel/VoxelRock';
import type { VisualMode } from '@/art/voxel/VisualMode';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const PLANK = C(0xc09461);
const PLANK_LIGHT = C(0xd8b07a);
const PLANK_DARK = C(0x8a5f2f);
/** Deliberately near-black: it sits under the decking so every seam between
 *  boards reads as a shadow line instead of a hole through to the sea. */
const PLANK_SHADOW = C(0x3d2a17);
const POST = C(0x7d5733);
const POST_WET = C(0x4c3722);
const WALL = C(0xe4cb9c);
const WALL_SHADE = C(0xc9ab7c);
const ROOF = C(0xc25a45);
const ROOF_DARK = C(0x9c4436);
const ROOF_RIDGE = C(0x7f3529);
const GLASS = C(0x2b3f4a);
const LAMP = C(0xffe9a8);
const LAMP_HOT = C(0xfff6d8);
const CHALK = C(0x2f3a35);
const SACK = C(0xcbb083);
const APPLE = C(0xd2402f);
const ORANGE = C(0xe8862c);
const LEAF = C(0x4f9e35);
const METAL = C(0x99a3ad);
const METAL_DARK = C(0x5d666f);
const CANVAS_RED = C(0xd8604a);
const CANVAS_CREAM = C(0xf2e3c2);
const CRATE = C(0xa9793f);
const ROPE = C(0xd6bd8a);
const STONE = C(0x9a9082);
const STONE_DARK = C(0x6d675c);
const STONE_WET = C(0x565349);
const HULL = C(0x4b7fa8);
const HULL_DARK = C(0x2f5b7d);

/** Collision radius of the King Melon; the mesh is built to match. */
export const KING_MELON_RADIUS = 5.6;

/**
 * The dock's authored frame, published so that spawning is derived from the
 * deck that actually exists rather than from world coordinates guessed to be
 * near it. The shipped spawn was 4.9 m off the side of the deck, on the sand.
 */
export interface DockFrame {
  /** Heading of the deck's long axis, pointing OUT toward open water. Read as a
   *  player yaw it faces back down the deck toward the island. */
  dir: number;
  /** Top of the walkable planking. */
  deckTop: number;
  /** Local (x, z) on the deck -> world position, on the planking by default.
   *  Local +Z runs seaward from the shore end; local +X is to the right of
   *  someone walking that way. */
  toWorld(localX: number, localZ: number, y?: number): THREE.Vector3;
}

export interface BuiltLandmarks {
  mesh: THREE.Mesh;
  /** A group: the main sheet, two flanking sheets and the spray at its foot. */
  waterfall: THREE.Object3D;
  signs: THREE.Mesh[];
  dock: DockFrame;
  /** World-space centre of the sell pad. */
  sellPad: THREE.Vector3;
  sellRadius: number;
  shopCounter: THREE.Vector3;
  kingMelon: THREE.Mesh;
  kingMelonPos: THREE.Vector3;
  /** Vine anchor points on the ravine rim, all above the melon. */
  kingMelonAnchors: THREE.Vector3[];
  /** The board by the counter that lists the islands, and its two faces. */
  islandBoard: THREE.Mesh;
  islandBoardLocked: THREE.CanvasTexture;
  islandBoardOpen: THREE.CanvasTexture;
  /** The pennant that goes up on the boat when the next island opens. */
  boatFlag: THREE.Group;
}

/**
 * All of Sunpatch's built content: the dock you arrive at, the shed you sell
 * to, the awful little boat, and the King Melon you cannot possibly harvest yet
 * but will spend the next several hours thinking about.
 */
export function buildLandmarks(scene: THREE.Scene, physics: PhysicsWorld, terrain: Terrain,
  visualMode: VisualMode = 'baseline'): BuiltLandmarks {
  const b = new PropBuilder(physics);
  const rng = new Rng('props');
  const signs: THREE.Mesh[] = [];

  const ground = (x: number, z: number) => terrain.height(x, z);
  let rockVariant = 0;
  const boulder = (radius: number, color: THREE.Color, collide: boolean) =>
    b.sphere(radius, 0, color, collide, [0, 0, 0],
      visualMode === 'voxel' ? voxelRockGeometry(radius, rockVariant++) : undefined);
  const localGround = (x: number, z: number, originX: number, originY: number, originZ: number, rot: number) =>
    ground(originX + x * Math.cos(rot) + z * Math.sin(rot),
      originZ - x * Math.sin(rot) + z * Math.cos(rot)) - originY;
  const timberBetween = (a: THREE.Vector3, end: THREE.Vector3, width: number, depth: number, tint: THREE.Color) => {
    const delta = end.clone().sub(a);
    const g = new THREE.BoxGeometry(width, delta.length(), depth);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    g.translate(...a.clone().add(end).multiplyScalar(0.5).toArray() as [number, number, number]);
    b.mesh(g, tint);
  };

  // ---- THE DOCK ------------------------------------------------------------
  // Runs from the shore out over the water, which is what makes arriving read
  // as arriving rather than spawning.
  const dockX = 58, dockZ = 62;
  const dockY = ground(dockX, dockZ);
  const dockDir = Math.atan2(1, 0.75);             // out toward open water
  b.reset().translate(dockX, 0, dockZ).rotateY(dockDir);

  const deckLen = 26, deckW = 5.2, deckY = dockY + 0.35;
  const deckThickness = 0.16;
  const dock: DockFrame = {
    dir: dockDir,
    deckTop: deckY + deckThickness / 2,
    toWorld(localX: number, localZ: number, y?: number) {
      // rotateY(dir): local +X -> (cos, 0, -sin), local +Z -> (sin, 0, cos).
      const s = Math.sin(dockDir), c = Math.cos(dockDir);
      return new THREE.Vector3(
        dockX + localX * c + localZ * s,
        y ?? deckY + deckThickness / 2,
        dockZ - localX * s + localZ * c);
    },
  };
  // Decking. A dark board runs the length of the deck UNDER the planking, so
  // every seam reads as a shadow line instead of a hole through to the sea.
  // Before it, one collider box was drawn as well as collided with, sitting
  // flush beneath eighteen planks and filling every gap between them: the deck
  // rendered as a single flat slab of tan in the opening shot of the game.
  b.push();
  b.translate(0, deckY, 0);
  b.box(deckW - 0.06, 0.13, deckLen, PLANK_SHADOW, false, [0, -0.11, -2 + deckLen / 2]);

  const PLANKS = 42;
  const pitch = deckLen / PLANKS;
  for (let i = 0; i < PLANKS; i++) {
    const z = -2 + (i + 0.5) * pitch;
    // Three tones rather than two. Strict alternation reads as a painted
    // stripe; a weighted draw from three tones reads as timber.
    const tone = rng.next();
    const col = tone > 0.74 ? PLANK_LIGHT : tone > 0.34 ? PLANK : PLANK_DARK;
    b.box(deckW - 0.30, 0.16, pitch - 0.085, col, false, [rng.range(-0.03, 0.03), 0, z]);
    // Staggered end joints, nail heads and sparse grain cut the broad stripes
    // into believable boards. No extra RNG calls: existing props keep their seed.
    const joint = [-0.85, 0.65, -0.15, 1.25][i % 4];
    b.box(0.022, 0.008, pitch - 0.09, PLANK_SHADOW, false, [joint, 0.083, z]);
    for (const nx of [-2.13, joint - 0.075, joint + 0.075, 2.13]) {
      for (const nz of [-0.17, 0.17])
        b.cylinder(0.018, 0.018, 0.012, 5, METAL_DARK, false, [nx, 0.086, z + nz]);
    }
    if (i % 3 !== 0) {
      b.box(1.12 + (i % 4) * 0.16, 0.006, 0.012, PLANK_DARK, false,
        [i % 2 ? -1.15 : 0.95, 0.084, z + 0.09]);
    }
  }
  // Rim boards down each side: they give the deck an edge, and stop the
  // planking ending in mid-air when you look along it.
  for (const side of [-1, 1]) {
    b.box(0.22, 0.19, deckLen, PLANK_DARK, false,
      [side * (deckW / 2 - 0.11), 0.005, -2 + deckLen / 2]);
  }
  // One invisible cuboid for the whole walkable surface. Its top is the deck
  // top exactly, because the spawn and the startup test both key off that.
  b.collider(deckW, deckThickness, deckLen, [0, 0, -2 + deckLen / 2]);
  b.pop();

  // Posts, with a dark waterline band. Bollards on the outer half stand proud
  // of the deck and carry the rope.
  const POST_Z: number[] = [];
  for (let i = 0; i < 7; i++) POST_Z.push(-1 + (i / 6) * (deckLen - 2));
  for (const z of POST_Z) {
    for (const side of [-1, 1]) {
      b.push();
      const px = side * (deckW / 2 - 0.28);
      const h = deckY + 3.8;
      const waterline = deckY - h + 0.1 + h * 0.42;
      b.cylinder(0.22, 0.26, h, 8,
        (y: number) => (y < waterline ? POST_WET : POST), true,
        [px, deckY - h / 2 + 0.1, z]);
      b.pop();
    }
  }
  // Cross-braces under the deck: cheap, and they stop the dock reading as a
  // plank floating on six sticks.
  for (let i = 0; i < POST_Z.length - 1; i++) {
    const z0 = POST_Z[i], z1 = POST_Z[i + 1];
    for (const side of [-1, 1]) {
      const px = side * (deckW / 2 - 0.28);
      b.push();
      b.translate(px, deckY - 1.15, (z0 + z1) / 2)
        .rotateX(Math.atan2(0.7, z1 - z0) - Math.PI / 2);
      b.box(0.12, 0.12, Math.hypot(z1 - z0, 0.7), POST, false);
      b.pop();
    }
  }
  // Tie beams across, under the planking.
  for (const z of POST_Z) {
    b.box(deckW - 0.2, 0.16, 0.18, POST, false, [0, deckY - 0.24, z]);
  }

  // Bollards and rope. A rope swag between posts reads as a working dock far
  // better than a second wooden rail, and it leaves the view down the deck
  // open, which the opening shot needs.
  const BOLLARD_Z = POST_Z.slice(1);
  for (const z of BOLLARD_Z) {
    for (const side of [-1, 1]) {
      const px = side * (deckW / 2 - 0.28);
      b.cylinder(0.15, 0.17, 1.02, 8, POST, false, [px, deckY + 0.58, z]);
      b.cylinder(0.20, 0.20, 0.12, 8, PLANK_DARK, false, [px, deckY + 1.13, z]);
    }
  }
  for (let i = 0; i < BOLLARD_Z.length - 1; i++) {
    const z0 = BOLLARD_Z[i], z1 = BOLLARD_Z[i + 1];
    for (const side of [-1, 1]) {
      const px = side * (deckW / 2 - 0.28);
      ropeSwag(b, [px, deckY + 1.0, z0], [px, deckY + 1.0, z1], 0.34, 5);
    }
  }

  // ---- DOCK DRESSING -------------------------------------------------------
  // Everything lives outboard of |x| = 1.5 so the walk down the middle of the
  // deck, which is the first thing the player does, stays completely clear.
  const crateStack = (x: number, z: number, rot: number, n: number) => {
    let y = deckY + 0.08;
    for (let i = 0; i < n; i++) {
      const sz = rng.range(0.52, 0.64) * (1 - i * 0.08);
      b.push().translate(x + rng.range(-0.08, 0.08), y + sz / 2, z + rng.range(-0.08, 0.08))
        .rotateY(rot + rng.range(-0.25, 0.25));
      b.recordProp(`dock-crate-${x}-${z}-${i}`, { kind: 'crate', size: sz, support: i ? 'crate below' : 'dock deck' });
      slattedCrate(b, sz, i === 0);
      b.pop();
      y += sz;
    }
  };
  const barrel = (x: number, z: number, r = 0.34) => {
    b.push().translate(x, deckY + 0.08, z).rotateY(rng.range(0, 3.14));
    b.recordProp(`dock-barrel-${x}-${z}`, { kind: 'barrel', radius: r, support: 'dock deck' });
    b.cylinder(r * 0.92, r * 0.92, 0.86, 16, CRATE, true, [0, 0.43, 0]);
    b.cylinder(r, r, 0.10, 16, METAL_DARK, false, [0, 0.24, 0]);
    b.cylinder(r, r, 0.10, 16, METAL_DARK, false, [0, 0.64, 0]);
    b.cylinder(r * 0.86, r * 0.86, 0.05, 16, PLANK_DARK, false, [0, 0.87, 0]);
    b.pop();
  };
  /** A basket with fruit heaped in it: the sell loop, stated as scenery. */
  const fruitBasket = (x: number, z: number, fruit: THREE.Color) => {
    b.push().translate(x, deckY + 0.08, z).rotateY(rng.range(0, 3.14));
    b.recordProp(`dock-basket-${x}-${z}`, { kind: 'basket', support: 'dock deck', contents: 'fruit seated on inset floor' });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.push().translate(Math.cos(a) * 0.31, 0.16, Math.sin(a) * 0.31).rotateY(-a);
      b.box(0.13, 0.32, 0.05, i % 2 ? ROPE : CRATE, false);
      b.pop();
    }
    b.cylinder(0.34, 0.30, 0.05, 9, CRATE, false, [0, 0.03, 0]);
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, 6.28), r = rng.range(0, 0.17);
      // Preserve RNG draws, but seat the contents on the floor instead of
      // floating above an empty basket.
      const radius = 0.09 + rng.range(0, 0.06) * 0.25;
      const piece = new THREE.SphereGeometry(radius, 8, 6);
      piece.translate(Math.cos(a) * r, 0.055 + radius, Math.sin(a) * r);
      b.mesh(piece, fruit);
    }
    b.pop();
  };
  const lantern = (x: number, y: number, z: number) => {
    // Corner posts and a cap around a small hot core. The first version was a
    // 19 cm cube of lamp colour with a lid on it, which at any distance is a
    // pale blank box rather than a lantern.
    b.cylinder(0.028, 0.028, 0.26, 5, METAL_DARK, false, [x, y + 0.25, z]);
    b.cylinder(0.045, 0.055, 0.23, 6, METAL_DARK, false, [x, y - 0.23, z]);
    b.box(0.145, 0.17, 0.145, LAMP_HOT, false, [x, y, z]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(0.032, 0.21, 0.032, METAL_DARK, false, [x + sx * 0.075, y, z + sz * 0.075]);
      }
    }
    b.box(0.20, 0.045, 0.20, METAL_DARK, false, [x, y + 0.115, z]);
    b.box(0.115, 0.05, 0.115, METAL_DARK, false, [x, y + 0.15, z]);
    b.box(0.185, 0.04, 0.185, METAL_DARK, false, [x, y - 0.105, z]);
  };

  // Kept low and hard outboard. The first pass stacked these three high and
  // 1.9 m off centre, which put two featureless brown pillars either side of
  // the one shot the whole game opens on.
  crateStack(-2.25, 1.9, 0.4, 2);
  crateStack(-2.3, 3.2, -0.6, 1);
  crateStack(2.25, 0.9, 0.9, 1);
  barrel(2.3, 2.2);
  barrel(2.2, 3.1, 0.30);
  barrel(-2.3, 11.4);
  barrel(2.3, 13.2, 0.31);
  fruitBasket(2.25, 4.1, APPLE);
  fruitBasket(-2.2, 4.4, ORANGE);
  fruitBasket(2.3, 12.0, APPLE);
  fruitBasket(-2.25, 13.6, APPLE);
  // A coil of rope and a stack of spare planking: the props that say this is a
  // working jetty rather than a walkway with boxes on it.
  b.push().translate(-2.2, deckY + 0.12, 8.4);
  b.cylinder(0.30, 0.30, 0.09, 10, ROPE, false);
  b.cylinder(0.20, 0.20, 0.09, 10, ROPE, false, [0, 0.08, 0]);
  b.pop();
  b.push().translate(2.2, deckY + 0.10, 8.0).rotateY(0.22);
  for (let i = 0; i < 4; i++) b.box(0.28, 0.07, 2.2, i % 2 ? PLANK : PLANK_DARK, false, [0, i * 0.075, 0]);
  b.pop();
  // Lantern spacing is chosen around the SPAWN, not around the posts. The
  // player starts at local z = 16.5 and one of these sat on a bollard at
  // z = 15 — a metre and a half off their right shoulder, at exactly eye
  // height, with a near-white core. In the opening frame of the game it read
  // as a blown-out panel floating at the edge of the screen. Alternating sides
  // and stepping off the odd posts keeps the row lighting the deck ahead and
  // nothing within three metres of where the player is standing.
  lantern(-(deckW / 2 - 0.28), deckY + 1.52, POST_Z[1]);
  lantern(deckW / 2 - 0.28, deckY + 1.52, POST_Z[3]);
  lantern(-(deckW / 2 - 0.28), deckY + 1.52, POST_Z[5]);

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
  // The pennant, hidden until Sunpatch is done: a mast in the bow with a
  // red flag on it. It is the boat saying "we are going somewhere".
  const boatFlag = new THREE.Group();
  boatFlag.name = 'BoatFlag';
  {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 2.6, 6),
      new THREE.MeshStandardMaterial({ color: POST, roughness: 0.9, flatShading: true }));
    mast.position.set(0, 1.3, 0);
    mast.castShadow = true;
    const flagGeo = new THREE.PlaneGeometry(0.9, 0.42);
    flagGeo.translate(0.45, 0, 0);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({
      color: CANVAS_RED, roughness: 0.95, side: THREE.DoubleSide,
    }));
    flag.position.set(0.03, 2.3, 0);
    flag.rotation.y = 0.9;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshStandardMaterial({ color: LAMP, roughness: 0.7 }));
    tip.position.set(0, 2.62, 0);
    boatFlag.add(mast, flag, tip);
    const mastAt = dock.toWorld(-4.4 + Math.sin(0.22) * 1.6, 16 + Math.cos(0.22) * 1.6, deckY - 0.55 + 1.05);
    boatFlag.position.copy(mastAt);
    boatFlag.visible = false;
    scene.add(boatFlag);
  }

  // ---- SIGN AT THE DOCK HEAD ----------------------------------------------
  // Post and board share ONE local position. They did not: the board was built
  // from a hand-rolled rotation that dropped the local X term entirely, so it
  // floated unsupported over the middle of the walkway, dead centre of the
  // opening shot and squarely in front of the shop. Deriving both from the dock
  // frame is what stops that happening again.
  const signLocal = { x: 2.0, z: -0.6 };
  const signFacing = dockDir - 0.55;
  b.push();
  b.translate(signLocal.x, deckY, signLocal.z).rotateY(-0.55);
  b.cylinder(0.09, 0.11, 1.85, 6, POST, true, [0, 0.925, 0]);
  b.pop();
  signs.push(makeSign(b,
    dock.toWorld(signLocal.x, signLocal.z, deckY + 1.45).add(
      new THREE.Vector3(Math.sin(signFacing), 0, Math.cos(signFacing)).multiplyScalar(0.20)),
    signFacing, 1.65, 0.74,
    signTexture(['PICK · HAUL · SELL'], { title: 'SUNPATCH', w: 640, h: 240,
      bg: '#34554a', fg: '#efe1bb', accent: '#78917a' }),
  ));

  // ---- SHOP SHED + SELL PAD -----------------------------------------------
  // The landmark the whole first hour navigates by, so it is built for
  // silhouette first: a plinth to stand on, a gable with real overhanging
  // eaves, a ridge cap, and a bracket sign that sticks out across the line of
  // approach. The shipped version was a cream box with a flat lid, and from
  // the dock it read as a shipping container.
  const shopX = 45, shopZ = 52;
  const shopY = ground(shopX, shopZ);
  const shopRot = -0.9;
  const shopGround = (x: number, z: number) => localGround(x, z, shopX, shopY, shopZ, shopRot);
  b.reset().translate(shopX, shopY, shopZ).rotateY(shopRot);
  b.recordProp('merv-shop', { kind: 'workstation', front: [0, 1.4, 3.4], origin: [shopX, shopY, shopZ], rotationY: shopRot });

  const SW = 6.8, SD = 5.2;            // body footprint
  const PLINTH = 0.34;
  const EAVE = 3.28;                   // wall top / eave line
  const RIDGE = 4.86;
  const OVER_X = 0.8, OVER_Z = 1.2;    // roof overhang
  const rise = RIDGE - EAVE;
  const runZ = SD / 2 + OVER_Z;
  const slabLen = Math.hypot(runZ, rise);
  const theta = Math.atan2(rise, runZ);
  const roofYAt = (z: number) => RIDGE - rise * Math.min(Math.abs(z) / runZ, 1);
  const front = SD / 2;

  // Plinth and walls.
  b.box(SW + 0.5, PLINTH, SD + 0.5, STONE, true, [0, PLINTH / 2, 0]);
  b.box(SW, EAVE - PLINTH, SD, WALL, true, [0, (EAVE + PLINTH) / 2, 0]);
  // Wainscot: a darker boarded band round the bottom metre. One tonal break is
  // most of the difference between a shed and a cream box.
  b.box(SW + 0.10, 1.05, SD + 0.10, WALL_SHADE, false, [0, PLINTH + 0.5, 0]);
  b.box(SW + 0.16, 0.10, SD + 0.16, POST, false, [0, PLINTH + 1.02, 0]);
  for (let i = 0; i < 8; i++) {
    const x = -SW / 2 + 0.45 + i * ((SW - 0.9) / 7);
    for (const sz of [-1, 1]) {
      b.box(0.12, EAVE - PLINTH - 1.05, 0.06, WALL_SHADE, false,
        [x, (EAVE + PLINTH + 1.05) / 2, sz * (SD / 2 + 0.03)]);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.26, EAVE, 0.26, POST, false,
        [sx * (SW / 2 - 0.01), EAVE / 2, sz * (SD / 2 - 0.01)]);
    }
  }

  // Roof: two slabs with a real overhang, a ridge cap, gable infill and
  // exposed rafter ends. The overhang is what casts the shadow line that makes
  // a building read at distance; a flat lid flush with the walls does not.
  for (const sz of [-1, 1]) {
    b.push().translate(0, (EAVE + RIDGE) / 2, (sz * runZ) / 2).rotateX(sz * theta);
    b.box(SW + OVER_X * 2, 0.20, slabLen, sz > 0 ? ROOF : ROOF_DARK, false);
    b.box(SW + OVER_X * 2 - 0.12, 0.07, slabLen - 0.1, ROOF_DARK, false, [0, -0.14, 0]);
    // Overlapping terracotta courses, kept broad enough to read from the dock.
    for (let row = 0; row < 7; row++) {
      const rz = -slabLen / 2 + (row + 0.5) * slabLen / 7;
      b.box(SW + OVER_X * 2, 0.045, 0.055, ROOF_DARK, false, [0, 0.115, rz]);
      for (let col = 0; col < 12; col++) {
        const rx = -(SW + OVER_X * 2) / 2 + 0.35 + col * 0.7 + (row % 2) * 0.16;
        b.box(0.025, 0.018, slabLen / 7 - 0.06, ROOF_RIDGE, false, [rx, 0.112, rz]);
      }
    }
    b.pop();
  }
  b.box(SW + OVER_X * 2 + 0.14, 0.20, 0.38, ROOF_RIDGE, false, [0, RIDGE + 0.05, 0]);
  for (const sx of [-1, 1]) {
    b.push().translate(sx * (SW / 2 - 0.02), EAVE, 0);
    b.mesh(gableGeometry(SD, rise, 0.18), WALL);
    b.pop();
    for (const sz of [-1, 1]) {
      b.push().translate(sx * (SW / 2 + OVER_X * 0.5), (EAVE + RIDGE) / 2, (sz * runZ) / 2)
        .rotateX(sz * theta);
      b.box(0.10, 0.26, slabLen, ROOF_DARK, false);
      b.pop();
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = -(SW / 2 + OVER_X) + 0.55 + i * ((SW + OVER_X * 2 - 1.1) / 6);
    for (const sz of [-1, 1]) {
      const z = sz * (SD / 2 + OVER_Z * 0.62);
      b.push().translate(x, roofYAt(z) - 0.22, z).rotateX(sz * theta);
      b.box(0.11, 0.16, 0.86, POST, false);
      b.pop();
    }
  }
  // A crooked stovepipe. Pure silhouette, thirty triangles.
  b.push().translate(-1.7, RIDGE - 0.55, -1.0).rotateZ(0.13);
  b.cylinder(0.13, 0.15, 1.5, 7, METAL_DARK, false, [0, 0.75, 0]);
  b.cylinder(0.19, 0.19, 0.12, 7, METAL, false, [0, 1.48, 0]);
  b.pop();

  // Serving hatch. Cutting a real opening out of a merged box is not worth the
  // geometry: a recessed dark panel with a warm interior behind it reads as an
  // open shop from ten metres, which is the distance that matters.
  b.box(4.6, 2.0, 0.14, POST, false, [0, 2.20, front + 0.03]);
  b.box(4.2, 1.72, 0.10, GLASS, false, [0, 2.18, front + 0.09]);
  b.box(3.9, 1.5, 0.06, C(0x7a5433), false, [0, 2.14, front + 0.12]);
  b.box(3.4, 0.09, 0.30, PLANK, false, [0, 2.62, front + 0.16]);
  b.box(2.4, 0.36, 0.05, LAMP, false, [0, 2.98, front + 0.13]);
  for (let i = 0; i < 5; i++) {
    b.sphere(0.14, 1, i % 2 ? APPLE : ORANGE, false, [-1.3 + i * 0.65, 2.80, front + 0.16]);
  }
  for (const sx of [-1, 1]) {
    b.box(0.20, 2.3, 0.20, POST, false, [sx * 2.35, 2.15, front + 0.06]);
  }

  // Windows on the gable ends, with shutters and a window box. The +X end is
  // what the player sees first walking up from the dock.
  for (const sz of [-1, 1]) {
    b.box(0.13, 1.14, 0.12, POST, false, [SW / 2 + 0.03, 2.25, sz * 1.35 - 0.56]);
    b.box(0.13, 1.14, 0.12, POST, false, [SW / 2 + 0.03, 2.25, sz * 1.35 + 0.56]);
    b.box(0.13, 0.12, 1.16, POST, false, [SW / 2 + 0.03, 2.80, sz * 1.35]);
    b.box(0.13, 0.12, 1.16, POST, false, [SW / 2 + 0.03, 1.72, sz * 1.35]);
    b.box(0.09, 1.0, 1.05, GLASS, false, [SW / 2 + 0.02, 2.25, sz * 1.35]);
    b.push().translate(SW / 2 + 0.06, 2.25, sz * (1.35 + 0.62)).rotateY(sz * 0.5);
    b.box(0.08, 1.05, 0.55, C(0x367f75), false);
    for (let slat = 0; slat < 6; slat++)
      b.box(0.10, 0.045, 0.51, C(0x25584f), false, [0.025, -0.4 + slat * 0.16, 0]);
    b.pop();
    b.box(0.34, 0.24, 1.15, PLANK, false, [SW / 2 + 0.18, 1.60, sz * 1.35]);
    for (let i = 0; i < 4; i++) {
      b.sphere(0.11, 0, i % 2 ? C(0xe2503f) : C(0xf5c33f), false,
        [SW / 2 + 0.18, 1.78, sz * 1.35 - 0.42 + i * 0.28]);
    }
  }

  // Counter and awning, out in front of the hatch.
  b.push().translate(0, 0, front + 0.55);
  b.box(5.0, 0.22, 1.5, PLANK, true, [0, 1.15, 0.5]);
  b.box(5.0, 1.05, 0.22, PLANK_DARK, true, [0, 0.52, 1.15]);
  for (let i = 0; i < 6; i++) {
    b.box(0.10, 1.0, 0.10, POST, false, [-2.2 + i * 0.88, 0.55, 1.22]);
  }
  b.box(5.2, 0.10, 0.24, POST, false, [0, 1.29, 0.5]);
  for (let i = 0; i < 14; i++) {
    b.box(0.335, 0.91, 0.04, i % 3 ? C(0x397e73) : C(0x326b62), false,
      [-2.3 + i * 0.354, 0.56, 1.285]);
  }
  for (const sy of [0.12, 1.04])
    b.box(5.08, 0.09, 0.08, CANVAS_CREAM, false, [0, sy, 1.31]);
  // A real counter scale: stout enamel base, dial and shallow brass pan.
  b.box(0.42, 0.15, 0.36, C(0x397e73), false, [-1.6, 1.34, 0.48]);
  b.cylinder(0.06, 0.09, 0.32, 7, METAL_DARK, false, [-1.6, 1.54, 0.48]);
  b.cylinder(0.30, 0.22, 0.075, 12, LAMP, false, [-1.6, 1.73, 0.48]);
  b.push().translate(-1.6, 1.51, 0.71).rotateX(Math.PI / 2);
  b.cylinder(0.15, 0.15, 0.06, 12, CANVAS_CREAM, false);
  b.pop();
  b.box(0.018, 0.105, 0.018, METAL_DARK, false, [-1.6, 1.53, 0.751]);
  b.pop();
  b.push().translate(0, 3.07, front + 1.15).rotateX(0.46);
  for (let i = 0; i < 9; i++) {
    b.box(0.62, 0.08, 2.1, i % 2 ? CANVAS_RED : CANVAS_CREAM, false, [-2.48 + i * 0.62, 0, 0]);
  }
  b.pop();
  // Scalloped valance hanging off the awning's front edge.
  for (let i = 0; i < 9; i++) {
    b.box(0.58, 0.30, 0.07, i % 2 ? CANVAS_RED : CANVAS_CREAM, false,
      [-2.48 + i * 0.62, 2.47, front + 2.06]);
  }
  b.cylinder(0.08, 0.08, 2.65, 6, POST, false, [-2.6, 1.325, front + 2.1]);
  b.cylinder(0.08, 0.08, 2.65, 6, POST, false, [2.6, 1.325, front + 2.1]);
  lantern(-2.6, 2.8, front + 2.1);
  lantern(2.6, 2.8, front + 2.1);

  // Bracket arm for the hanging sign, on the +X gable.
  b.box(1.5, 0.14, 0.14, POST, false, [SW / 2 + 0.75, 3.30, 0]);
  b.box(0.14, 0.14, 1.28, POST, false, [SW / 2 + 1.35, 3.30, 0]);
  b.box(0.14, 0.90, 0.14, POST, false, [SW / 2 + 0.06, 2.90, 0]);
  b.push().translate(SW / 2 + 1.35, 0, 0).rotateY(Math.PI / 2);
  ropeSwag(b, [-0.5, 3.24, 0], [-0.5, 3.05, 0], 0, 1, 0.028);
  ropeSwag(b, [0.5, 3.24, 0], [0.5, 3.05, 0], 0, 1, 0.028);
  b.pop();

  // Porch decking between the counter and the sell pad, so the two read as one
  // place rather than two props standing on sand.
  b.push().translate(0, 0.04, front + 2.6);
  // Only the side walkways extend past the pad. The old ten full-length
  // boards overlapped its base at y=.10, fighting through every plank seam.
  for (const side of [-1, 1]) {
    b.box(0.42, 0.12, 3.0, PLANK_DARK, true, [side * 2.44, 0, 0]);
  }
  b.box(5.5, 0.15, 0.20, POST, false, [0, 0.01, 1.55]);
  b.pop();

  // Goods stacked round the front, so the shop looks stocked rather than shut.
  const shopCrate = (x: number, z: number, y: number, sz: number, rot: number, loaded = false) => {
    b.push().translate(x, y + sz / 2, z).rotateY(rot);
    b.recordProp(`shop-crate-${x}-${z}-${y}`, { kind: 'crate', size: sz, loaded, supportTop: y + sz });
    b.collider(sz, sz, sz);
    b.box(sz, sz * 0.08, sz, PLANK_DARK, false, [0, -sz * 0.46, 0]);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1])
      b.box(sz * 0.09, sz, sz * 0.09, PLANK_DARK, false, [sx * sz * 0.455, 0, sz2 * sz * 0.455]);
    for (let row = 0; row < 4; row++) for (const side of [-1, 1]) {
      const sy = -sz * 0.38 + row * sz * 0.25;
      b.box(sz, sz * 0.15, sz * 0.06, CRATE, false, [0, sy, side * sz * 0.47]);
      b.box(sz * 0.06, sz * 0.15, sz, CRATE, false, [side * sz * 0.47, sy, 0]);
    }
    // A slatted lid carries the decorative produce; its top is exactly the
    // same local support plane used by the contents and closed collider.
    for (let slat = 0; slat < 4; slat++) b.box(sz * 0.23, sz * 0.08, sz, CRATE, false,
      [(-0.375 + slat * 0.25) * sz, sz * 0.46, 0]);
    if (loaded) for (let i = 0; i < 4; i++) {
      const r = sz * 0.17, offset = sz * 0.22;
      const fruit = new THREE.SphereGeometry(r, 16, 10);
      fruit.translate(i % 2 ? offset : -offset, sz / 2 + r, i > 1 ? offset : -offset);
      b.mesh(fruit, i % 2 ? APPLE : ORANGE);
    }
    b.pop();
  };
  const leftCrateBase = shopGround(-3.15, front + 1.1);
  shopCrate(-3.15, front + 1.1, leftCrateBase, 0.78, 0.3);
  shopCrate(-3.15, front + 1.1, leftCrateBase + 0.78, 0.64, 0.3, true);
  shopCrate(3.25, front + 1.0, shopGround(3.25, front + 1.0), 0.74, -0.2, true);
  shopCrate(-4.0, -0.8, shopGround(-4.0, -0.8), 0.70, 0.9);
  for (let i = 0; i < 3; i++) {
    const sx = 3.7 + i * 0.05, sz = front - 0.6 - i * 0.62;
    b.push().translate(sx, shopGround(sx, sz), sz).rotateY(i * 0.7);
    b.recordProp(`shop-sack-${i}`, { kind: 'sack', support: 'terrain', radius: 0.42 });
    const sack = new THREE.SphereGeometry(0.42, 16, 10);
    sack.scale(1, 0.78, 1); sack.translate(0, 0.42 * 0.78, 0);
    b.mesh(sack, SACK);
    b.cylinder(.075, .15, .15, 10, SACK, false, [0, .69, 0]);
    b.cylinder(.085, .085, .035, 10, ROPE, false, [0, .70, 0]);
    b.pop();
  }
  for (const bz of [1.7, 0.5, -2.2]) {
    const barrelX = bz > 0 ? -4.1 : 4.1;
    b.push().translate(barrelX, shopGround(barrelX, bz), bz);
    b.recordProp(`shop-barrel-${barrelX}-${bz}`, { kind: 'barrel', support: 'terrain', radius: 0.39 });
    b.cylinder(0.36, 0.36, 0.94, 16, CRATE, true, [0, 0.47, 0]);
    b.cylinder(0.39, 0.39, 0.10, 16, METAL_DARK, false, [0, 0.26, 0]);
    b.cylinder(0.39, 0.39, 0.10, 16, METAL_DARK, false, [0, 0.70, 0]);
    b.pop();
  }
  // The island board by the counter: the frame is built here, the face is a
  // sign whose texture changes when the King Melon is done. It is the first
  // place the game says there is a second island, and the place it says the
  // second island is open.
  b.push().translate(3.3, 0, front + 2.3).rotateY(-0.55);
  b.box(0.10, 1.5, 0.10, POST, false, [-0.5, 0.75, 0]);
  b.box(0.10, 1.5, 0.10, POST, false, [0.5, 0.75, 0]);
  b.box(1.38, 1.05, 0.06, POST, false, [0, 1.15, -0.03]);
  b.box(1.25, 0.95, 0.05, CHALK, false, [0, 1.15, 0.0]);
  b.pop();
  const boardStyle = { w: 512, h: 384, bg: '#2f3a35', fg: '#f0e6c8', accent: '#556058', lineScale: 1.25 };
  const islandBoardLocked = signTexture(['SUNPATCH  ✓', 'GALE GROVE  — LOCKED', 'bring me the King Melon'],
    { title: 'ISLANDS', ...boardStyle });
  const islandBoardOpen = signTexture(['SUNPATCH  ✓', 'GALE GROVE  ✓ OPEN', 'boat leaves when it floats'],
    { title: 'ISLANDS', ...boardStyle });
  const boardPos = new THREE.Vector3(3.3, 0, front + 2.3)
    .add(new THREE.Vector3(0, 1.15, 0.14).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55))
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));
  const islandBoard = makeSign(b, boardPos, shopRot - 0.55, 1.22, 0.92, islandBoardLocked);
  islandBoard.name = 'IslandBoard';
  signs.push(islandBoard);

  // The bounty poster, on the gable the walk from the dock faces. The first
  // ten minutes should already know what the giant melon over the ravine is
  // for, what it pays, and the one word that opens it.
  signs.push(makeSign(b,
    new THREE.Vector3(SW / 2 + 0.18, 1.72, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
      .add(new THREE.Vector3(shopX, shopY, shopZ)),
    shopRot + Math.PI / 2, 1.22, 1.3,
    signTexture(['THE KING MELON', '2,600 KG. FOUR VINES.', '$9,500 REWARD', 'BRING ROPE.'],
      { title: 'WANTED', w: 400, h: 440, bg: '#efe0bd', fg: '#3a2109', accent: '#8a2a1e' }),
  ));

  // The sell pad: planked, edged in paint, under a weighing gantry.
  const sellLocal = new THREE.Vector3(0, 0, 5.4);
  b.push().translate(sellLocal.x, 0, sellLocal.z);
  b.box(4.2, 0.10, 4.2, C(0xd8bd7c), true, [0, 0.05, 0]);
  for (let i = 0; i < 8; i++) {
    b.box(0.46, 0.06, 4.0, i % 2 ? PLANK : PLANK_LIGHT, false, [-1.75 + i * 0.5, 0.11, 0]);
  }
  for (const sx of [-1, 1]) {
    b.box(0.22, 0.10, 4.3, C(0xd05a3c), false, [sx * 2.1, 0.12, 0]);
    // Butt joints: no coincident top faces at the four painted corners.
    b.box(3.98, 0.10, 0.22, C(0xd05a3c), false, [0, 0.12, sx * 2.1]);
  }
  for (const c2 of [[-1.95, -1.95], [1.95, -1.95], [-1.95, 1.95], [1.95, 1.95]]) {
    b.box(0.26, 0.30, 0.26, POST, false, [c2[0], 0.22, c2[1]]);
  }
  b.cylinder(0.10, 0.11, 3.1, 6, METAL_DARK, true, [-2.0, 1.55, 0]);
  b.cylinder(0.10, 0.11, 3.1, 6, METAL_DARK, true, [2.0, 1.55, 0]);
  b.box(4.6, 0.18, 0.18, METAL, false, [0, 3.08, 0]);
  b.box(0.20, 0.22, 0.20, METAL_DARK, false, [-1.6, 2.98, 0]);
  b.box(0.20, 0.22, 0.20, METAL_DARK, false, [1.6, 2.98, 0]);
  // Small, dark-faced and up on the crossbar. At 1.05 m across and lamp-white
  // it was a blank cream panel hung at eye height dead centre of the walk from
  // the pad to the counter, and it read as a missing texture.
  b.box(0.76, 0.46, 0.14, METAL_DARK, false, [0, 2.86, 0]);
  b.box(0.60, 0.32, 0.05, CHALK, false, [0, 2.86, 0.09]);
  b.box(0.16, 0.05, 0.06, LAMP, false, [0, 2.92, 0.11]);
  b.cylinder(0.55, 0.62, 0.12, 10, METAL, false, [-1.6, 1.90, 0]);
  ropeSwag(b, [-1.6, 2.90, 0], [-1.6, 1.95, 0], 0, 1, 0.03);
  lantern(-2.0, 2.35, 0);
  lantern(2.0, 2.35, 0);
  b.pop();

  const sellPad = new THREE.Vector3(sellLocal.x, 0, sellLocal.z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));

  // Mount the shop name above, and in front of, the weighing crossbar.
  // A roof-mounted face was still hidden by the gantry at walking height.
  for (const x of [-1.45, 1.45]) b.box(0.16, 1.02, 0.16, POST, false, [x, 3.66, sellLocal.z + 0.05]);
  signs.push(makeSign(b,
    new THREE.Vector3(0, 3.92, sellLocal.z + 0.19).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
      .add(new THREE.Vector3(shopX, shopY, shopZ)),
    shopRot, 4.0, 1.28,
    signTexture(['SELL HERE  \u2022  BUY THINGS'], { title: "MERV'S SUPPLY", h: 200, w: 640 }),
  ));
  // The hanging bracket board, legible from the whole approach.
  signs.push(makeSign(b,
    new THREE.Vector3(SW / 2 + 1.35, 2.62, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
      .add(new THREE.Vector3(shopX, shopY, shopZ)),
    shopRot + Math.PI / 2, 1.6, 1.0,
    signTexture(['FRESH FRUIT'], { title: 'SHOP', h: 240, w: 380 }),
  ));

  const shopCounter = new THREE.Vector3(0, 1.4, 3.4)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));

  // The arrival faces the gable, so give that face the same harvest identity
  // as the counter. A carved orange medallion sits above the wanted poster.
  b.reset().translate(shopX, shopY, shopZ).rotateY(shopRot);
  b.push().translate(SW / 2 + 0.14, 3.75, 0).rotateZ(Math.PI / 2);
  b.cylinder(0.52, 0.52, 0.12, 12, C(0x25584f), false);
  b.cylinder(0.42, 0.42, 0.14, 12, CANVAS_CREAM, false);
  b.pop();
  b.push().translate(SW / 2 + 0.26, 3.73, 0).scale(0.32, 1, 1);
  b.sphere(0.30, 1, ORANGE, false);
  b.pop();
  b.box(0.06, 0.14, 0.055, POST, false, [SW / 2 + 0.28, 4.04, 0]);
  b.push().translate(SW / 2 + 0.27, 4.02, -0.16).scale(0.15, 0.4, 1);
  b.sphere(0.21, 0, LEAF, false);
  b.pop();

  // Forecourt dressing, out where the route meets the sell pad. The pad and
  // the counter were an island of detail in the middle of a big empty apron.
  b.reset().translate(shopX, shopY, shopZ).rotateY(shopRot);
  const apronBase = shopGround(-3.2, 8.4);
  b.push().translate(-3.2, apronBase, 8.4).rotateY(0.5);
  b.cylinder(0.36, 0.36, 0.94, 16, CRATE, true, [0, 0.47, 0]);
  b.cylinder(0.39, 0.39, 0.10, 16, METAL_DARK, false, [0, 0.26, 0]);
  b.cylinder(0.39, 0.39, 0.10, 16, METAL_DARK, false, [0, 0.70, 0]);
  const apronCrateGround = shopGround(-3.2 + Math.cos(.5) + .3 * Math.sin(.5),
    8.4 - Math.sin(.5) + .3 * Math.cos(.5)) - apronBase;
  b.push().translate(1.0, apronCrateGround + .31, .3);
  b.recordProp('shop-apron-crate', { kind: 'crate', size: .62, support: 'terrain' });
  slattedCrate(b, .62, true); b.pop();
  b.pop();
  // A fingerpost where the route forks for the orchard: signposting the loop
  // in the world instead of on the HUD. The arms carry words now.
  b.push().translate(4.6, 0, 7.6).rotateY(-0.35);
  b.cylinder(0.10, 0.12, 2.7, 7, POST, true, [0, 1.35, 0]);
  b.push().translate(0.55, 2.28, 0).rotateY(0.9);
  b.box(1.25, 0.26, 0.07, PLANK, false);
  b.pop();
  b.push().translate(-0.5, 1.88, 0).rotateY(-0.5);
  b.box(1.1, 0.24, 0.07, PLANK_DARK, false);
  b.pop();
  b.pop();
  {
    const post = new THREE.Matrix4().makeTranslation(shopX, shopY, shopZ)
      .multiply(new THREE.Matrix4().makeRotationY(shopRot))
      .multiply(new THREE.Matrix4().makeTranslation(4.6, 0, 7.6))
      .multiply(new THREE.Matrix4().makeRotationY(-0.35));
    const arm = (x: number, y: number, rot: number, w: number, text: string) => {
      const m = post.clone()
        .multiply(new THREE.Matrix4().makeTranslation(x, y, 0))
        .multiply(new THREE.Matrix4().makeRotationY(rot))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.14));
      signs.push(makeSign(b, new THREE.Vector3().setFromMatrixPosition(m), shopRot - 0.35 + rot, w, w * 0.2,
        signTexture([text], { w: 512, h: 104, lineScale: 3.2 })));
    };
    arm(0.55, 2.28, 0.9, 1.22, '←  OLD ORCHARD');
    arm(-0.5, 1.88, -0.5, 1.08, '←  WATERFALL');
  }

  // Waypoint boards deeper in: one at the orchard's back fence pointing up
  // the hill, one at the top of the hill pointing at the ravine. Between them
  // and the second worn route the island reads as a climb rather than a
  // collection of places, and the walk to the King Melon needs no marker.
  const fingerboard = (x: number, z: number, faceX: number, faceZ: number, lines: string[], title: string) => {
    const y = ground(x, z);
    b.reset().translate(x, y, z);
    b.cylinder(0.10, 0.12, 2.5, 7, POST, true, [0, 1.25, 0]);
    const rot = Math.atan2(faceX - x, faceZ - z);
    const pos = new THREE.Vector3(x, y + 2.05, z).add(
      new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)).multiplyScalar(0.215));
    signs.push(makeSign(b, pos, rot, 1.6, 0.95,
      signTexture(lines, { title, w: 512, h: 300, lineScale: 1.25 })));
  };
  fingerboard(-28.8, 0.7, -24, 22, ['BOULDER PLUMS AHEAD', 'ROPE · BLAST · CATCH'], 'HILL FARM ↑');
  fingerboard(-24.7, -38.3, -36, -30, ['THE KING MELON', 'rope gun required'], 'THE RAVINE ↑');
  // A hand cart parked on the apron.
  b.reset().translate(shopX, shopY, shopZ).rotateY(shopRot);
  b.push().translate(-5.4, 0, 6.2).rotateY(1.2);
  const cartWorld = new THREE.Vector3(-5.4, 0, 6.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), shopRot)
    .add(new THREE.Vector3(shopX, shopY, shopZ));
  const cartGround = (x: number, z: number) => localGround(x, z, cartWorld.x, shopY, cartWorld.z, shopRot + 1.2);
  b.recordProp('shop-hand-cart', { kind: 'cart', supports: [-1, 1].flatMap(side => [
    [side * 0.62, cartGround(side * 0.62, -0.25), -0.25], [side * 0.42, cartGround(side * 0.42, 0.6), 0.6]]) });
  b.box(1.1, 0.14, 1.6, PLANK, false, [0, 0.62, 0]);
  b.box(1.1, 0.40, 0.10, PLANK_DARK, false, [0, 0.82, -0.76]);
  b.box(0.10, 0.40, 1.6, PLANK_DARK, false, [-0.55, 0.82, 0]);
  b.box(0.10, 0.40, 1.6, PLANK_DARK, false, [0.55, 0.82, 0]);
  for (const side of [-1, 1]) {
    const wheelY = cartGround(side * 0.62, -0.25) + 0.34;
    b.push().translate(side * 0.62, wheelY, -0.25).rotateZ(Math.PI / 2);
    b.cylinder(0.34, 0.34, 0.12, 10, METAL_DARK, false);
    b.cylinder(0.17, 0.17, 0.14, 10, PLANK_LIGHT, false);
    b.pop();
    timberBetween(new THREE.Vector3(side * 0.62, wheelY, -0.25), new THREE.Vector3(side * 0.46, 0.6, -0.25), 0.10, 0.10, POST);
    const foot = cartGround(side * 0.42, 0.6) - 0.03;
    b.box(0.08, 0.59 - foot, 0.08, POST, false, [side * 0.42, (0.59 + foot) / 2, 0.6]);
    b.box(0.09, 0.09, 1.25, POST, false, [side * 0.42, 0.59, 1.0]);
  }
  for (let i = 0; i < 6; i++) {
    b.sphere(0.16, 1, i % 2 ? APPLE : ORANGE, false,
      [-0.28 + (i % 3) * 0.28, 0.80, -0.5 + i * 0.20]);
  }
  b.pop();

  // ---- THE OLD ORCHARD ----------------------------------------------------
  // A post-and-rail line either side of the route as it climbs into the
  // orchard. It does three jobs at once: it says a person farms here, it gives
  // the avenue an edge so the walkable space reads as deliberate, and it puts
  // repeating verticals in the middle distance, which is what the orchard was
  // missing when it was thirty green blobs on a flat green field.
  //
  // Solid rails match the visible timber. The authored gate stays open.
  const fenceLine = (pts: Array<[number, number]>, gapAt = -1) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const span = Math.hypot(x2 - x1, z2 - z1);
      const bays = Math.max(1, Math.round(span / 2.6));
      for (let k = 0; k < bays; k++) {
        if (i === gapAt && k === 1) continue;             // the gate opening
        const t0 = k / bays, t1 = (k + 1) / bays;
        const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0;
        const bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1;
        const ay = ground(ax, az), by = ground(bx, bz);
        b.reset().translate(ax, ay, az).rotateY(Math.atan2(bx - ax, bz - az));
        b.cylinder(0.085, 0.10, 1.42, 6, POST, true, [0, 0.62, 0]);
        const len = Math.hypot(bx - ax, bz - az);
        for (const ry of [1.02, 0.58]) {
          b.push().translate(0, ry + (by - ay) * 0.5, len / 2)
            .rotateX(-Math.atan2(by - ay, len));
          b.recordProp(`orchard-rail-${ax}-${az}-${ry}`, { kind: 'rail', width: .07, height: .13, length: len * 1.02 });
          b.box(0.07, 0.13, len * 1.02, PLANK_DARK, true);
          b.pop();
        }
      }
    }
    // Cap the far end so the run does not stop in mid-air.
    const [lx, lz] = pts[pts.length - 1];
    b.reset().translate(lx, ground(lx, lz), lz);
    b.cylinder(0.085, 0.10, 1.42, 6, POST, true, [0, 0.62, 0]);
  };
  fenceLine([[-5.5, 36.4], [-12.5, 32.8], [-19.0, 29.8], [-26.5, 26.8], [-33.0, 25.4]], 0);
  fenceLine([[-1.5, 26.6], [-8.5, 23.2], [-15.0, 20.2], [-22.0, 17.2], [-29.0, 15.4]]);
  // Orchard entry: a wide, open timber lintel and a painted harvest sign.
  // Posts sit beyond the path shoulders; the entire addition is decorative.
  const entryX = -7, entryZ = 29, entryY = ground(entryX, entryZ);
  const entryRot = Math.atan2(0.9, 0.44);
  b.reset().translate(entryX, entryY, entryZ).rotateY(entryRot);
  for (const side of [-1, 1]) {
    const px = entryX + side * 5.3 * Math.cos(entryRot);
    const pz = entryZ - side * 5.3 * Math.sin(entryRot);
    const base = ground(px, pz) - entryY;
    b.box(0.30, 4.15 - base, 0.30, POST, false, [side * 5.3, (4.15 + base) / 2, 0]);
    b.box(0.42, 0.12, 0.42, PLANK_LIGHT, false, [side * 5.3, 4.16, 0]);
    b.box(0.34, 0.42, 0.34, C(0x397e73), false, [side * 5.3, base + 0.45, 0]);
  }
  b.box(11.1, 0.22, 0.28, PLANK_DARK, false, [0, 4.0, 0]);
  b.box(3.9, 0.96, 0.16, POST, false, [0, 3.75, 0.06]);
  const entrySignPos = new THREE.Vector3(0, 3.75, 0.155)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), entryRot)
    .add(new THREE.Vector3(entryX, entryY, entryZ));
  signs.push(makeSign(b, entrySignPos, entryRot, 3.72, 0.81,
    signTexture(['PICK SOMETHING GOOD'], { title: 'OLD ORCHARD', w: 768, h: 180,
      bg: '#28584e', fg: '#fff0cc', accent: '#cba66b' })));
  for (let i = 0; i < 10; i++) {
    const fx = -4.75 + i * 1.055;
    if (Math.abs(fx) < 2.1) continue;
    const flag = new THREE.BufferGeometry();
    flag.setAttribute('position', new THREE.Float32BufferAttribute([
      fx - 0.28, 3.91, 0, fx + 0.28, 3.91, 0, fx + 0.10, 3.35, 0,
      fx + 0.28, 3.91, 0, fx - 0.28, 3.91, 0, fx + 0.10, 3.35, 0,
    ], 3));
    flag.computeVertexNormals();
    b.mesh(flag, i % 2 ? CANVAS_RED : CANVAS_CREAM);
  }
  // A gate post pair and a leaning gate where the route crosses the north run.
  b.reset().translate(-8.6, ground(-8.6, 34.6), 34.6).rotateY(0.42);
  b.cylinder(0.12, 0.14, 1.85, 6, POST, true, [0, 0.9, 0]);
  b.push().translate(0.9, 0.72, 0.15).rotateY(0.55).rotateZ(0.07);
  for (let i = 0; i < 3; i++) b.box(1.7, 0.11, 0.07, PLANK, false, [0, -0.35 + i * 0.35, 0]);
  b.box(0.09, 0.85, 0.07, PLANK_DARK, false, [-0.78, 0, 0]);
  b.box(0.09, 0.85, 0.07, PLANK_DARK, false, [0.78, 0, 0]);
  b.pop();

  // Orchard working props use one local frame for their supports and contents.
  // Ladders are self-supporting picking A-frames, with every foot grounded.
  const orchardProp = (x: number, z: number, rot: number, what: string) => {
    const y = ground(x, z);
    const supportGround = (sx: number, sz: number) => localGround(sx, sz, x, y, z, rot);
    b.reset().translate(x, y, z).rotateY(rot);
    if (what === 'ladder') {
      const feet = [-1, 1].flatMap(side => [-1, 1].map(end =>
        new THREE.Vector3(side * 0.27, supportGround(side * 0.27, end * 0.64) - 0.025, end * 0.64)));
      const topY = Math.max(...feet.map(p => p.y)) + 3.02;
      for (const foot of feet) timberBetween(foot,
        new THREE.Vector3(foot.x, topY, 0), 0.095, 0.095, PLANK);
      for (let i = 1; i <= 7; i++) {
        const t = i / 8;
        const left = feet[1].clone().lerp(new THREE.Vector3(-0.27, topY, 0), t);
        const right = feet[3].clone().lerp(new THREE.Vector3(0.27, topY, 0), t);
        timberBetween(left, right, 0.075, 0.12, PLANK_DARK);
      }
      b.box(0.73, 0.10, 0.24, PLANK_DARK, false, [0, topY, 0]);
      for (const side of [-1, 1]) b.box(0.045, 0.07, 0.70, METAL_DARK, false, [side * 0.27, topY * 0.48, 0]);
      timberBetween(feet[0].clone().lerp(new THREE.Vector3(-0.27, topY, 0), 0.3),
        feet[2].clone().lerp(new THREE.Vector3(0.27, topY, 0), 0.65), 0.07, 0.07, PLANK_DARK);
      b.recordProp(`orchard-ladder-${x}-${z}`, { kind: 'ladder', supports: feet.map(p => p.toArray()),
        peak: [0, topY, 0], supportType: 'A-frame with spreader bars' });
    } else if (what === 'crates') {
      const crate = (cx: number, cz: number, width: number, height: number, base: number, loaded: boolean) => {
        b.push().translate(cx, base, cz);
        // Closed collision stays within the visible slats and corner uprights.
        b.collider(width, height, width, [0, height / 2, 0]);
        b.box(width, 0.045, width, PLANK_DARK, false, [0, 0.0225, 0]);
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          b.box(0.065, height, 0.065, PLANK_DARK, false, [sx * (width / 2 - 0.0325), height / 2, sz * (width / 2 - 0.0325)]);
        for (let slat = 0; slat < 3; slat++) {
          const sy = 0.08 + slat * (height - 0.15) / 2;
          for (const side of [-1, 1]) {
            b.box(width, 0.10, 0.04, CRATE, false, [0, sy, side * (width / 2 - 0.02)]);
            b.box(0.04, 0.10, width, CRATE, false, [side * (width / 2 - 0.02), sy, 0]);
          }
        }
        const fruitCenters: number[][] = [];
        if (loaded) for (let i = 0; i < 4; i++) {
          const r = 0.125, center = [i % 2 ? 0.13 : -0.13, 0.045 + r, i > 1 ? 0.13 : -0.13];
          const fruit = new THREE.SphereGeometry(r, 16, 10);
          fruit.translate(...center as [number, number, number]); b.mesh(fruit, i % 2 ? APPLE : ORANGE);
          fruitCenters.push(center);
        }
        b.recordProp(`orchard-crate-${x}-${z}-${cx}-${base}`, { kind: 'crate', width, height,
          floorTop: 0.045, fruitRadius: 0.125, fruitCenters, supportRelativeContents: true });
        b.pop();
      };
      const baseA = supportGround(0, 0), baseB = supportGround(0.74, 0);
      crate(0, 0, 0.68, 0.58, baseA, false);
      crate(0.74, 0, 0.64, 0.55, baseB, false);
      crate(0, 0, 0.58, 0.30, baseA + 0.58, true);
    } else {
      // A barrow: two rails, a tray and a wheel.
      b.box(0.90, 0.12, 1.30, PLANK, false, [0, 0.52, 0]);
      b.box(0.90, 0.34, 0.10, PLANK_DARK, false, [0, 0.70, -0.62]);
      b.box(0.10, 0.34, 1.30, PLANK_DARK, false, [-0.44, 0.70, 0]);
      b.box(0.10, 0.34, 1.30, PLANK_DARK, false, [0.44, 0.70, 0]);
      for (const sx of [-0.36, 0.36]) b.box(0.09, 0.09, 2.0, POST, false, [sx, 0.48, 0.35]);
      const wheelY = supportGround(0, -0.72) + 0.28;
      b.push().translate(0, wheelY, -0.72).rotateZ(Math.PI / 2);
      b.cylinder(0.28, 0.28, 0.12, 9, METAL_DARK, false);
      b.cylinder(0.13, 0.13, 0.135, 9, PLANK_LIGHT, false);
      b.pop();
      for (const sx of [-0.34, 0.34]) {
        const foot = supportGround(sx, 0.5) - 0.025;
        b.box(0.08, 0.52 - foot, 0.08, POST, false, [sx, (0.52 + foot) / 2, 0.5]);
      }
      timberBetween(new THREE.Vector3(0, wheelY, -0.72), new THREE.Vector3(0, 0.50, -0.54), 0.11, 0.11, POST);
      b.recordProp(`orchard-barrow-${x}-${z}`, { kind: 'barrow', supports: [
        [0, supportGround(0, -0.72), -0.72], ...[-0.34, 0.34].map(sx => [sx, supportGround(sx, 0.5), 0.5])] });
      for (let i = 0; i < 5; i++) {
        b.sphere(0.15, 1, i % 2 ? APPLE : ORANGE, false,
          [-0.2 + (i % 3) * 0.2, 0.68, -0.3 + i * 0.16]);
      }
    }
  };
  orchardProp(-13.5, 30.0, 0.7, 'ladder');
  orchardProp(-21.0, 27.4, -0.4, 'crates');
  orchardProp(-6.6, 30.6, 1.9, 'barrow');
  orchardProp(-27.5, 21.0, 2.4, 'crates');
  orchardProp(-18.0, 16.5, 0.2, 'ladder');

  // ---- SCATTERED ROCKS ----------------------------------------------------
  const rockRng = new Rng('rocks');
  for (let i = 0; i < 68; i++) {
    const a = rockRng.range(0, Math.PI * 2);
    const r = rockRng.range(18, 92);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = ground(x, z);
    if (y < 1.0 || y > 34) continue;
    // Keep them off the worn route. One two-metre boulder landed a metre from
    // where the path enters the orchard and filled a third of that frame.
    if (terrain.pathWeight(x, z) > 0.12) continue;
    // Capped well below head height. A 2.3 m boulder is not scenery from a
    // metre away, it is a wall across a third of the frame.
    const s = rockRng.range(0.4, 1.55);
    b.reset().translate(x, y + s * 0.26, z).rotateY(rockRng.range(0, 6.28))
      .rotateZ(rockRng.range(-0.3, 0.3)).scale(1, rockRng.range(0.5, 0.9), 1);
    boulder(s, rockRng.chance(0.35) ? STONE_DARK : STONE, s > 1.0);
    // A smaller companion, so boulders come in groups the way they do in the
    // reference rather than one at a time on an empty field.
    if (rockRng.chance(0.55)) {
      const s2 = s * rockRng.range(0.35, 0.6);
      const x2 = x + rockRng.range(-1.6, 1.6), z2 = z + rockRng.range(-1.6, 1.6);
      b.reset().translate(x2, 0, z2);
      const y2 = ground(x2, z2);
      b.push().translate(0, y2 + s2 * 0.22, 0).rotateY(rockRng.range(0, 6.28))
        .scale(1, rockRng.range(0.5, 0.85), 1);
      boulder(s2, STONE, false);
      b.pop();
    }
  }

  // ---- ROCK ACCENTS ON THE STEEP GROUND -----------------------------------
  // The hills are smooth by construction: the height function is a sum of
  // gaussians, so every slope on the island is a clean curve and every hillside
  // read as a green dome. Outcrops placed BY SLOPE are what give them
  // structure, and because they go into the same merged mesh as everything
  // else they cost no draw call at all.
  //
  // Only the largest boulder in each group takes a collider. Ninety of them is
  // a sensible broadphase cost; three hundred is not, and the small ones are
  // ankle height anyway.
  const cragRng = new Rng('crags');
  for (let gx = -96; gx <= 96; gx += 7.5) {
    for (let gz = -96; gz <= 96; gz += 7.5) {
      const x = gx + cragRng.range(-3.4, 3.4);
      const z = gz + cragRng.range(-3.4, 3.4);
      const y = ground(x, z);
      if (y < 2.2) continue;
      const sl = terrain.slope(x, z);
      if (sl < 0.26) continue;                        // flat ground stays clear
      if (terrain.pathWeight(x, z) > 0.1) continue;
      if (!cragRng.chance(0.32 + sl * 0.8)) continue;
      const big = cragRng.range(1.1, 2.2);
      const cragRot = cragRng.range(0, 6.28);
      b.reset().translate(x, y, z).rotateY(cragRot);
      b.push().translate(0, big * 0.30, 0).rotateZ(cragRng.range(-0.35, 0.35))
        .scale(1, cragRng.range(0.55, 0.95), 1);
      boulder(big, cragRng.chance(0.4) ? STONE_DARK : STONE, true);
      b.pop();
      const extras = cragRng.int(1, 3);
      for (let k = 0; k < extras; k++) {
        const r2 = big * cragRng.range(0.30, 0.62);
        const ax = cragRng.range(-big * 1.5, big * 1.5);
        const az = cragRng.range(-big * 1.5, big * 1.5);
        const wx = x + ax * Math.cos(cragRot) + az * Math.sin(cragRot);
        const wz = z - ax * Math.sin(cragRot) + az * Math.cos(cragRot);
        b.push().translate(ax, ground(wx, wz) - y + r2 * 0.24, az)
          .rotateY(cragRng.range(0, 6.28)).rotateZ(cragRng.range(-0.4, 0.4))
          .scale(1, cragRng.range(0.5, 0.9), 1);
        boulder(r2, STONE, false);
        b.pop();
      }
    }
  }

  // ---- WATERFALL BASIN DRESSING -------------------------------------------
  b.reset().translate(34, ground(34, -14), -14);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.push().translate(Math.cos(a) * 11, 0.2, Math.sin(a) * 11).rotateY(a);
    boulder(rng.range(1.1, 2.0), STONE, true);
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

  // A rock outcrop under every anchor. Without one the vines read as four
  // whiskers disappearing into an empty sky, and the whole thing stops looking
  // like it is attached to the island at all.
  buildAnchorCrags(b, physics, terrain, kingMelonAnchors);

  // The vines themselves belong to LegendaryHarvestSystem: they are real rope
  // constraints that can be cut, not decoration, so they are not baked in here.

  // ---- THE WATERFALL ------------------------------------------------------
  // The basin is named for it, so it had better have one.
  // Falls from the basin rim down to the pool. The length is the DROP, not an
  // absolute height — conflating the two buried the whole sheet underground.
  // Find the steepest point on the knoll's south face and fall from there.
  const fallX = 34;
  let fallZ = -26.5;
  let steepest = 0;
  for (let z2 = -30; z2 <= -21; z2 += 0.5) {
    const drop = ground(fallX, z2) - ground(fallX, z2 + 2);
    if (drop > steepest) { steepest = drop; fallZ = z2 + 0.5; }
  }
  const fallTop = ground(fallX, fallZ);
  // The basin floor is below sea level, so the sea floods it into a lagoon and
  // the pool surface is y = 0. Starting the sheet just under that hides the
  // join instead of leaving it hovering 40 cm above its own splash.
  const poolLevel = -0.2;
  // Nudged out from the face so the sheet hangs clear instead of z-fighting it.
  const waterfall = buildWaterfall(fallX, fallZ + 1.9, poolLevel, Math.max(5, fallTop - poolLevel), terrain);
  scene.add(waterfall);

  // ---- THE CLIFF THE WATER COMES OFF --------------------------------------
  // A sheet of animated water against a smooth grassy slope reads as a white
  // rectangle stuck to a hill — which is exactly what shipped, and it was
  // legible as such from the dock, 90 m away. What sells falling water at
  // gameplay distance is the rock around it: a dark overhanging lip to pour
  // over, masses either side to cut the silhouette, ledges for the fall to be
  // seen against, and boulders in the plunge pool for it to land on.
  const fallW = 7.0;
  b.reset().translate(fallX, 0, fallZ);
  // The lip: a dark slab of overhanging rock. The water leaves from under it.
  b.push().translate(0, fallTop - 0.55, 1.5).rotateX(-0.16);
  b.box(fallW + 3.4, 1.1, 3.0, STONE_DARK, true);
  b.pop();
  b.box(fallW + 5.0, 0.9, 1.6, STONE, true, [0, fallTop - 0.2, -0.4]);
  // Masses either side of the notch, stepping down the face.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const r = 2.9 - t * 1.1;
      b.push()
        .translate(side * (fallW / 2 + 1.5 + t * 1.9) - (side === -1 && i === 0 ? 3 : 0),
          fallTop - 0.9 - t * (fallTop - poolLevel - 1.6) * 0.92,
          1.9 + t * 1.4 + (i % 2) * 0.5)
        .rotateY(side * (0.4 + t))
        .scale(1, 0.82 + t * 0.3, 1);
      b.sphere(r, 0, i > 1 ? STONE_WET : STONE_DARK, true);
      b.pop();
    }
  }
  // Ledges the falling water is read against.
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const y = fallTop - t * (fallTop - poolLevel);
    b.push().translate((i % 2 ? 1 : -1) * (fallW / 2 + 0.4), y, 2.4 + t * 1.2)
      .rotateY((i % 2 ? 1 : -1) * 0.35).rotateZ((i % 2 ? -1 : 1) * 0.12);
    b.box(3.2, 0.6, 2.0, i % 2 ? STONE_DARK : STONE_WET, true);
    b.pop();
  }
  // Plunge-pool boulders, half in the water.
  for (const [ox, oz, r] of [[-3.4, 4.6, 1.7], [3.0, 5.2, 1.5], [-0.6, 6.4, 1.2],
    [4.4, 3.4, 1.1], [-4.8, 6.0, 0.9]] as Array<[number, number, number]>) {
    b.push().translate(ox, poolLevel + r * 0.28, oz)
      .rotateY(rng.range(0, 6.28)).scale(1, 0.66, 1);
    b.sphere(r, 0, STONE_WET, true);
    b.pop();
  }

  buildIslandWorksites(b, terrain, signs);
  buildGroveArch(b, physics, terrain, signs);
  const merged = b.finish()!;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0.03, flatShading: true,
  });
  mat.name = 'props';
  // The sky env map was adding a third of a stop on top of a 2.45 sun, and
  // every pale prop — crates, sails, sign boards, the shed itself — came out
  // the same washed cream. Half the environment term puts the tone range back.
  mat.envMapIntensity = 0.32;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'Props';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  for (const s of signs) scene.add(s);

  return {
    mesh, waterfall, signs, dock, sellPad, sellRadius: 3.2, shopCounter,
    kingMelon, kingMelonPos, kingMelonAnchors,
    islandBoard, islandBoardLocked, islandBoardOpen, boatFlag,
  };
}

/**
 * A slack rope between two points, as a chain of short cylinders.
 *
 * Five segments is enough for the eye to read a catenary and cheap enough to
 * hang one between every pair of bollards on the dock. The sag is quadratic
 * rather than a real catenary: at this span the difference is under a
 * centimetre and nobody has ever measured a rope in a fruit game.
 */
function ropeSwag(b: PropBuilder, from: [number, number, number],
  to: [number, number, number], sag: number, segments: number, r = 0.035): void {
  const pt = (t: number): [number, number, number] => [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t - sag * 4 * t * (1 - t),
    from[2] + (to[2] - from[2]) * t,
  ];
  for (let i = 0; i < segments; i++) {
    const a = pt(i / segments), c = pt((i + 1) / segments);
    const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    b.push();
    b.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    b.rotateY(Math.atan2(dx, dz));
    b.rotateX(Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz)));
    b.cylinder(r, r, len * 1.04, 5, ROPE, false);
    b.pop();
  }
}

/**
 * The triangle that fills the end of a gable, extruded to a thickness and
 * oriented to sit in the ZY plane (so it caps a roof whose ridge runs along X).
 */
function gableGeometry(width: number, height: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function makeSign(b: PropBuilder, pos: THREE.Vector3, rotY: number, w: number, h: number,
  tex: THREE.CanvasTexture): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  // Signs face the sun square-on, and at the sun's 2.45 intensity a pale board
  // with a default env contribution tone-maps straight to white: every sign in
  // the game rendered as a blank rectangle. Dropping the environment term and
  // taking the albedo down keeps the lettering inside the roll-off.
  const m = new THREE.MeshStandardMaterial({
    map: tex, roughness: 1.0, metalness: 0, side: THREE.FrontSide,
    color: 0xb9b0a2,
  });
  m.envMapIntensity = 0.12;
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(pos);
  mesh.rotation.y = rotY;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  finishWorldSign(b, mesh, w, h, tex);
  return mesh;
}

/** The aspirational object. It has to look absurd from 150 metres away. */
function buildKingMelon(pos: THREE.Vector3): THREE.Mesh {
  const body = buildKingMelonGeometry(KING_MELON_RADIUS);
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

const FALL_VERT = /* glsl */`
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vDepth = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FALL_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uPhase;
uniform float uFoamBias;
uniform float uOpacity;
uniform vec3 uWater;
uniform vec3 uFoam;
varying vec2 vUv;
varying float vDepth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  // Three bands of noise, each stretched hard along the fall direction and
  // scrolled at its own rate. The stretch is the whole trick: isotropic noise
  // reads as static, and noise sampled ten times wider than it is tall reads as
  // water in ropes. One band was a grey smear; three is a waterfall.
  float t = uTime * 2.1 + uPhase;
  float s1 = noise(vec2(vUv.x * 10.0, vUv.y * 2.4 - t * 0.9));
  float s2 = noise(vec2(vUv.x * 21.0 + 4.0, vUv.y * 4.8 - t * 1.5));
  float s3 = noise(vec2(vUv.x * 38.0 + 9.0, vUv.y * 8.6 - t * 2.3));
  float streak = s1 * 0.48 + s2 * 0.33 + s3 * 0.19;
  // Sharpened into distinct strands rather than a soft gradient.
  float strand = smoothstep(0.34, 0.70, streak);

  vec3 col = mix(uWater, uFoam, strand * 0.85);
  // The lip, where the water is compressed and white as it goes over.
  float lip = smoothstep(0.86, 1.0, vUv.y);
  col = mix(col, uFoam, lip * 0.8);
  // Foam builds toward the bottom, where it is hitting something.
  float base = 1.0 - smoothstep(0.0, 0.34, vUv.y);
  col = mix(col, uFoam, min(1.0, base * 0.95 + uFoamBias));

  // Alpha: dense in the middle of the sheet, torn at its edges, and heaviest
  // where it lands. Uniform alpha is what made the old sheet a solid card.
  float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float alpha = (0.26 + strand * 0.52 + base * 0.34 + lip * 0.30 + uFoamBias * 0.35)
    * mix(0.22, 1.0, edge) * uOpacity;
  // Fade the very top so the sheet does not end in a hard line.
  alpha *= smoothstep(1.02, 0.90, vUv.y);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The waterfall: three sheets of falling water at different widths, depths and
 * phases, plus a curtain of spray at the foot.
 *
 * One sheet was not enough. A single quad with a scrolling texture has a
 * constant silhouette and a constant parallax, so at any distance it reads as
 * a decal on the hillside. Three narrow sheets at different depths cross each
 * other as the camera moves, which is what the eye actually uses to decide
 * something is falling.
 *
 * `baseY` is where it lands; `drop` is how far it falls. Conflating the two
 * once buried the whole sheet underground.
 */
function buildWaterfall(x: number, z: number, baseY: number, drop: number, terrain: Terrain): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'Waterfall';
  const uTime = { value: 0 };

  const sheet = (width: number, h: number, phase: number, foam: number, opacity: number,
    offsetX = 0, lean = 0, offsetY = 0, forward = 0) => {
    const geo = new THREE.PlaneGeometry(width, h, 6, 14);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) / width) * 2;
      const v = pos.getY(i) / h + 0.5;
      // Bow the sheet so it is not a flat card, and flare it as it falls: real
      // water spreads on the way down and this is most of the silhouette.
      const flaredX = pos.getX(i) * (1 + (1 - v) * 0.34);
      const riseY = v * h;
      // Fit the final transformed vertex, including each side sheet's lean
      // and offset. Fitting at the centre then moving it can bury it again.
      const localX = flaredX * Math.cos(lean) - riseY * Math.sin(lean) + offsetX;
      const localY = flaredX * Math.sin(lean) + riseY * Math.cos(lean) + offsetY;
      // The old vertical sheet disappeared inside the sloped bank halfway
      // down. Follow the exposed rock face into the pool without changing
      // the terrain or its collision. Local -Z is world south after rotation.
      const worldX = x - localX;
      const worldY = baseY + localY;
      let faceZ = z + Math.cos(u * 1.2) * 0.8;
      while (faceZ < z + 15 && terrain.height(worldX, faceZ) > worldY - 0.45) faceZ += 0.25;
      pos.setXYZ(i, localX, localY, z - faceZ - 0.35 - forward);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uPhase: { value: phase },
        uFoamBias: { value: foam },
        uOpacity: { value: opacity },
        uWater: { value: new THREE.Color().setHex(0xa6e6f2, THREE.SRGBColorSpace) },
        uFoam: { value: new THREE.Color().setHex(0xf8feff, THREE.SRGBColorSpace) },
      },
      vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'WaterfallSheet';
    mesh.renderOrder = 4;
    return mesh;
  };

  const main = sheet(6.8, drop, 0, 0, 1.0);
  group.add(main);
  const left = sheet(2.4, drop * 0.97, 2.3, 0.05, 0.85, -2.3, 0.05, 0, 0.3);
  group.add(left);
  const right = sheet(1.9, drop * 0.94, 4.1, 0.05, 0.8, 2.1, -0.06, 0, 0.3);
  group.add(right);

  // Spray at the foot: one short, heavily foam-biased curtain, so the fall ends
  // in a cloud rather than at a line. Two of them cost a second full-width
  // transparent surface for a difference nobody could see.
  const spray = sheet(10.5, 3.6, 1.7, 0.55, 0.55, 0, 0, -0.3, 0.55);
  spray.renderOrder = 5;
  group.add(spray);

  group.position.set(x, baseY, z);
  group.rotation.y = Math.PI;
  group.userData.uniforms = { uTime };
  return group;
}


/** Slatted shipping crate, centered on the current prop transform. */
function slattedCrate(b: PropBuilder, size: number, solid: boolean): void {
  if (solid) b.collider(size, size, size);
  b.box(size, size * .08, size, PLANK_DARK, false, [0, -size * .46, 0]);
  for (const x of [-1, 1]) for (const z of [-1, 1])
    b.box(size * .09, size, size * .09, PLANK_DARK, false, [x * size * .455, 0, z * size * .455]);
  for (let row = 0; row < 4; row++) for (const side of [-1, 1]) {
    const y = (-.38 + row * .25) * size;
    b.box(size, size * .15, size * .06, CRATE, false, [0, y, side * size * .47]);
    b.box(size * .06, size * .15, size, CRATE, false, [side * size * .47, y, 0]);
  }
  for (let i = 0; i < 4; i++) b.box(size * .23, size * .08, size, CRATE, false,
    [(-.375 + i * .25) * size, size * .46, 0]);
}
