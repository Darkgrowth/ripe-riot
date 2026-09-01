import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { ToolInventory } from '@/tools/ToolInventory';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import { buildViewModel, type ViewModel } from '@/render/Viewmodel';
import { damp, clamp } from '@/core/MathUtils';

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
  visible = true;

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

    g.bus.on('tool:fired', () => this.punch(1));
    g.bus.on('tool:equipped', () => { this.stow = 1; });

    g.debug?.addProbe('viewmodel', () => ({
      tool: this.currentId,
      stow: +this.stow.toFixed(2),
      kick: +this.kick.toFixed(3),
      visible: this.visible,
      cached: this.cache.size,
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

    // Hide the viewmodel whenever the camera is not on the player's face.
    const shouldShow = this.visible
      && player.state === 'active'
      && this.g.playerCamera.enabled;

    // Swap tools through a quick stow-and-draw rather than popping.
    if (wantId !== this.currentId) {
      this.stow = Math.min(1, this.stow + dt * 7);
      if (this.stow >= 0.999) {
        if (this.current) r.viewScene.remove(this.current.root);
        this.current = this.modelFor(wantId);
        this.currentId = wantId;
        r.viewScene.add(this.current.root);
      }
    } else {
      this.stow = damp(this.stow, shouldShow ? 0 : 1, 9, dt);
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

    // --- recoil spring
    this.kickVel -= this.kick * 90 * dt;
    this.kickVel *= Math.exp(-11 * dt);
    this.kick += this.kickVel * dt;

    // --- charge-up: pull the tool back as a throw or blast winds up
    const charge = Math.max(this.interaction.throwCharge, this.tools.activeTool?.charge ?? 0);

    const root = this.current.root;
    root.position.set(
      this.sway.x + this.bob.x,
      this.sway.y + this.bob.y - this.stow * 0.55 - player.landDip * 0.25,
      this.bob.z + this.kick * 0.09 + charge * 0.06,
    );
    root.rotation.set(
      -this.sway.y * 2.2 + this.kick * 0.35 + charge * 0.22,
      -this.sway.x * 2.4,
      this.sway.x * 1.6 - this.stow * 0.5,
    );
    root.visible = this.stow < 0.995;
  }

  /** Where a carried fruit should be drawn so it lines up with the hands. */
  get holdPoint(): THREE.Vector3 | null {
    return this.current ? this.current.holdPoint : null;
  }

  dispose(): void {
    for (const vm of this.cache.values()) vm.dispose();
    this.cache.clear();
    this.material.dispose();
  }
}

function shortestAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
