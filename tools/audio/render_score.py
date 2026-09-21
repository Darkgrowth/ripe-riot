"""Original Sunpatch score, authored for RIPE RIOT; no samples or external music.

48 bars, 4/4, 96 BPM = exactly 120 seconds. The three stereo stems share one
harmonic/melodic grid and are additive: calm foundation, busy picking, trouble
percussion. Edit the explicit melody/progression below, then rerun this file.
Requires Python + numpy + ffmpeg. Notes wrap their decay into the next loop.
"""
from pathlib import Path
import argparse, json, math, shutil, subprocess, wave
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'audio'
SR, BPM, BARS = 32000, 96, 48
BEAT, LENGTH = 60 / BPM, 120
N = SR * LENGTH
CHORDS = {
    'C': [48, 55, 60, 64, 67, 72], 'Am': [45, 52, 57, 60, 64, 69],
    'F': [41, 48, 53, 57, 60, 65], 'G': [43, 50, 55, 59, 62, 67],
    'Dm': [38, 45, 50, 53, 57, 62], 'Em': [40, 47, 52, 55, 59, 64],
}
PROGRESSION = (
    ['C','C','Am','Am','F','C','Dm','G','C','Em','F','G','Am','F','G','C'] +
    ['F','F','C','C','Dm','G','C','C','Am','Em','F','C','Dm','G','G','C'] +
    ['C','C','Am','Am','F','C','Dm','G','C','Em','F','G','Am','F','G','C']
)
# Each tuple is beat, MIDI note, duration in beats. Deliberate call/response,
# rests and four-bar cadences keep the tune from sounding like random notes.
MELODY_A = [
    [(0,64,1),(1,67,.5),(1.5,69,.5),(2,67,1.5)],
    [(0,64,.75),(1,62,.75),(2,60,1.5)],
    [(0,64,1),(1.5,69,.5),(2,72,1),(3,71,.5)],
    [(0,69,2),(3,67,.5)],
    [(0,65,1),(1,69,.5),(1.5,72,.5),(2.5,69,1)],
    [(0,67,1.5),(2,64,1),(3,62,.5)],
    [(0,62,1),(1,65,1),(2.5,64,.5),(3,62,.5)],
    [(0,59,1.5),(2,62,.75),(3,67,.75)],
    [(0,72,1),(1.5,71,.5),(2,67,1.5)],
    [(0,64,1),(1,67,1),(2.5,71,1)],
    [(0,69,1),(1,65,.5),(2,64,.5),(2.5,65,1)],
    [(0,67,1.5),(2,62,.5),(3,59,.5)],
    [(0,60,1),(1,64,.5),(1.5,69,.5),(2.5,67,1)],
    [(0,65,1.5),(2,64,.5),(3,62,.5)],
    [(0,62,.5),(1,59,.5),(2,67,1)],
    [(0,64,1),(1.5,62,.5),(2,60,1.5)],
]
MELODY_B = [
    [(0,69,1.5),(2,72,1)],[(0,74,.5),(1,72,.5),(2,69,1.5)],
    [(0,67,1),(1.5,64,.5),(2,67,1)],[(0,72,2),(3,67,.5)],
    [(0,65,.5),(1,62,.5),(2,65,1)],[(0,67,1),(1.5,71,.5),(2.5,74,1)],
    [(0,72,1),(1,67,.5),(2,64,1)],[(0,62,.5),(1,64,.5),(2,60,1.5)],
    [(0,69,.5),(1,72,.5),(2,76,1)],[(0,74,.5),(1,71,.5),(2,67,1.5)],
    [(0,72,1),(1.5,69,.5),(2.5,65,1)],[(0,67,2),(3,64,.5)],
    [(0,65,1),(1,62,1),(2.5,69,1)],[(0,67,1),(1.5,62,.5),(2.5,59,1)],
    [(0,62,.5),(1,64,.5),(2,67,.5),(3,71,.5)],[(0,72,1.5),(2,67,.5),(3,64,.5)],
]

def add(out, start, signal, pan=0):
    idx = (round(start * SR) + np.arange(len(signal))) % N
    out[idx, 0] += signal * math.sqrt((1-pan)/2)
    out[idx, 1] += signal * math.sqrt((1+pan)/2)

def pluck(note, seconds, level, timbre='guitar'):
    t = np.arange(round((seconds + .32) * SR)) / SR
    freq = 440 * 2 ** ((note-69)/12)
    decay = {'guitar':1.8, 'bass':2.8, 'banjo':4.5, 'bell':1.1}[timbre]
    signal = np.zeros(len(t))
    for harmonic in range(1, 9):
        weight = 1 / harmonic ** (1.45 if timbre != 'banjo' else 1.12)
        if timbre == 'guitar': weight *= .8 + .2 * math.cos(harmonic * 1.4)
        signal += weight * np.sin(2*np.pi*freq*harmonic*t) * np.exp(-t*decay*(1+.22*harmonic))
    envelope = np.minimum(1, t/.003) * np.minimum(1, np.maximum(0, (seconds+.32-t)/.15))
    return signal * envelope * level

def tap(seconds, pitch, level, seed):
    t = np.arange(round(seconds*SR))/SR
    rng = np.random.default_rng(seed)
    signal = (np.sin(2*np.pi*pitch*t)*.72 + np.sin(2*np.pi*pitch*1.47*t)*.18
              + rng.uniform(-1,1,len(t))*.10)
    return signal * np.exp(-t*34) * np.minimum(1,t/.001) * level

