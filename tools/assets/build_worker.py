"""Build the editable, connected RIPE RIOT worker and first-person gloves.

Run with Blender 5.2:
  blender --background --factory-startup --python-exit-code 1 --python tools/assets/build_worker.py
The low-poly body and each glove are single topological components. Accessories
are separate only where a real fitted seam belongs.
"""
import bpy
import bmesh
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/source/worker.blend'
MODELS = ROOT / 'public/models'
SOURCE.parent.mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0


def V(x, y, z=0):
    """Game (Y up, +Z forward) to Blender (Z up)."""
    return (x, -z, y)


palette = {
    'suit': (1.0, 0.70, 0.20, 1),
    'suitDark': (0.67, 0.43, 0.12, 1),
    'skin': (0.93, 0.68, 0.45, 1),
    'boots': (0.19, 0.12, 0.07, 1),
    'gloves': (0.56, 0.30, 0.12, 1),
    'hat': (0.91, 0.29, 0.17, 1),
    'pack': (0.36, 0.46, 0.29, 1),
    'eyes': (0.045, 0.037, 0.025, 1),
}
mats = {}
for name, rgba in palette.items():
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 0.78
    mats[name] = mat

hand_mat = bpy.data.materials.new('ViewGloves')
hand_mat.diffuse_color = (1, 1, 1, 1)
hand_mat.use_nodes = True
hand_bsdf = hand_mat.node_tree.nodes.get('Principled BSDF')
hand_color = hand_mat.node_tree.nodes.new('ShaderNodeVertexColor')
hand_color.layer_name = 'COLOR_0'
hand_mat.node_tree.links.new(hand_color.outputs['Color'], hand_bsdf.inputs['Base Color'])
hand_bsdf.inputs['Roughness'].default_value = .78


def graph_mesh(name, nodes, edges, subdiv=1):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([V(*n[0]) for n in nodes], edges, [])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    skin = obj.modifiers.new('Connected surface from anatomy graph', 'SKIN')
    for i, (_, radius) in enumerate(nodes):
        skin_vertex = mesh.skin_vertices[0].data[i]
        skin_vertex.radius = (radius[0], radius[1])
        skin_vertex.use_root = (i == 0)
    bpy.ops.object.modifier_apply(modifier=skin.name)
    if subdiv:
        smooth = obj.modifiers.new('Art-directed junction loops', 'SUBSURF')
        smooth.levels = subdiv
        smooth.render_levels = subdiv
        bpy.ops.object.modifier_apply(modifier=smooth.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for vert in list(bm.verts):
        if not vert.link_edges:
            bm.verts.remove(vert)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.select_set(False)
    return obj


# This edge graph branches within the body, not at hidden overlapping pieces.
# Skin creates manifold loops at shoulders/hips and Subsurf gives bend loops.
body_nodes = [
    ((0, -0.37, 0), (.19, .145)),       # 0 pelvis, root
    ((0, -0.13, 0), (.22, .155)),       # 1 waist
    ((0, 0.11, 0), (.255, .17)),        # 2 chest
    ((0, 0.30, 0), (.105, .105)),       # 3 neck
    ((0, 0.49, 0), (.20, .18)),         # 4 face
    ((0, 0.64, 0), (.19, .16)),         # 5 crown
    ((-.30, .15, 0), (.115, .115)),     # 6 left shoulder
    ((-.40, -.08, 0), (.092, .085)),    # 7 left elbow
    ((-.44, -.36, 0), (.080, .075)),    # 8 left wrist
    ((-.45, -.50, 0), (.085, .075)),    # 9 left hand
    ((.30, .15, 0), (.115, .115)),      # 10 right shoulder
    ((.40, -.08, 0), (.092, .085)),     # 11 right elbow
    ((.44, -.36, 0), (.080, .075)),     # 12 right wrist
    ((.45, -.50, 0), (.085, .075)),     # 13 right hand
    ((-.15, -.48, 0), (.12, .115)),     # 14 left hip
    ((-.16, -.72, 0), (.105, .10)),     # 15 left knee
    ((-.16, -.98, 0), (.09, .085)),     # 16 left ankle
    ((.15, -.48, 0), (.12, .115)),      # 17 right hip
    ((.16, -.72, 0), (.105, .10)),      # 18 right knee
    ((.16, -.98, 0), (.09, .085)),      # 19 right ankle
]
body_edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5),
              (2, 6), (6, 7), (7, 8), (8, 9),
              (2, 10), (10, 11), (11, 12), (12, 13),
              (0, 14), (14, 15), (15, 16),
              (0, 17), (17, 18), (18, 19)]
