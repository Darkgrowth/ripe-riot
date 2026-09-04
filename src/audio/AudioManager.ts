import * as THREE from 'three';
import type { Game, System } from '@/core/Game';

/**
 * Every sound in the game is synthesised at runtime.
 *
 * No audio files means nothing to licence, nothing to download, and — more
 * usefully — sounds that take arguments. A coconut hitting a player and a
 * coconut hitting a dock are the same generator at different pitches, so the
 * impact system can just pass through what it already knows.
 */

interface SfxOpts {
  volume?: number;
  pitch?: number;
  position?: THREE.Vector3;
}

type Voice = (ctx: AudioContext, out: AudioNode, t: number, o: Required<Pick<SfxOpts, 'pitch'>>) => number;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class AudioManager implements System {
  readonly name = 'audio';
  private g!: Game;
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambienceBus!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private listener = new THREE.Vector3();
  private lastPlay = new Map<string, number>();
  masterVolume = 0.7;
  sfxVolume = 0.9;
  musicVolume = 0.35;
  ambienceVolume = 0.5;
  enabled = true;
  /** Sounds played this session, for the harness. */
  played = 0;
  lastSound = '';

  init(g: Game): void {
    this.g = g;
    // Browsers refuse to start audio without a gesture; unlock on the first one.
    const unlock = () => this.ensureContext();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    g.bus.on('audio:sfx', (p) => this.play(p.name, {
      volume: p.volume, pitch: p.pitch, position: p.position,
    }));
    g.bus.on('fruit:impact', (p) => {
      const speed = clamp01(p.speed / 22);
      this.play(p.onPlayer ? 'thud' : 'fruitHit', {
        volume: 0.25 + speed * 0.75, pitch: 1.25 - speed * 0.45, position: p.point,
      });
    });
    g.bus.on('rope:snapped', () => this.play('ropeSnap', { volume: 1 }));
    g.bus.on('player:ragdoll', () => this.play('thud', { volume: 1 }));
    g.bus.on('money:changed', (p) => { if (p.delta > 0 && p.reason === 'sale') this.play('sale'); });

    g.debug?.addProbe('audio', () => ({
      running: this.ctx?.state ?? 'none',
      played: this.played,
      last: this.lastSound,
      enabled: this.enabled,
    }));
    g.debug?.addAction('audio.unlock', () => { this.ensureContext(); return this.ctx?.state ?? 'none'; });
    g.debug?.addAction('audio.play', (name: string) => { this.play(name); return this.lastSound; });
    g.debug?.addAction('audio.list', () => Object.keys(VOICES));
    g.debug?.addAction('audio.mute', (on = true) => { this.enabled = !on; return this.enabled; });
  }

  private ensureContext(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    // A limiter keeps a pile of simultaneous impacts from clipping, which is
    // exactly the moment this game is at its loudest.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = this.ambienceVolume;
    this.ambienceBus.connect(this.master);

    this.noiseBuffer = makeNoise(ctx, 2.0);
    this.startAmbience();
  }

  // ---- playback -----------------------------------------------------------
  play(name: string, opts: SfxOpts = {}): void {
    if (!this.enabled) return;
    this.ensureContext();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const voice = VOICES[name];
    if (!voice) return;

    // Rate-limit identical sounds: a tree shake can drop nine fruit in one
    // frame and nine copies of the same sample is a click, not a sound.
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlay.set(name, now);

    let out: AudioNode = this.sfxBus;
    let gainScale = opts.volume ?? 1;

    if (opts.position) {
      const d = this.listener.distanceTo(opts.position);
      if (d > 90) return;                       // too far to hear
      const panner = ctx.createStereoPanner();
      const cam = this.g.renderer.camera;
      _v.copy(opts.position).sub(this.listener);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      panner.pan.value = Math.max(-0.85, Math.min(0.85, _v.normalize().dot(_right)));
      const dist = ctx.createGain();
      dist.gain.value = 1 / (1 + d * d * 0.0022);
      panner.connect(dist).connect(this.sfxBus);
      out = panner;
      gainScale *= 1;
    }

    const g = ctx.createGain();
    g.gain.value = gainScale;
    g.connect(out);
    const dur = voice(ctx, g, now, { pitch: opts.pitch ?? 1 });
    // Free the graph once the tail has decayed.
    window.setTimeout(() => { try { g.disconnect(); } catch { /* already gone */ } },
      Math.ceil((dur + 0.35) * 1000));
    this.played++;
    this.lastSound = name;
  }

  // ---- ambience -----------------------------------------------------------
  private ambienceNodes: AudioNode[] = [];
  private birdTimer = 0;

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return;

    // Surf: filtered noise with a slowly breathing cutoff and level.
    const surf = ctx.createBufferSource();
    surf.buffer = this.noiseBuffer;
    surf.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 480;
    surfFilter.Q.value = 0.6;
    const surfGain = ctx.createGain();
    surfGain.gain.value = 0.16;
    surf.connect(surfFilter).connect(surfGain).connect(this.ambienceBus);

    const swell = ctx.createOscillator();
    swell.frequency.value = 0.09;
    const swellGain = ctx.createGain();
    swellGain.gain.value = 0.09;
    swell.connect(swellGain).connect(surfGain.gain);
    const cutoffLfo = ctx.createOscillator();
    cutoffLfo.frequency.value = 0.06;
    const cutoffGain = ctx.createGain();
    cutoffGain.gain.value = 240;
    cutoffLfo.connect(cutoffGain).connect(surfFilter.frequency);

    // Wind: higher, quieter, band-passed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 780;
    windFilter.Q.value = 1.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(this.ambienceBus);
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.13;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.035;
    windLfo.connect(windLfoGain).connect(windGain.gain);

    surf.start(); wind.start(); swell.start(); cutoffLfo.start(); windLfo.start();
    this.ambienceNodes.push(surf, wind, swell, cutoffLfo, windLfo, surfGain, windGain);
    this.surfGain = surfGain;
    this.windGain = windGain;
  }
  private surfGain: GainNode | null = null;
  private windGain: GainNode | null = null;

  frameUpdate(dt: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.listener.copy(this.g.renderer.camera.position);

    // Surf gets louder near the water; wind gets louder up high.
    const world = this.g.has('world')
      ? this.g.get<{ terrain: { height(x: number, z: number): number } }>('world')
      : null;
    if (world && this.surfGain && this.windGain) {
      const h = this.listener.y;
      const shore = Math.max(0, 1 - Math.abs(h) / 26);
      this.surfGain.gain.value = 0.06 + shore * 0.14;
      this.windGain.gain.value = 0.02 + Math.min(1, Math.max(0, (h - 8) / 30)) * 0.09;
    }

    // Occasional birds, only in daylight and only over land.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 9;
      if (world && world.terrain.height(this.listener.x, this.listener.z) > 1.5) {
        _v.copy(this.listener).add(new THREE.Vector3(
          (Math.random() - 0.5) * 30, 4 + Math.random() * 6, (Math.random() - 0.5) * 30));
        this.play('bird', { volume: 0.22 + Math.random() * 0.2, pitch: 0.85 + Math.random() * 0.4, position: _v.clone() });
      }
    }
  }

  setMaster(v: number): void {
    this.masterVolume = clamp01(v);
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  dispose(): void {
    for (const n of this.ambienceNodes) { try { n.disconnect(); } catch { /* gone */ } }
    void this.ctx?.close();
    this.ctx = null;
  }
}

// ---------------------------------------------------------------------------
// synthesis helpers
// ---------------------------------------------------------------------------
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly smoothed white noise: pure white is harsh and hisses.
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.35 + w * 0.65;
    d[i] = last;
  }
  return buf;
}

let sharedNoise: AudioBuffer | null = null;
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
  o.start(t);
  o.stop(t + opts.dur + 0.02);
  return opts.dur;
}

const VOICES: Record<string, Voice> = {
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
