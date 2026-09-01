import * as THREE from 'three';
import { Renderer } from '@/render/Renderer';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Clock, FIXED_DT } from './Time';
import { EventBus } from './Events';
import type { GameEventMap } from './GameEvents';
import { PlayerInput } from '@/player/PlayerInput';
import { PlayerController } from '@/player/PlayerController';
import { PlayerCamera } from '@/player/PlayerCamera';
import { Rng } from './Rng';
import type { DebugAPI } from '@/debug/DebugAPI';

export interface System {
  readonly name: string;
  init?(g: Game): void | Promise<void>;
  /** Runs at a fixed 60 Hz alongside physics. Put simulation here. */
  fixedStep?(dt: number): void;
  /** Runs once per rendered frame. Put visuals and interpolation here. */
  frameUpdate?(dt: number, alpha: number): void;
  /** After frameUpdate, for things that must observe final transforms. */
  lateUpdate?(dt: number): void;
  dispose?(): void;
}

export type GameBus = EventBus<GameEventMap>;

export class Game {
  renderer!: Renderer;
  physics = new PhysicsWorld();
  clock = new Clock();
  bus: GameBus = new EventBus<GameEventMap>();
  input!: PlayerInput;
  player!: PlayerController;
  playerCamera!: PlayerCamera;
  rng = new Rng('sunpatch');
  seed = 20260901;
  /** Present in dev builds only; systems register probes and actions here. */
  debug: DebugAPI | null = null;

  readonly systems: System[] = [];
  private byName = new Map<string, System>();
  private nextId = 1;
  running = false;
  /** Seconds of wall clock spent in the last frame's major phases. */
  profile = { physics: 0, fixed: 0, frame: 0, render: 0, total: 0 };

  newId(): number { return this.nextId++; }

  add<T extends System>(sys: T): T {
    this.systems.push(sys);
    this.byName.set(sys.name, sys);
    return sys;
  }

  /** Look a system up by name. The type parameter is a structural view of the
   *  system, not necessarily the concrete class — call sites often only need
   *  one method, and depending on the narrow shape keeps coupling low. */
  get<T = System>(name: string): T {
    const s = this.byName.get(name);
    if (!s) throw new Error(`System not found: ${name}`);
    return s as T;
  }

  has(name: string): boolean { return this.byName.has(name); }

  async boot(canvas: HTMLCanvasElement, spawn: THREE.Vector3): Promise<void> {
    await PhysicsWorld.load();
    this.physics.init();
    this.renderer = new Renderer(canvas);
    this.input = new PlayerInput(canvas);
    this.player = new PlayerController(this.physics, this.newId(), spawn);
    this.playerCamera = new PlayerCamera(this.renderer.camera);
  }

  async initSystems(): Promise<void> {
    for (const s of this.systems) await s.init?.(this);
  }

  private lastFrameTime = 0;

  /** One iteration of the main loop. Called by requestAnimationFrame. */
  tick(nowMs: number): void {
    const t0 = performance.now();
    const steps = this.clock.advance(nowMs);
    const frameDt = Math.min(0.1, (nowMs - this.lastFrameTime) / 1000 || FIXED_DT);
    this.lastFrameTime = nowMs;

    const input = this.input.sample();
    // Look is applied per frame, not per fixed step: mouse deltas are already
    // frame-quantised and re-integrating them at 60 Hz feels laggy.
    this.player.applyLook(input.lookX, input.lookY);

    let tPhys = 0, tFixed = 0;
    for (let i = 0; i < steps; i++) {
      const a = performance.now();
      this.player.step(input, FIXED_DT);
      for (const s of this.systems) s.fixedStep?.(FIXED_DT);
      tFixed += performance.now() - a;
      const b = performance.now();
      this.physics.step();
      tPhys += performance.now() - b;
      // Edge-triggered input must not fire again on a second substep.
      if (i === 0) clearEdges(input);
    }

    const t2 = performance.now();
    for (const s of this.systems) s.frameUpdate?.(frameDt, this.clock.alpha);
    this.playerCamera.update(this.player, frameDt);
    for (const s of this.systems) s.lateUpdate?.(frameDt);
    this.renderer.updateCameraFov(frameDt);
    this.renderer.updateSunFollow(this.player.position, this.player.forward(_f));
    const t3 = performance.now();
    this.renderer.render();
    const t4 = performance.now();

    this.profile.physics = tPhys;
    this.profile.fixed = tFixed;
    this.profile.frame = t3 - t2;
    this.profile.render = t4 - t3;
    this.profile.total = t4 - t0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.tick(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; }

  dispose(): void {
    this.stop();
    for (const s of this.systems) s.dispose?.();
    this.input?.dispose();
    this.player?.dispose();
  }
}

const _f = new THREE.Vector3();

function clearEdges(i: { jumpPressed: boolean; interactPressed: boolean; primaryPressed: boolean;
  secondaryPressed: boolean; primaryReleased: boolean; secondaryReleased: boolean;
  dropPressed: boolean; slot: number; }): void {
  i.jumpPressed = false; i.interactPressed = false; i.primaryPressed = false;
  i.secondaryPressed = false; i.primaryReleased = false; i.secondaryReleased = false;
  i.dropPressed = false; i.slot = 0;
}
