"""Build the versioned detailed-voxel worker and first-person grips.

Blender 5.2:
  blender --background --factory-startup --python-exit-code 1 --python tools/assets/build_detailed_voxel_worker.py

The character is authored as connected voxel volumes with shared surface
vertices, then skinned to the game's existing 17 named bones.  It is a new
candidate; the shipped connected worker and hand exports are untouched.
"""

import math
from collections import deque
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/source/worker-detailed-voxel-v1.blend'
WORKER_GLB = ROOT / 'public/models/worker-detailed-voxel-v1.glb'
HANDS_GLB = ROOT / 'public/models/worker-hands-detailed-voxel-v1.glb'
for folder in (SOURCE.parent, WORKER_GLB.parent):
    folder.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0


def blender_xyz(point):
    """The runtime is Y-up and faces +Z; Blender is Z-up and faces -Y."""
    x, y, z = point
    return (x, -z, y)


def material(name, rgb, vertex_color=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .86
    shader.inputs['Metallic'].default_value = 0
    if vertex_color:
        color = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        color.layer_name = 'COLOR_0'
        mat.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
    return mat


COLORS = {
    'suit': (.76, .50, .13),
    'suitDark': (.49, .30, .10),
    'skin': (.87, .58, .35),
    'gloves': (.36, .18, .075),
    'boots': (.13, .075, .035),
    'hat': (.83, .20, .105),
    'pack': (.31, .39, .21),
    'canvas': (.18, .265, .115),
    'eyes': (.065, .045, .035),
}
MATS = {name: material(name, rgb) for name, rgb in COLORS.items()}
HAND_MAT = material('ViewGloves', (1, 1, 1), vertex_color=True)

# The four-pixel UV texture and its order are the existing co-op suit contract.
BODY_ROLES = ('suit', 'suitDark', 'skin', 'gloves')
palette_image = bpy.data.images.new('WorkerPalette', width=4, height=1, alpha=True)
palette_image.pixels = [channel for name in BODY_ROLES
                        for channel in (*COLORS[name], 1)]
palette_image.pack()
body_mat = material('WorkerBodyPalette', (1, 1, 1))
tex = body_mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = palette_image
tex.interpolation = 'Closest'
body_mat.node_tree.links.new(tex.outputs['Color'],
                             body_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])


# Unit cube corners on each outward face.  Shared corner vertices make an
# actual welded skin instead of a collection of cube meshes.
FACES = (
    ((1, 0, 0), ((1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1))),
    ((-1, 0, 0), ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1))),
    ((0, 1, 0), ((-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1))),
    ((0, -1, 0), ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1))),
    ((0, 0, 1), ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))),
    ((0, 0, -1), ((1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1))),
)


