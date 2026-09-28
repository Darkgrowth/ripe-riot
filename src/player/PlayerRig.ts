import * as THREE from 'three';
import { cloneWorkerVisual, type WorkerVisual } from './WorkerAsset.ts';
import { solveTwoBone } from './WorkerPose.ts';
import { STAND_HEIGHT } from './PlayerDimensions.ts';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
export interface RigColors {
  suit: THREE.Color; suitDark: THREE.Color; skin: THREE.Color;
  boots: THREE.Color; gloves: THREE.Color; hat: THREE.Color; pack: THREE.Color;
}
export const DEFAULT_COLORS: RigColors = {
  suit: C(0xd8a13c), suitDark: C(0xa9761f), skin: C(0xe0a878),
  boots: C(0x4a3524), gloves: C(0x8c5a30), hat: C(0xdd5a3c), pack: C(0x6c7a54),
};
export const SUIT_PRESETS: Array<{ id: string; label: string; colors: Partial<RigColors> }> = [
  { id: 'default', label: 'Orchard Yellow', colors: {} },
  { id: 'blue', label: 'Dockworker Blue', colors: { suit: C(0x4a86c0), suitDark: C(0x2f5f8e), hat: C(0xf0e2c0) } },
  { id: 'green', label: 'Grove Green', colors: { suit: C(0x62a04a), suitDark: C(0x3f7030), hat: C(0xe8d16a) } },
  { id: 'red', label: 'Harvest Red', colors: { suit: C(0xc4503c), suitDark: C(0x8f3427), hat: C(0x2f2f38) } },
  { id: 'hazmat', label: 'Volatile Handling', colors: { suit: C(0xe8e2d0), suitDark: C(0xb8b2a0), hat: C(0xe8a020), gloves: C(0x3a3a44) } },
];
export type RigPartName = 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';
/** Fixed order for the six physical bodies sent during a short co-op ragdoll. */
export const RAGDOLL_PART_NAMES: readonly RigPartName[] =
  ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];
export interface RigidPose { position: THREE.Vector3; quaternion: THREE.Quaternion }
export interface ActivePose {
  position: THREE.Vector3; yaw: number; height: number; time: number;
  moving: boolean; down: boolean; carrying: boolean; busy: boolean;
}
export interface PlayerRig {
  root: THREE.Group; body: THREE.SkinnedMesh | null; source: 'glb' | 'fallback';
  setVisible(v: boolean): void;
  poseActive(input: ActivePose): void;
  posePhysics(bodies: Record<RigPartName, RigidPose>): void;
  dispose(): void;
}
/** Rest offsets from the physics torso center; collision values are unchanged. */
export const RIG_JOINTS = {
  head: new THREE.Vector3(0, 0.33, 0),
  armL: new THREE.Vector3(-0.34, 0.16, 0), armR: new THREE.Vector3(0.34, 0.16, 0),
  legL: new THREE.Vector3(-0.14, -0.38, 0), legR: new THREE.Vector3(0.14, -0.38, 0),
};

