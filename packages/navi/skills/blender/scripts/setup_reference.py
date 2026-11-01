"""Create/update the reference camera from camera.json and verify it against the reference image.

Run:  blender -b [existing.blend] -P setup_reference.py -- --image reference.png --camera camera.json
          [--name Cam_ref] [--grid 1.0] [--grid-size 60] [--proxies proxies.json]
          [--overlay-out evidence/camera_check.png] [--save scene.blend]

- Sets render resolution to the reference size, adds the camera (lens, sensor fit, rotation, location, shift)
  and attaches the reference as a viewport background image (alpha 0.5).
- --grid N      adds a renderable ground grid (lines every N metres on z=0) for Gate C checks.
- --proxies     JSON list of {"name", "type": "box"|"cylinder", "center": [x,y,z], "size": [sx,sy,sz], "rotz": deg}
                (z of center = base height; boxes sit on it) to test scale anchors.
- --overlay-out renders grid+proxies with a transparent film and composites them over the reference
                image, so the camera match can be inspected without the UI.
"""
import bpy
import sys
import json
import math
import argparse

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--image", required=True)
ap.add_argument("--camera", required=True)
ap.add_argument("--name", default="Cam_ref")
ap.add_argument("--grid", type=float, default=0.0)
ap.add_argument("--grid-size", type=float, default=60.0)
ap.add_argument("--proxies")
ap.add_argument("--overlay-out")
ap.add_argument("--save")
ap.add_argument("--samples", type=int, default=16)
a = ap.parse_args(argv)

scene = bpy.context.scene
cam_cfg = json.load(open(a.camera))
img = bpy.data.images.load(a.image, check_existing=True)
W, H = img.size
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100

# --- camera
cam = bpy.data.objects.get(a.name)
if cam is None:
    cam = bpy.data.objects.new(a.name, bpy.data.cameras.new(a.name))
    scene.collection.objects.link(cam)
cd = cam.data
cd.sensor_fit = cam_cfg.get("sensor_fit", "HORIZONTAL")
cd.sensor_width = cam_cfg.get("sensor_width", 36.0)
cd.lens = cam_cfg["lens_mm"]
cd.shift_x = cam_cfg.get("shift_x", 0.0)
cd.shift_y = cam_cfg.get("shift_y", 0.0)
cd.clip_start, cd.clip_end = 0.05, 2000.0
cam.location = cam_cfg["location"]
cam.rotation_mode = 'XYZ'
cam.rotation_euler = cam_cfg["rotation_euler"]
scene.camera = cam
cd.show_background_images = True
cd.background_images.clear()
bg = cd.background_images.new()
bg.image = img
bg.alpha = 0.5
bg.display_depth = 'FRONT'
bg.frame_method = 'FIT'
print(f"[setup_reference] {W}x{H}, lens {cd.lens:.2f} mm, rot {[round(math.degrees(v), 2) for v in cam.rotation_euler]}, "
      f"loc {tuple(round(v, 3) for v in cam.location)}")

helpers = bpy.data.collections.get("RECON_helpers") or bpy.data.collections.new("RECON_helpers")
if helpers.name not in scene.collection.children:
    scene.collection.children.link(helpers)


def emission_mat(name, color, strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


# --- ground grid: thin emissive strips (renderable)
if a.grid > 0:
    old = bpy.data.objects.get("RECON_grid")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    half = a.grid_size / 2
    w = a.grid * 0.012
    verts, faces = [], []
    n = int(a.grid_size / a.grid)
    for i in range(n + 1):
        c = -half + i * a.grid
        for (x0, y0, x1, y1) in ((c - w, -half, c + w, half), (-half, c - w, half, c + w)):
            k = len(verts)
            verts += [(x0, y0, 0.002), (x1, y0, 0.002), (x1, y1, 0.002), (x0, y1, 0.002)]
            faces.append((k, k + 1, k + 2, k + 3))
    me = bpy.data.meshes.new("RECON_grid")
    me.from_pydata(verts, [], faces)
    g = bpy.data.objects.new("RECON_grid", me)
    helpers.objects.link(g)
    me.materials.append(emission_mat("RECON_grid_mat", (0.0, 1.0, 0.9), 3.0))
    # axis markers: X red, Y green at origin
    for name, col, (sx, sy) in (("RECON_axis_x", (1, 0.1, 0.1), (2.0, 0.05)), ("RECON_axis_y", (0.1, 1, 0.1), (0.05, 2.0))):
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx / 2 if sx > 1 else 0, sy / 2 if sy > 1 else 0, 0.01))
        o = bpy.context.active_object
        o.name = name
        o.scale = (sx, sy, 0.02)
        for c in o.users_collection:
            c.objects.unlink(o)
        helpers.objects.link(o)
        o.data.materials.append(emission_mat(name + "_mat", col, 4.0))

