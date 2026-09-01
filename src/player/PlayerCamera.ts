import * as THREE from 'three';
import { clamp, damp, lerp } from '@/core/MathUtils';
import type { PlayerController } from './PlayerController';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

interface Shake { amp: number; freq: number; left: number; total: number; }

/**
 * Turns player state into a camera transform. Everything here is cosmetic —
 * never let camera effects influence the simulation, or replays and multiplayer
 * clients will disagree with the host.
 */
export class PlayerCamera {
  camera: THREE.PerspectiveCamera;
  private shakes: Shake[] = [];
  private roll = 0;
  private bobOffset = new THREE.Vector3();
  private recoil = new THREE.Vector2();
  private recoilVel = new THREE.Vector2();
  /** Blend 0..1 toward a free/ragdoll camera. */
  private ragdollBlend = 0;
  ragdollAnchor: THREE.Object3D | null = null;
  fovOffset = 0;

  bobStrength = 1;
  enabled = true;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  addShake(amp: number, duration = 0.35, freq = 26): void {
    this.shakes.push({ amp, freq, left: duration, total: duration });
  }

  /** Kick the view; x = horizontal, y = vertical (radians). */
  addRecoil(x: number, y: number): void {
    this.recoilVel.x += x;
    this.recoilVel.y += y;
  }

  setRagdoll(on: boolean, anchor: THREE.Object3D | null = null): void {
    this.ragdollAnchor = anchor;
    this.ragdollTarget = on ? 1 : 0;
  }
  private ragdollTarget = 0;

  update(player: PlayerController, dt: number): void {
    if (!this.enabled) return;

    // --- shake accumulation
    let shakeX = 0, shakeY = 0, shakeZ = 0;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.left -= dt;
      if (s.left <= 0) { this.shakes.splice(i, 1); continue; }
      const k = s.left / s.total;
      const a = s.amp * k * k;
      const t = (s.total - s.left) * s.freq;
      shakeX += Math.sin(t * 1.13) * a;
      shakeY += Math.sin(t * 1.71 + 1.3) * a;
      shakeZ += Math.sin(t * 0.91 + 2.2) * a * 0.35;
    }

    // --- recoil spring
    this.recoilVel.multiplyScalar(Math.exp(-11 * dt));
    this.recoil.x = damp(this.recoil.x + this.recoilVel.x * dt, 0, 7, dt);
    this.recoil.y = damp(this.recoil.y + this.recoilVel.y * dt, 0, 7, dt);

    // --- head bob and strafe roll
    const speed = player.speed;
    const moving = player.grounded && speed > 0.6;
    const bobAmp = moving ? clamp(speed / 8, 0.15, 1) * 0.055 * this.bobStrength : 0;
    const bx = Math.sin(player.bobPhase) * bobAmp * 0.6;
    const by = Math.abs(Math.cos(player.bobPhase)) * bobAmp;
    this.bobOffset.x = damp(this.bobOffset.x, bx, 14, dt);
    this.bobOffset.y = damp(this.bobOffset.y, by, 14, dt);

    const strafe = player.velocity.dot(player.right(_v)) / Math.max(1, player.tuning.walk);
    const targetRoll = clamp(-strafe, -1, 1) * 0.028 + Math.sin(player.bobPhase) * bobAmp * 0.25;
    this.roll = damp(this.roll, targetRoll, 10, dt);

    this.ragdollBlend = damp(this.ragdollBlend, this.ragdollTarget, 9, dt);

    // --- compose
    const eye = player.eyePosition;
    _v.set(eye.x, eye.y - player.landDip * 0.55 + this.bobOffset.y, eye.z);
    _v.x += this.bobOffset.x * player.right(new THREE.Vector3()).x;
    _v.z += this.bobOffset.x * player.right(new THREE.Vector3()).z;

    if (this.ragdollBlend > 0.001 && this.ragdollAnchor) {
      const a = this.ragdollAnchor.getWorldPosition(new THREE.Vector3());
      // Pull back and up a little so the tumble is legible instead of nauseating.
      a.y += 0.35;
      _v.lerp(a, this.ragdollBlend);
    }

    this.camera.position.copy(_v);
    _e.set(player.pitch + this.recoil.y + shakeY, player.yaw + this.recoil.x + shakeX, this.roll + shakeZ, 'YXZ');
    _q.setFromEuler(_e);
    this.camera.quaternion.copy(_q);
  }

  /** Third-person-ish framing used by the capture harness for scenery shots. */
  frameTo(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.enabled = false;
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }
  resume(): void { this.enabled = true; }
}

export { lerp };
