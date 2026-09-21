"""One 22-second direction audition, not a replacement runtime score.
Original authored notes and synthesized instruments; no external samples.
"""
from pathlib import Path
import numpy as np
import wave, subprocess, shutil, json

SR, BPM = 32000, 132
beat = 60 / BPM
length = 48 * beat
audio = np.zeros((round((length + .5) * SR), 2), dtype=np.float32)
rng = np.random.default_rng(922)

def add(signal, at, pan=0):
    start = round(at * SR)
    end = min(len(audio), start + len(signal))
    audio[start:end, 0] += signal[:end-start] * np.sqrt((1-pan)/2)
    audio[start:end, 1] += signal[:end-start] * np.sqrt((1+pan)/2)

def note(midi, seconds, level, brass=False):
    t = np.arange(round((seconds + .06)*SR))/SR
    hz = 440*2**((midi-69)/12)
    # Short pitch settle gives the bass a rubbery attack, rather than a pad.
    phase = 2*np.pi*hz*(t + (.0008 if brass else .003)*(1-np.exp(-t*30)))
    tone = sum(np.sin(phase*h)/h**(1.35 if brass else 2) for h in range(1,8))
    env = np.minimum(t/(.018 if brass else .004),1)*np.clip((seconds+.06-t)/.07,0,1)
    env *= np.exp(-t*(3 if brass else 4.5))
    return np.tanh(tone*1.5)*env*level

def drum(kind, level):
    t = np.arange(round(.24*SR))/SR
    noise = rng.uniform(-1,1,len(t))
    if kind == 'kick':
        tone = np.sin(2*np.pi*(47*t + 1.5*(1-np.exp(-t*35))))*np.exp(-t*25)
    elif kind == 'snare':
        tone = (noise*.75 + np.sin(2*np.pi*180*t)*.25)*np.exp(-t*32)
    elif kind == 'wood':
        tone = (np.sin(2*np.pi*860*t)+.35*np.sin(2*np.pi*1337*t))*np.exp(-t*85)
    else:
        tone = np.r_[0,np.diff(noise)]*.45*np.exp(-t*80)
    return tone*np.minimum(t/.001,1)*level

# Three four-bar phrases: working groove, trouble, then a stop-time payoff.
roots = [36, 34, 41, 43]
chords = [[60,63,67],[58,62,65],[65,69,72],[67,71,74]]
hook = [(0,72,.23),(.75,75,.15),(1.5,72,.18),(2.75,67,.34)]
for bar in range(12):
    start = bar*4*beat; root=roots[bar%4]
    active = bar >= 4
    for t,offset in [(0,0),(.75,12),(1.5,7),(2,0),(2.75,10),(3.5,12)]:
        if bar == 11 and t > 1.5: continue
        add(note(root+offset,.19,.25),start+t*beat)
    for t in ([0,1.75,2.5] if active else [0,2.5]): add(drum('kick',.31),start+t*beat)
    for t in [1,3]: add(drum('snare',.15 if active else .09),start+t*beat,.08)
    for j in range(8): add(drum('hat',.031 if j%2 else .022),start+(j*.5+(.04 if j%2 else 0))*beat,-.25)
    for t in [.5,2.5]:
        for midi in chords[bar%4]: add(note(midi,.10,.035,True),start+t*beat,-.35)
    if active and bar%2 == 0:
        for t,midi,dur in hook: add(note(midi+(bar%4==2)*2,dur,.10,True),start+t*beat,.22)
    if active and bar%4 == 3:
        for t in [2.5,3,3.25,3.5,3.75]: add(drum('wood',.075),start+t*beat,.35)

audio *= .82 / max(float(np.max(np.abs(audio))),.001)
audio[-round(.35*SR):] *= np.linspace(1,0,round(.35*SR))[:,None]
out = Path('capture/focused-feedback/music-audition');out.mkdir(parents=True,exist_ok=True)
with wave.open(str(out/'scrappy-groove.wav'),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
    f.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
subprocess.run([shutil.which('ffmpeg'),'-v','error','-y','-i',str(out/'scrappy-groove.wav'),'-c:a','libmp3lame','-q:a','3',str(out/'scrappy-groove.mp3')],check=True)
(out/'notes.json').write_text(json.dumps({'status':'Direction audition only; not shipped','bpm':BPM,'seconds':len(audio)/SR,'bars':12,'roots':roots,'hook':hook,'instruments':['rubber bass','dry drums','woodblock fills','short brass-like stabs'],'humanListeningVerified':False},indent=2))
print(str(out/'scrappy-groove.mp3'))
