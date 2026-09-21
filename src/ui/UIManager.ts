import type { Game, System } from '@/core/Game';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { Economy } from '@/systems/Economy';
import { toolIconMarkup } from './ToolIcons';
import { createAudioSettings } from './AudioSettings';
import type { AudioManager } from '@/audio/AudioManager';

/**
 * All HUD rendering. Kept as plain DOM: it composites over the canvas for free,
 * costs nothing on the GPU budget, and reflows text far better than anything we
 * would write in WebGL.
 *
 * The rule from the brief is "minimal HUD, big temporary celebrations", so the
 * persistent layer is money + slots + prompt and everything else is transient.
 */
export class UIManager implements System {
  readonly name = 'ui';
  private g!: Game;
  private root!: HTMLElement;
  private els!: {
    money: HTMLElement; moneyDelta: HTMLElement; prompt: HTMLElement;
    toasts: HTMLElement; celebrate: HTMLElement; carry: HTMLElement;
    crosshair: HTMLElement; debug: HTMLElement; stunts: HTMLElement;
    banner: HTMLElement; hurt: HTMLElement; slots: HTMLElement;
    entryHint: HTMLElement; entryTitle: HTMLElement;
  };
  private debugVisible = false;
  private debugTimer = 0;
  private celebrateTimer = 0;
  private toastNodes: Array<{ el: HTMLElement; until: number }> = [];
  private stuntNodes: Array<{ el: HTMLElement; until: number }> = [];
  private lastPrompt: string | null = null;
  private promptCandidate: { text: string; priority: number } | null = null;
  private hasControlled = false;
  private audioSettings: ReturnType<typeof createAudioSettings> | null = null;

