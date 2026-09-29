import type { EncounterState } from '@/enemies/EncounterModel';

export interface EncounterAdvice {
  name: string;
  text: string;
  tone: 'danger' | 'opening' | 'bait' | 'neutral';
}

/** Describe an observed opening without inventing damage or vulnerability. */
export function encounterAdvice(state: EncounterState, carrying: boolean,
  hasCannon: boolean): EncounterAdvice | null {
  if (state.health <= 0 || state.phase === 'defeated') return null;
  const name = { mimic: 'MIMIC MELON', snapjaw: 'SNAPJAW', spitter: 'SPITTER PLANT' }[state.kind];
  const cue = (text: string, tone: EncounterAdvice['tone']): EncounterAdvice => ({ name, text, tone });
  if (state.kind === 'snapjaw') {
    if (state.capturedVictimId !== null) return cue('Get close · E to pull them free', 'danger');
    if (state.phase === 'recover') return cue('Jaws open · strike now', 'opening');
    if (state.phase === 'attack') return cue('Keep clear of the jaws', 'danger');
    if (state.baited) return cue('Bait taken · move beside the jaws', 'bait');
    if (state.phase === 'warn') return cue('Bite incoming · step aside', 'danger');
    return cue(carrying ? 'Hold LMB, release to throw bait' : 'Toss fruit to draw its bite', 'neutral');
  }
  if (state.phase === 'recover' || state.phase === 'stagger')
    return cue(state.kind === 'mimic' ? 'Off balance · strike now' : 'Stem exposed · strike now', 'opening');
  if (state.kind === 'mimic') return cue(state.phase === 'attack'
    ? 'Sidestep the rush' : 'Watch the wind-up · sidestep', 'danger');
  if (state.phase === 'idle') return cue('Move between shots · strike the stem', 'neutral');
  return cue(hasCannon ? 'Dodge or blast the incoming seed' : 'Seed incoming · move sideways', 'danger');
}
