"""Render review evidence from a .blend: hero (+ optional clay pass and extra cameras).

Run:  blender -b scene.blend -P render_evidence.py -- --out evidence/round_03
          [--cameras Cam_ref,Cam_close1] [--width 960] [--samples 96] [--clay] [--clay-only] [--tag r03]
          [--hide-collections RECON_helpers]

- Resolution keeps the scene aspect; --width sets the output width (default 960 for review rounds).
- --clay renders a second image with every surface replaced by mid-grey diffuse (value/shadow check, Gate V).
  Pure-volume objects (haze boxes) are hidden in the clay pass; water/glass become opaque grey (expected).
- GPU: uses all visible OptiX (then CUDA) devices; set CUDA_VISIBLE_DEVICES to choose GPUs.
Outputs: <out>/<tag>_<camera>.png and <out>/<tag>_<camera>_clay.png
"""
import bpy
import os
import sys
import argparse

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--cameras", default="")
ap.add_argument("--width", type=int, default=960)
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--clay", action="store_true")
ap.add_argument("--clay-only", action="store_true")
ap.add_argument("--tag", default="render")
ap.add_argument("--hide-collections", default="RECON_helpers")
ap.add_argument("--cpu", action="store_true")
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
if not a.cpu:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == backend]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == backend
                sc.cycles.device = 'GPU'
                break
        except TypeError:
            continue
sc.cycles.samples = a.samples
sc.cycles.use_denoising = True
aspect = sc.render.resolution_y / sc.render.resolution_x
sc.render.resolution_x = a.width
sc.render.resolution_y = max(2, int(round(a.width * aspect / 2) * 2))
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'

for cname in [c.strip() for c in a.hide_collections.split(",") if c.strip()]:
    coll = bpy.data.collections.get(cname)
    if coll:
        coll.hide_render = True

cams = [bpy.data.objects[c] for c in a.cameras.split(",") if c] if a.cameras else [sc.camera]


def render(path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[render_evidence] {path}")


def is_pure_volume(mat):
    if not (mat and mat.use_nodes):
        return False
    for n in mat.node_tree.nodes:
        if n.bl_idname == 'ShaderNodeOutputMaterial':
            return n.inputs['Volume'].is_linked and not n.inputs['Surface'].is_linked
    return False


for cam in cams:
    sc.camera = cam
    if not a.clay_only:
        render(os.path.join(a.out, f"{a.tag}_{cam.name}.png"))
    if a.clay or a.clay_only:
        clay = bpy.data.materials.get("RECON_clay") or bpy.data.materials.new("RECON_clay")
        clay.use_nodes = True
        bsdf = clay.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (0.18, 0.18, 0.18, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
        vl = bpy.context.view_layer
        prev = vl.material_override
        vols = [o for o in sc.objects if any(is_pure_volume(s.material) for s in getattr(o, "material_slots", []))]
        state = [(o, o.hide_render) for o in vols]
        for o in vols:
            o.hide_render = True
        vl.material_override = clay
        render(os.path.join(a.out, f"{a.tag}_{cam.name}_clay.png"))
        vl.material_override = prev
        for o, h in state:
            o.hide_render = h