def woodwind(midi, seconds, level):
    """Quiet breathy flute answer with soft attack and restrained vibrato."""
    t = np.arange(round((seconds+.18)*SR))/SR
    freq = 440 * 2 ** ((midi-69)/12)
    phase = 2*np.pi*freq*(t + .00007*np.sin(2*np.pi*5*t))
    signal = np.sin(phase) + .12*np.sin(phase*2) + .025*np.sin(phase*3)
    breath = np.random.default_rng(510+midi).uniform(-1,1,len(t))
    signal += np.convolve(breath,np.ones(7)/7,mode='same')*.035
    envelope = np.minimum(1,t/.045)*np.clip((seconds+.18-t)/.18,0,1)
    return signal*envelope*level

def render():
    stems = {name:np.zeros((N,2),dtype=np.float32) for name in ('calm','busy','trouble')}
    score = []
    for bar, chord in enumerate(PROGRESSION):
        start = bar * 4 * BEAT
        notes = CHORDS[chord]
        melody = (MELODY_B if 16 <= bar < 32 else MELODY_A)[bar % 16]
        # Finger-picked accompaniment and a soft alternating root/fifth bass.
        for beat, string in [(0,2),(.75,4),(1.5,3),(2,2),(2.75,5),(3.5,4)]:
            add(stems['calm'],start+beat*BEAT,pluck(notes[string],.85,.044),-.34)
        for beat, note in [(0,notes[0]),(2,notes[1]-12)]:
            add(stems['calm'],start+beat*BEAT,pluck(note,1.2,.095,'bass'),.04)
        for beat,note,dur in melody:
            add(stems['calm'],start+beat*BEAT,pluck(note,dur*BEAT,.105),.20)
            score.append({'bar':bar,'beat':beat,'midi':note,'beats':dur})
        # A light woodwind answers the plucked lead at four-bar cadences.
        if bar % 4 == 3:
            for beat,note in [(2,notes[3]),(3,notes[4])]:
                add(stems['calm'],start+beat*BEAT,woodwind(note,.8*BEAT,.027),-.12)
                score.append({'bar':bar,'beat':beat,'midi':note,'beats':.8,'instrument':'woodwind'})
        # The busy layer answers in chord tones; it never replaces the tune.
        for j, string in enumerate([3,4,5,4,3,5,4,3]):
            add(stems['busy'],start+(j*.5+.04)*BEAT,pluck(notes[string],.33,.037,'banjo'),-.55 if j%2 else .52)
        for beat in [1,3]:
            add(stems['busy'],start+beat*BEAT,tap(.16,480,.055,bar*8+int(beat)),.25)
        # Wooden percussion and pizzicato low fifths add comic urgency without
        # a siren, chromatic random notes, or a different beat grid.
        for j,beat in enumerate([0,1,1.5,2.5,3,3.5]):
            add(stems['trouble'],start+beat*BEAT,tap(.24,130 if j%2==0 else 760,.085 if j%2==0 else .042,bar*16+j),-.2 if j%2 else .2)
        for beat,note in [(0,notes[0]+12),(1.5,notes[1]),(2.5,notes[2])]:
            add(stems['trouble'],start+beat*BEAT,pluck(note,.35,.050,'banjo'),0)
    combined = sum(stems.values())
    gain = .72 / max(.001,float(np.max(np.abs(combined))))
    OUT.mkdir(parents=True,exist_ok=True)
    stats = {'title':'Sunpatch: Small Margins','bpm':BPM,'bars':BARS,'beatsPerBar':4,
             'duration':LENGTH,'sampleRate':SR,'instruments':['plucked melody','fingerpicked strings','warm bass','breathy woodwind','banjo answers','wooden percussion'],
             'license':'Original composition and synthesis authored for RIPE RIOT; no third-party samples.', 'stems':{}}
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg: raise RuntimeError('ffmpeg must be on PATH')
    for name, signal in stems.items():
        signal *= gain
        stats['stems'][name] = {'peak':float(np.max(np.abs(signal))),
            'rms':float(np.sqrt(np.mean(signal**2))),
            'seamDelta':float(np.max(np.abs(signal[0]-signal[-1]))), 'samples':len(signal)}
        encode(signal,OUT/(name+'.ogg'),ffmpeg)
    # A listenable arrangement demo: calm -> busy -> trouble -> calm, with
    # changes on ten-second phrases within the runtime's 2.5-second bar grid.
    times=np.arange(N)/SR
    def window(a,b): return np.minimum(np.clip((times-a)/2.5,0,1),np.clip((b-times)/2.5,0,1))
    demo=stems['calm']+stems['busy']*window(30,100)[:,None]*.75+stems['trouble']*window(60,90)[:,None]*.75
    encode(demo,OUT/'sunpatch-demo.ogg',ffmpeg)
    stats['combinedPeak']=float(np.max(np.abs(sum(stems.values()))))
    stats['demoPeak']=float(np.max(np.abs(demo)))
    (OUT/'score.json').write_text(json.dumps({**stats,'progression':PROGRESSION,'melody':score},indent=2)+'\n')
    print(json.dumps(stats,indent=2))

def encode(signal,target,ffmpeg):
    wav=target.with_suffix('.wav')
    with wave.open(str(wav),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(SR)
        out.writeframes((np.clip(signal,-1,1)*32767).astype('<i2').tobytes())
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(wav),'-c:a','libvorbis','-q:a','4',str(target)],check=True)
    wav.unlink()

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=OUT,help='Optional staging output directory')
    OUT=parser.parse_args().output
    render()
