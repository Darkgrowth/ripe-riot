export type MusicMood = 'calm' | 'busy' | 'trouble' | 'legendary';
const BAR = 2.5, LOOP = 120;
const MIX: Record<MusicMood, [number, number, number]> = {
  calm: [1, 0, 0], busy: [1, .75, 0], trouble: [.88, .65, .75], legendary: [.8, .8, 1],
};

/** All stems start on one audio-clock epoch and keep running in phase. Only
 * gains change, at bar boundaries, so rendering stalls cannot drift the score. */
export class MusicDirector {
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private abort = new AbortController();
  private dead = false;
  private epoch = 0;
  private mood: MusicMood = 'calm';
  private pending: MusicMood | null = null;
  private transitionAt = 0;
  ready = false;
  error = '';
  constructor(private ctx: AudioContext, private out: AudioNode) {}

  async start(): Promise<void> {
    try {
      const buffers = await Promise.all(['calm', 'busy', 'trouble'].map(async name => {
        const response = await fetch(`/audio/${name}.ogg`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`music ${name}: HTTP ${response.status}`);
        return this.ctx.decodeAudioData(await response.arrayBuffer());
      }));
      if (this.dead) return;
      if (buffers.some(b => Math.abs(b.duration - LOOP) > .02)) throw new Error('Music stems must share the 120-second grid');
      this.epoch = this.ctx.currentTime + .12;
      buffers.forEach((buffer, i) => {
        const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
        source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = LOOP;
        gain.gain.setValueAtTime(0, this.epoch);
        gain.gain.linearRampToValueAtTime(MIX[this.mood][i], this.epoch + BAR);
        source.connect(gain).connect(this.out); source.start(this.epoch);
        this.sources.push(source); this.gains.push(gain);
      });
      this.ready = true;
    } catch (error) {
      if (!this.dead) { this.error = String(error); console.warn('Music unavailable:', error); }
    }
  }

  setMood(mood: MusicMood): void {
    if (!this.ready) { this.mood = mood; return; }
    if (mood === (this.pending ?? this.mood)) return;
    const now = this.ctx.currentTime;
    // Finish a scheduled crossfade before scheduling another; fast events
    // cannot pile unbounded AudioParam automation onto each frame.
    if (this.pending && now < this.transitionAt + BAR) return;
    if (this.pending) this.mood = this.pending;
    this.pending = mood;
    this.transitionAt = this.epoch + Math.ceil(Math.max(0, now - this.epoch) / BAR) * BAR;
    this.gains.forEach((gain, i) => {
      gain.gain.cancelScheduledValues(this.transitionAt);
      gain.gain.setValueAtTime(MIX[this.mood][i], this.transitionAt);
      gain.gain.linearRampToValueAtTime(MIX[mood][i], this.transitionAt + BAR);
    });
  }
  getState() { return { ready: this.ready, mood: this.pending ?? this.mood,
    sources: this.sources.length, epoch: this.epoch, transitionAt: this.transitionAt, error: this.error }; }
  dispose(): void {
    this.dead = true; this.abort.abort();
    for (const source of this.sources) { try { source.stop(); } catch { /* already stopped */ } source.disconnect(); }
    for (const gain of this.gains) gain.disconnect();
    this.sources.length = 0; this.gains.length = 0; this.ready = false;
  }
}
