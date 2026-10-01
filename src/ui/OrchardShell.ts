import type { Game, System } from '@/core/Game';
import type { SaveSystem } from '@/save/SaveSystem';
import type { HarvestExtraction } from '@/systems/HarvestExtraction';
import type { MultiplayerAuthority } from '@/net/MultiplayerAuthority';
import './orchard-shell.css';

type OrchardMenu = 'title' | 'pause' | 'results' | null;

/** Front door and explicit departure for the short physical harvest run. */
export class OrchardShell implements System {
  readonly name = 'orchardShell';
  open = false;
  mode: OrchardMenu = null;
  private g!: Game;
  private save!: SaveSystem;
  private run!: HarvestExtraction;
  private root!: HTMLElement;
  private hasPlayed = false;

  constructor(private readonly buildId: string) {}

  init(g: Game): void {
    this.g = g; this.save = g.get<SaveSystem>('save'); this.run = g.get<HarvestExtraction>('extraction');
    this.root = document.createElement('section'); this.root.className = 'orchard-shell';
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Orchard Run menu'); this.root.hidden = true;
    this.root.addEventListener('click', event => this.click(event));
    document.getElementById('ui-root')!.append(this.root);
    document.addEventListener('pointerlockchange', () => window.setTimeout(() => {
      if (!this.hasPlayed || this.open || document.pointerLockElement === g.renderer.canvas || this.otherModal()) return;
      this.show(this.run.finished ? 'results' : 'pause');
    }, 0));
    window.addEventListener('keydown', event => {
      if (event.code !== 'Escape' || event.repeat || this.otherModal()) return;
      if (this.mode === 'pause') { event.preventDefault(); this.play(); }
      else if (!this.open && this.hasPlayed) { event.preventDefault(); this.show(this.run.finished ? 'results' : 'pause'); }
    }, true);
    this.hasPlayed = new URLSearchParams(window.location.search).has('fresh');
    if (this.run.finished) this.show('results');
    else if (!this.hasPlayed) this.show('title');
  }

  private otherModal(): boolean {
    return ['shop', 'book'].some(name => this.g.has(name) && this.g.get<{ open: boolean }>(name).open);
  }

  frameUpdate(): void {
    if (this.run.finished && this.mode !== 'results') this.show('results');
    if (this.open) this.g.clock.paused = !this.g.get<MultiplayerAuthority>('net').connected;
  }

  private show(mode: Exclude<OrchardMenu, null>): void {
    this.open = true; this.mode = mode; this.g.input.enabled = false;
    this.g.clock.paused = !this.g.get<MultiplayerAuthority>('net').connected;
    if (document.pointerLockElement === this.g.renderer.canvas) document.exitPointerLock?.();
    this.root.hidden = false; document.body.classList.add('orchard-menu-open'); this.render();
    this.root.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  private play(): void {
    if (this.run.finished) { this.show('results'); return; }
    this.open = false; this.mode = null; this.hasPlayed = true; this.root.hidden = true;
    document.body.classList.remove('orchard-menu-open'); this.g.clock.paused = false;
    this.g.input.enabled = true; this.g.input.requestLock();
  }

  private navigate(replay: boolean): void {
    if (this.hasPlayed || this.save.resumed) this.save.save();
    const url = new URL(window.location.href); url.searchParams.delete('fresh');
    if (replay) {
      const slot = this.save.createReplaySlot();
      if (!this.save.activateSlot(slot)) { this.status('Local saving is unavailable. Your current run remains open.'); return; }
      url.searchParams.set('orchardRun', '1'); url.searchParams.set('saveSlot', slot);
    } else { url.searchParams.delete('orchardRun'); url.searchParams.delete('saveSlot'); }
    window.location.assign(url.toString());
  }

  private click(event: MouseEvent): void {
    const action = (event.target as Element).closest<HTMLElement>('[data-orchard-action]')?.dataset.orchardAction;
    if (action === 'play' || action === 'resume') this.play();
    else if (action === 'replay') this.navigate(true);
    else if (action === 'expedition') this.navigate(false);
    else if (action === 'finish') {
      if (this.run.finish()) this.show('results');
      else this.status('Return to the crate and bank your carried fruit before finishing.');
    } else if (action === 'coop') {
      this.g.get<MultiplayerAuthority>('net').openRoom('orchard-local');
      this.status('Local co-op is open. Choose Open local co-op in another Orchard Run tab, then begin.');
    } else if (action === 'controls') {
      const panel = this.root.querySelector<HTMLElement>('.orchard-controls'); if (panel) panel.hidden = !panel.hidden;
    }
  }

  private status(text: string): void {
    const label = this.root.querySelector<HTMLElement>('.orchard-status'); if (label) label.textContent = text;
  }

  private render(): void {
    const results = this.mode === 'results';
    const title = results ? this.run.targetReached ? 'HAUL SECURED' : 'SMALL HAUL, SAFE HOME'
      : this.mode === 'pause' ? 'CATCH YOUR BREATH' : 'ORCHARD RUN';
    const money = this.run.banked.toLocaleString('en-US');
    const time = `${Math.floor(this.run.elapsed / 60)}:${Math.floor(this.run.elapsed % 60).toString().padStart(2, '0')}`;
    const buttons = results ? `<button data-orchard-action="replay">New orchard run</button>`
      : this.mode === 'pause' ? `<button data-orchard-action="resume">Resume harvesting</button>
          <button data-orchard-action="finish">Finish at the crate</button>`
        : `<button data-orchard-action="play">${this.save.resumed ? 'Continue orchard run' : 'Begin harvesting'}</button>
           <button data-orchard-action="replay">New run · separate save</button>`;
    this.root.innerHTML = `<div class="orchard-card">
      <p class="orchard-kicker">RIPE RIOT · HARVEST & HAUL</p><h1>${title}</h1>
      ${results ? `<p>Your produce is banked. ${this.run.targetReached ? 'You met the $500 target.' : 'You chose to bring a smaller haul home.'}</p>
        <div class="orchard-results"><div><span>Secured cargo</span><strong>$${money}</strong></div>
        <div><span>Fruit banked</span><strong>${this.run.fruitCount}</strong></div>
        <div><span>Run time</span><strong>${time}</strong></div></div>`
        : `<p>Get $500 of produce into the crate. Shake a loaded tree, redirect a rolling plum, survive the trouble you stir up — then bring the haul home.</p>
           <p class="orchard-rule">Bank small hauls whenever you want. Reach $500 and keep going, or finish at the crate with empty hands.</p>`}
      <div class="orchard-actions">${buttons}</div>
      <div class="orchard-secondary">${!results ? '<button data-orchard-action="coop">Open local co-op</button><button data-orchard-action="controls">Controls</button>' : ''}
        <button data-orchard-action="expedition">Sunpatch expedition</button></div>
      <div class="orchard-controls" hidden><p><b>WASD</b> Move · <b>Mouse</b> Look · <b>Space</b> Jump · <b>Shift</b> Sprint</p>
        <p><b>1</b> Mallet & hands · <b>2</b> Air Cannon · <b>3</b> Catch Net · <b>E</b> Pick / shake / bank / finish</p>
        <p><b>LMB</b> Use tool or throw held fruit · <b>RMB</b> Stow held fruit / cannon hop / lay net · <b>Esc</b> Pause</p></div>
      <p class="orchard-status" role="status">${results ? 'Your run is saved separately from Sunpatch.' : 'Unsecured cargo is lost on evacuation. Banked cargo stays safe.'}</p>
      <small class="orchard-build">${this.buildId}</small></div>`;
  }
}