# --- proxies
if a.proxies:
    pm = emission_mat("RECON_proxy_mat", (1.0, 0.45, 0.0), 1.5)
    for p in json.load(open(a.proxies)):
        name = "RECON_proxy_" + p["name"]
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
        sx, sy, sz = p["size"]
        cx, cy, cz = p["center"]
        if p.get("type", "box") == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=1, location=(cx, cy, cz + sz / 2))
        else:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, cz + sz / 2))
        o = bpy.context.active_object
        o.name = name
        o.scale = (sx, sy, sz)
        o.rotation_euler.z = math.radians(p.get("rotz", 0.0))
        for c in o.users_collection:
            c.objects.unlink(o)
        helpers.objects.link(o)
        o.data.materials.append(pm)
        # wireframe look so the photo stays visible underneath
        wf = o.modifiers.new("wire", 'WIREFRAME')
        wf.thickness = max(0.01, min(sx, sy, sz) * 0.04)

# --- overlay render: helpers only, composited over the reference
if a.overlay_out:
    others = [o for o in scene.objects if o.users_collection and helpers not in o.users_collection
              and o.type not in ('CAMERA',)]
    hidden = [(o, o.hide_render) for o in others]
    for o, _ in hidden:
        o.hide_render = True
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = a.samples
    scene.cycles.use_denoising = False
    scene.render.film_transparent = True
    vs = scene.view_settings
    saved_cm = (vs.view_transform, vs.look, vs.exposure, vs.gamma)
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure, vs.gamma = 0.0, 1.0
    # Blender 5 uses a compositor group; keep the same Alpha Over composition.
    compositor_group = hasattr(scene, "compositing_node_group")
    if compositor_group:
        saved_compositor = scene.compositing_node_group
        nt = bpy.data.node_groups.new("RECON_overlay", "CompositorNodeTree")
        nt.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = nt
    else:
        scene.use_nodes = True
        nt = scene.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    im = nt.nodes.new("CompositorNodeImage")
    im.image = img
    ao = nt.nodes.new("CompositorNodeAlphaOver")
    comp = nt.nodes.new("NodeGroupOutput" if compositor_group else "CompositorNodeComposite")
    # Blender 5 names and reorders the Alpha Over inputs.
    background = ao.inputs["Background"] if "Background" in ao.inputs else ao.inputs[1]
    foreground = ao.inputs["Foreground"] if "Foreground" in ao.inputs else ao.inputs[2]
    nt.links.new(im.outputs["Image"], background)
    nt.links.new(rl.outputs["Image"], foreground)
    nt.links.new(ao.outputs["Image"], comp.inputs["Image"])
    scene.render.filepath = a.overlay_out
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    for o, h in hidden:
        o.hide_render = h
    if compositor_group:
        scene.compositing_node_group = saved_compositor
        bpy.data.node_groups.remove(nt)
    else:
        scene.use_nodes = False
    scene.render.film_transparent = False
    vs.view_transform = saved_cm[0]
    try:
        vs.look = saved_cm[1]
    except TypeError:
        pass
    vs.exposure, vs.gamma = saved_cm[2], saved_cm[3]
    print(f"[setup_reference] overlay written to {a.overlay_out}")

if a.save:
    bpy.ops.wm.save_as_mainfile(filepath=a.save)
    print(f"[setup_reference] saved {a.save}")
