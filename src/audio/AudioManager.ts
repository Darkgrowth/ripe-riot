import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import { MusicDirector, type MusicMood } from './MusicDirector';

export type AudioChannel = 'master' | 'music' | 'sfx' | 'ambience';
export interface AudioSettings { master: number; music: number; sfx: number; ambience: number; muted: boolean; }
export interface AudioEventPresentation {
  kind: 'windfall' | 'coconuts' | 'order' | null;
  phase: 'idle' | 'warning' | 'active' | 'result'; remaining: number;
}
export interface AudioEventDirector { getPresentation(): AudioEventPresentation; }
interface SfxOpts { volume?: number; pitch?: number; position?: THREE.Vector3; ambience?: boolean; }
type Voice = (ctx: AudioContext, out: AudioNode, t: number, o: Required<Pick<SfxOpts, 'pitch'>>) => number;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const DEFAULTS: AudioSettings = { master: .7, music: .35, sfx: .9, ambience: .5, muted: false };
const STORE = 'ripe.audio.v1';

/** Original rendered music plus synthesized effects and localized ambience.
 * One master gain owns every route; gesture and page visibility own the clock. */
export class AudioManager implements System {
  readonly name = 'audio';
  private g!: Game;
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private music: MusicDirector | null = null;
  private settings = { ...DEFAULTS };
  private listeners = new Set<(settings: AudioSettings) => void>();
  private unsubscribe: Array<() => void> = [];
  private eventDirector: AudioEventDirector | null = null;
  private legendaryPhase = 'prepare';
  private musicDuckUntil = 0;
  private musicDucked = false;
  private crateBoxes: Array<{ center: THREE.Vector3; inverse: THREE.Quaternion; half: THREE.Vector3 }> | null = null;
  private disposed = false;
  private unlocked = false;
  private listener = new THREE.Vector3();
  private lastPlay = new Map<string, number>();
  private activeVoices = new Map<number, () => void>();
  private nextVoice = 1;
  private ambienceNodes: AudioNode[] = [];
  private ambienceSources: AudioBufferSourceNode[] = [];
  private ambientGains: GainNode[] = [];
  private waterfallPan: StereoPannerNode | null = null;
  private birdTimer = 3;
  private localTimer = 8;
  played = 0;
  lastSound = '';
  get masterVolume() { return this.settings.master; }
  get musicVolume() { return this.settings.music; }
  get sfxVolume() { return this.settings.sfx; }
  get ambienceVolume() { return this.settings.ambience; }
  get enabled() { return !this.settings.muted; }
  set enabled(value: boolean) { this.setMuted(!value); }
  private gesture = () => { void this.unlock(); };
  private visibility = () => {
    if (!this.ctx || this.disposed) return;
    if (document.hidden) {
      for (const cleanup of [...this.activeVoices.values()]) cleanup();
      void this.ctx.suspend();
    }
    else if (this.unlocked) void this.ctx.resume().catch(() => {});
  };

