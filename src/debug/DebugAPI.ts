import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { InputFrame } from '@/player/PlayerInput';

/**
 * The automated-test surface. Everything the Playwright harness needs lives on
 * `window.__RIPE`; nothing in the game may depend on it, so it can be stripped
 * from a shipping build without touching gameplay code.
 *
 * Design rule: prefer returning NUMBERS over rendering pictures. A test that can
 * assert `flat < 0.9` never has to open a screenshot.
 */
export interface DebugState {
  ready: boolean;
  tick: number;
  elapsed: number;
  fps: number;
  player: {
    pos: [number, number, number];
    vel: [number, number, number];
    yaw: number; pitch: number;
    grounded: boolean; speed: number; state: string; height: number;
  };
  physics: { bodies: number; active: number };
  render: { drawCalls: number; triangles: number; geometries: number; textures: number; programs: number };
  profile: { physics: number; fixed: number; frame: number; render: number; total: number };
  [k: string]: unknown;
}

type Probe = () => Record<string, unknown>;

export class DebugAPI {
  private g: Game;
  private frames: number[] = [];
  private probes = new Map<string, Probe>();
  private actions = new Map<string, (...args: never[]) => unknown>();
  logs: string[] = [];

  constructor(g: Game) {
    this.g = g;
    (window as unknown as { __RIPE: DebugAPI }).__RIPE = this;
    g.bus.on('debug:log', (p) => this.log(p.text));
  }

  log(text: string): void {
    this.logs.push(`[${this.g.clock.elapsed.toFixed(2)}] ${text}`);
    if (this.logs.length > 400) this.logs.shift();
  }

  /** Systems attach extra state here so the harness sees one flat object. */
  addProbe(key: string, fn: Probe): void { this.probes.set(key, fn); }
  addAction(key: string, fn: (...args: never[]) => unknown): void { this.actions.set(key, fn); }

  call(key: string, ...args: unknown[]): unknown {
    const fn = this.actions.get(key);
    if (!fn) throw new Error(`No debug action: ${key}. Have: ${[...this.actions.keys()].join(', ')}`);
    return (fn as (...a: unknown[]) => unknown)(...args);
  }
  hasAction(key: string): boolean { return this.actions.has(key); }
  listActions(): string[] { return [...this.actions.keys()].sort(); }

  noteFrame(dtMs: number): void {
    this.frames.push(dtMs);
    if (this.frames.length > 120) this.frames.shift();
  }

  get fps(): number {
    if (!this.frames.length) return 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    return avg > 0 ? +(1000 / avg).toFixed(1) : 0;
  }

  state(): DebugState {
    const p = this.g.player;
    const s: DebugState = {
      ready: true,
      tick: this.g.clock.tick,
      elapsed: +this.g.clock.elapsed.toFixed(3),
      fps: this.fps,
      player: {
        pos: v3(p.position), vel: v3(p.velocity),
        yaw: +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4),
        grounded: p.grounded, speed: +p.speed.toFixed(3),
        state: p.state, height: +p.height.toFixed(3),
      },
      physics: { bodies: this.g.physics.bodyCount, active: this.g.physics.activeBodyCount },
      render: this.g.renderer.info,
      profile: {
        physics: +this.g.profile.physics.toFixed(2),
        fixed: +this.g.profile.fixed.toFixed(2),
        frame: +this.g.profile.frame.toFixed(2),
        render: +this.g.profile.render.toFixed(2),
        total: +this.g.profile.total.toFixed(2),
      },
    };
    for (const [k, fn] of this.probes) {
      try { s[k] = fn(); } catch (e) { s[k] = { error: String(e) }; }
    }
    return s;
  }

  /** Numeric image triage — see Renderer.frameStats. */
  frameStats(w?: number, h?: number) { return this.g.renderer.frameStats(w, h); }

  // ---- control ------------------------------------------------------------
  pause(on = true): void { this.g.clock.paused = on; }
  step(n = 1): void { this.g.clock.stepOnce(n); }
  setTimeScale(s: number): void { this.g.clock.scale = s; }

  /** Advance the simulation deterministically by N fixed steps, rendering each. */
  async advance(steps: number): Promise<void> {
    const wasPaused = this.g.clock.paused;
    this.g.clock.paused = true;
    for (let i = 0; i < steps; i++) {
      this.g.clock.stepOnce(1);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    this.g.clock.paused = wasPaused;
  }

  input(patch: Partial<InputFrame> | null): void {
    if (patch === null) { this.g.input.synthetic = null; return; }
    this.g.input.synthetic = { ...(this.g.input.synthetic ?? {}), ...patch };
  }
  clearInput(): void { this.g.input.synthetic = null; }

  tp(x: number, y: number, z: number): void {
    this.g.player.teleport(new THREE.Vector3(x, y, z));
  }
  look(yaw: number, pitch: number): void {
    this.g.player.yaw = yaw;
    this.g.player.pitch = pitch;
  }

  /** Detach the camera and frame a point — used for scenery contact sheets. */
  freeCam(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.g.playerCamera.frameTo(new THREE.Vector3(px, py, pz), new THREE.Vector3(tx, ty, tz));
  }
  attachCam(): void { this.g.playerCamera.resume(); }

  /** Place the camera on an orbit around a target — convenient for turntables. */
  orbitCam(tx: number, ty: number, tz: number, radius: number, yawDeg: number, pitchDeg: number): void {
    const y = THREE.MathUtils.degToRad(yawDeg);
    const p = THREE.MathUtils.degToRad(pitchDeg);
    const pos = new THREE.Vector3(
      tx + Math.cos(p) * Math.sin(y) * radius,
      ty + Math.sin(p) * radius,
      tz + Math.cos(p) * Math.cos(y) * radius,
    );
    this.freeCam(pos.x, pos.y, pos.z, tx, ty, tz);
  }

  setPixelRatio(v: number): void { this.g.renderer.setPixelRatioCap(v); }
  resize(w: number, h: number): void { this.g.renderer.resize(w, h); }

  terrainHeight(x: number, z: number): number {
    const w = this.g.get('world') as unknown as { terrain: { height(x: number, z: number): number } };
    return +w.terrain.height(x, z).toFixed(3);
  }

  /** Cast a ray from the eye and report what it hits. Cheap "what am I looking
   *  at" probe that replaces squinting at a screenshot. */
  probeLook(maxDist = 60): Record<string, unknown> {
    const p = this.g.player;
    const dir = p.lookDir();
    const hit = this.g.physics.raycast(p.eyePosition.clone(), dir, maxDist, 0xffffffff, p.body);
    if (!hit) return { hit: false };
    return {
      hit: true,
      distance: +hit.distance.toFixed(3),
      point: v3(hit.point),
      normal: v3(hit.normal),
      owner: hit.owner ? { id: hit.owner.id, kind: hit.owner.kind } : null,
    };
  }

  dumpLogs(): string[] { return this.logs.slice(); }
  clearLogs(): void { this.logs.length = 0; }
}

function v3(v: THREE.Vector3): [number, number, number] {
  return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
}
