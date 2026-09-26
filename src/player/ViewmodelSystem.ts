import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { ToolInventory } from '@/tools/ToolInventory';
import type { Carried, InteractionSystem } from '@/interaction/InteractionSystem';
import { buildViewModel, VIEW_DEPTH, VIEW_LATERAL, type ViewModel } from '@/render/Viewmodel';
import { CarryViewmodel } from '@/player/CarryViewmodel';
import { framingFor } from '@/interaction/CarryRules';
import { VIEWMODEL_FOV_SCALE } from '@/render/Renderer';
import { damp, clamp } from '@/core/MathUtils';
import { disposeWorkerHands, workerHandsSource } from '@/render/WorkerHands';

/** Framing is authored at 16:9; anything narrower gets a smaller tool. */
const REFERENCE_ASPECT = 16 / 9;

/**
 * The tool in your hands.
 *
 * A first-person game where the equipment is invisible reads as a systems demo,
 * however good the systems are. This is cheap to run (one small mesh, its own
 * scene, depth cleared) and does most of the work of making a tool feel like an
 * object you are holding rather than a mode you are in.
 *
 * All of it is cosmetic. Nothing here may feed back into simulation.
 */
export class ViewmodelSystem implements System {
  readonly name = 'viewmodel';
  private g!: Game;
  private tools!: ToolInventory;
  private interaction!: InteractionSystem;
  private material!: THREE.MeshStandardMaterial;
  private cache = new Map<string, ViewModel>();
  private current: ViewModel | null = null;
  private currentId = '';

  /** Smoothed sway/bob state. */
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private bob = new THREE.Vector3();
  private lastYaw = 0;
  private lastPitch = 0;
  /** 0 = fully out, 1 = fully stowed below the screen. */
  private stow = 1;
  private kick = 0;
  private kickVel = 0;
  /** A lateral sweep of the whole rig, for tools that swing: seconds left, total, and the smoothed pose. */
  private swingLeft = 0;
  private swingTotal = 0;
  private swingX = 0;
  private swingY = 0;
  private swingYaw = 0;
  visible = true;

  /**
   * The carry rig. Mutually exclusive with the tool: whenever something is in
   * the player's hands the equipped tool stows itself and this takes the frame,
   * so a fruit, a basket, a rope gun and a spare pair of gloves can never be on
   * screen at the same time.
   */
  private carry!: CarryViewmodel;
  /** 0 = carried fruit fully presented, 1 = fully out of frame. */
  private carryStow = 1;
  private carryBob = new THREE.Vector3();