  init(g: Game): void {
    this.g = g;
    this.root = document.getElementById('ui-root')!;
    this.root.innerHTML = `
      <div class="hud">
        <div class="vignette"></div>
        <div class="hurt"></div>
        <div class="crosshair"><i class="dot"></i></div>
        <div class="money"><small>$</small><span>0</span></div>
        <div class="money-delta"></div>
        <div class="prompt"></div>
        <div class="carry"></div>
        <div class="slots"></div>
        <div class="stunt-stack"></div>
        <div class="celebrate"></div>
        <div class="toasts"></div>
        <div class="state-banner"></div>
        <div class="entry-hint" hidden>
          <strong>Click to play</strong>
          <span>WASD move · Mouse look · E pick · 1–4 tools</span>
        </div>
      </div>
      <div class="debug hidden"></div>`;
    this.audioSettings = createAudioSettings(g.get<AudioManager>('audio'));
    this.root.append(this.audioSettings.element);

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.els = {
      money: q('.money span'),
      moneyDelta: q('.money-delta'),
      prompt: q('.prompt'),
      toasts: q('.toasts'),
      celebrate: q('.celebrate'),
      carry: q('.carry'),
      crosshair: q('.crosshair'),
      debug: q('.debug'),
      stunts: q('.stunt-stack'),
      banner: q('.state-banner'),
      hurt: q('.hurt'),
      slots: q('.slots'),
      entryHint: q('.entry-hint'),
      entryTitle: q('.entry-hint strong'),
    };

    g.bus.on('money:changed', (p) => this.onMoney(p.money, p.delta));
    g.bus.on('ui:toast', (p) => this.toast(p.text, p.sub, p.kind, p.ms));
    g.bus.on('ui:celebrate', (p) => this.celebrate(p.title, p.sub, p.kind));
    g.bus.on('ui:prompt', (p) => this.offerPrompt(p.text, p.priority));
    g.bus.on('stunt:awarded', (p) => this.stunt(p.label, p.multiplier));
    // A discovery is the strongest single moment in the loop and it used to be
    // the quietest: two handlers wrote the same banner over each other (this one
    // with the raw species id), nothing made a sound, and nothing moved. The
    // banner comes from the book's own ui:celebrate; this adds the parts a
    // player feels — a chime, a gold flash and a kick.
    g.bus.on('book:discovered', () => {
      this.flash('good', 340);
      g.bus.emit('audio:sfx', { name: 'discovery', volume: 0.9 });
      g.playerCamera.addRecoil(0, 0.02);
      g.playerCamera.addShake(0.012, 0.3, 22);
    });
    g.bus.on('player:ragdoll', () => this.flashHurt(260));
    g.bus.on('player:hit', (p) => this.flashHurt(p.momentum > 140 ? 200 : 130));
    // Only your own accidents are worth interrupting for: a melon bursting
    // on the far side of the island is somebody else's problem.
    g.bus.on('fruit:qualityChanged', (p) => {
      if (!this.nearPlayer(p.fruitId)) return;
      this.quality(p.displayName, p.quality, p.lost);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.code === 'Backquote' && !e.ctrlKey)) {
        this.debugVisible = !this.debugVisible;
        this.els.debug.classList.toggle('hidden', !this.debugVisible);
      }
    });

    this.renderSlots();
    // A restored save changed the money before this listener existed.
    if (g.has('economy')) this.onMoney(g.get<Economy>('economy').money, 0);
  }

  // ---- persistent ---------------------------------------------------------
  private onMoney(money: number, delta: number): void {
    this.els.money.textContent = money.toLocaleString('en-US');
    const parent = this.els.money.parentElement!;
    parent.classList.remove('bump');
    void parent.offsetWidth;
    parent.classList.add('bump');
    if (delta !== 0) {
      const d = this.els.moneyDelta;
      d.textContent = `${delta > 0 ? '+' : '−'}$${Math.abs(delta).toLocaleString('en-US')}`;
      d.classList.toggle('neg', delta < 0);
      d.classList.remove('show');
      void d.offsetWidth;
      d.classList.add('show');
    }
  }

  private setPrompt(text: string | null): void {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.els.prompt.innerHTML = text ?? '';
    this.els.prompt.classList.toggle('show', !!text);
    this.els.crosshair.classList.toggle('wide', !!text);
  }

  /**
   * Prompt emitters describe what they have; the HUD decides what the player
   * should see. Keeping the first candidate on a tie preserves the immediate
   * aimed interaction, which runs before broader world context systems.
   */
  private offerPrompt(text: string | null, priority: 'hint' | 'context' | 'action' = 'action'): void {
    if (!text) return;
    const rank = priority === 'action' ? 3 : priority === 'context' ? 2 : 1;
    if (!this.promptCandidate || rank > this.promptCandidate.priority) {
      this.promptCandidate = { text, priority: rank };
    }
  }

  private modalOpen(): boolean {
    return ['shop', 'book'].some(name =>
      this.g.has(name) && this.g.get<{ open: boolean }>(name).open);
  }

  /** Resolve after every system has offered its candidate for this frame. */
  lateUpdate(): void {
    const blocked = this.g.player.state !== 'active' || !this.g.input.enabled || this.modalOpen();
    this.setPrompt(blocked ? null : (this.promptCandidate?.text ?? null));
    this.promptCandidate = null;
  }

  /** Rebuilt whenever the tool inventory changes. */
  renderSlots(): void {
    // Systems that initialise before the UI (tools does) will call this during
    // their own init, before this one has run.
    if (!this.g || !this.els) return;
    const inv = this.g.has('tools')
      ? this.g.get<{ slotSummary(): Array<{
        name: string; icon: string; active: boolean; empty: boolean; status: string;
      }> }>('tools')
      : null;
    const slots = inv?.slotSummary() ?? [
      { name: 'Hand', icon: '✋', active: true, empty: false, status: '' },
      { name: '—', icon: '', active: false, empty: true, status: '' },
      { name: '—', icon: '', active: false, empty: true, status: '' },
      { name: 'Basket', icon: '🧺', active: false, empty: false, status: '' },
    ];
    this.els.slots.innerHTML = slots.map((s, i) => `
      <div class="slot ${s.active ? 'active' : ''} ${s.empty ? 'empty' : ''}">
        <div class="num">${i + 1}</div>
        <div class="icon">${toolIconMarkup(s.icon)}</div>
        <div>${s.name}</div>
        <div class="slot-status">${s.status ?? ''}</div>
      </div>`).join('');
  }

  // ---- transient ----------------------------------------------------------
  toast(text: string, sub?: string, kind: string = 'info', ms = 2600): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.els.toasts.appendChild(el);
    this.toastNodes.push({ el, until: performance.now() + ms });
    while (this.toastNodes.length > 5) {
      const old = this.toastNodes.shift()!;
      old.el.remove();
    }
  }

  celebrate(title: string, sub?: string, kind = 'info'): void {
    this.els.celebrate.innerHTML = `<div class="big">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    // Reassigning className both applies the kind and clears `out`, so a second
    // discovery inside the fade of the first still plays its entry animation.
    this.els.celebrate.className = `celebrate ${kind}`;
    // Louder AND shorter. A banner that hangs for nearly three seconds stops
    // being an event and starts being UI you are waiting out.
    this.celebrateTimer = kind === 'discovery' || kind === 'legendary' ? 1.9 : 2.6;
  }

  /**
   * A stunt landed.
   *
   * These used to be a 13px pill that appeared beside the crosshair and then
   * vanished mid-frame with no exit, which reads as a debug print rather than
   * a reward. Now they punch in, stack, count up as a run continues, and fade
   * out — and a run that has earned several turns the whole stack brighter,
   * because the escalating multiplier is the actual prize.
   */
  stunt(label: string, mult: number): void {
    this.stuntRun += 1;
    this.stuntRunUntil = performance.now() + 2600;
    const el = document.createElement('div');
    el.className = `stunt-chip${this.stuntRun > 1 ? ' combo' : ''}`;
    el.innerHTML = `${label}<span class="mult">×${mult.toFixed(2)}</span>`;
    this.els.stunts.appendChild(el);
    this.els.stunts.classList.toggle('hot', this.stuntRun >= 3);
    this.stuntNodes.push({ el, until: performance.now() + 2900 });
    while (this.stuntNodes.length > 5) {
      const old = this.stuntNodes.shift()!;
      old.el.remove();
    }
  }
  /** Stunts awarded in quick succession, for escalating the presentation. */
  private stuntRun = 0;
  private stuntRunUntil = 0;

  /**
   * A fruit dropped a quality tier.
   *
   * `fruit:qualityChanged` was emitted from the moment the damage model was
   * written and nothing ever listened, so the entire fragility system — the
   * thing that is supposed to make carrying a watermelon tense — was
   * communicated by a slightly darker tint on a mesh you are usually running
   * away from. Now it says so, and says what it cost.
   */
  private quality(name: string, tier: string, lost: number): void {
    const ruined = tier === 'Ruined' || tier === 'Damaged';
    this.toast(`${name} — ${tier.toUpperCase()}`,
      lost > 0 ? `−$${lost} of value` : 'Handle it more gently',
      ruined ? 'bad' : 'info', ruined ? 2400 : 1700);
    const el = this.els.carry;
    el.classList.remove('knock');
    void el.offsetWidth;
    el.classList.add('knock');
  }

  banner(text: string, seconds: number): void {
    this.els.banner.textContent = text;
    this.els.banner.classList.add('show');
    this.bannerTimer = seconds;
  }
  private bannerTimer = 0;

  private flashHurt(ms = 260): void { this.flash('hurt', ms); }

  /** A brief full-screen wash. 'hurt' is red at the edges; 'good' is gold. */
  private flash(kind: 'hurt' | 'good', ms = 260): void {
    const el = this.els.hurt;
    el.classList.remove('on', 'good');
    void el.offsetWidth;                    // restart the transition
    el.classList.add('on');
    if (kind === 'good') el.classList.add('good');
    setTimeout(() => el.classList.remove('on', 'good'), ms);
  }

  /** Is that fruit in the player's hands, or close enough to be theirs? */
  private nearPlayer(fruitId: number): boolean {
    if (!this.g.has('fruit')) return false;
    const f = this.g.get<{ get(id: number): { position: { distanceTo(v: unknown): number };
      state: string } | undefined }>('fruit').get(fruitId);
    if (!f) return false;
    if (f.state === 'carried' || f.state === 'stowed') return true;
    return f.position.distanceTo(this.g.player.position) < 14;
  }

  // ---- loop ---------------------------------------------------------------
  frameUpdate(dt: number): void {
    const now = performance.now();
    for (let i = this.toastNodes.length - 1; i >= 0; i--) {
      const t = this.toastNodes[i];
      if (now > t.until) {
        t.el.classList.add('out');
        setTimeout(() => t.el.remove(), 320);
        this.toastNodes.splice(i, 1);
      }
    }
    for (let i = this.stuntNodes.length - 1; i >= 0; i--) {
      const s = this.stuntNodes[i];
      // Fade out rather than blinking away: the chip used to be removed from
      // the DOM mid-frame, which is what made a reward look like a log line.
      if (now > s.until - 420) s.el.classList.add('out');
      if (now > s.until) { s.el.remove(); this.stuntNodes.splice(i, 1); }
    }
    if (this.stuntRun > 0 && now > this.stuntRunUntil) {
      this.stuntRun = 0;
      this.els.stunts.classList.remove('hot');
    }
    if (this.celebrateTimer > 0) {
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) this.els.celebrate.classList.add('out');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.els.banner.classList.remove('show');
    }

    this.updateCarry();
    this.updateSlotStatus();
    this.updateEntryHint();

    this.debugTimer -= dt;
    if (this.debugVisible && this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.els.debug.textContent = this.debugText();
    }
  }

  /** A small invitation to take control, never a modal or a pause state. */
  private updateEntryHint(): void {
    const controlled = document.pointerLockElement === this.g.renderer.canvas;
    if (controlled) this.hasControlled = true;
    const panelOpen = this.modalOpen();
    const hidden = controlled || panelOpen;
    if (this.els.entryHint.hidden !== hidden) this.els.entryHint.hidden = hidden;
    const title = this.hasControlled ? 'Click to return' : 'Click to play';
    if (this.els.entryTitle.textContent !== title) this.els.entryTitle.textContent = title;
  }

  /** The active tool's charge/ammo line, refreshed without rebuilding the DOM. */
  private updateSlotStatus(): void {
    const inv = this.g.has('tools')
      ? this.g.get<{ slotSummary(): Array<{ status: string }>; activeSlot: number }>('tools')
      : null;
    if (!inv) return;
    const nodes = this.els.slots.querySelectorAll('.slot-status');
    const summary = inv.slotSummary();
    for (let i = 0; i < nodes.length && i < summary.length; i++) {
      const text = summary[i].status ?? '';
      if (nodes[i].textContent !== text) nodes[i].textContent = text;
    }
  }

  private updateCarry(): void {
    const inter = this.g.has('interaction') ? this.g.get<InteractionSystem>('interaction') : null;
    if (!inter) return;
    const held = inter.carried;
    const basket = inter.basket;
    if (!held && basket.items.length === 0) {
      this.els.carry.textContent = '';
      this.els.carry.style.opacity = '0';
      return;
    }
    this.els.carry.style.opacity = '1';
    const parts: string[] = [];
    if (held) {
      const f = held.fruit;
      const grip = held.cls === 'small' ? '' : ' · <b>both hands</b>';
      parts.push(`${f.displayName} <span class="q">${f.quality}</span> · ${f.mass.toFixed(1)} kg${grip}`);
      // How to put it down. Picking things up was always discoverable — the
      // look prompt says so — and putting them down never was: Q and the stow
      // click existed from the first build and appeared nowhere on screen.
      const canStow = f.mass <= basket.maxItemMass && basket.items.length < basket.capacity;
      if (f.stuckHands > 0) {
        parts.push(`<span class="keys"><b>STUCK</b> ${f.stuckHands.toFixed(1)} s</span>`);
      } else {
        parts.push(`<span class="keys">${canStow ? '<b>RMB</b> basket · ' : ''}<b>LMB</b> throw · <b>Q</b> drop</span>`);
      }
    }
    if (basket.items.length) {
      parts.push(`${toolIconMarkup('basket')} ${basket.items.length}/${basket.capacity} · $${inter.basketValue()}`);
    }
    this.els.carry.innerHTML = parts.join('');
  }

  private debugText(): string {
    const g = this.g;
    const s = g.debug?.state();
    if (!s) return '';
    const eco = g.has('economy') ? g.get<Economy>('economy') : null;
    const f = s.fruit as Record<string, number> | undefined;
    const p = s.player;
    return [
      `fps ${s.fps.toFixed(0)}  draw ${s.render.drawCalls}  tri ${(s.render.triangles / 1000).toFixed(0)}k`,
      `cpu ${s.profile.total.toFixed(1)}ms (phys ${s.profile.physics.toFixed(1)} sim ${s.profile.fixed.toFixed(1)} gfx ${s.profile.render.toFixed(1)})`,
      `pos ${p.pos.map((v: number) => v.toFixed(1)).join(' ')}  spd ${p.speed.toFixed(1)}  ${p.grounded ? 'ground' : 'air'}  ${p.state}`,
      `bodies ${s.physics.bodies} (${s.physics.active} awake)`,
      f ? `fruit ${f.total}: att ${f.attached} free ${f.free} carry ${f.carried} bag ${f.stowed}  plants ${f.plants}` : '',
      eco ? `money $${eco.money}  tier ${eco.discoveryTier}` : '',
    ].filter(Boolean).join('\n');
  }
  dispose(): void { this.audioSettings?.dispose(); }
}
