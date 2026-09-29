import type { Game, System } from '@/core/Game';
import type { SaveSystem } from '@/save/SaveSystem';
import type { Progression } from '@/systems/Progression';
import './expedition-shell.css';

type ShellMode = 'title' | 'pause' | 'results' | null;

/** A small front door and ending around the existing in-world HUD. */
export class ExpeditionShell implements System {
  readonly name = 'expeditionShell';
  open = false;
  mode: ShellMode = null;
  private g!: Game;
  private save!: SaveSystem;
  private progress!: Progression;
  private root!: HTMLElement;
  private hasPlayed = false;
  private offSettlement: (() => void) | null = null;
  private readonly onPointerLockChange = () => {
    // Shop and book briefly release the cursor. Check after their own state
    // changes, so using either modal never opens a second one on top.
    window.setTimeout(() => {
      if (!this.hasPlayed || this.open || document.pointerLockElement === this.g.renderer.canvas) return;
      if (this.g.get<{ open: boolean }>('shop').open || this.g.get<{ open: boolean }>('book').open) return;
      this.show('pause');
    }, 0);
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Escape' || event.repeat) return;
    if (this.mode === 'pause' || this.mode === 'results') {
      event.preventDefault(); this.resume();
    } else if (!this.open && this.hasPlayed
      && !this.g.get<{ open: boolean }>('shop').open
      && !this.g.get<{ open: boolean }>('book').open
      && !(event.target instanceof Element && event.target.closest('.audio-settings'))) {
      // Browsers normally release pointer lock on Escape, but that browser
      // event is not guaranteed (notably headless and embedded clients).
      event.preventDefault(); this.show('pause');
    }
  };

  constructor(private readonly buildId: string) {}

