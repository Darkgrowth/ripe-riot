"""Render versioned GLBs for front, side, rear, bend and glove inspection."""

from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/evidence/detailed-voxel-worker/source-review'
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/worker-detailed-voxel-v1.glb'))

world = bpy.context.scene.world
world.color = (.35, .45, .52)
for name, position, power, size in (
    ('Key', (3, -4, 5), 900, 4),
    ('Fill', (-4, 2, 4), 650, 4),
):
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy = power
    light_data.shape = 'DISK'
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (Vector((0, 0, -.15)) - light.location).to_track_quat('-Z', 'Y').to_euler()

camera_data = bpy.data.cameras.new('ReviewCamera')
camera = bpy.data.objects.new('ReviewCamera', camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.2
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 960
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'


def render(name, position, aim=(0, 0, -.15)):
    camera.location = position
    camera.rotation_euler = (Vector(aim) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)


for name, position in (
    ('front', (0, -4, -.13)),
    ('side', (4, 0, -.13)),
    ('rear', (0, 4, -.13)),
    ('three-quarter', (3, -4, -.13)),
):
    render(name, position)

# Match the existing remote-worker capture's approximate 450 px character
# height on a 1920x1080 view.  This is an isolated scale check; the lead will
# capture the actual game camera after integration.
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
camera_data.ortho_scale = 4.5
render('game-scale-front', (0, -4, -.13))
scene.render.resolution_x = 960
scene.render.resolution_y = 960
camera_data.ortho_scale = 2.2

arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
for name, angle in (
    ('UpperArm_L', .45), ('UpperArm_R', -.45),
    ('Forearm_L', .62), ('Forearm_R', -.62),
    ('Thigh_L', .35), ('Thigh_R', -.35),
    ('Shin_L', -.48), ('Shin_R', -.48),
):
    bone = arm.pose.bones[name]
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler[0] = angle
bpy.context.view_layer.update()
render('bent-three-quarter', (3, -4, -.13))
render('bent-front', (0, -4, -.13))

bpy.ops.object.select_all(action='DESELECT')
for obj in tuple(bpy.data.objects):
    if obj.type in ('MESH', 'ARMATURE', 'EMPTY'):
        obj.select_set(True)
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/worker-hands-detailed-voxel-v1.glb'))
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    obj.location.x = -.17 if obj.name.endswith('_L') else .17
    obj.location.z = .11 if obj.name.startswith('Tool') else -.11
camera_data.ortho_scale = .68
render('first-person-grips', (0, -.8, 0), aim=(0, 0, 0))
render('grips-three-quarter', (.4, -.8, .25), aim=(0, 0, 0))