  init(g: Game): void {
    this.g = g;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      for (const key of ['master', 'music', 'sfx', 'ambience'] as AudioChannel[]) {
        if (Number.isFinite(saved[key])) this.settings[key] = clamp01(saved[key]);
      }
      if (typeof saved.muted === 'boolean') this.settings.muted = saved.muted;
    } catch { /* storage may be blocked or contain an obsolete value */ }
    window.addEventListener('pointerdown', this.gesture);
    window.addEventListener('keydown', this.gesture);
    document.addEventListener('visibilitychange', this.visibility);
    this.unsubscribe.push(
      g.bus.on('audio:sfx', p => this.play(p.name, p)),
      g.bus.on('fruit:impact', p => {
        const speed = clamp01(p.speed / 22);
        this.play(p.onPlayer ? 'thud' : p.species === 'coconut' ? 'coconutClack' : 'fruitHit', {
          volume: .22 + speed * .65, pitch: 1.2 - speed * .4, position: p.point,
        });
        const fruit = !p.onPlayer && g.has('fruit')
          ? g.get<{ get(id: number): { radius: number } | undefined }>('fruit').get(p.fruitId) : null;
        if (fruit && this.touchesCrate(p.point, fruit.radius)) this.play('woodKnock', {
          volume: .2 + speed * .45, pitch: 1.05 - speed * .2, position: p.point,
        });
      }),
      g.bus.on('rope:snapped', () => this.play('ropeSnap', { volume: .75 })),
      g.bus.on('player:ragdoll', () => this.play('thud', { volume: .8 })),
      g.bus.on('money:changed', p => { if (p.delta > 0 && p.reason === 'sale') this.play('sale'); }),
      g.bus.on('tool:fired', p => { if (p.toolId === 'aircannon') this.play('recoil', { volume: .25 }); }),
      g.bus.on('tool:meleeResult', p => {
        const cue = {
          whoosh: ['malletWhoosh', .20],
          blocked: ['malletBlocked', .29],
          protected: ['malletProtected', .28],
          hit: ['malletHit', .42],
        }[p.outcome] as [string, number];
        this.play(cue[0], { volume: cue[1] });
      }),
      g.bus.on('legendary:phase', p => { this.legendaryPhase = p.phase; }),
      g.bus.on('legendary:complete', () => { this.legendaryPhase = 'complete'; this.play('legendaryPayoff', { volume: .65 }); }),
    );
    g.debug?.addProbe('audio', () => ({ running: this.ctx?.state ?? 'none', played: this.played,
      last: this.lastSound, enabled: this.enabled, settings: this.getSettings(),
      activeVoices: this.activeVoices.size, ambienceSources: this.ambienceSources.length,
      music: this.music?.getState() ?? null, masterGain: this.master?.gain.value ?? 0 }));
    g.debug?.addAction('audio.unlock', async () => { await this.unlock(); return this.ctx?.state ?? 'none'; });
    g.debug?.addAction('audio.play', (name: string) => { this.play(name); return this.lastSound; });
    g.debug?.addAction('audio.list', () => SOUND_NAMES);
    g.debug?.addAction('audio.mute', (on = true) => { this.setMuted(on); return this.enabled; });
    g.debug?.addAction('audio.volume', (channel: AudioChannel, value: number) => { this.setVolume(channel, value); return this.getSettings(); });
  }

  getSettings(): AudioSettings { return { ...this.settings }; }
  /** Impacts report fruit centres. Test its sphere against the actual authored
   * crate OBBs, including the orchard's base-origin rectangular boxes. */
  private touchesCrate(point: THREE.Vector3, radius: number): boolean {
    if (!Number.isFinite(radius) || radius <= 0 || !this.g.has('world')) return false;
    if (!this.crateBoxes) {
      const world = this.g.get<{ built?: { mesh: THREE.Mesh } }>('world');
      if (!world.built) return false;
      const props = world.built.mesh.geometry.userData.authoredProps as
        Array<{ matrix: number[]; details: Record<string, unknown> }> | undefined;
      this.crateBoxes = [];
      for (const prop of props ?? []) {
        const d = prop.details;
        // Upper dock crates are decorative and have no collision primitive.
        if (d.kind !== 'crate' || d.support === 'crate below') continue;
        const width = Number(d.width ?? d.size), height = Number(d.height ?? d.size);
        if (!(width > 0 && height > 0)) continue;
        const matrix = new THREE.Matrix4().fromArray(prop.matrix);
        const center = new THREE.Vector3(0, d.height === undefined ? 0 : height / 2, 0).applyMatrix4(matrix);
        const rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
        matrix.decompose(new THREE.Vector3(), rotation, scale);
        this.crateBoxes.push({ center, inverse: rotation.invert(),
          half: new THREE.Vector3(width / 2, height / 2, width / 2).multiply(scale) });
      }
    }
    for (const box of this.crateBoxes) {
      _cratePoint.copy(point).sub(box.center).applyQuaternion(box.inverse);
      const dx = Math.max(0, Math.abs(_cratePoint.x) - box.half.x);
      const dy = Math.max(0, Math.abs(_cratePoint.y) - box.half.y);
      const dz = Math.max(0, Math.abs(_cratePoint.z) - box.half.z);
      // Small Rapier contact allowance, not a proximity/wood-material guess.
      if (dx * dx + dy * dy + dz * dz <= (radius + .025) ** 2) return true;
    }
    return false;
  }
  subscribeSettings(listener: (settings: AudioSettings) => void): () => void {
    this.listeners.add(listener); listener(this.getSettings()); return () => this.listeners.delete(listener);
  }
  setEventDirector(director: AudioEventDirector | null): void { this.eventDirector = director; }
  setMaster(value: number): void { this.setVolume('master', value); }
  setVolume(channel: AudioChannel, value: number): void {
    if (!['master', 'music', 'sfx', 'ambience'].includes(channel) || !Number.isFinite(value)) return;
    this.settings[channel] = clamp01(value); this.applySettings(); this.persist();
  }
  setMuted(muted: boolean): void { this.settings.muted = !!muted; this.applySettings(); this.persist(); }
  private persist(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* session controls still work */ }
    for (const listener of this.listeners) listener(this.getSettings());
  }
  private applySettings(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const [node, value] of [[this.master, this.settings.muted ? 0 : this.settings.master],
      [this.musicBus, this.settings.music * (this.musicDucked ? .5 : 1)], [this.sfxBus, this.settings.sfx],
      [this.ambienceBus, this.settings.ambience]] as Array<[GainNode | null, number]>) {
      if (!node) continue;
      node.gain.cancelScheduledValues(now);
      // Mute is immediate and reaches every sound, including running loops.
      if (value === 0) node.gain.setValueAtTime(0, now);
      else node.gain.setTargetAtTime(value, now, .025);
    }
  }

  async unlock(): Promise<void> {
    if (this.disposed || document.hidden) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      // Keep decoded stereo stems at 48 kHz even on 96/192 kHz output devices.
      const ctx = this.ctx = new Ctor({ sampleRate: 48000 });
      this.master = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -10; this.compressor.knee.value = 16;
      this.compressor.ratio.value = 5; this.compressor.attack.value = .003; this.compressor.release.value = .18;
      this.master.connect(this.compressor).connect(ctx.destination);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
      this.ambienceBus = ctx.createGain(); this.ambienceBus.connect(this.master);
      this.applySettings(); this.startAmbience();
      this.music = new MusicDirector(ctx, this.musicBus); void this.music.start();
    }
    try { await this.ctx.resume(); this.unlocked = this.ctx.state === 'running'; } catch { /* next gesture can retry */ }
  }

  play(name: string, opts: SfxOpts = {}): void {
    const ctx = this.ctx, voice = VOICES[name];
    if (!this.enabled || !ctx || ctx.state !== 'running' || !voice || this.disposed) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlay.get(name) ?? -1) < .035) return;
    this.lastPlay.set(name, now);
    const nodes: AudioNode[] = [];
    let out: AudioNode = (opts.ambience ? this.ambienceBus : this.sfxBus)!;
    if (opts.position) {
      this.listener.copy(this.g.renderer.camera.position);
      const d = this.listener.distanceTo(opts.position);
      if (d > 85) return;
      const panner = ctx.createStereoPanner(), distance = ctx.createGain();
      _v.copy(opts.position).sub(this.listener);
      _right.set(1, 0, 0).applyQuaternion(this.g.renderer.camera.quaternion);
      panner.pan.value = Math.max(-.85, Math.min(.85, _v.normalize().dot(_right)));
      distance.gain.value = 1 / (1 + d*d*.003);
      panner.connect(distance).connect(out); out = panner; nodes.push(panner, distance);
    }
    while (this.activeVoices.size >= 32) this.activeVoices.values().next().value?.();
    const gain = ctx.createGain(); gain.gain.value = Math.max(0, Math.min(1.5, opts.volume ?? 1));
    gain.connect(out); nodes.push(gain);
    const variation = ['coconutClack','fruitHit','woodKnock','ropeSnap','ropeFire','recoil'].includes(name)
      ? .94 + ((this.played * 7) % 13) * .01 : 1;
    const sources: AudioScheduledSourceNode[] = [];
    let duration = 0;
    voiceNodes = nodes; voiceSources = sources;
    try { duration = voice(ctx, gain, now, { pitch: Math.max(.25, Math.min(3, (opts.pitch ?? 1) * variation)) }); }
    finally { voiceNodes = null; voiceSources = null; }
    const id = this.nextVoice++;
    const cleanup = () => {
      window.clearTimeout(timer);
      for (const source of sources) { try { source.stop(); } catch { /* ended */ } }
      for (const node of nodes) node.disconnect(); this.activeVoices.delete(id);
    };
    const timer = window.setTimeout(cleanup, Math.ceil((duration + .1) * 1000));
    this.activeVoices.set(id, cleanup); this.played++; this.lastSound = name;
    // Briefly make room for warnings and outcome phrases. Only music ducks;
    // the player's saved music volume and the master mute remain authoritative.
    if (['eventWarning', 'eventSuccess', 'eventFail', 'legendaryPayoff'].includes(name)) {
      this.musicDuckUntil = Math.max(this.musicDuckUntil, now + duration + .25);
      this.musicDucked = true;
      this.musicBus!.gain.cancelScheduledValues(now);
      this.musicBus!.gain.setTargetAtTime(this.settings.music * .5, now, .025);
    }
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const noise = makeNoise(ctx, 4);
    for (const [i, frequency] of [420, 950, 1200, 2600].entries()) {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = noise; source.loop = true; filter.type = i === 0 ? 'lowpass' : 'bandpass';
      filter.frequency.value = frequency; filter.Q.value = .65; gain.gain.value = 0;
      source.connect(filter).connect(gain);
      if (i === 2) { this.waterfallPan = ctx.createStereoPanner(); gain.connect(this.waterfallPan).connect(this.ambienceBus!); this.ambienceNodes.push(this.waterfallPan); }
      else gain.connect(this.ambienceBus!);
      source.start(0, i*.53); this.ambienceSources.push(source); this.ambientGains.push(gain);
      this.ambienceNodes.push(source, filter, gain);
    }
  }

  frameUpdate(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.listener.copy(this.g.renderer.camera.position);
    const x = this.listener.x, z = this.listener.z, height = this.listener.y;
    const shore = clamp01((Math.hypot(x,z)-55)/32) * clamp01(1-Math.abs(height)/20);
    const falls = clamp01(1-this.listener.distanceTo(_waterfall)/34);
    const grove = Math.max(clamp01(1-Math.hypot(x+24,z-22)/35),clamp01(1-Math.hypot(x+36,z+30)/24));
    const time = ctx.currentTime;
    if (this.musicDucked && time >= this.musicDuckUntil) {
      this.musicDucked = false;
      this.musicBus!.gain.cancelScheduledValues(time);
      this.musicBus!.gain.setTargetAtTime(this.settings.music, time, .3);
    }
    const levels = [.018 + shore*(.10+.025*Math.sin(time*.5)), .009+clamp01((height-12)/30)*.025,
      falls*falls*.22, grove*(.018+.008*Math.sin(time*.8))];
    this.ambientGains.forEach((gain,i) => gain.gain.setTargetAtTime(levels[i],time,.25));
    if (this.waterfallPan) {
      _v.copy(_waterfall).sub(this.listener).normalize(); _right.set(1,0,0).applyQuaternion(this.g.renderer.camera.quaternion);
      this.waterfallPan.pan.setTargetAtTime(_v.dot(_right)*.8,time,.25);
    }
    const event = this.eventDirector?.getPresentation();
    let mood: MusicMood = this.g.player.speed > 5 ? 'busy' : 'calm';
    if (event?.phase === 'warning') mood = 'busy';
    if (event?.phase === 'active') mood = event.kind === 'coconuts' || event.remaining < 12 ? 'trouble' : 'busy';
    // Save restoration can set the phase before audio subscribes to events.
    // Read the live system when available; isolated fixtures can use the bus.
    if (this.g.has('legendary')) this.legendaryPhase = this.g.get<{ phase: string }>('legendary').phase;
    if (['tether','detach','drop','recover'].includes(this.legendaryPhase)
      && Math.hypot(x-8,z+62)<45) mood = 'legendary';
    this.music?.setMood(mood);
    this.birdTimer -= dt; this.localTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 9 + (this.played % 7);
      if (shore > .35) this.play('gullSquawk', { volume: .16, position: _dock, ambience: true });
      else if (grove > .25) this.play('bird', { volume: .10, pitch: .92 + (this.played%4)*.07, ambience: true });
    }
    if (this.localTimer <= 0) {
      this.localTimer = 11 + (this.played%9);
      if (Math.hypot(x-45,z-52)<13) this.play('mervMutter',{volume:.13,position:_shop,ambience:true});
      else if (Math.hypot(x-58,z-65)<19) this.play('woodKnock',{volume:.15,position:_dock,ambience:true});
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.gesture); window.removeEventListener('keydown', this.gesture);
    document.removeEventListener('visibilitychange', this.visibility);
    for (const off of this.unsubscribe) off(); this.unsubscribe.length = 0;
    this.music?.dispose(); this.music = null;
    for (const cleanup of [...this.activeVoices.values()]) cleanup();
    for (const source of this.ambienceSources) { try { source.stop(); } catch { /* stopped */ } }
    for (const node of this.ambienceNodes) node.disconnect();
    this.ambienceSources.length = 0; this.ambienceNodes.length = 0; this.ambientGains.length = 0;
    for (const node of [this.master,this.sfxBus,this.musicBus,this.ambienceBus,this.compressor]) node?.disconnect();
    this.listeners.clear(); void this.ctx?.close(); this.ctx = null;
  }
}
const _waterfall = new THREE.Vector3(34,4,-25), _dock = new THREE.Vector3(58,2,65), _shop = new THREE.Vector3(45,3,52);
const _cratePoint = new THREE.Vector3();

