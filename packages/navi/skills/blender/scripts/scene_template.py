"""Self-contained reconstruction scene (template). Copy to recon/<name>/scene.py and fill in components.

Rebuild:   blender -b --factory-startup -P scene.py -- --output scene.blend
Preview:   blender -b --factory-startup -P scene.py -- --output scene.blend --render evidence/r01.png --width 960 --samples 96
Final:     blender -b --factory-startup -P scene.py -- --output scene.blend --render final.png --quality final

Rules (keep them when editing):
- Use native Blender APIs and Python's standard library (numpy only if Blender's own Python has it;
  distro packages often do not). External model assets follow the task's
  asset policy. Optional authored texture maps belong in the project, resolve from the script location,
  and must be packed or supplied for a portable saved scene and reproducible rebuild.
- One build_<name>(P) per component, run in COMPONENTS order; presentation is last. A component creates its own
  objects/materials and never edits objects owned by another component (ownership is tagged automatically).
- Shared interfaces (ground height, footprints, attachment points) go into IFACE and are derived from built
  geometry/functions, never re-guessed by consumers.
- Deterministic: random.Random(P["seed"]). SI units, Z up. Same geometry in draft and final quality.
"""
import bpy
import bmesh
import math
import random
import sys
import argparse
from mathutils import Vector, Matrix, Euler, noise

# ---------------------------------------------------------------------------
# Parameters (paste camera.json values into "shot"; keep tunables per component)
# ---------------------------------------------------------------------------
PARAMS = {
    "reference_image": "",               # optional absolute path; attached as camera background only
    "resolution": [1920, 1080],          # reference aspect
    "shot": {                            # from camera_solve.py
        "lens_mm": 35.0, "sensor_width": 36.0, "sensor_fit": "HORIZONTAL",
        "location": [0.0, -10.0, 1.6], "rotation_euler": [math.radians(88), 0.0, 0.0],
        "shift_x": 0.0, "shift_y": 0.0,
        "dof": {"use": False, "focus_distance": 10.0, "fstop": 8.0},
    },
    "components": {
        "terrain": {"seed": 1, "extent": 40.0, "res": 0.25, "mound_height": 0.6},
        "subject": {"seed": 2},
        "presentation": {
            "sun_dir": [-0.6, 0.4, 0.69],   # unit vector toward the sun (from shadow analysis)
            "sun_strength": 4.5, "sun_angle_deg": 0.6, "sun_color": [1.0, 0.92, 0.8],
            "sky_strength": 0.8, "air": 1.0, "dust": 1.0, "ozone": 1.0,
            "exposure": 0.0, "look": "AgX - Medium High Contrast",
            "haze_density": 0.0,
        },
    },
}
COMPONENTS = ["terrain", "subject", "presentation"]
IFACE = {}  # shared interface data produced by earlier components


# ---------------------------------------------------------------------------
# Small helpers (component-private helpers should be prefixed with the component name)
# ---------------------------------------------------------------------------
def mesh_from_arrays(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if smooth:
        me.shade_smooth()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]


# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------
def build_terrain(P):
    """Heightfield ground. Publishes IFACE['ground_z'](x, y) as the single source of truth."""
    rng = random.Random(P["seed"])
    off = Vector((rng.uniform(0, 100), rng.uniform(0, 100), 0))

    def ground_z(x, y):
        return P["mound_height"] * noise.fractal(Vector((x * 0.08, y * 0.08, 0)) + off, 0.5, 2.0, 4)

    n = int(P["extent"] * 2 / P["res"]) + 1
    xs = [-P["extent"] + 2 * P["extent"] * i / (n - 1) for i in range(n)]
    verts = [(x, y, ground_z(x, y)) for y in xs for x in xs]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i) for j in range(n - 1) for i in range(n - 1)]
    m, nodes, links, bsdf = new_material("terrain_ground")
    bsdf.inputs["Base Color"].default_value = (0.06, 0.08, 0.03, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    mesh_from_arrays("terrain_ground", verts, faces, m)
    IFACE["ground_z"] = ground_z


def build_subject(P):
    """Example hero element placed on the terrain via the shared interface."""
    gz = IFACE["ground_z"]
    x, y = 0.0, 0.0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, gz(x, y) + 0.5))
    ob = bpy.context.active_object
    ob.name = "subject_block"
    m, nodes, links, bsdf = new_material("subject_mat")
    bsdf.inputs["Base Color"].default_value = (0.3, 0.3, 0.3, 1)
    ob.data.materials.append(m)