  init(g: Game): void {
    this.g = g;
    this.save = g.get<SaveSystem>('save');
    this.progress = g.get<Progression>('progress');
    this.root = document.createElement('section');
    this.root.className = 'expedition-shell';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'RIPE RIOT expedition menu');
    this.root.hidden = true;
    this.root.addEventListener('click', event => this.click(event));
    document.getElementById('ui-root')!.append(this.root);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    // Observe Shop/Book before their own Escape handlers close them.
    window.addEventListener('keydown', this.onKeyDown, true);
    this.offSettlement = g.bus.on('expedition:settled', () => this.show('results'));
    // Harness `?fresh` is an input fixture with deliberately disabled auto
    // persistence. It must not be stopped by a title modal.
    if (!new URLSearchParams(window.location.search).has('fresh')) this.show('title');
  }

  frameUpdate(): void {
    this.root.dataset.chapterState = this.progress.chapterState;
    if (this.open) {
      // A connected session keeps running for peers while this player reads.
      this.g.clock.paused = !this.g.get<{ connected: boolean }>('net').connected;
    }
  }

  private show(mode: Exclude<ShellMode, null>): void {
    this.mode = mode; this.open = true;
    this.g.input.enabled = false;
    this.g.clock.paused = !this.g.get<{ connected: boolean }>('net').connected;
    if (document.pointerLockElement === this.g.renderer.canvas) document.exitPointerLock?.();
    this.root.hidden = false;
    document.body.classList.add('expedition-menu-open');
    this.render();
    this.root.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private resume(): void {
    if (this.mode === 'title') this.hasPlayed = true;
    this.mode = null; this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('expedition-menu-open');
    const sound = document.querySelector<HTMLDetailsElement>('.audio-settings');
    if (sound) sound.open = false;
    this.g.clock.paused = false;
    this.g.input.enabled = true;
    this.g.input.requestLock();
  }

  private navigateTo(slot: string): void {
    if (!this.save.activateSlot(slot)) {
      const status = this.root.querySelector<HTMLElement>('.expedition-status');
      if (status) status.textContent = 'Local saves are unavailable in this browser.';
      return;
    }
    // A fresh title that immediately starts a separate run has no original
    // adventure to preserve. Do not create a misleading blank auto save while
    // this page unloads; played and pre-existing slots continue saving.
    if (!this.hasPlayed && !this.save.exists(this.save.slot)) this.save.enabled = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('fresh');
    url.searchParams.set('saveSlot', slot);
    window.location.assign(url.toString());
  }

  private click(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-expedition-action]')?.dataset.expeditionAction;
    if (!action) return;
    switch (action) {
      case 'continue':
      case 'resume':
      case 'continue-exploring': this.hasPlayed = true; this.resume(); break;
      case 'new-replay': this.navigateTo(this.save.createReplaySlot()); break;
      case 'original': this.navigateTo('auto'); break;
      case 'results': this.show('results'); break;
      case 'title': this.show('title'); break;
      case 'controls': {
        const controls = this.root.querySelector<HTMLElement>('.expedition-controls');
        if (controls) controls.hidden = !controls.hidden;
        break;
      }
      case 'sound': {
        const sound = document.querySelector<HTMLDetailsElement>('.audio-settings');
        if (sound) { sound.open = !sound.open; sound.querySelector('summary')?.focus(); }
        break;
      }
    }
  }

  private render(): void {
    const active = this.save.exists(this.save.slot);
    const original = this.save.slot !== 'auto' && this.save.exists('auto');
    const replay = this.save.slot !== 'auto';
    const title = this.mode === 'results' ? 'EXPEDITION SETTLED'
      : this.mode === 'pause' ? 'PAUSED' : 'RIPE RIOT';
    const mission = 'Bring Sunpatch’s King Melon home. Harvest fruit for tools, face the plants that guard it, then return to the dock boat to settle Merv’s books.';
    const results = this.progress.results;
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    const resultMarkup = results ? `<div class="expedition-results">
      <div><span>King Melon payout</span><strong>$${fmt(results.payout)}</strong></div>
      <div><span>Expedition earnings</span><strong>$${fmt(results.lifetimeEarned)}</strong></div>
      <div><span>Fruit sold</span><strong>${fmt(results.fruitSold)}</strong></div>
      <div><span>Fruit discovered</span><strong>${fmt(results.discovered)}</strong></div>
      <div><span>Best sale</span><strong>$${fmt(results.bestSale)}</strong></div>
      <div><span>Expedition time</span><strong>${Math.max(1, Math.round(results.playtime / 60))} min</strong></div>
    </div>` : '<p>Your results will appear after the dock settlement.</p>';
    const buttons = this.mode === 'results'
      ? `<button data-expedition-action="continue-exploring">Continue exploring Sunpatch</button>
         <button data-expedition-action="title">Expedition menu</button>`
      : this.mode === 'pause'
        ? `<button data-expedition-action="resume">Resume expedition</button>
           ${this.progress.chapterState === 'settled' ? '<button data-expedition-action="results">View results</button>' : ''}
           <button data-expedition-action="title">Expedition menu</button>`
        : `<button data-expedition-action="continue">${active
          ? this.progress.chapterState === 'settled' ? 'Continue exploring' : replay ? 'Continue replay' : 'Continue expedition'
          : 'Begin expedition'}</button>
           <button data-expedition-action="new-replay">New expedition · separate save</button>
           ${original ? '<button data-expedition-action="original">Original expedition</button>' : ''}
           ${this.progress.chapterState === 'settled' ? '<button data-expedition-action="results">View results</button>' : ''}`;
    this.root.innerHTML = `<div class="expedition-card">
      <p class="expedition-kicker">SUNPATCH · FIRST EXPEDITION</p>
      <h1>${title}</h1>
      ${this.mode === 'results' ? `<p>The King Melon is home. Merv has settled the books; Sunpatch remains open for harvesting.</p>${resultMarkup}`
        : `<p>${mission}</p>`}
      <div class="expedition-actions">${buttons}</div>
      <div class="expedition-secondary">
        <button data-expedition-action="controls">Controls</button>
        <button data-expedition-action="sound">Sound settings</button>
      </div>
      <div class="expedition-controls" hidden>
        <p><b>WASD</b> move · <b>Mouse</b> look · <b>LMB</b> use tool · <b>E</b> interact and revive</p>
        <p><b>1–4</b> tools · <b>RMB</b> secondary tool or basket · <b>Q</b> drop · <b>H</b> stuck recovery</p>
        <p>At the dock after securing King Melon, press <b>E</b> by the boat to settle.</p>
      </div>
      <p class="expedition-status" aria-live="polite">${this.mode === 'pause'
        ? this.g.get<{ connected: boolean }>('net').connected ? 'Your controls are paused; the co-op world keeps moving.' : 'The expedition is paused.'
        : replay ? 'This replay has its own save. Your original expedition remains available.'
          : 'New expeditions use separate saves. Your original progress stays safe.'}</p>
      <small class="expedition-build"></small>
    </div>`;
    this.root.querySelector<HTMLElement>('.expedition-build')!.textContent = `DEVELOPMENT BUILD ${this.buildId}`;
  }

  dispose(): void {
    this.offSettlement?.();
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('keydown', this.onKeyDown, true);
    document.body.classList.remove('expedition-menu-open');
    this.root.remove();
  }
}
