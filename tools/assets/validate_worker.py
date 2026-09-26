"""Validate editable source topology and weighted joints; run inside Blender."""
import bpy
import math
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/source/worker.blend'))


def components(mesh):
    adj = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adj[a].append(b)
        adj[b].append(a)
    seen = set()
    sizes = []
    for v in range(len(adj)):
        if v in seen:
            continue
        todo = deque([v])
        seen.add(v)
        count = 0
        while todo:
            current = todo.popleft()
            count += 1
            for nxt in adj[current]:
                if nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
        sizes.append(count)
    return sizes, sum(not links for links in adj)


for name in ['WorkerBody', 'ToolGrip_L', 'ToolGrip_R', 'CarryGrip_L', 'CarryGrip_R']:
    obj = bpy.data.objects[name]
    sizes, loose = components(obj.data)
    assert sizes == [len(obj.data.vertices)], f'{name}: disconnected pieces {sizes}'
    assert loose == 0, f'{name}: {loose} loose vertices'
    print(f'{name}: vertices={len(obj.data.vertices)} faces={len(obj.data.polygons)} components=1')

body = bpy.data.objects['WorkerBody']
for zone, ylo, yhi in [('shoulder', 0.08, 0.28), ('elbow', -0.30, -0.08),
                       ('hip', -0.50, -0.28), ('knee', -0.80, -0.62)]:
    verts = [v for v in body.data.vertices if ylo <= v.co.z <= yhi and
             (abs(v.co.x) > 0.20 if zone in ('shoulder', 'elbow') else abs(v.co.x) > 0.08)]
    assert verts, f'no {zone} loop'
    blended = 0
    for v in verts:
        weights = [g.weight for g in v.groups if g.weight > 1e-5]
        assert weights and math.isclose(sum(weights), 1, abs_tol=2e-3), f'{zone}: invalid weights'
        blended += len(weights) > 1
    assert blended, f'{zone}: no gradient weights'
    print(f'{zone}: {len(verts)} verts, {blended} blended')

for name in ['Helmet', 'Backpack', 'Boot_L', 'Boot_R']:
    obj = bpy.data.objects[name]
    assert obj.parent is not None or any(m.type == 'ARMATURE' for m in obj.modifiers), f'{name}: unbound accessory'
print('worker source topology: PASS')