body = graph_mesh('WorkerBody', body_nodes, body_edges, subdiv=2)
swatches = [palette[r] for r in ('suit', 'suitDark', 'skin', 'gloves')]
image = bpy.data.images.new('WorkerPalette', width=4, height=1, alpha=True)
image.pixels = [channel for color in swatches for channel in color]
image.pack()
palette_mat = mats['suit']
nodes = palette_mat.node_tree.nodes
tex = nodes.new('ShaderNodeTexImage')
tex.image = image
tex.interpolation = 'Closest'
palette_mat.node_tree.links.new(tex.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
body.data.materials.append(palette_mat)
uv = body.data.uv_layers.new(name='PaletteUV')
for poly in body.data.polygons:
    center = poly.center
    x, y, z = center.x, center.z, -center.y
    if y > .36 and abs(x) < .27:
        role = 'skin'
    elif abs(x) > .33 and y < -.35:
        role = 'gloves'
    elif y < -.42:
        role = 'suitDark'
    else:
        role = 'suit'
    index = ['suit', 'suitDark', 'skin', 'gloves'].index(role)
    for loop_index in poly.loop_indices:
        uv.data[loop_index].uv = ((index + .5) / 4, .5)

# Edit bones use the body graph as their measured rest anchors.
bone_def = [
    ('Pelvis', (0, -.37), (0, -.13), None),
    ('Spine', (0, -.13), (0, .11), 'Pelvis'),
    ('Chest', (0, .11), (0, .30), 'Spine'),
    ('Neck', (0, .30), (0, .49), 'Chest'),
    ('Head', (0, .49), (0, .68), 'Neck'),
]
for side, sign in [('L', -1), ('R', 1)]:
    bone_def += [
        (f'UpperArm_{side}', (sign*.30, .15), (sign*.40, -.08), 'Chest'),
        (f'Forearm_{side}', (sign*.40, -.08), (sign*.44, -.36), f'UpperArm_{side}'),
        (f'Hand_{side}', (sign*.44, -.36), (sign*.45, -.52), f'Forearm_{side}'),
        (f'Thigh_{side}', (sign*.15, -.48), (sign*.16, -.72), 'Pelvis'),
        (f'Shin_{side}', (sign*.16, -.72), (sign*.16, -.98), f'Thigh_{side}'),
        (f'Foot_{side}', (sign*.16, -.98), (sign*.16, -1.08), f'Shin_{side}'),
    ]
arm_data = bpy.data.armatures.new('WorkerSkeleton')
arm = bpy.data.objects.new('WorkerArmature', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, a, b, parent in bone_def:
    eb = arm_data.edit_bones.new(name)
    eb.head = V(a[0], a[1])
    eb.tail = V(b[0], b[1])
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
arm.select_set(False)


def dist_segment(p, a, b):
    line = b - a
    u = max(0.0, min(1.0, (p - a).dot(line) / line.length_squared))
    return (p - (a + line*u)).length


for name, *_ in bone_def:
    body.vertex_groups.new(name=name)
for v in body.data.vertices:
    p = v.co
    x, y = p.x, p.z
    candidates = []
    for name, a, b, _ in bone_def:
        if 'Arm_' in name or 'Forearm_' in name or 'Hand_' in name:
            if abs(x) < .20 or (name.endswith('_L') and x > 0) or (name.endswith('_R') and x < 0):
                continue
        elif 'Thigh_' in name or 'Shin_' in name or 'Foot_' in name:
            if y > -.29 or (name.endswith('_L') and x > 0) or (name.endswith('_R') and x < 0):
                continue
        elif abs(x) > .34 and y < .24:
            continue
        distance = dist_segment(p, Vector(V(a[0], a[1])), Vector(V(b[0], b[1])))
        candidates.append((name, math.exp(-((distance / .17) ** 2))))
    candidates.sort(key=lambda item: item[1], reverse=True)
    chosen = [(n, w) for n, w in candidates[:4] if w > 1e-8]
    if not chosen:
        chosen = [('Pelvis', 1)]
    total = sum(w for _, w in chosen)
    for name, weight in chosen:
        body.vertex_groups[name].add([v.index], weight/total, 'REPLACE')
body.parent = arm
mod = body.modifiers.new('Deform with worker skeleton', 'ARMATURE')
mod.object = arm


def cube(name, role, location, scale, parent_bone=None, bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=V(*location))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = obj.modifiers.new('Fitted edge', 'BEVEL')
        b.width = bevel
        b.segments = 1
        bpy.ops.object.modifier_apply(modifier=b.name)
    obj.data.materials.append(mats[role])
    if parent_bone:
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.parent_type = 'BONE'
        obj.parent_bone = parent_bone
        obj.matrix_world = world
    return obj


helmet = cube('Helmet', 'hat', (0, .69, 0), (.44, .16, .39), 'Head', .045)
brim = cube('HelmetBrim', 'hat', (0, .63, .17), (.46, .05, .19), 'Head', .012)
pack = cube('Backpack', 'pack', (0, -.02, -.17), (.32, .40, .18), 'Chest', .045)
belt = cube('Belt', 'suitDark', (0, -.32, .012), (.43, .075, .31), 'Pelvis', .012)
nose = cube('Nose', 'skin', (0, .44, .19), (.075, .065, .08), 'Head', .015)
for sign, side in [(-1, 'L'), (1, 'R')]:
    cube(f'Boot_{side}', 'boots', (sign*.16, -.98, .07), (.22, .20, .32), f'Foot_{side}', .025)
    cube(f'Eye_{side}', 'eyes', (sign*.08, .50, .18), (.055, .045, .02), 'Head', .006)
    cube(f'Cuff_{side}', 'gloves', (sign*.44, -.38, 0), (.18, .065, .17), f'Hand_{side}', .012)


def glove(name, side, carry):
    sign = -1 if side == 'L' else 1
    if carry:
        # Cupped palm points up around fruit; fingers curve toward the player.
        nodes = [((0, -.095, -.005), (.034, .029)),
                 ((0, -.045, 0), (.046, .038)),
                 ((0, .005, 0), (.050, .035)),
                 ((0, .034, .012), (.045, .030))]
        edges = [(0, 1), (1, 2), (2, 3)]
        for i, fx in enumerate([-.033, -.011, .011, .033]):
            j = len(nodes)
            nodes += [((fx, .045, .027), (.010, .012)),
                      ((fx, .070 - abs(i-1.5)*.006, .044), (.009, .010))]
            edges += [(3, j), (j, j+1)]
        j = len(nodes)
        nodes += [((sign*.047, .003, .016), (.018, .018)),
                  ((sign*.056, .032, .035), (.013, .014))]
        edges += [(2, j), (j, j+1)]
        # One continuous wrist and sleeve, extending below the gameplay frame.
        j = len(nodes)
        nodes += [((0, -.145, -.005), (.037, .033)),
                  ((0, -.205, -.012), (.045, .039))]
        edges += [(0, j), (j, j+1)]
    else:
        nodes = [((0, 0, .145), (.032, .029)),
                 ((0, 0, .075), (.037, .032)),
                 ((0, 0, .018), (.045, .033)),
                 ((0, 0, -.018), (.042, .027))]
        edges = [(0, 1), (1, 2), (2, 3)]
        for i, fx in enumerate([-.030, -.010, .010, .030]):
            j = len(nodes)
            nodes += [((fx, .004, -.040), (.010, .012)),
                      ((fx, .006, -.068 + abs(i-1.5)*.005), (.008, .009))]
            edges += [(3, j), (j, j+1)]
        j = len(nodes)
        nodes += [((sign*.044, -.002, .010), (.018, .018)),
                  ((sign*.055, .008, -.020), (.012, .013))]
        edges += [(2, j), (j, j+1)]
        # Keep the tool's original near-plane envelope: the forearm slopes
        # down into the frame edge, rather than continuing toward the eye.
        j = len(nodes)
        nodes += [((0, -.08, .145), (.038, .033)),
                  ((0, -.15, .135), (.047, .040))]
        edges += [(0, j), (j, j+1)]
    obj = graph_mesh(name, nodes, edges, subdiv=1)
    # Skin's branch caps can remain separate islands around densely clustered
    # fingers. A fine voxel union makes palm, fingers, thumb and wrist truly one
    # volume before the editable source and GLB are saved.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    obj.data.remesh_voxel_size = .003
    bpy.ops.object.voxel_remesh()
    dec = obj.modifiers.new('Low-poly hand facets', 'DECIMATE')
    dec.ratio = min(1.0, 1250 / max(1, len(obj.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=dec.name)
    obj.select_set(False)
    obj.data.materials.append(hand_mat)
    # Named linear vertex colors are consumed by the current viewmodel merge.
    col = obj.data.color_attributes.new(name='COLOR_0', type='FLOAT_COLOR', domain='CORNER')
    for loop in obj.data.loops:
        point = obj.data.vertices[loop.vertex_index].co
        along = -point.z  # negative game Y enters from the frame bottom
        if along > (.15 if carry else .105):
            rgba = (.76, .48, .13, 1)  # worker's ochre sleeve
        elif along > (.085 if carry else .065):
            rgba = (.65, .40, .15, 1)  # continuous fabric/leather cuff
        else:
            rgba = (.48, .22, .08, 1)  # palm and individual fingers
        col.data[loop.index].color = rgba
    return obj


hands = [glove(f'{pose}Grip_{side}', side, pose == 'Carry')
         for pose in ('Tool', 'Carry') for side in ('L', 'R')]

# Save the authored topology and rig before limiting export selection.
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))


def export(objects, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
        use_selection=True, export_yup=True, export_apply=False,
        export_normals=True, export_materials='EXPORT')
    print('EXPORTED', path, path.stat().st_size)


export([arm, body, helmet, brim, pack, belt, nose]
       + [bpy.data.objects[f'{n}_{s}'] for s in ('L', 'R')
          for n in ('Boot', 'Eye', 'Cuff')], MODELS / 'worker.glb')
export(hands, MODELS / 'worker-hands.glb')