class Volume:
    def __init__(self, cell, origin=(0, 0, 0)):
        self.cell = cell
        self.origin = origin
        self.cells = {}

    def point(self, key):
        return tuple(self.origin[i] + key[i] * self.cell for i in range(3))

    def keys_in_box(self, lo, hi):
        lower = [math.floor((lo[i] - self.origin[i]) / self.cell) - 1 for i in range(3)]
        upper = [math.ceil((hi[i] - self.origin[i]) / self.cell) + 1 for i in range(3)]
        for ix in range(lower[0], upper[0] + 1):
            for iy in range(lower[1], upper[1] + 1):
                for iz in range(lower[2], upper[2] + 1):
                    point = self.point((ix, iy, iz))
                    if all(lo[j] <= point[j] <= hi[j] for j in range(3)):
                        yield (ix, iy, iz), point

    def box(self, lo, hi, role):
        for key, _ in self.keys_in_box(lo, hi):
            self.cells[key] = role

    def ellipsoid(self, center, radius, role):
        lo = tuple(center[i] - radius[i] for i in range(3))
        hi = tuple(center[i] + radius[i] for i in range(3))
        for key, point in self.keys_in_box(lo, hi):
            if sum(((point[i] - center[i]) / radius[i]) ** 2 for i in range(3)) <= 1:
                self.cells[key] = role

    def capsule(self, a, b, radius, role):
        lo = tuple(min(a[i], b[i]) - radius[i] for i in range(3))
        hi = tuple(max(a[i], b[i]) + radius[i] for i in range(3))
        ab = Vector(b) - Vector(a)
        for key, point in self.keys_in_box(lo, hi):
            t = max(0, min(1, (Vector(point) - Vector(a)).dot(ab) / ab.length_squared))
            closest = Vector(a) + t * ab
            if sum(((point[i] - closest[i]) / radius[i]) ** 2 for i in range(3)) <= 1:
                self.cells[key] = role

    def components(self):
        unseen = set(self.cells)
        sizes = []
        while unseen:
            seed = unseen.pop()
            queue = deque((seed,))
            size = 0
            while queue:
                key = queue.popleft()
                size += 1
                for offset, _ in FACES:
                    adjacent = tuple(key[i] + offset[i] for i in range(3))
                    if adjacent in unseen:
                        unseen.remove(adjacent)
                        queue.append(adjacent)
            sizes.append(size)
        return sorted(sizes, reverse=True)

    def mesh(self, name, roles, face_override=None, colors=None):
        assert len(self.components()) == 1, f'{name}: detached voxel islands {self.components()}'
        vertices, polygons, face_roles = [], [], []
        vertex_lookup = {}
        for key in sorted(self.cells):
            x, y, z = key
            for offset, corners in FACES:
                adjacent = tuple(key[i] + offset[i] for i in range(3))
                if adjacent in self.cells:
                    continue
                role = self.cells[key]
                if face_override:
                    role = face_override(key, offset, role)
                corners_out = []
                for cx, cy, cz in corners:
                    corner = (2 * x + cx, 2 * y + cy, 2 * z + cz)
                    if corner not in vertex_lookup:
                        coords = tuple(self.origin[i] + corner[i] * self.cell / 2
                                       for i in range(3))
                        vertex_lookup[corner] = len(vertices)
                        vertices.append(blender_xyz(coords))
                    corners_out.append(vertex_lookup[corner])
                polygons.append(corners_out)
                face_roles.append(role)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], polygons)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        for role in roles:
            mesh.materials.append(MATS[role] if role != 'ViewGloves' else HAND_MAT)
        if roles == BODY_ROLES:
            uv = mesh.uv_layers.new(name='PaletteUV')
            for polygon, role in zip(mesh.polygons, face_roles):
                palette_x = (BODY_ROLES.index(role) + .5) / len(BODY_ROLES)
                for loop_id in polygon.loop_indices:
                    uv.data[loop_id].uv = (palette_x, .5)
        elif roles == ('ViewGloves',):
            pass  # one vertex-color material; face_roles select COLOR_0 values
        else:
            for polygon, role in zip(mesh.polygons, face_roles):
                polygon.material_index = roles.index(role)
        if colors:
            attribute = mesh.color_attributes.new(name='COLOR_0',
                                                  type='FLOAT_COLOR', domain='CORNER')
            for polygon, role in zip(mesh.polygons, face_roles):
                rgba = colors[role]
                for loop_id in polygon.loop_indices:
                    attribute.data[loop_id].color = (*rgba, 1)
        return obj


CELL = .043  # 43-44 visual units through the finished 1.89-m silhouette.
BODY = Volume(CELL, origin=(0, -1.078, 0))

# Fitted torso and head.  The changing widths and shallow collar break the
# straight box silhouette while keeping this entire core one welded surface.
# The limb segments below are purpose-built rigid articulations, with
# overlapping voxel sockets at each anatomical joint.
for ylo, yhi, width, depth in (
    (-.47, -.32, .205, .145),
    (-.32, -.16, .195, .145),
    (-.16, .08, .225, .160),
    (.08, .23, .260, .170),
    (.23, .31, .225, .152),
):
    BODY.box((-width, ylo, -depth), (width, yhi, depth), 'suit')
