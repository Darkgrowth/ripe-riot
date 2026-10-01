import type { Game, System } from '@/core/Game';

const SAVE_VERSION = 1;
const KEY_PREFIX = 'riperiot.save.';

export interface SaveSessionOptions {
  /** Separate game modes must not share the expedition's active slot or blobs. */
  namespace?: string;
  slot?: string;
  loadOnBoot?: boolean;
  autoPersist?: boolean;
}

const validSessionSlot = (slot: string | null): slot is string =>
  !!slot && (slot === 'auto' || /^replay-[a-z0-9-]{8,}$/i.test(slot));

interface Serializable {
  serialize(): unknown;
  deserialize(data: never): void;
}

export interface SaveBlob {
  version: number;
  savedAt: number;
  playtime: number;
  island: string;
  systems: Record<string, unknown>;
}

/**
 * Progression persistence.
 *
 * Only systems that opt in by exposing serialize/deserialize are saved, and the
 * blob is keyed by system name, so adding or removing a system never
 * invalidates an existing save — an unknown key is skipped and a missing one
 * just leaves that system at its defaults. That matters because this game will
 * grow four more islands' worth of systems after players already have saves.
 */
export class SaveSystem implements System {
  readonly name = 'save';
  private g!: Game;
  slot = 'auto';
  autosaveInterval = 45;
  private timer = 0;
  playtime = 0;
  lastSaved = 0;
  enabled = true;
  /** True when a previous session was restored at boot. */
  resumed = false;

  constructor(private readonly options: SaveSessionOptions = {}) {}

  private get keyPrefix(): string {
    return this.options.namespace ? `riperiot.${this.options.namespace}.save.` : KEY_PREFIX;
  }
  private get activeSlotKey(): string { return this.keyPrefix + 'activeSlot'; }

  init(g: Game): void {
    this.g = g;
    // Pick up where the last session left off. Saves were written for months
    // before anything read them back, which made every session a fresh one.
    // `?fresh` skips it — the harness boots that way so a page that saved on
    // close cannot leak progress into the next test.
    const params = new URLSearchParams(window.location.search);
    const fresh = params.has('fresh');
    const querySlot = params.get('saveSlot');
    let active: string | null = null;
    try { active = localStorage.getItem(this.activeSlotKey); } catch { /* private mode */ }
    this.slot = this.options.slot ?? (validSessionSlot(querySlot) ? querySlot
      : validSessionSlot(active) ? active : 'auto');
    this.enabled = this.options.autoPersist ?? !fresh;
    if ((this.options.loadOnBoot ?? !fresh) && this.exists(this.slot)) this.resumed = this.load(this.slot);
    g.debug?.addProbe('save', () => ({
      slot: this.slot, playtime: +this.playtime.toFixed(1),
      lastSaved: +this.lastSaved.toFixed(1), has: this.exists(this.slot),
      enabled: this.enabled, resumed: this.resumed,
    }));
    g.debug?.addAction('save.write', (slot?: string) => this.save(slot ?? this.slot));
    g.debug?.addAction('save.read', (slot?: string) => this.load(slot ?? this.slot));
    g.debug?.addAction('save.clear', (slot?: string) => this.clear(slot ?? this.slot));
    g.debug?.addAction('save.peek', (slot?: string) => this.peek(slot ?? this.slot));
    g.debug?.addAction('save.enable', (on: boolean) => { this.enabled = on; return this.enabled; });

    // Merely visiting the first title must not create an empty "Continue"
    // entry. A resumed save remains eligible even if the player exits there.
    window.addEventListener('beforeunload', () => {
      if (this.enabled && (this.resumed || this.playtime > 0)) this.save(this.slot);
    });
  }

  private participants(): Array<[string, Serializable]> {
    const out: Array<[string, Serializable]> = [];
    for (const s of this.g.systems) {
      const cand = s as unknown as Partial<Serializable>;
      if (typeof cand.serialize === 'function' && typeof cand.deserialize === 'function') {
        out.push([s.name, cand as Serializable]);
      }
    }
    return out;
  }

  exists(slot = this.slot): boolean {
    try { return localStorage.getItem(this.keyPrefix + slot) !== null; } catch { return false; }
  }

  /** Remember the next page's slot; this running page keeps saving its own. */
  activateSlot(slot: string): boolean {
    if (!validSessionSlot(slot)) return false;
    try { localStorage.setItem(this.activeSlotKey, slot); return true; } catch { return false; }
  }

  /** Every deliberate replay gets its own slot, leaving earlier runs intact. */
  createReplaySlot(): string {
    let slot: string;
    do {
      slot = `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    } while (this.exists(slot));
    return slot;
  }

  save(slot = this.slot): boolean {
    const blob: SaveBlob = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      playtime: this.playtime,
      island: this.options.namespace ?? 'sunpatch',
      systems: {},
    };
    for (const [name, sys] of this.participants()) {
      try { blob.systems[name] = sys.serialize(); }
      catch (e) { console.warn(`save: ${name} failed`, e); }
    }
    try {
      localStorage.setItem(this.keyPrefix + slot, JSON.stringify(blob));
    } catch (e) {
      console.warn('save: storage unavailable', e);
      return false;
    }
    this.lastSaved = this.playtime;
    this.g.bus.emit('save:written', { slot });
    return true;
  }

  peek(slot = this.slot): { version: number; savedAt: number; playtime: number } | null {
    try {
      const raw = localStorage.getItem(this.keyPrefix + slot);
      if (!raw) return null;
      const blob = JSON.parse(raw) as SaveBlob;
      return { version: blob.version, savedAt: blob.savedAt, playtime: blob.playtime };
    } catch { return null; }
  }

  load(slot = this.slot): boolean {
    let blob: SaveBlob;
    try {
      const raw = localStorage.getItem(this.keyPrefix + slot);
      if (!raw) return false;
      blob = JSON.parse(raw) as SaveBlob;
    } catch { return false; }
    if (blob.version !== SAVE_VERSION) {
      // Forward-compatible by omission: load what still makes sense rather than
      // refusing the whole save. A player's records are worth more than tidiness.
      this.g.bus.emit('ui:toast', {
        text: 'Save from an older build', sub: 'Loading what still applies', ms: 3000,
      });
    }
    this.playtime = blob.playtime ?? 0;
    for (const [name, sys] of this.participants()) {
      const data = blob.systems?.[name];
      if (data === undefined) continue;
      try { sys.deserialize(data as never); }
      catch (e) { console.warn(`load: ${name} failed`, e); }
    }
    this.g.bus.emit('save:loaded', { slot });
    this.g.bus.emit('ui:toast', { text: 'Progress restored', kind: 'good', ms: 2200 });
    return true;
  }

  clear(slot = this.slot): boolean {
    try { localStorage.removeItem(this.keyPrefix + slot); return true; } catch { return false; }
  }

  /** Wipe progression in memory without touching storage. */
  resetRun(): void {
    for (const [, sys] of this.participants()) {
      try { sys.deserialize({} as never); } catch { /* defaults are fine */ }
    }
  }

  frameUpdate(dt: number): void {
    if (!this.enabled || this.g.clock.paused) return;
    this.playtime += dt;
    this.timer += dt;
    if (this.timer >= this.autosaveInterval) {
      this.timer = 0;
      this.save(this.slot);
    }
  }
}
