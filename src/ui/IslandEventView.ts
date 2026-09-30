import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { IslandDirector } from '@/systems/IslandDirector';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import type { KingVine } from '@/boss/KingVine';
import type { LegendaryHarvest } from '@/systems/LegendaryHarvest';
import type { UIManager } from './UIManager';

/** A compact objective and world-space warnings, never a screen-covering announcement. */
export class IslandEventView implements System {
  readonly name = 'eventView';
  private g!: Game;
  private hud!: HTMLElement;
  private title!: HTMLElement;
  private detail!: HTMLElement;
  private timer!: HTMLElement;
  private marks = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private leaves!: THREE.InstancedMesh;
  private time = 0;
  private key = '';
  private ringGeo = new THREE.RingGeometry(0.65, 0.75, 24).rotateX(-Math.PI / 2);
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xf4c85c, transparent: true,
    opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
  init(g: Game): void {
    this.g = g;
    this.hud = document.createElement('aside');
    this.hud.className = 'island-event'; this.hud.hidden = true;
    this.hud.innerHTML = '<div><strong></strong><b></b></div><p></p>';
    this.title = this.hud.querySelector('strong')!;
    this.detail = this.hud.querySelector('p')!;
    this.timer = this.hud.querySelector('b')!;
    document.getElementById('ui-root')!.append(this.hud);
    this.marks.name = 'Event warnings';
    g.renderer.scene.add(this.marks);
    const leafGeo = new THREE.OctahedronGeometry(0.09, 0); leafGeo.scale(2.1, 0.12, 0.65);
    this.leaves = new THREE.InstancedMesh(leafGeo,
      new THREE.MeshStandardMaterial({ color: 0x829c4a, roughness: 1 }), 24);
    this.leaves.frustumCulled = false; this.marks.add(this.leaves);
  }
  frameUpdate(dt: number): void {
    this.time += dt;
    const director = this.g.get<IslandDirector>('director');
    const e = director.getPresentation();
    const agitation = director.getAgitationPresentation?.();
    const shellOpen = this.g.has('expeditionShell')
      && this.g.get<{ open: boolean }>('expeditionShell').open;
    const menu = this.g.get<{ open: boolean }>('shop').open
      || this.g.get<{ open: boolean }>('book').open || shellOpen;
    const chapter = this.g.has('progress')
      ? this.g.get<{ chapterState: string }>('progress').chapterState : 'active';
    const finalBeat = chapter === 'return' || (chapter === 'settled' && shellOpen);
    const urgentOrder = e.kind === 'order' && e.phase === 'active' && e.remaining <= 10;
    const boss = this.g.has('kingVine') ? this.g.get<KingVine>('kingVine') : null;
    const nearBoss = boss && Math.hypot(this.g.player.position.x - boss.center[0],
      this.g.player.position.z - boss.center[2]) < 38;
    const harvest = this.g.has('legendary') ? this.g.get<LegendaryHarvest>('legendary') : null;
    const kingVineFocus = nearBoss && ((boss.phase !== 'idle' && !boss.subdued) || (harvest !== null
      && ['tether', 'detach', 'drop', 'recover'].includes(harvest.phase)));
    const stirring = e.phase === 'idle' && agitation?.warning === true;
    this.hud.hidden = (e.phase === 'idle' && !stirring) || menu || finalBeat
      || (!urgentOrder && (kingVineFocus || this.g.get<UIManager>('ui').celebrating));
    this.hud.classList.toggle('urgent', e.kind === 'order' && e.phase === 'active' && e.remaining <= 10);
    this.title.textContent = stirring ? 'ROOTS STIRRING'
      : e.kind === 'windfall' ? 'WINDFALL' : e.kind === 'coconuts' ? 'COCONUT FORECAST' : "MERV’S RUSH ORDER";
    this.timer.textContent = stirring || e.phase === 'result' ? '' : `${Math.ceil(e.remaining)}s`;
    const fruit = e.species.includes('coconut') ? 'coconuts' : 'apples or oranges';
    this.detail.textContent = stirring ? 'The nearby branches are restless. Watch for a windfall.'
      : e.phase === 'result'
      ? e.result === 'success' ? `Order filled! +$${e.reward} bonus.`
        : e.result === 'missed' ? 'Time’s up. Your fruit still sells normally.'
          : e.result === 'cancelled' ? 'The gust passed. Back to work.' : `Clear skies. ${e.progress} fruit gathered.`
      : e.kind === 'order' ? `Sell ${e.goal} ${fruit} · ${e.progress}/${e.goal} · +$${e.reward} bonus`
        : e.phase === 'warning' ? e.kind === 'windfall' ? 'Those trees are about to let go. Get underneath!'
          : 'Watch the marked palms. Catch them—or duck.' : `Gather the fall · ${e.progress}/${e.goal} collected`;
    const show = !finalBeat && (e.phase === 'warning'
      || (e.phase === 'active' && e.kind !== 'order' && e.remaining > 12));
    this.marks.visible = show;
    if (!show) return;
    if (this.key !== `${e.id}`) {
      this.key = `${e.id}`;
      for (const r of this.rings) this.marks.remove(r);
      this.rings = [];
      for (const id of e.plants) {
        const plant = this.g.get<FruitSystem>('fruit').plants.get(id);
        if (!plant) continue;
        const r = new THREE.Mesh(this.ringGeo, this.ringMat);
        r.position.copy(plant.position); r.position.y += 0.035;
        const normal = this.g.get<Sunpatch>('world').terrain.normal(r.position.x, r.position.z, new THREE.Vector3());
        r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        this.rings.push(r); this.marks.add(r);
      }
    }
    this.ringMat.opacity = 0.35 + 0.3 * (0.5 + Math.sin(this.time * 5) * 0.5);
    this.leaves.visible = e.kind === 'windfall';
    if (this.leaves.visible) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
      for (let i = 0; i < 24; i++) {
        const t = (this.time * 0.3 + i / 24) % 1;
        v.set(e.at[0] - 8 + t * 16, e.at[1] + 1 + (i % 5) * 0.55 + Math.sin(t * 9 + i) * 0.4,
          e.at[2] + Math.sin(i * 2.3) * 5);
        q.setFromEuler(new THREE.Euler(t * 12 + i, t * 8, i));
        m.compose(v, q, new THREE.Vector3(1, 1, 1)); this.leaves.setMatrixAt(i, m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }
  dispose(): void {
    this.hud.remove(); this.marks.removeFromParent(); this.ringGeo.dispose(); this.ringMat.dispose();
    this.leaves.geometry.dispose(); (this.leaves.material as THREE.Material).dispose();
  }
}