# The collar is part of the main shell, not a disconnected neck ornament.
BODY.box((-.18, .28, .105), (.18, .34, .162), 'suitDark')
BODY.box((-.18, .28, -.162), (.18, .34, -.105), 'suitDark')
BODY.box((-.18, .28, -.12), (-.09, .34, .12), 'suitDark')
BODY.box((.09, .28, -.12), (.18, .34, .12), 'suitDark')
BODY.box((-.085, .27, -.092), (.085, .38, .092), 'skin')
BODY.ellipsoid((0, .515, 0), (.205, .205, .170), 'skin')
BODY.box((-.145, .34, -.132), (.145, .48, .132), 'skin')

# A nose has actual depth; all face marks remain surface color, never separate
# floating eye cubes.
BODY.box((-.03, .445, .145), (.03, .505, .23), 'skin')


def body_face(key, direction, role):
    x, y, z = BODY.point(key)
    if role == 'skin' and direction[2] == 1 and z > .11:
        if .53 < y < .58 and .065 < abs(x) < .145:
            return 'suitDark'  # two-pixel eyes, visible at play distance
        if .625 < y < .655 and .04 < abs(x) < .145:
            return 'suitDark'  # short eyebrows below the hat brim
        if .39 < y < .44 and abs(x) < .065:
            return 'suitDark'  # small mouth
    if role == 'suit' and direction[2] == 1 and z > .12:
        if .16 < y < .26 and abs(x) < .065:
            return 'suitDark'  # jacket opening behind the fitted bib
        if -.35 < y < -.30 and abs(x) > .12:
            return 'suitDark'  # lower jacket hem
    if role == 'gloves' and y > -.39:
        return 'suitDark'  # tied cuff
    return role


body = BODY.mesh('WorkerBody', BODY_ROLES, face_override=body_face)
body.data.materials[0] = body_mat

# Each segment is an authored voxel shell rather than loose cube meshes.  The
# spherical cut ends overlap around fixed joint centers, so a bend leaves
# fitted contact and preserves the stepped surface instead of skin shearing.
PARTS = []
for side, sign in (('L', -1), ('R', 1)):
    upper = Volume(CELL, origin=BODY.origin)
    upper.capsule((sign * .285, .17, 0), (sign * .398, -.08, 0),
                  (.101, .105, .102), 'suit')
    upper.ellipsoid((sign * .30, .15, 0), (.122, .125, .116), 'suit')
    PARTS.append((upper.mesh(f'UpperSleeve_{side}', ('suit', 'suitDark'),
                             face_override=lambda key, direction, role:
                             'suitDark' if upper.point(key)[1] < -.065 or (
                                 direction[2] == 1 and upper.point(key)[2] > .07
                                 and .06 < upper.point(key)[1] < .19) else role),
                  f'UpperArm_{side}'))

    fore = Volume(CELL, origin=BODY.origin)
    fore.capsule((sign * .398, -.08, 0), (sign * .445, -.365, 0),
                 (.086, .092, .086), 'suit')
    fore.ellipsoid((sign * .4, -.08, 0), (.095, .102, .095), 'suit')
    PARTS.append((fore.mesh(f'ForeSleeve_{side}', ('suit', 'suitDark'),
                            face_override=lambda key, direction, role:
                            'suitDark' if fore.point(key)[1] < -.32 else role),
                  f'Forearm_{side}'))

    glove = Volume(CELL, origin=BODY.origin)
    glove.capsule((sign * .444, -.36, 0), (sign * .46, -.505, .016),
                  (.078, .080, .078), 'gloves')
    glove.ellipsoid((sign * .466, -.513, .02), (.08, .078, .078), 'gloves')
    glove.ellipsoid((sign * .52, -.45, .055), (.045, .045, .042), 'gloves')
    PARTS.append((glove.mesh(f'Glove_{side}', ('gloves',)), f'Hand_{side}'))

    thigh = Volume(CELL, origin=BODY.origin)
    thigh.capsule((sign * .15, -.455, 0), (sign * .157, -.725, 0),
                  (.105, .114, .105), 'suit')
    thigh.ellipsoid((sign * .15, -.47, 0), (.108, .113, .108), 'suit')
    PARTS.append((thigh.mesh(f'ThighSuit_{side}', ('suit', 'suitDark'),
                             face_override=lambda key, direction, role:
                             'suitDark' if thigh.point(key)[1] < -.71 else role),
                  f'Thigh_{side}'))

    shin = Volume(CELL, origin=BODY.origin)
    shin.capsule((sign * .157, -.72, 0), (sign * .158, -.995, -.002),
                 (.092, .10, .092), 'suit')
    shin.ellipsoid((sign * .157, -.72, 0), (.098, .103, .098), 'suit')
    PARTS.append((shin.mesh(f'ShinSuit_{side}', ('suit', 'suitDark'),
                            face_override=lambda key, direction, role:
                            'suitDark' if shin.point(key)[1] < -.91 or (
                                direction[2] == 1 and shin.point(key)[2] > .06
                                and -.81 < shin.point(key)[1] < -.72) else role),
                  f'Shin_{side}'))

