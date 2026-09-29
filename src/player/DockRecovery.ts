import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import type { PlayerVitals } from './PlayerVitals';

/** A safe place to regroup between excursions, with no purchase or cargo penalty. */
export class DockRecovery implements System {
  readonly name = 'dockRecovery';
  private g!: Game;
  private world!: Sunpatch;
  private vitals!: PlayerVitals;
  private resting = 0;
  private announced = false;

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.vitals = g.get<PlayerVitals>('vitals');
  }

  fixedStep(dt: number): void {
    const p = this.g.player;
    const near = [this.world.spawnPoint, this.world.shopCounter].some((at, i) =>
      Math.hypot(p.position.x - at.x, p.position.z - at.z) < (i === 0 ? 14 : 8)
      && Math.abs(p.position.y - at.y) < 3.5);
    if (!near || p.state !== 'active' || this.vitals.downed || this.vitals.wiped
      || Math.hypot(p.velocity.x, p.velocity.z) > .75) {
      this.resting = 0; this.announced = false; return;
    }
    this.resting += dt;
    if (this.resting < 1.5 || this.vitals.health >= this.vitals.maxHealth) return;
    if (!this.announced) {
      this.announced = true;
      this.g.bus.emit('ui:toast', { text: 'Resting at the dock',
        sub: 'Catch your breath here to recover health.', kind: 'good', ms: 2600 });
    }
    this.vitals.heal(25 * dt);
  }
}
