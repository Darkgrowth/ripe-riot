"""Validate the versioned worker source in background Blender 5.2."""

from collections import deque
from pathlib import Path
import math

import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/source/worker-detailed-voxel-v1.blend'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))

EXPECTED_BONES = {
    'Pelvis', 'Spine', 'Chest', 'Neck', 'Head',
    'UpperArm_L', 'Forearm_L', 'Hand_L',
    'UpperArm_R', 'Forearm_R', 'Hand_R',
    'Thigh_L', 'Shin_L', 'Foot_L',
    'Thigh_R', 'Shin_R', 'Foot_R',
}


def component_sizes(mesh):
    edges = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        edges[a].append(b)
        edges[b].append(a)
    unseen = set(range(len(mesh.vertices)))
    sizes = []
    while unseen:
        seed = unseen.pop()
        queue = deque((seed,))
        count = 0
        while queue:
            item = queue.popleft()
            count += 1
            for adjacent in edges[item]:
                if adjacent in unseen:
                    unseen.remove(adjacent)
                    queue.append(adjacent)
        sizes.append(count)
    return sorted(sizes, reverse=True)


def validate_connected(name):
    obj = bpy.data.objects[name]
    mesh = obj.data
    sizes = component_sizes(mesh)
    assert sizes == [len(mesh.vertices)], f'{name}: disconnected mesh {sizes}'
    edge_uses = [0] * len(mesh.edges)
    lookup = {tuple(sorted(edge.vertices)): edge.index for edge in mesh.edges}
    for face in mesh.polygons:
        vertices = list(face.vertices)
        for i, a in enumerate(vertices):
            b = vertices[(i + 1) % len(vertices)]
            edge_uses[lookup[tuple(sorted((a, b)))]] += 1
    bad_edges = [([tuple(round(c, 4) for c in mesh.vertices[v].co)
                   for v in mesh.edges[index].vertices], count)
                 for index, count in enumerate(edge_uses) if count != 2]
    assert not bad_edges, f'{name}: {len(bad_edges)} nonmanifold edges {bad_edges[:4]}'
    print(name, 'vertices', len(mesh.vertices), 'faces', len(mesh.polygons),
          'components', sizes, 'manifold edges', len(edge_uses))


SECTION_BONES = {
    f'{prefix}_{side}': f'{bone}_{side}'
    for side in ('L', 'R')
    for prefix, bone in (('UpperSleeve', 'UpperArm'),
                         ('ForeSleeve', 'Forearm'), ('Glove', 'Hand'),
                         ('ThighSuit', 'Thigh'), ('ShinSuit', 'Shin'))
}
for name in ('WorkerBody', 'Helmet', 'CanvasHarness', 'Backpack', 'Boot_L', 'Boot_R',
             *SECTION_BONES.keys(),
             'ToolGrip_L', 'ToolGrip_R', 'CarryGrip_L', 'CarryGrip_R'):
    validate_connected(name)

arm = bpy.data.objects['WorkerArmature']
body = bpy.data.objects['WorkerBody']
assert set(arm.data.bones.keys()) == EXPECTED_BONES
assert body.parent == arm
assert any(mod.type == 'ARMATURE' and mod.object == arm for mod in body.modifiers)
assert body.data.uv_layers.get('PaletteUV') is not None
assert [round(float(body.data.uv_layers['PaletteUV'].data[face.loop_start].uv.x), 4)
        for face in body.data.polygons if face.loop_total]  # UVs exist

group_names = {group.index: group.name for group in body.vertex_groups}
for vertex in body.data.vertices:
    weights = [(group_names[g.group], g.weight) for g in vertex.groups]
    assert weights, f'unweighted body vertex {vertex.index}'
    assert math.isclose(sum(weight for _, weight in weights), 1,
                        abs_tol=2e-3), f'unnormalized body vertex {vertex.index}'
    side = 'L' if vertex.co.x < -.06 else 'R' if vertex.co.x > .06 else None
    if side and vertex.co.z < -.55 and abs(vertex.co.x) < .27:
        other = 'R' if side == 'L' else 'L'
        assert all(not (name.endswith('_' + other) and weight > 1e-4)
                   for name, weight in weights), f'leg cross-weight {vertex.index}'
    if side and abs(vertex.co.x) > .32 and vertex.co.z > -.52:
        other = 'R' if side == 'L' else 'L'
        assert all(not (name.endswith('_' + other) and weight > 1e-4)
                   for name, weight in weights), f'arm cross-weight {vertex.index}'

for name, bone in (('Helmet', 'Head'), ('CanvasHarness', 'Chest'),
                   ('Backpack', 'Chest'),
                   ('Boot_L', 'Foot_L'), ('Boot_R', 'Foot_R'),
                   *SECTION_BONES.items()):
    obj = bpy.data.objects[name]
    assert obj.parent == arm and obj.parent_bone == bone

for name in ('ToolGrip_L', 'ToolGrip_R', 'CarryGrip_L', 'CarryGrip_R'):
    obj = bpy.data.objects[name]
    assert obj.data.color_attributes.get('COLOR_0')
    assert len(obj.data.polygons) > 700

# Evaluate a raised/bent-limb pose and check finite deformed coordinates.
for name, angle in (('UpperArm_L', .45), ('UpperArm_R', -.45),
                    ('Forearm_L', .62), ('Forearm_R', -.62),
                    ('Thigh_L', .35), ('Thigh_R', -.35),
                    ('Shin_L', -.48), ('Shin_R', -.48)):
    pose = arm.pose.bones[name]
    pose.rotation_mode = 'XYZ'
    pose.rotation_euler[0] = angle
bpy.context.view_layer.update()
evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
assert len(evaluated.vertices) == len(body.data.vertices)
assert all(math.isfinite(c) for vertex in evaluated.vertices for c in vertex.co)
body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()


def posed_bounds(name):
    evaluated_obj = bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated_obj.to_mesh()
    points = [evaluated_obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    evaluated_obj.to_mesh_clear()
    return [(min(point[axis] for point in points),
             max(point[axis] for point in points)) for axis in range(3)]


for side in ('L', 'R'):
    for a, b in (
        ('WorkerBody', f'UpperSleeve_{side}'),
        (f'UpperSleeve_{side}', f'ForeSleeve_{side}'),
        (f'ForeSleeve_{side}', f'Glove_{side}'),
        ('WorkerBody', f'ThighSuit_{side}'),
        (f'ThighSuit_{side}', f'ShinSuit_{side}'),
        (f'ShinSuit_{side}', f'Boot_{side}'),
    ):
        box_a, box_b = posed_bounds(a), posed_bounds(b)
        overlap = [min(box_a[axis][1], box_b[axis][1]) -
                   max(box_a[axis][0], box_b[axis][0]) for axis in range(3)]
        assert min(overlap) > .005, f'{a}/{b}: open bent-pose AABB gap {overlap}'
        print(a, b, 'bent-pose overlap', [round(x, 3) for x in overlap])

print('DETAILED VOXEL WORKER SOURCE: PASS; bones', len(arm.data.bones),
      'palette', len(body.data.uv_layers['PaletteUV'].data), 'weighted vertices',
      len(body.data.vertices))