// ---------------------------------------------------------------------------
// synthesis helpers
// ---------------------------------------------------------------------------
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly smoothed white noise: pure white is harsh and hisses.
  let last = 0;
  let seed = 0x51a7c0de;
  for (let i = 0; i < len; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const w = (seed >>> 0) / 0xffffffff * 2 - 1;
    last = last * 0.35 + w * 0.65;
    d[i] = last;
  }
  return buf;
}

let sharedNoise: AudioBuffer | null = null;
// A voice is built synchronously. Register every generated node so stealing a
// voice, hiding the page, or disposing can release the entire graph, not just
// its final gain. These are never used by the music or ambience loops.
let voiceNodes: AudioNode[] | null = null;
let voiceSources: AudioScheduledSourceNode[] | null = null;
function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  if (!sharedNoise || sharedNoise.sampleRate !== ctx.sampleRate) {
    sharedNoise = makeNoise(ctx, 2.0);
  }
  const s = ctx.createBufferSource();
  s.buffer = sharedNoise;
  s.loop = true;
  return s;
}

/** A filtered noise burst — the basis of impacts, rustles and blasts. */
function burst(ctx: AudioContext, out: AudioNode, t: number, opts: {
  dur: number; type: BiquadFilterType; from: number; to: number; q?: number; gain?: number;
  attack?: number;
}): number {
  const src = noiseSource(ctx);
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.Q.value = opts.q ?? 1;
  f.frequency.setValueAtTime(opts.from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + opts.dur);
  const g = ctx.createGain();
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.5, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(f).connect(g).connect(out);
  voiceNodes?.push(src, f, g); voiceSources?.push(src);
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  src.start(t);
  src.stop(t + opts.dur + 0.02);
  return opts.dur;
}