# The fitted accessories each remain a single optimized surface and follow
# their parent bone.  They overlap the underlying skin/clothes at real seams.
HAT = Volume(CELL, origin=BODY.origin)
HAT.box((-.17, .675, -.14), (.17, .765, .14), 'hat')
HAT.box((-.21, .635, -.175), (.21, .69, .175), 'hat')
HAT.box((-.255, .61, .125), (.255, .66, .245), 'hat')
HAT.box((-.215, .61, .235), (.215, .645, .31), 'hat')
hat = HAT.mesh('Helmet', ('hat', 'boots'),
               face_override=lambda key, direction, role:
               'boots' if .665 < HAT.point(key)[1] < .71 and
               (direction[2] == 1 or direction[0] != 0) else role)

# One fitted canvas shell gives the worker a clear expedition outfit at the
# normal co-op camera.  Its bib, shoulder straps, belt and pocket are all one
# connected voxel surface; the suit underneath stays skinned and team-tinted.
HARNESS = Volume(CELL, origin=BODY.origin)
HARNESS.box((-.225, -.29, -.205), (.225, -.215, .205), 'canvas')
HARNESS.box((-.15, -.245, .14), (.15, .155, .205), 'canvas')
for sign in (-1, 1):
    xlo, xhi = sorted((sign * .105, sign * .185))
    HARNESS.box((xlo, .10, .125), (xhi, .285, .205), 'canvas')
    HARNESS.box((xlo, -.23, -.205), (xhi, .285, -.125), 'canvas')
    HARNESS.box((xlo, .24, -.16), (xhi, .295, .16), 'canvas')
HARNESS.box((-.095, -.09, .19), (.095, .035, .245), 'canvas')


def harness_face(key, direction, role):
    x, y, z = HARNESS.point(key)
    if direction[2] == 1 and z > .18:
        if -.005 < y < .055 and abs(x) < .105:
            return 'suitDark'  # pocket flap
        if -.275 < y < -.22 and abs(x) < .045:
            return 'boots'  # dark belt clasp
    return role


harness = HARNESS.mesh('CanvasHarness', ('canvas', 'suitDark', 'boots'),
                       face_override=harness_face)

