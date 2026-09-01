import type { Game, System } from '@/core/Game';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { Economy } from '@/systems/Economy';

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
  };
  private debugVisible = false;
  private debugTimer = 0;
  private celebrateTimer = 0;
  private toastNodes: Array<{ el: HTMLElement; until: number }> = [];
  private stuntNodes: Array<{ el: HTMLElement; until: number }> = [];
  private lastPrompt: string | null = null;

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
      </div>
      <div class="debug hidden"></div>`;

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
    };

    g.bus.on('money:changed', (p) => this.onMoney(p.money, p.delta));
    g.bus.on('ui:toast', (p) => this.toast(p.text, p.sub, p.kind, p.ms));
    g.bus.on('ui:celebrate', (p) => this.celebrate(p.title, p.sub));
    g.bus.on('ui:prompt', (p) => this.setPrompt(p.text));
    g.bus.on('stunt:awarded', (p) => this.stunt(p.label, p.multiplier));
    g.bus.on('book:discovered', (p) => this.celebrate('NEW FRUIT', p.species.toUpperCase()));
    g.bus.on('player:ragdoll', () => this.flashHurt());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.code === 'Backquote' && !e.ctrlKey)) {
        this.debugVisible = !this.debugVisible;
        this.els.debug.classList.toggle('hidden', !this.debugVisible);
      }
    });

    this.renderSlots();
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
        <div class="icon">${s.icon}</div>
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

  celebrate(title: string, sub?: string): void {
    this.els.celebrate.innerHTML = `<div class="big">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.els.celebrate.classList.remove('out');
    this.celebrateTimer = 2.6;
  }

  stunt(label: string, mult: number): void {
    const el = document.createElement('div');
    el.className = 'stunt-chip';
    el.innerHTML = `${label}<span class="mult">×${mult.toFixed(2)}</span>`;
    this.els.stunts.appendChild(el);
    this.stuntNodes.push({ el, until: performance.now() + 3000 });
  }

  banner(text: string, seconds: number): void {
    this.els.banner.textContent = text;
    this.els.banner.classList.add('show');
    this.bannerTimer = seconds;
  }
  private bannerTimer = 0;

  private flashHurt(): void {
    this.els.hurt.classList.add('on');
    setTimeout(() => this.els.hurt.classList.remove('on'), 260);
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
      if (now > s.until) { s.el.remove(); this.stuntNodes.splice(i, 1); }
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

    this.debugTimer -= dt;
    if (this.debugVisible && this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.els.debug.textContent = this.debugText();
    }
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
      parts.push(`${f.displayName} <span class="q">${f.quality}</span> · ${f.mass.toFixed(1)} kg`);
    }
    if (basket.items.length) {
      parts.push(`🧺 ${basket.items.length}/${basket.capacity} · $${inter.basketValue()}`);
    }
    this.els.carry.innerHTML = parts.join('&nbsp;&nbsp;|&nbsp;&nbsp;');
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
}
