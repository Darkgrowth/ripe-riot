"""Decode the shipped compressed stems and measure their actual loop/peak data."""
from pathlib import Path
import argparse, json, shutil, subprocess
import numpy as np
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--directory',type=Path,default=root/'public'/'audio')
directory=parser.parse_args().directory
ffmpeg=shutil.which('ffmpeg')
stems=[];report={}
for name in ['calm','busy','trouble','sunpatch-demo']:
    file=directory/(name+'.ogg')
    raw=subprocess.check_output([ffmpeg,'-v','error','-i',str(file),'-f','f32le','-ar','32000','-ac','2','-'])
    audio=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
    assert len(audio)==3840000,(name,len(audio))
    peak=float(np.max(np.abs(audio)))
    assert peak<.95,(name,peak)
    report[name]={'seconds':len(audio)/32000,'samples':len(audio),'peak':peak,
      'rms':float(np.sqrt(np.mean(audio**2))),'seamDelta':float(np.max(np.abs(audio[0]-audio[-1]))),
      'fileBytes':file.stat().st_size}
    assert report[name]['seamDelta']<.01,(name,report[name])
    if name!='sunpatch-demo':stems.append(audio)
report['allLayersPeak']=float(np.max(np.abs(sum(stems))))
assert report['allLayersPeak']<.95
text=json.dumps(report,indent=2)+'\n'
(directory/'verification.json').write_text(text)
print(text)