PACK = Volume(CELL, origin=BODY.origin)
PACK.box((-.168, -.225, -.345), (.168, .21, -.145), 'pack')
PACK.box((-.135, .21, -.315), (.135, .28, -.18), 'pack')
PACK.box((-.21, -.16, -.31), (.21, .075, -.19), 'pack')
PACK.box((-.11, -.29, -.32), (.11, -.22, -.18), 'pack')
PACK.box((-.235, -.105, -.31), (-.16, .06, -.19), 'pack')
PACK.box((.16, -.105, -.31), (.235, .06, -.19), 'pack')
pack = PACK.mesh('Backpack', ('pack', 'suitDark'),
                 face_override=lambda key, direction, role:
                 'suitDark' if direction[2] == -1 and (
                     .095 < PACK.point(key)[1] < .16 or
                     (abs(PACK.point(key)[0]) < .045 and PACK.point(key)[1] < -.12))
                 else role)


def boot_volume(sign, name):
    boot = Volume(CELL, origin=BODY.origin)
    center = sign * .158
    boot.box((center - .112, -1.10, -.11),
             (center + .112, -.945, .19), 'boots')
    boot.box((center - .105, -1.055, .17),
             (center + .105, -.98, .255), 'boots')
    boot.box((center - .095, -.975, -.105),
             (center + .095, -.88, .11), 'boots')
    assert boot.components() == [len(boot.cells)]
    return boot.mesh(name, ('boots', 'suitDark'),
                     face_override=lambda key, direction, role:
                     'suitDark' if boot.point(key)[1] < -1.045 else role)


boots = [boot_volume(-1, 'Boot_L'), boot_volume(1, 'Boot_R')]


# Rest anchors retain the exact game skeleton dimensions and named hierarchy.
BONE_DEF = [
    ('Pelvis', (0, -.37), (0, -.13), None),
    ('Spine', (0, -.13), (0, .11), 'Pelvis'),
    ('Chest', (0, .11), (0, .30), 'Spine'),
    ('Neck', (0, .30), (0, .49), 'Chest'),
    ('Head', (0, .49), (0, .68), 'Neck'),
]
for side, sign in (('L', -1), ('R', 1)):
    BONE_DEF.extend((
        (f'UpperArm_{side}', (sign * .30, .15), (sign * .40, -.08), 'Chest'),
        (f'Forearm_{side}', (sign * .40, -.08), (sign * .44, -.36), f'UpperArm_{side}'),
        (f'Hand_{side}', (sign * .44, -.36), (sign * .45, -.52), f'Forearm_{side}'),
        (f'Thigh_{side}', (sign * .15, -.48), (sign * .16, -.72), 'Pelvis'),
        (f'Shin_{side}', (sign * .16, -.72), (sign * .16, -.98), f'Thigh_{side}'),
        (f'Foot_{side}', (sign * .16, -.98), (sign * .16, -1.08), f'Shin_{side}'),
    ))