function diagnosticRig(): PlayerRig {
  const root = new THREE.Group();
  root.name = 'MISSING WORKER GLB - diagnostic fallback';
  const material = new THREE.MeshBasicMaterial({ color: 0xff00dd, wireframe: true });
  const geometry = new THREE.CapsuleGeometry(.31, 1.2, 4, 8);
  const marker = new THREE.Mesh(geometry, material);
  marker.name = 'MISSING WORKER GLB'; marker.position.y = .1;
  root.add(marker); root.visible = false;
  return { root, body: null, source: 'fallback',
    setVisible(v) { root.visible = v; },
    poseActive(input) {
      root.position.copy(input.position).add(new THREE.Vector3(0, input.height * .58, 0));
      root.rotation.set(0, input.yaw, 0);
    },
    posePhysics(parts) {
      root.position.copy(parts.torso.position); root.quaternion.copy(parts.torso.quaternion);
    },
    dispose() { root.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}

/** One connected visual follows the unchanged six-body Rapier rig. */
export function makePlayerRig(overrides: Partial<RigColors> = {}): PlayerRig {
  let visual: WorkerVisual;
  try { visual = cloneWorkerVisual({ ...DEFAULT_COLORS, ...overrides }); }
  catch (error) {
    console.error('Worker visual unavailable; showing diagnostic fallback', error);
    return diagnosticRig();
  }
  const { root, body } = visual;
  root.visible = false;
  // The imported pivot is at the torso, but each worker mesh has its own boot
  // sole depth. Calibrate against the actual authored boots once, so the active
  // pose puts them at the controller's foot instead of inside the ground.
  root.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  let soleY = Infinity;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/^Boot_[LR]/.test(object.name)) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      if (object instanceof THREE.SkinnedMesh) object.getVertexPosition(i, vertex);
      else vertex.fromBufferAttribute(positions, i);
      vertex.applyMatrix4(object.matrixWorld);
      soleY = Math.min(soleY, vertex.y);
    }
  });
  const standingPivot = Number.isFinite(soleY) ? -soleY + .012 : STAND_HEIGHT * .58;
  const bones = new Map(body.skeleton.bones.map((bone) => [bone.name, bone]));
  const rest = new Map(body.skeleton.bones.map((bone) => [bone.name, bone.quaternion.clone()]));
  const pelvis = bones.get('Pelvis')!;
  const pelvisRestX = pelvis.position.x;
  let lastYaw: number | null = null;
  let lastTime: number | null = null;
  let turnLag = 0;
  const get = (name: string): THREE.Bone => {
    const bone = bones.get(name);
    if (!bone) throw new Error(`worker skeleton missing ${name}`);
    return bone;
  };
  const reset = () => {
    for (const bone of body.skeleton.bones) bone.quaternion.copy(rest.get(bone.name)!);
    pelvis.position.x = pelvisRestX;
  };
  const aim = (name: string, childName: string, worldDirection: THREE.Vector3) => {
    if (worldDirection.lengthSq() < 1e-8) return;
    const bone = get(name), child = get(childName);
    root.updateMatrixWorld(true);
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const localDirection = worldDirection.clone().normalize().applyQuaternion(parentWorld.invert());
    const base = rest.get(name)!;
    const restDirection = child.position.clone().applyQuaternion(base).normalize();
    bone.quaternion.copy(new THREE.Quaternion()
      .setFromUnitVectors(restDirection, localDirection).multiply(base));
  };
  const chain = (upper: string, lower: string, end: string,
    shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3,
    upperLength: number, lowerLength: number) => {
    const solved = solveTwoBone(shoulder, target, pole, upperLength, lowerLength);
    aim(upper, lower, solved.joint.clone().sub(shoulder));
    aim(lower, end, solved.target.clone().sub(solved.joint));
  };
  return { root, body, source: 'glb',
    setVisible(v) { root.visible = v; },
    poseActive(input) {
      reset();
      const dt = lastTime === null ? 0 : input.time - lastTime;
      if (lastYaw !== null && dt > 0 && dt < .2 && !input.down) {
        const deltaYaw = Math.atan2(Math.sin(input.yaw - lastYaw),
          Math.cos(input.yaw - lastYaw));
        turnLag = THREE.MathUtils.clamp(turnLag - deltaYaw * .28, -.18, .18)
          * Math.exp(-6 * dt);
      } else turnLag = 0;
      lastYaw = input.yaw;
      lastTime = input.time;
      root.position.set(input.position.x,
        input.position.y + standingPivot + (input.height - STAND_HEIGHT) * .58,
        input.position.z);
      root.rotation.set(0, input.yaw, 0);
      if (input.down) { root.position.y -= .36; root.rotateX(1.1); }
      const swing = input.moving && !input.down ? Math.sin(input.time * 8) : 0;
      const weight = input.down ? 0 : input.moving ? swing * .2
        : Math.sin(input.time * 1.3);
      pelvis.position.x += weight * .012;
      get('Spine').rotateZ(-weight * .055);
      get('Chest').rotateZ(weight * .025);
      get('Chest').rotateY(turnLag * .55);
      get('Neck').rotateY(turnLag * .45);
      for (const side of ['L', 'R'] as const) {
        const sign = side === 'L' ? 1 : -1;
        const arm = get(`UpperArm_${side}`), forearm = get(`Forearm_${side}`);
        const thigh = get(`Thigh_${side}`), shin = get(`Shin_${side}`);
        const foot = get(`Foot_${side}`);
        const stepLift = Math.max(0, sign * swing);
        arm.rotateZ(-sign * (input.carrying ? .05 : .14));
        arm.rotateX(input.carrying ? -.50 : sign * swing * .46);
        forearm.rotateX(input.carrying ? -.65 : -.28 - Math.abs(swing) * .22);
        thigh.rotateX(sign * swing * .53);
        shin.rotateX(.10 + Math.max(0, -sign * swing) * .68 + stepLift * .35);
        foot.rotateX(-stepLift * .48);
        if (input.busy) forearm.rotateX(-.12);
      }
      root.updateMatrixWorld(true);
    },
    posePhysics(parts) {
      reset();
      lastYaw = null;
      lastTime = null;
      turnLag = 0;
      root.position.copy(parts.torso.position);
      root.quaternion.copy(parts.torso.quaternion);
      root.updateMatrixWorld(true);
      const torsoQ = parts.torso.quaternion;
      for (const side of ['L', 'R'] as const) {
        const sign = side === 'L' ? -1 : 1;
        const armKey = side === 'L' ? 'armL' : 'armR';
        const legKey = side === 'L' ? 'legL' : 'legR';
        const shoulder = RIG_JOINTS[armKey].clone().applyQuaternion(torsoQ)
          .add(parts.torso.position);
        const wrist = new THREE.Vector3(0, -.26, 0)
          .applyQuaternion(parts[armKey].quaternion).add(parts[armKey].position);
        const armPole = new THREE.Vector3(sign * .9, .2, .48)
          .applyQuaternion(torsoQ).add(shoulder);
        chain(`UpperArm_${side}`, `Forearm_${side}`, `Hand_${side}`,
          shoulder, wrist, armPole, .25, .29);
        const hip = RIG_JOINTS[legKey].clone().applyQuaternion(torsoQ)
          .add(parts.torso.position);
        const ankle = new THREE.Vector3(0, -.28, 0)
          .applyQuaternion(parts[legKey].quaternion).add(parts[legKey].position);
        const legPole = new THREE.Vector3(sign * .15, .12, .8)
          .applyQuaternion(torsoQ).add(hip);
        chain(`Thigh_${side}`, `Shin_${side}`, `Foot_${side}`,
          hip, ankle, legPole, .26, .28);
      }
      const neck = get('Neck');
      const relativeHead = torsoQ.clone().invert().multiply(parts.head.quaternion);
      neck.quaternion.copy(relativeHead.multiply(rest.get('Neck')!));
      root.updateMatrixWorld(true);
    },
    dispose() { root.removeFromParent(); visual.dispose(); },
  };
}
