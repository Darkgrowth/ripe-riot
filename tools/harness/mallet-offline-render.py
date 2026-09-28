"""Render exported mallet triangles at the actual 52-degree game camera.

blender -b -P tools/harness/mallet-offline-render.py -- input.json output.png [width height]
The input comes from mallet-offline-preview.mjs; no browser or cursor capture.
"""
import bpy
import json
import math
import sys

args = sys.argv[sys.argv.index('--') + 1:]
source, target = args[:2]
with open(source, encoding='utf-8') as stream:
    parts = json.load(stream)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for part in parts:
    coords = part['vertices']
    vertices = [(coords[i], -coords[i+2], coords[i+1]) for i in range(0, len(coords), 3)]
    faces = [(i, i+1, i+2) for i in range(0, len(vertices), 3)]
    mesh = bpy.data.meshes.new(part['name'])
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    color = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    raw = part['colors']
    for loop in mesh.loops:
        i = loop.vertex_index * 3
        color.data[loop.index].color = (raw[i], raw[i+1], raw[i+2], 1)
    obj = bpy.data.objects.new(part['name'], mesh)
    bpy.context.collection.objects.link(obj)

camera_data = bpy.data.cameras.new('GameCamera')
camera = bpy.data.objects.new('GameCamera', camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera.location = (0, 0, 0)
camera.rotation_euler = (math.pi / 2, 0, 0)
camera_data.type = 'PERSP'
camera_data.sensor_fit = 'VERTICAL'
camera_data.angle_y = math.radians(52)
camera_data.clip_start = .01
camera_data.clip_end = 6

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = int(args[2]) if len(args) > 2 else 1280
scene.render.resolution_y = int(args[3]) if len(args) > 3 else 720
scene.render.resolution_percentage = 100
scene.display.shading.color_type = 'VERTEX'
scene.display.shading.light = 'STUDIO'
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'WORLD'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = target
bpy.ops.render.render(write_still=True)

for name, suffix in [('vm:hand:rightGrip', 'right'), ('vm:hand:leftGrip', 'left'),
                     ('vm:hand', 'tool')]:
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.hide_render = obj.name != name
    scene.render.filepath = target.replace('.png', f'-{suffix}.png')
    bpy.ops.render.render(write_still=True)