arm_data = bpy.data.armatures.new('WorkerSkeleton')
arm = bpy.data.objects.new('WorkerArmature', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONE_DEF:
    bone = arm_data.edit_bones.new(name)
    bone.head = blender_xyz((*head, 0))
    bone.tail = blender_xyz((*tail, 0))
    if parent:
        bone.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
arm.select_set(False)


def skin_weights(point):
    # The central shell bends only through pelvis, spine, neck and head;
    # articulated sleeve/leg shells rotate rigidly at their own joints.
    candidates = []
    for name, a, b, _ in BONE_DEF:
        if name not in ('Pelvis', 'Spine', 'Chest', 'Neck', 'Head'):
            continue
        start = Vector(blender_xyz((*a, 0)))
        end = Vector(blender_xyz((*b, 0)))
        span = end - start
        t = max(0, min(1, (point - start).dot(span) / span.length_squared))
        distance = (point - (start + t * span)).length
        candidates.append((name, math.exp(-((distance / .15) ** 2))))
    candidates.sort(key=lambda entry: entry[1], reverse=True)
    chosen = [(name, weight) for name, weight in candidates[:4] if weight > 1e-8]
    if not chosen:
        return {'Pelvis': 1}
    total = sum(weight for _, weight in chosen)
    return {name: weight / total for name, weight in chosen}


groups = {name: body.vertex_groups.new(name=name) for name, *_ in BONE_DEF}
for vertex in body.data.vertices:
    weights = skin_weights(vertex.co)
    for name, weight in weights.items():
        if weight > 1e-7:
            groups[name].add([vertex.index], weight, 'REPLACE')
body.parent = arm
deformer = body.modifiers.new('Voxel body deformation', 'ARMATURE')
deformer.object = arm


def bone_parent(obj, name):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = name
    obj.matrix_world = world


bone_parent(hat, 'Head')
bone_parent(harness, 'Chest')
bone_parent(pack, 'Chest')
for obj, side in zip(boots, ('L', 'R')):
    bone_parent(obj, f'Foot_{side}')
for obj, bone in PARTS:
    bone_parent(obj, bone)


# Grips are authored in their own local coordinates, at the original viewmodel
# scale.  Each glove includes the wrist and visible sleeve as one voxel volume.
HAND_CELL = .009
HAND_COLORS = {
    # Vertex attributes are linear RGB in glTF; brighter values washed the
    # imported grips into a single pale tan under the game's sunlight.
    'leather': (.14, .055, .018),
    'leatherLight': (.23, .10, .035),
    'cuff': (.075, .035, .015),
    'sleeve': (.54, .255, .05),
}


def hand(side, carry):
    hand_volume = Volume(HAND_CELL)
    sign = -1 if side == 'L' else 1
    if carry:
        hand_volume.box((-.053, -.035, -.028), (.053, .054, .045), 'leather')
        hand_volume.box((-.050, -.105, -.029), (.050, -.025, .027), 'cuff')
        hand_volume.box((-.058, -.195, -.043), (.058, -.095, .036), 'sleeve')
        for i, fx in enumerate((-.038, -.013, .013, .038)):
            reach = .073 - abs(i - 1.5) * .006
            hand_volume.capsule((fx, .034, .020), (fx, reach, .047),
                                (.011, .012, .012), 'leather')
        hand_volume.capsule((sign * .046, .002, .015),
                            (sign * .065, .046, .035),
                            (.016, .014, .016), 'leather')
        name = f'CarryGrip_{side}'
    else:
        hand_volume.box((-.049, -.029, -.027), (.049, .030, .065), 'leather')
        hand_volume.box((-.046, -.065, .055), (.046, .027, .126), 'cuff')
        hand_volume.box((-.056, -.155, .112), (.056, -.055, .173), 'sleeve')
        for i, fx in enumerate((-.036, -.012, .012, .036)):
            reach = -.073 + abs(i - 1.5) * .005
            hand_volume.capsule((fx, .003, -.020), (fx, .007, reach),
                                (.011, .011, .011), 'leather')
        hand_volume.capsule((sign * .043, -.007, .020),
                            (sign * .065, .010, -.025),
                            (.017, .016, .014), 'leather')
        name = f'ToolGrip_{side}'

    def face_role(key, direction, role):
        x, y, z = hand_volume.point(key)
        if role == 'leather' and direction[1] == 1 and abs(x) < .038:
            if (carry and -.015 < y < .03) or (not carry and -.005 < z < .035):
                return 'leatherLight'  # broad knuckle facets
        return role

    obj = hand_volume.mesh(name, ('ViewGloves',), face_override=face_role,
                           colors=HAND_COLORS)
    return obj


hands = [hand(side, carry) for carry in (False, True) for side in ('L', 'R')]

# Source is saved before selecting only export objects, so all editable
# volumes, armature, weights and material assignments remain inspectable.
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


export([arm, body, hat, harness, pack, *boots,
        *(obj for obj, _ in PARTS)], WORKER_GLB)
export(hands, HANDS_GLB)
print('DETAIL GRID', round(1.89 / CELL), 'central body cells', len(BODY.cells),
      'body faces', len(body.data.polygons), 'articulated sections', len(PARTS), 'hand faces',
      [len(obj.data.polygons) for obj in hands])
