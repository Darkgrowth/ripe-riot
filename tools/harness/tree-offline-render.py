"""Render actual exported voxel tree triangles at close and game-view distances.

blender -b -P tools/harness/tree-offline-render.py -- input.json output-directory
This runs Blender in the background and never opens a browser or captures a cursor.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

source, target = sys.argv[sys.argv.index('--') + 1:]
os.makedirs(target, exist_ok=True)
with open(source, encoding='utf-8') as stream:
    samples = json.load(stream)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.color_type = 'VERTEX'
scene.display.shading.light = 'STUDIO'
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'WORLD'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world.color = (0.72, 0.82, 0.90)

camera_data = bpy.data.cameras.new('GameView')
camera = bpy.data.objects.new('GameView', camera_data)
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'PERSP'
camera_data.sensor_fit = 'VERTICAL'
camera_data.angle_y = math.radians(52)
camera_data.clip_start = 0.05
camera_data.clip_end = 100

def look(eye, target):
    camera.location = eye
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

def make_tree(sample, offset):
    raw = sample['vertices']
    vertices = [(raw[i] + offset, -raw[i + 2], raw[i + 1]) for i in range(0, len(raw), 3)]
    faces = [(i, i + 1, i + 2) for i in range(0, len(vertices), 3)]
    label = f"{sample['type']}:{sample['variant']}"
    mesh = bpy.data.meshes.new(label)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    color = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    raw_color = sample['colors']
    for loop in mesh.loops:
        i = loop.vertex_index * 3
        color.data[loop.index].color = (raw_color[i], raw_color[i + 1], raw_color[i + 2], 1)
    obj = bpy.data.objects.new(label, mesh)
    bpy.context.collection.objects.link(obj)
    # Fruit markers show the unchanged attachment sites, scaled as ordinary fruit.
    fruit_color = (0.92, 0.24, 0.12, 1) if sample['type'] == 'appleTree' else \
        (1, 0.55, 0.10, 1) if sample['type'] == 'orangeTree' else (0.48, 0.33, 0.21, 1)
    for index, point in enumerate(sample['fruit']):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4,
            radius=0.16 if sample['type'] != 'palm' else 0.13,
            location=(point[0] + offset, -point[2], point[1]))
        marker = bpy.context.object
        marker.name = f'{label}:fruit:{index}'
        marker_color = marker.data.color_attributes.new(
            name='FruitColor', type='FLOAT_COLOR', domain='CORNER')
        for loop in marker.data.loops:
            marker_color.data[loop.index].color = fruit_color
    return obj

def render(name, eye, target, visible):
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.hide_render = not any(obj.name.startswith(prefix) for prefix in visible)
    look(eye, target)
    scene.render.filepath = os.path.abspath(os.path.join(source_target, name))
    bpy.ops.render.render(write_still=True)

source_target = target
offsets = [-5.6, -1.7, 2.2, 6.2, 10.2, 14.1, 17.0]
for sample, offset in zip(samples, offsets):
    make_tree(sample, offset)

render('orchard-game-distance.png', (-1.7, -11.5, 1.7), (-1.7, 0, 2.4),
       ['appleTree:', 'orangeTree:'])
render('orchard-close.png', (-5.6, -5.0, 1.7), (-5.6, 0, 2.1), ['appleTree:0'])
render('palm-game-distance.png', (8.2, -14.0, 1.7), (8.2, 0, 3.0), ['palm:'])
render('palm-close.png', (6.2, -6.0, 1.7), (6.2, 0, 2.8), ['palm:0'])
render('shrubs-game-distance.png', (15.6, -6.5, 1.7), (15.6, 0, 0.9),
       ['gumTree:', 'spikeShrub:'])
render('shrubs-close.png', (15.6, -3.7, 1.7), (15.6, 0, 0.95),
       ['gumTree:', 'spikeShrub:'])