def build_presentation(P):
    """World sky aligned with the sun, sun lamp, optional haze, render and color management."""
    sc = bpy.context.scene
    s = Vector(P["sun_dir"]).normalized()
    world = bpy.data.worlds.new("recon_world")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    # Blender 5 renamed Nishita to Single Scattering; keep the same sky model.
    sky_types = sky.bl_rna.properties["sky_type"].enum_items.keys()
    sky.sky_type = 'NISHITA' if 'NISHITA' in sky_types else 'SINGLE_SCATTERING'
    sky.sun_disc = False
    sky.sun_elevation = math.asin(max(-1.0, min(1.0, s.z)))
    sky.sun_rotation = math.atan2(s.x, s.y)          # 0 = +Y, 90 deg = +X
    sky.air_density, sky.ozone_density = P["air"], P["ozone"]
    dust_property = "dust_density" if hasattr(sky, "dust_density") else "aerosol_density"
    setattr(sky, dust_property, P["dust"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = P["sky_strength"]
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    sun = bpy.data.objects.new("presentation_sun", bpy.data.lights.new("presentation_sun", 'SUN'))
    sun.data.energy = P["sun_strength"]
    sun.data.angle = math.radians(P["sun_angle_deg"])
    sun.data.color = P["sun_color"]
    sun.rotation_euler = s.to_track_quat('Z', 'Y').to_euler()
    sc.collection.objects.link(sun)
    if P["haze_density"] > 0:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 10))
        hz = bpy.context.active_object
        hz.name = "presentation_haze"
        hz.scale = (120, 120, 20)
        m = bpy.data.materials.new("presentation_haze")
        m.use_nodes = True
        m.node_tree.nodes.clear()
        vo = m.node_tree.nodes.new("ShaderNodeVolumePrincipled")
        vo.inputs["Density"].default_value = P["haze_density"]
        vo.inputs["Anisotropy"].default_value = 0.3
        mo = m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(vo.outputs[0], mo.inputs["Volume"])
        hz.data.materials.append(m)
        hz.visible_shadow = False
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = P["look"]
    except TypeError:
        pass
    sc.view_settings.exposure = P["exposure"]


# ---------------------------------------------------------------------------
# Orchestration (rarely needs editing)
# ---------------------------------------------------------------------------
def setup_camera(shot, res, ref):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = bpy.data.objects.new("Cam_ref", bpy.data.cameras.new("Cam_ref"))
    sc.collection.objects.link(cam)
    cd = cam.data
    cd.lens = shot["lens_mm"]
    cd.sensor_width = shot.get("sensor_width", 36.0)
    cd.sensor_fit = shot.get("sensor_fit", "HORIZONTAL")
    cd.shift_x, cd.shift_y = shot.get("shift_x", 0.0), shot.get("shift_y", 0.0)
    cd.clip_start, cd.clip_end = 0.05, 2000.0
    cam.location = shot["location"]
    cam.rotation_euler = shot["rotation_euler"]
    dof = shot.get("dof", {})
    cd.dof.use_dof = dof.get("use", False)
    cd.dof.focus_distance = dof.get("focus_distance", 10.0)
    cd.dof.aperture_fstop = dof.get("fstop", 8.0)
    if ref:
        try:
            img = bpy.data.images.load(ref, check_existing=True)
            cd.show_background_images = True
            bg = cd.background_images.new()
            bg.image, bg.alpha, bg.display_depth = img, 0.5, 'FRONT'
        except RuntimeError:
            print(f"[scene] reference image not found: {ref}")
    sc.camera = cam
    return cam


def setup_render(quality, samples, width):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            if any(d.type == backend for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == backend
                sc.cycles.device = 'GPU'
                break
        except TypeError:
            continue
    final = quality == "final"
    sc.cycles.samples = samples or (1024 if final else 96)
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01 if final else 0.03
    sc.cycles.use_denoising = True
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.render.use_persistent_data = True
    sc["recon_quality"] = quality
    if width:
        aspect = sc.render.resolution_y / sc.render.resolution_x
        sc.render.resolution_x = width
        sc.render.resolution_y = max(2, int(round(width * aspect / 2) * 2))


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    setup_camera(PARAMS["shot"], PARAMS["resolution"], PARAMS.get("reference_image"))
    assert COMPONENTS[-1] == "presentation", "presentation must be the last component"
    for name in COMPONENTS:
        before = set(bpy.data.objects)
        globals()["build_" + name](PARAMS["components"].get(name, {}))
        for ob in set(bpy.data.objects) - before:
            ob["recon_component"] = name
        print(f"[scene] built {name}: {len(set(bpy.data.objects) - before)} objects")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--output")
    ap.add_argument("--render")
    ap.add_argument("--quality", default="draft", choices=["draft", "final"])
    ap.add_argument("--samples", type=int, default=0)
    ap.add_argument("--width", type=int, default=0)
    a = ap.parse_args(argv)
    build_all()
    setup_render(a.quality, a.samples, a.width)
    if a.output:
        bpy.ops.wm.save_as_mainfile(filepath=a.output)
    if a.render:
        bpy.context.scene.render.filepath = a.render
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