/** A pitched tone with an exponential decay. */
function tone(ctx: AudioContext, out: AudioNode, t: number, opts: {
  freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number; attack?: number;
}): number {
  const o = ctx.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(opts.freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.dur);
  const g = ctx.createGain();
  const a = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.35, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  o.connect(g).connect(out);
  voiceNodes?.push(o, g); voiceSources?.push(o);
  o.onended = () => { o.disconnect(); g.disconnect(); };
  o.start(t);
  o.stop(t + opts.dur + 0.02);
  return opts.dur;
}

const VOICES: Record<string, Voice> = {
  coconutClack: (c, o, t, p) => {
    tone(c,o,t,{freq:740*p.pitch,to:520*p.pitch,dur:.075,type:'triangle',gain:.22});
    tone(c,o,t+.025,{freq:290*p.pitch,to:190,dur:.12,gain:.25});
    return burst(c,o,t,{dur:.07,type:'bandpass',from:2300,to:900,q:2.5,gain:.16});
  },
  woodKnock: (c,o,t,p) => {
    tone(c,o,t,{freq:340*p.pitch,to:260*p.pitch,dur:.12,type:'triangle',gain:.22});
    return tone(c,o,t+.07,{freq:220*p.pitch,dur:.09,gain:.13})+.07;
  },
  recoil: (c,o,t,p) => {
    tone(c,o,t,{freq:85*p.pitch,to:40,dur:.16,gain:.3});
    return burst(c,o,t,{dur:.19,type:'bandpass',from:800,to:160,gain:.13});
  },
  gullSquawk: (c,o,t,p) => {
    tone(c,o,t,{freq:820*p.pitch,to:1400*p.pitch,dur:.12,type:'triangle',gain:.075,attack:.035});
    tone(c,o,t+.13,{freq:1380*p.pitch,to:720*p.pitch,dur:.24,type:'triangle',gain:.09,attack:.025});
    return .4;
  },
  mervMutter: (c,o,t,p) => {
    [145,180,135].forEach((freq,i)=>{
      tone(c,o,t+i*.16,{freq:freq*p.pitch,to:freq*.85,dur:.13,type:'triangle',gain:.08,attack:.025});
      tone(c,o,t+i*.16,{freq:freq*3.2*p.pitch,dur:.11,gain:.018,attack:.03});
    });
    return .52;
  },
  eventWarning: (c,o,t) => {
    [392,523.25,392].forEach((freq,i)=>tone(c,o,t+i*.16,{freq,dur:.22,type:'triangle',gain:.14}));
    return .6;
  },
  eventTick: (c,o,t,p) => tone(c,o,t,{freq:660*p.pitch,dur:.065,type:'triangle',gain:.09}),
  eventSuccess: (c,o,t) => {
    [523.25,659.25,783.99,1046.5].forEach((freq,i)=>tone(c,o,t+i*.11,{freq,dur:.4,type:'triangle',gain:.14}));
    return .8;
  },
  eventFail: (c,o,t) => {
    [392,349.23,293.66].forEach((freq,i)=>tone(c,o,t+i*.15,{freq,dur:.27,type:'triangle',gain:.12}));
    return .65;
  },
  legendaryPayoff: (c,o,t) => {
    [523.25,659.25,783.99,1046.5,1318.5].forEach((freq,i)=>tone(c,o,t+i*.125,{freq,dur:.65,type:'triangle',gain:.13}));
    [130.81,196,261.63].forEach(freq=>tone(c,o,t+.5,{freq,dur:1.1,gain:.075}));
    return 1.7;
  },
  // --- harvesting
  pick: (c, o, t, p) => {
    tone(c, o, t, { freq: 620 * p.pitch, to: 240 * p.pitch, dur: 0.09, type: 'triangle', gain: 0.22 });
    return burst(c, o, t, { dur: 0.075, type: 'bandpass', from: 2600, to: 900, q: 2.4, gain: 0.28 });
  },
  stow: (c, o, t, p) => burst(c, o, t, {
    dur: 0.09, type: 'bandpass', from: 1500 * p.pitch, to: 620, q: 1.6, gain: 0.20 }),
  shake: (c, o, t, p) => burst(c, o, t, {
    dur: 0.55, type: 'bandpass', from: 1800 * p.pitch, to: 700, q: 0.8, gain: 0.30, attack: 0.05 }),
  rustle: (c, o, t, p) => burst(c, o, t, {
    dur: 0.34, type: 'highpass', from: 900 * p.pitch, to: 2400, q: 0.7, gain: 0.16, attack: 0.06 }),

  // --- impacts
  thud: (c, o, t, p) => {
    tone(c, o, t, { freq: 130 * p.pitch, to: 48, dur: 0.24, type: 'sine', gain: 0.7 });
    return burst(c, o, t, { dur: 0.16, type: 'lowpass', from: 900, to: 160, gain: 0.36 });
  },
  fruitHit: (c, o, t, p) => {
    tone(c, o, t, { freq: 220 * p.pitch, to: 90 * p.pitch, dur: 0.13, type: 'sine', gain: 0.4 });
    return burst(c, o, t, { dur: 0.1, type: 'lowpass', from: 1700, to: 380, gain: 0.24 });
  },
  splat: (c, o, t, p) => {
    tone(c, o, t, { freq: 160 * p.pitch, to: 55, dur: 0.2, type: 'sine', gain: 0.45 });
    return burst(c, o, t, { dur: 0.34, type: 'lowpass', from: 2800, to: 220, q: 0.8, gain: 0.55 });
  },
  boom: (c, o, t, p) => {
    tone(c, o, t, { freq: 90 * p.pitch, to: 32, dur: 0.6, type: 'sine', gain: 0.85 });
    return burst(c, o, t, { dur: 0.72, type: 'lowpass', from: 3600, to: 110, gain: 0.7 });
  },

  // --- tools
  throw: (c, o, t, p) => burst(c, o, t, {
    dur: 0.2, type: 'bandpass', from: 420 * p.pitch, to: 1500, q: 1.1, gain: 0.20, attack: 0.03 }),
  cannon: (c, o, t, p) => {
    tone(c, o, t, { freq: 120 * p.pitch, to: 42, dur: 0.34, type: 'sine', gain: 0.6 });
    return burst(c, o, t, { dur: 0.42, type: 'lowpass', from: 5200, to: 260, q: 0.7, gain: 0.66 });
  },
  ropeFire: (c, o, t, p) => {
    tone(c, o, t, { freq: 300 * p.pitch, to: 900, dur: 0.14, type: 'sawtooth', gain: 0.18 });
    return burst(c, o, t, { dur: 0.26, type: 'highpass', from: 700, to: 2600, gain: 0.22 });
  },
  ropeAnchor: (c, o, t, p) => {
    tone(c, o, t, { freq: 380 * p.pitch, to: 180, dur: 0.12, type: 'square', gain: 0.16 });
    return burst(c, o, t, { dur: 0.14, type: 'bandpass', from: 2200, to: 700, q: 2, gain: 0.3 });
  },
  ropeSnap: (c, o, t, p) => {
    tone(c, o, t, { freq: 900 * p.pitch, to: 120, dur: 0.16, type: 'sawtooth', gain: 0.4 });
    return burst(c, o, t, { dur: 0.3, type: 'highpass', from: 3000, to: 900, gain: 0.45 });
  },
  ropeStrain: (c, o, t, p) => tone(c, o, t, {
    freq: 180 * p.pitch, to: 260 * p.pitch, dur: 0.5, type: 'sawtooth', gain: 0.08, attack: 0.2 }),
  winch: (c, o, t, p) => tone(c, o, t, {
    freq: 92 * p.pitch, to: 96 * p.pitch, dur: 0.16, type: 'square', gain: 0.09 }),
  netCatch: (c, o, t, p) => burst(c, o, t, {
    dur: 0.24, type: 'bandpass', from: 2400 * p.pitch, to: 600, q: 0.9, gain: 0.3, attack: 0.02 }),
  // A net through the air. Lower and longer for a miss (pitch < 1).
  netSwing: (c, o, t, p) => burst(c, o, t, {
    dur: 0.22 / Math.max(0.6, p.pitch), type: 'bandpass', from: 320 * p.pitch, to: 1700 * p.pitch, q: 1.4, gain: 0.16, attack: 0.05 }),
  malletWhoosh: (c, o, t, p) => burst(c, o, t, {
    dur: .16, type: 'bandpass', from: 300 * p.pitch, to: 1400 * p.pitch,
    q: 1.1, gain: .12, attack: .025 }),
  malletBlocked: (c, o, t, p) => {
    tone(c, o, t, { freq: 230 * p.pitch, to: 115, dur: .11,
      type: 'triangle', gain: .22 });
    return burst(c, o, t, { dur: .075, type: 'lowpass', from: 950,
      to: 280, gain: .17 });
  },
  malletProtected: (c, o, t, p) => {
    tone(c, o, t, { freq: 720 * p.pitch, to: 1040 * p.pitch, dur: .10,
      type: 'triangle', gain: .18 });
    return tone(c, o, t + .045, { freq: 1380 * p.pitch, to: 990 * p.pitch,
      dur: .12, type: 'sine', gain: .10 }) + .045;
  },
  malletHit: (c, o, t, p) => {
    tone(c, o, t, { freq: 155 * p.pitch, to: 65, dur: .17,
      type: 'sine', gain: .34 });
    return burst(c, o, t, { dur: .11, type: 'lowpass', from: 1550,
      to: 310, gain: .24 });
  },
  netPlace: (c, o, t, p) => burst(c, o, t, {
    dur: 0.2, type: 'lowpass', from: 1400 * p.pitch, to: 300, gain: 0.28 }),
  ladderPlace: (c, o, t, p) => {
    tone(c, o, t, { freq: 240 * p.pitch, to: 110, dur: 0.16, type: 'triangle', gain: 0.3 });
    return burst(c, o, t, { dur: 0.16, type: 'bandpass', from: 1300, to: 420, q: 1.6, gain: 0.26 });
  },

  // --- rewards
  sale: (c, o, t) => {
    // A small major arpeggio: the sound of being paid.
    [523.25, 659.25, 783.99].forEach((f, i) => {
      tone(c, o, t + i * 0.06, { freq: f, dur: 0.24, type: 'triangle', gain: 0.20 });
    });
    return 0.45;
  },
  purchase: (c, o, t) => {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => {
      tone(c, o, t + i * 0.07, { freq: f, dur: 0.3, type: 'triangle', gain: 0.22 });
    });
    return 0.6;
  },
  stunt: (c, o, t, p) => {
    [660, 880, 1174].forEach((f, i) => {
      tone(c, o, t + i * 0.045, { freq: f * p.pitch, dur: 0.18, type: 'square', gain: 0.10 });
    });
    return 0.35;
  },
  discovery: (c, o, t) => {
    [523.25, 622.25, 783.99, 1046.5].forEach((f, i) => {
      tone(c, o, t + i * 0.10, { freq: f, dur: 0.5, type: 'triangle', gain: 0.20 });
    });
    return 0.9;
  },

  // --- world
  bird: (c, o, t, p) => {
    const f = 1800 * p.pitch;
    tone(c, o, t, { freq: f, to: f * 1.5, dur: 0.07, type: 'sine', gain: 0.10 });
    tone(c, o, t + 0.09, { freq: f * 1.35, to: f * 0.9, dur: 0.08, type: 'sine', gain: 0.09 });
    return 0.22;
  },
  splash: (c, o, t, p) => burst(c, o, t, {
    dur: 0.42, type: 'lowpass', from: 3800 * p.pitch, to: 300, gain: 0.4 }),
};

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();

export const SOUND_NAMES = Object.keys(VOICES);
