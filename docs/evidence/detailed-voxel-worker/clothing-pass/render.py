"""Render the existing worker review views into this pass's evidence folder."""

from pathlib import Path

root = Path(__file__).resolve().parents[4]
review = root / 'tools/assets/render_detailed_voxel_worker.py'
source = review.read_text(encoding='utf-8')
old = "OUT = ROOT / 'docs/evidence/detailed-voxel-worker/source-review'"
new = "OUT = ROOT / 'docs/evidence/detailed-voxel-worker/clothing-pass'"
assert old in source
exec(compile(source.replace(old, new), str(review), 'exec'),
     {'__file__': str(review), '__name__': '__main__'})