  init(g: Game): void {
    this.g = g;
    this.tools = g.get<ToolInventory>('tools');
    this.interaction = g.get<InteractionSystem>('interaction');

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.06,
      flatShading: true,
    });
    this.material.name = 'viewmodel';
    g.renderer.enableViewmodel();
    this.carry = new CarryViewmodel(this.material);
    g.renderer.viewScene.add(this.carry.root);

    g.bus.on('tool:fired', (p) => this.punch(clamp(p.power ?? 1, 0.15, 2.2)));
    g.bus.on('tool:swing', (p) => { this.swingLeft = this.swingTotal = Math.max(0.05, p.duration); });
    // The hands are a tool too. Pulling fruit off a branch and dropping it in
    // the basket should register in the arms, not only in the toast.
    g.bus.on('fruit:detached', (p) => { if (p.cause === 'hand') this.punch(0.45); });
    g.bus.on('fruit:stowed', () => this.punch(0.28));
    // Taking hold of something loose is the commonest action in the game and
    // used to move nothing on screen at all. Heavier is a bigger heave.
    g.bus.on('fruit:grabbed', (p) => this.punch(clamp(0.3 + p.mass * 0.05, 0.3, 1.1)));
    g.bus.on('player:hit', (p) => this.punch(clamp(p.momentum / 90, 0.25, 0.9)));
    g.bus.on('tool:equipped', () => { this.stow = 1; });

    g.debug?.addProbe('viewmodel', () => ({
      tool: this.currentId,
      handsSource: workerHandsSource(),
      stow: +this.stow.toFixed(2),
      kick: +this.kick.toFixed(3),
      visible: this.visible,
      cached: this.cache.size,
      toolShown: !!this.current?.root.visible,
      carryShown: this.carry.root.visible,
      carryClass: this.interaction.carryClass,
      carryHeightPct: +this.carry.targetHeightPct.toFixed(1),
    }));
    g.debug?.addAction('viewmodel.show', (on: boolean) => {
      this.visible = on;
      return this.visible;
    });
  }

  /** A recoil impulse; tools call it through the `tool:fired` event. */
  punch(strength: number): void {
    this.kickVel += 5.5 * strength;
  }

  private modelFor(id: string): ViewModel {
    let vm = this.cache.get(id);
    if (!vm) {
      vm = buildViewModel(id, this.material);
      this.cache.set(id, vm);
    }
    return vm;
  }

  frameUpdate(dt: number): void {
    const r = this.g.renderer;
    const wantId = this.tools.activeId ?? 'hand';
    const player = this.g.player;

    // Hide the viewmodel whenever the camera is not on the player's face — or
    // whenever the hands are full. Carrying a fruit and holding a tool are
    // mutually exclusive PRESENTATIONS even though they are not mutually
    // exclusive states: the rope gun still fires while you have an apple under
    // your arm, it just is not drawn, because the alternative is the failure
    // this whole pass exists to fix — a melon, a basket and two unrelated
    // gloves stacked on top of each other in the middle of the screen.
    const carried = this.interaction.carried;
    const onScreen = this.visible && player.state === 'active' && this.g.playerCamera.enabled;
    const shouldShow = onScreen && !carried;

    // Swap tools through a quick stow-and-draw rather than popping.
    if (wantId !== this.currentId) {
      this.stow = Math.min(1, this.stow + dt * 7);
      if (this.stow >= 0.999) {
        if (this.current) r.viewScene.remove(this.current.root);
        this.current = this.modelFor(wantId);
        this.currentId = wantId;
        r.viewScene.add(this.current.root);
      }
    } else if (shouldShow) {
      this.stow = damp(this.stow, 0, 9, dt);
    } else {
      // Putting a tool away is a RAMP, not a decay. An exponential approach
      // takes 0.6 s to get within the threshold that actually stops drawing it,
      // so picking up an apple left the shaker fading on screen for most of a
      // second — long enough to be exactly the overlap this pass is removing.
      this.stow = Math.min(1, this.stow + dt * 7);
    }
    if (!this.current) {
      this.current = this.modelFor(wantId);
      this.currentId = wantId;
      r.viewScene.add(this.current.root);
    }

    // --- sway: the tool lags behind where you are looking
    const dYaw = shortestAngle(player.yaw - this.lastYaw);
    const dPitch = player.pitch - this.lastPitch;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    this.swayVel.x += clamp(dYaw, -0.25, 0.25) * 3.2;
    this.swayVel.y += clamp(dPitch, -0.25, 0.25) * 3.2;
    this.swayVel.multiplyScalar(Math.exp(-9 * dt));
    this.sway.x = damp(this.sway.x + this.swayVel.x * dt, 0, 6, dt);
    this.sway.y = damp(this.sway.y + this.swayVel.y * dt, 0, 6, dt);
    this.sway.x = clamp(this.sway.x, -0.12, 0.12);
    this.sway.y = clamp(this.sway.y, -0.12, 0.12);

    // --- bob: tied to the same phase the camera uses, so they agree
    const speed = player.speed;
    const moving = player.grounded && speed > 0.6;
    const amp = moving ? clamp(speed / 8, 0.2, 1) * 0.026 : 0;
    this.bob.x = damp(this.bob.x, Math.sin(player.bobPhase) * amp, 12, dt);
    this.bob.y = damp(this.bob.y, -Math.abs(Math.cos(player.bobPhase)) * amp, 12, dt);
    this.bob.z = damp(this.bob.z, moving ? -amp * 0.5 : 0, 10, dt);

    // --- swing: the rig sweeps right-to-left across the frame and yaws with
    // it, then settles back. Driven by the tool's own timing so the arms and
    // the hoop in the world agree about when the net is where.
    let swingX = 0, swingY = 0, swingYaw = 0;
    if (this.swingLeft > 0) {
      this.swingLeft = Math.max(0, this.swingLeft - dt);
      const s = 1 - this.swingLeft / this.swingTotal;
      const e = s * s * (3 - 2 * s);
      // An upward scoop across the frame: right and low, up through the
      // middle, out to the left. The middle is where the hoop meets the fruit.
      swingX = 0.16 - e * 0.34;
      swingY = Math.sin(e * Math.PI) * 0.17;
      swingYaw = -0.55 + e * 1.1;
    }
    this.swingX = damp(this.swingX, swingX, this.swingLeft > 0 ? 40 : 9, dt);
    this.swingY = damp(this.swingY, swingY, this.swingLeft > 0 ? 40 : 9, dt);
    this.swingYaw = damp(this.swingYaw, swingYaw, this.swingLeft > 0 ? 40 : 9, dt);

    // --- recoil spring
    this.kickVel -= this.kick * 90 * dt;
    this.kickVel *= Math.exp(-11 * dt);
    this.kick += this.kickVel * dt;

    // --- charge-up: pull the tool back as a throw or blast winds up
    const charge = Math.max(this.interaction.throwCharge, this.tools.activeTool?.charge ?? 0);
    this.current.setCharge?.(this.tools.activeTool?.charge ?? 0);

    // --- framing. How much of the screen a tool covers, and how far to the
    // right it sits, both depend on the aspect ratio, so both are expressed as
    // fractions of the visible frame rather than as fixed distances. A window
    // dragged tall and narrow otherwise hangs the hoop of a catch net off the
    // edge of the screen.
    //
    // Read the MAIN camera: the view camera is only synced during render(),
    // which runs after this, so using it would lag a frame behind a resize.
    const vmFov = r.camera.fov * VIEWMODEL_FOV_SCALE;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(vmFov) * 0.5) * r.camera.aspect * VIEW_DEPTH;
    this.current.setFit(clamp(r.camera.aspect / REFERENCE_ASPECT, 0.5, 1));

    const root = this.current.root;
    root.position.set(
      VIEW_LATERAL * halfWidth + this.sway.x + this.bob.x + this.swingX,
      this.sway.y + this.bob.y + this.swingY - this.stow * 0.55 - player.landDip * 0.25,
      this.bob.z + this.kick * 0.09 + charge * 0.06,
    );
    root.rotation.set(
      -this.sway.y * 2.2 + this.kick * 0.35 + charge * 0.22 - this.swingY * 3.2,
      -this.sway.x * 2.4 + this.swingYaw,
      this.sway.x * 1.6 - this.stow * 0.5 - this.swingYaw * 0.25,
    );
    // Ownership decides visibility immediately; the real-time stow animation
    // only decides the pose. Waiting for its ramp let both rigs appear during
    // pickup, especially when several simulation steps share one fast frame.
    root.visible = shouldShow && this.stow < 0.995;

    this.updateCarry(dt, carried, charge);
  }

  /**
   * Frame the carried fruit.
   *
   * The fruit itself is placed by `CarryViewmodel` from the framing table; what
   * happens here is the movement — bob, look-lag, the spring the interaction
   * system is already running on the world copy, and the wind-up of a throw.
   * Without those the proxy is a decal and the weight the carry spring works so
   * hard to communicate never reaches the screen.
   */
  private updateCarry(dt: number, carried: Carried | null, charge: number): void {
    const showCarry = !!carried && this.visible && this.g.player.state === 'active'
      && this.g.playerCamera.enabled;
    this.carryStow = showCarry
      ? damp(this.carryStow, 0, 13, dt)
      : Math.min(1, this.carryStow + dt * 8);
    // A released fruit already belongs to the world renderer. Keeping this
    // proxy visible until its stow ramp finishes leaves a frozen duplicate in
    // the hands, because there is no carried object left to update its pose.
    this.carry.root.visible = showCarry && this.carryStow < 0.995;
    if (!this.carry.root.visible) { this.carry.reset(); return; }
    if (!carried) return;

    const player = this.g.player;
    const f = framingFor(this.interaction.carryClass);
    const speed = player.speed;
    const moving = player.grounded && speed > 0.6;
    const amp = (moving ? clamp(speed / 8, 0.2, 1) * 0.022 : 0) * f.heft;
    this.carryBob.x = damp(this.carryBob.x, Math.sin(player.bobPhase) * amp, 11, dt);
    this.carryBob.y = damp(this.carryBob.y, -Math.abs(Math.cos(player.bobPhase)) * amp, 11, dt);
    this.carryBob.z = damp(this.carryBob.z, moving ? -amp * 0.4 : 0, 10, dt);

    // The world spring's displacement, already resolved into view axes by the
    // interaction system. Scaled down hard: 0.32 m of world swing across a
    // 0.55 m deep viewmodel scene would throw the fruit out of frame.
    const lag = this.interaction.handLagView;
    _sway.set(
      this.carryBob.x + this.sway.x * 0.55 + lag.x * 0.16,
      this.carryBob.y + this.sway.y * 0.55 + lag.y * 0.16
        - this.carryStow * 0.42 - player.landDip * 0.06 * f.heft,
      this.carryBob.z + lag.z * 0.10 + charge * 0.10 + this.kick * 0.03,
    );
    // Turning your head tips the fruit; winding up a throw rolls it back.
    _e2.set(
      -this.sway.y * 1.4 + charge * 0.5 + this.kick * 0.2,
      -this.sway.x * 1.8 + 0.5,
      this.sway.x * 1.1 + this.carryStow * 0.5,
      'YXZ',
    );
    _q2.setFromEuler(_e2);

    const r = this.g.renderer;
    this.carry.update(
      dt, this.interaction.carryClass, carried.fruit.diameter, carried.fruit.species,
      carried.fruit.tint, carried.fruit.emissive ? 0.5 : 0,
      r.camera.aspect, r.camera.fov * VIEWMODEL_FOV_SCALE, _sway, _q2,
    );
  }

  /** Where a carried fruit should be drawn so it lines up with the hands. */
  get holdPoint(): THREE.Vector3 | null {
    return this.current ? this.current.holdPoint : null;
  }

  dispose(): void {
    for (const vm of this.cache.values()) vm.dispose();
    this.cache.clear();
    this.carry.dispose();
    this.material.dispose();
    disposeWorkerHands();
  }
}

function shortestAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const _sway = new THREE.Vector3();
const _e2 = new THREE.Euler();
const _q2 = new THREE.Quaternion();
