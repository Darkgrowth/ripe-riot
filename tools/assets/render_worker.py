"""Render the exported GLB for close-range art inspection; run in Blender."""
import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/evidence/connected-worker/source-review'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/worker.glb'))

world = bpy.context.scene.world
world.color = (0.32, 0.4, 0.55)
for name, point, energy, size in [
    ('key', (3, -4, 5), 900, 4),
    ('fill', (-4, 2, 3), 550, 3),
]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy = energy
    light.shape = 'DISK'
    light.size = size
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = point
    obj.rotation_euler = (Vector((0, 0, -.15)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

camera_data = bpy.data.cameras.new('review camera')
camera = bpy.data.objects.new('review camera', camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.15
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 840
scene.render.resolution_y = 840
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'

for label, pos in [('front', (0, -4, -.14)), ('side', (4, 0, -.14)),
                   ('rear', (0, 4, -.14)), ('three-quarter', (3, -4, -.14))]:
    camera.location = pos
    camera.rotation_euler = (Vector((0, 0, -.14)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / f'{label}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)

# Bend both elbows and knees on the imported skeleton to expose skinning at
# authored junction loops, independent of the later game pose adapter.
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for name, radians in [('Forearm_L', .55), ('Forearm_R', -.55),
                      ('Shin_L', .38), ('Shin_R', -.38)]:
    bone = arm.pose.bones[name]
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler[0] = radians
bpy.context.view_layer.update()
camera.location = (3, -4, -.14)
camera.rotation_euler = (Vector((0, 0, -.14)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(OUT / 'bent.png')
bpy.ops.render.render(write_still=True)
print('RENDERED', scene.render.filepath)

bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type in ('MESH', 'ARMATURE', 'EMPTY'):
        obj.select_set(True)
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/worker-hands.glb'))
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    obj.location.x = (-.15 if obj.name.endswith('_L') else .15)
    obj.location.z = (.09 if obj.name.startswith('Tool') else -.09)
camera.location = (0, -.8, 0)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.ortho_scale = .65
scene.render.filepath = str(OUT / 'gloves.png')
bpy.ops.render.render(write_still=True)
print('RENDERED', scene.render.filepath)
