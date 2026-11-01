"""Version-tolerant bpy helpers for building, lighting, animating and rendering scenes (Blender 3.6-5.x).

Import from your own build script (run with `blender -b --factory-startup -P build.py`):

    import sys; sys.path.insert(0, "<skill-dir>/scripts")
    import bpy_helpers as H

    H.reset_scene()
    body = H.add_cylinder("body", radius=0.04, depth=0.1, location=(0, 0, 0.05), bevel=0.003,
                          mat=H.material("ceramic", "#F2F0EB", roughness=0.15))
    cam = H.add_camera(lens=50)
    H.frame_objects(cam, [body], azimuth=35, elevation=20)
    H.studio_lighting(target=body)
    H.set_render(resolution=(1200, 800), samples=64)
    H.render_still("/tmp/out.png", background="#FFFFFF")
    H.save_blend("/tmp/scene.blend")

Conventions: metres, Z up, angles in degrees unless the name says radians. Hex colours ("#RRGGBB") are sRGB
and are converted to linear; tuples are taken as linear RGB(A). Everything uses the data API (no bpy.ops
except file I/O), so it works headless without a UI context.
"""
import atexit
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

BLENDER = bpy.app.version  # e.g. (4, 3, 2)


# ----------------------------------------------------------------------------- scene and colour basics

def reset_scene():
    """Empty the file (factory settings, no objects). Call first so the script is rebuildable."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def srgb_to_linear(c):
    c = float(c)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def color(value, alpha=1.0):
    """'#RRGGBB' (sRGB) or (r, g, b[, a]) linear -> linear RGBA tuple."""
    if isinstance(value, str):
        h = value.lstrip("#")
        rgb = [srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)]
        return (*rgb, alpha)
    v = tuple(float(x) for x in value)
    return v if len(v) == 4 else (*v[:3], alpha)


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def collection(name, parent=None):
    """Get or create a collection linked under parent (default: scene collection)."""
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in parent.children:
        parent.children.link(col)
    return col


# ----------------------------------------------------------------------------- materials

# Principled BSDF inputs were renamed in 4.0; each friendly key lists new name first, then old.
_PRINCIPLED = {
    "base_color": ["Base Color"],
    "metallic": ["Metallic"],
    "roughness": ["Roughness"],
    "ior": ["IOR"],
    "alpha": ["Alpha"],
    "normal": ["Normal"],
    "specular": ["Specular IOR Level", "Specular"],
    "transmission": ["Transmission Weight", "Transmission"],
    "subsurface": ["Subsurface Weight", "Subsurface"],
    "subsurface_radius": ["Subsurface Radius"],
    "coat": ["Coat Weight", "Clearcoat"],
    "coat_roughness": ["Coat Roughness", "Clearcoat Roughness"],
    "sheen": ["Sheen Weight", "Sheen"],
    "anisotropic": ["Anisotropic"],
    "emission": ["Emission Color", "Emission"],
    "emission_strength": ["Emission Strength"],
}


def principled_input(bsdf, key):
    """Return the Principled BSDF input socket for a friendly key, across Blender versions (or None)."""
    for name in _PRINCIPLED.get(key, [key]):
        sock = bsdf.inputs.get(name)
        if sock is not None:
            return sock
    return None


def set_principled(bsdf, **values):
    """set_principled(bsdf, base_color="#ff0000", roughness=0.3, transmission=1.0, emission="#fff", ...)"""
    for key, val in values.items():
        if val is None:
            continue
        sock = principled_input(bsdf, key)
        if sock is None:
            print(f"[bpy_helpers] Principled input {key!r} not in Blender {bpy.app.version_string}; skipped")
            continue
        if key in ("base_color", "emission", "subsurface_radius") or isinstance(val, str):
            v = color(val)
            sock.default_value = v[:len(sock.default_value)]
        else:
            sock.default_value = val
    if values.get("emission") is not None and values.get("emission_strength") is None:
        s = principled_input(bsdf, "emission_strength")
        if s is not None and s.default_value == 0.0:
            s.default_value = 1.0


def material(name, base_color="#cccccc", roughness=0.5, metallic=0.0, **principled):
    """Create (or replace) a Principled material. Extra keys go to set_principled (transmission, coat, ...)."""
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True  # always on (and deprecated) in 5.x
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    set_principled(bsdf, base_color=base_color, roughness=roughness, metallic=metallic, **principled)
    mat.diffuse_color = color(base_color)  # viewport/solid colour
    if principled.get("transmission") or (principled.get("alpha") is not None and principled["alpha"] < 1):
        if hasattr(mat, "blend_method"):
            try:
                mat.blend_method = "HASHED"  # EEVEE legacy; Cycles ignores it
            except TypeError:
                pass
    return mat


def emission_material(name, emit_color="#ffffff", strength=5.0):
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color(emit_color)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def add_noise_variation(mat, scale=8.0, amount=0.15, roughness_amount=0.1, bump=0.0, detail=6.0):
    """Break up a flat Principled colour with object-space noise (colour, roughness and optional bump)."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = principled_input(bsdf, "base_color")
    rough = principled_input(bsdf, "roughness")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    c0 = tuple(base.default_value)
    dark = tuple(max(0.0, x * (1 - amount)) for x in c0[:3]) + (1.0,)
    light = tuple(min(1.0, x * (1 + amount)) for x in c0[:3]) + (1.0,)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].color = light
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], base)
    if roughness_amount:
        r0 = rough.default_value
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = max(0.0, r0 - roughness_amount)
        mr.inputs["To Max"].default_value = min(1.0, r0 + roughness_amount)
        nt.links.new(noise.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], rough)
    if bump:
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        nt.links.new(noise.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], principled_input(bsdf, "normal"))
    return mat


_PRESETS = {
    # kind: (default colour, Principled settings, procedural pattern)
    "plastic": ("#d0d0d0", dict(roughness=0.4), None),
    "glossy_plastic": ("#d0d0d0", dict(roughness=0.15, coat=0.3), None),
    "rubber": ("#1a1a1a", dict(roughness=0.85), "fine"),
    "ceramic": ("#f2f0eb", dict(roughness=0.08, coat=0.6), None),
    "car_paint": ("#b3121b", dict(roughness=0.3, metallic=0.4, coat=1.0, coat_roughness=0.03), None),
    "chrome": ("#f0f0f0", dict(roughness=0.04, metallic=1.0), None),
    "steel": ("#b4b6b8", dict(roughness=0.3, metallic=1.0), None),
    "brushed_metal": ("#c0c2c4", dict(roughness=0.35, metallic=1.0, anisotropic=0.8), "brushed"),
    "aluminum": ("#d5d7da", dict(roughness=0.25, metallic=1.0), None),
    "gold": ("#e5b143", dict(roughness=0.18, metallic=1.0), None),
    "brass": ("#c9a24a", dict(roughness=0.25, metallic=1.0), None),
    "copper": ("#c87a4f", dict(roughness=0.25, metallic=1.0), None),
    "painted_metal": ("#3d6b9e", dict(roughness=0.35, metallic=0.0, coat=0.4), "fine"),
    "glass": ("#ffffff", dict(roughness=0.0, transmission=1.0, ior=1.45), None),
    "frosted_glass": ("#ffffff", dict(roughness=0.35, transmission=1.0, ior=1.45), None),
    "water": ("#e8f4f8", dict(roughness=0.02, transmission=1.0, ior=1.33), None),
    "wood": ("#a8743a", dict(roughness=0.45, coat=0.15), "wood"),
    "leather": ("#3b2416", dict(roughness=0.55, coat=0.1), "leather"),
    "fabric": ("#7a8a99", dict(roughness=0.9, sheen=0.6), "fabric"),
    "concrete": ("#9a9893", dict(roughness=0.9), "stone"),
    "stone": ("#8d8a83", dict(roughness=0.8), "stone"),
    "foliage": ("#3f6b2a", dict(roughness=0.6, subsurface=0.1), "fine"),
}


def material_preset(name, kind, base_color=None, scale=1.0, **overrides):
    """Physically sensible material by kind, with a procedural pattern where the material has one.
    kinds: plastic, glossy_plastic, rubber, ceramic, car_paint, chrome, steel, brushed_metal, aluminum,
    gold, brass, copper, painted_metal, glass, frosted_glass, water, wood, leather, fabric, concrete, stone,
    foliage. base_color tints it; scale sizes the pattern (1.0 = metre-scale objects; use ~10 for small
    props like a 10 cm box, so grain and pores stay fine); overrides go to set_principled."""
    col, props, pattern = _PRESETS[kind]
    props = {**props, **overrides}
    mat = material(name, base_color or col, **props)
    if pattern:
        _add_pattern(mat, pattern, scale)
    return mat


def _add_pattern(mat, pattern, scale):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = principled_input(bsdf, "base_color")
    c0 = tuple(base.default_value)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    nt.links.new(bump.outputs["Normal"], principled_input(bsdf, "normal"))

    def ramp(fac_socket, dark, light):
        r = nt.nodes.new("ShaderNodeValToRGB")
        r.color_ramp.elements[0].color = tuple(max(0.0, x * dark) for x in c0[:3]) + (1.0,)
        r.color_ramp.elements[1].color = tuple(min(1.0, x * light) for x in c0[:3]) + (1.0,)
        nt.links.new(fac_socket, r.inputs["Fac"])
        nt.links.new(r.outputs["Color"], base)

    if pattern == "wood":  # rings + streaks along local X (orient boards along X or rotate the mapping)
        mp.inputs["Scale"].default_value = (0.6 * scale, 6 * scale, 6 * scale)
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "RINGS"
        wave.inputs["Scale"].default_value = 2.0
        wave.inputs["Distortion"].default_value = 6.0
        wave.inputs["Detail"].default_value = 3.0
        nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
        ramp(wave.outputs["Fac"], 0.55, 1.15)
        nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.05
    elif pattern == "brushed":  # fine streaks along local X
        mp.inputs["Scale"].default_value = (2 * scale, 400 * scale, 400 * scale)
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = 8.0
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.08
    elif pattern == "leather":
        mp.inputs["Scale"].default_value = (60 * scale,) * 3
        v = nt.nodes.new("ShaderNodeTexVoronoi")
        nt.links.new(mp.outputs["Vector"], v.inputs["Vector"])
        nt.links.new(v.outputs["Distance"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.25
        ramp(v.outputs["Distance"], 0.8, 1.1)
    elif pattern == "fabric":
        mp.inputs["Scale"].default_value = (150 * scale,) * 3
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 1.0
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.2
        ramp(n.outputs["Fac"], 0.85, 1.1)
    elif pattern == "stone":
        mp.inputs["Scale"].default_value = (3 * scale,) * 3
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 2.0
        n.inputs["Detail"].default_value = 10.0
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.3
        ramp(n.outputs["Fac"], 0.7, 1.2)
    elif pattern == "fine":
        mp.inputs["Scale"].default_value = (40 * scale,) * 3
        n = nt.nodes.new("ShaderNodeTexNoise")
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.08
    return mat


def assign(obj, mat, slot=None):
    """Append (or set slot index) a material on obj; returns the slot index."""
    if obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
        mats = obj.data.materials
        if slot is not None and slot < len(mats):
            mats[slot] = mat
            return slot
        mats.append(mat)
        return len(mats) - 1
    return None


# ----------------------------------------------------------------------------- mesh construction

def _finish(name, mesh, location, rotation, mat, bevel, smooth, collection_=None, segments=3):
    obj = bpy.data.objects.new(name, mesh)
    link(obj, collection_)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    if mat is not None:
        assign(obj, mat)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
        if hasattr(mod, "harden_normals"):
            mod.harden_normals = False
    if smooth:
        shade_smooth(obj, angle=smooth if isinstance(smooth, (int, float)) and smooth is not True else 35)
    return obj


def mesh_from_bmesh(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def add_box(name, size=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), mat=None, bevel=0.0,
            smooth=False, collection=None):
    """Box with its centre at location; size is the full (x, y, z) extent."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, bevel, smooth or bool(bevel),
                   collection)


def add_cylinder(name, radius=0.5, depth=1.0, location=(0, 0, 0), rotation=(0, 0, 0), mat=None,
                 vertices=64, bevel=0.0, radius_top=None, cap=True, smooth=True, collection=None):
    """Cylinder (or cone/frustum with radius_top) along local Z, centred at location."""
    bm = bmesh.new()
    rt = radius if radius_top is None else radius_top
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=vertices, radius1=radius,
                          radius2=rt, depth=depth)
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, bevel, smooth, collection)


def add_cone(name, radius=0.5, depth=1.0, **kw):
    kw.setdefault("radius_top", 0.0)
    return add_cylinder(name, radius=radius, depth=depth, **kw)


def add_sphere(name, radius=0.5, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), mat=None,
               segments=64, rings=32, smooth=True, collection=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, 0, smooth, collection)


def add_torus(name, major=0.5, minor=0.1, location=(0, 0, 0), rotation=(0, 0, 0), mat=None,
              major_segments=64, minor_segments=24, smooth=True, collection=None):
    bm = bmesh.new()
    verts = []
    for i in range(major_segments):
        a = 2 * math.pi * i / major_segments
        ring = []
        for j in range(minor_segments):
            b = 2 * math.pi * j / minor_segments
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        verts.append(ring)
    for i in range(major_segments):
        for j in range(minor_segments):
            a, b = verts[i][j], verts[(i + 1) % major_segments][j]
            c, d = verts[(i + 1) % major_segments][(j + 1) % minor_segments], verts[i][(j + 1) % minor_segments]
            bm.faces.new((a, b, c, d))
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, 0, smooth, collection)


def add_plane(name, size=(1, 1), location=(0, 0, 0), rotation=(0, 0, 0), mat=None, collection=None):
    sx, sy = (size, size) if isinstance(size, (int, float)) else size
    bm = bmesh.new()
    v = [bm.verts.new((x * sx / 2, y * sy / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(v)
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, 0, False, collection)


def add_lathe(name, profile, segments=64, location=(0, 0, 0), rotation=(0, 0, 0), mat=None,
              thickness=0.0, smooth=True, close_ends=False, collection=None):
    """Revolve a profile [(radius, z), ...] (bottom to top) around local Z: cups, vases, bottles, bells,
    lamp shades, wheels, knobs. thickness>0 adds a Solidify shell (for open containers)."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-9:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segments),
                                    r * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    for lo, hi in zip(rings, rings[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        for i in range(segments):
            j = (i + 1) % segments
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[i], hi[j]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[j], hi[0]))
            else:
                bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if close_ends:
        for ring in (rings[0], rings[-1]):
            if len(ring) > 2:
                bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, 0, smooth, collection)
    if thickness:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = thickness
        mod.offset = -1.0
    return obj


def add_extrusion(name, outline, depth=0.1, location=(0, 0, 0), rotation=(0, 0, 0), mat=None, bevel=0.0,
                  collection=None):
    """Extrude a closed 2D polygon [(x, y), ...] (counter-clockwise, in local XY) by depth along +Z,
    centred on z=0: fins, wings, brackets, gears, letters, panels. Concave outlines are fine."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, -depth / 2)) for x, y in outline]
    top = [bm.verts.new((x, y, depth / 2)) for x, y in outline]
    n = len(outline)
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, mesh_from_bmesh(name, bm), location, rotation, mat, bevel, bool(bevel), collection)


def add_tube(name, points, radius=0.01, mat=None, closed=False, resolution=12, bevel_resolution=6,
             smooth_path=True, collection=None, taper=None):
    """Round tube swept along a 3D polyline (world coords): handles, pipes, cables, rails, frames, legs,
    spokes, ropes. smooth_path=True makes a smooth NURBS-like curve through the points; False keeps corners."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_resolution
    cu.use_fill_caps = not closed
    cu.resolution_u = resolution
    if smooth_path:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(points) - 1)
        for bp, p in zip(sp.bezier_points, points):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(points) - 1)
        for pt, p in zip(sp.points, points):
            pt.co = (*p, 1.0)
    sp.use_cyclic_u = closed
    if taper is not None:  # list of radius multipliers per point (BEZIER only)
        for bp, t in zip(sp.bezier_points, taper):
            bp.radius = t
    obj = bpy.data.objects.new(name, cu)
    link(obj, collection)
    if mat is not None:
        assign(obj, mat)
    return obj


def add_text(name, body, size=0.1, extrude=0.005, location=(0, 0, 0), rotation=(90, 0, 0), mat=None,
             align="CENTER", collection=None):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    obj = bpy.data.objects.new(name, cu)
    link(obj, collection)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    if mat is not None:
        assign(obj, mat)
    return obj


def radial_array(src, count, radius=0.0, name=None, center=(0, 0, 0), axis="Z", start_deg=0.0,
                 face_out=True, collection=None):
    """Repeat src `count` times evenly around `axis` through `center`: bolts on a flange, spokes, keys on a
    dial, chairs round a table, columns round a tower. Model src in its pose for angle 0; radius > 0 first
    pushes it that far out along the start direction (+Y for Z and X axes, +Z for the Y axis). With face_out
    each copy also turns with the circle; otherwise copies keep src's orientation. Returns all copies,
    src first (linked duplicates share its mesh)."""
    c = Vector(center)
    start = Vector((0, 0, 1)) if axis == "Y" else Vector((0, 1, 0))
    base = src.matrix_basis.copy()
    base.translation = base.translation + start * radius
    out = []
    for i in range(count):
        ang = math.radians(start_deg) + 2 * math.pi * i / count
        rot = Matrix.Rotation(ang, 4, axis)
        obj = src if i == 0 else instance(src, f"{name or src.name}_{i:02d}", collection=collection)
        if face_out:
            m = Matrix.Translation(c) @ rot @ Matrix.Translation(-c) @ base
        else:
            m = base.copy()
            m.translation = c + rot.to_3x3() @ (base.translation - c)
        obj.matrix_basis = m
        out.append(obj)
    return out


def add_wheel(name, radius=0.35, width=0.25, location=(0, 0, 0), rotation=(0, 0, 0), tire_mat=None,
              rim_mat=None, spokes=5, rim_ratio=0.62, tread=0, collection=None):
    """Tyre + rim + hub (+ spokes, + tread blocks) as one parented group whose axle is local X, so a vehicle
    facing -Y rolls along Y; place it at the axle centre (location z = radius on flat ground).
    spokes=0 makes a solid disc rim; tread>0 adds that many tread blocks around the tyre. Returns the empty
    that parents the parts (animate its X rotation to spin the wheel)."""
    tire_mat = tire_mat or material(f"{name}_tyre", "#151515", roughness=0.85)
    rim_mat = rim_mat or material(f"{name}_rim", "#c8cacc", roughness=0.25, metallic=1.0)
    root = bpy.data.objects.new(name, None)
    link(root, collection)
    r_in = radius * rim_ratio
    hw = width / 2
    # rounded tyre cross-section revolved around the axle
    prof = []
    for k in range(9):
        t = math.pi / 2 * k / 8
        prof.append((radius - (1 - math.cos(t)) * width * 0.18, -hw + width * 0.18 * (1 - math.sin(t))))
    prof = [(r_in, -hw * 0.92)] + prof + [(r, -z) for r, z in reversed(prof)] + [(r_in, hw * 0.92)]
    tyre = add_lathe(f"{name}_tyre", prof, segments=72, mat=tire_mat, close_ends=False, collection=collection)
    hub = add_cylinder(f"{name}_hub", radius * 0.14, width * 0.7, mat=rim_mat, vertices=24, collection=collection)
    if spokes:  # open rim ring, a dark recessed backing disc, and spokes from hub to ring
        z0, z1 = -width * 0.4, width * 0.4
        ring = [(r_in * 0.86, z0), (r_in, z0), (r_in, z1), (r_in * 0.86, z1), (r_in * 0.86, z0 + 1e-4)]
        rim = add_lathe(f"{name}_rim", ring, segments=72, mat=rim_mat, smooth=False, collection=collection)
        back = add_cylinder(f"{name}_rimback", r_in * 0.9, width * 0.05, location=(0, 0, -width * 0.1),
                            mat=material(f"{name}_dark", "#1c1d1f", roughness=0.5), vertices=48,
                            collection=collection)
        spoke = add_box(f"{name}_spoke", (radius * 0.08, r_in * 0.78, width * 0.1),
                        location=(0, r_in * 0.47, width * 0.2), mat=rim_mat, bevel=radius * 0.01,
                        collection=collection)
        parts = [tyre, rim, hub, back] + radial_array(spoke, spokes, 0.0, axis="Z", collection=collection)
    else:
        rim = add_cylinder(f"{name}_rim", r_in, width * 0.8, mat=rim_mat, vertices=48, collection=collection)
        parts = [tyre, rim, hub]
    if tread:
        block = add_box(f"{name}_tread", (radius * 0.12, radius * 0.06, width * 0.9),
                        location=(0, radius * 0.995, 0), mat=tire_mat, bevel=radius * 0.01,
                        collection=collection)
        parts += radial_array(block, tread, 0.0, axis="Z", face_out=True, collection=collection)
    for p in parts:  # parts were built around local Z; turn the axle to X
        p.matrix_basis = Matrix.Rotation(math.pi / 2, 4, "Y") @ p.matrix_basis
        p.parent = root
    root.location = location
    root.rotation_euler = [math.radians(a) for a in rotation]
    return root


def shade_smooth(obj, angle=35):
    """Smooth shading with sharp edges above `angle` degrees (auto smooth was removed in 4.1)."""
    me = obj.data
    if not hasattr(me, "polygons"):
        return obj
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    if hasattr(me, "set_sharp_from_angle"):  # 4.1+
        me.set_sharp_from_angle(angle=math.radians(angle))
    elif hasattr(me, "use_auto_smooth"):  # <= 4.0
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(angle)
    me.update()
    return obj


def add_modifier(obj, kind, **props):
    """add_modifier(obj, 'SUBSURF', levels=2, render_levels=2); 'ARRAY', 'MIRROR', 'SOLIDIFY', 'BOOLEAN', ..."""
    mod = obj.modifiers.new(kind.title(), kind)
    for k, v in props.items():
        setattr(mod, k, v)
    return mod


def boolean(target, cutter, operation="DIFFERENCE", hide_cutter=True):
    mod = target.modifiers.new(f"Bool_{cutter.name}", "BOOLEAN")
    mod.operation = operation
    mod.object = cutter
    if hasattr(mod, "solver"):
        mod.solver = "EXACT"
    if hide_cutter:
        cutter.hide_render = True
        cutter.hide_viewport = True
    return mod


def apply_modifiers(obj):
    """Bake all modifiers into the mesh (data API, no operator context needed)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def join(objects, name=None):
    """Merge mesh objects into the first one (data API). Materials are kept per face."""
    objects = [o for o in objects if o.type == "MESH"]
    if not objects:
        return None
    for o in objects:
        apply_modifiers(o)
    bpy.context.view_layer.update()  # matrix_world is stale for objects created this run
    base = objects[0]
    bm = bmesh.new()
    mats = []
    for o in objects:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(base.matrix_world.inverted() @ o.matrix_world)
        remap = []
        for m in o.data.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for f in tmp.faces:
            if remap:
                f.material_index = remap[min(f.material_index, len(remap) - 1)]
        me_tmp = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me_tmp)
        tmp.free()
        bm.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    me = bpy.data.meshes.new(name or base.name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    old = base.data
    base.data = me
    for o in objects[1:]:
        bpy.data.objects.remove(o)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    if name:
        base.name = name
    return base


def instance(src, name, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), collection=None):
    """Linked duplicate sharing src's mesh data (cheap repeats: wheels, bolts, trees, chairs)."""
    obj = bpy.data.objects.new(name, src.data)
    link(obj, collection)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    obj.scale = scale if not isinstance(scale, (int, float)) else (scale,) * 3
    for m in src.modifiers:  # modifiers live on the object, copy the common ones
        n = obj.modifiers.new(m.name, m.type)
        for p in ("width", "segments", "limit_method", "angle_limit", "levels", "render_levels",
                  "thickness", "offset"):
            if hasattr(m, p):
                try:
                    setattr(n, p, getattr(m, p))
                except AttributeError:
                    pass
    return obj


def collection_instance(col, name, location=(0, 0, 0), rotation=(0, 0, 0), scale=1.0, parent_col=None):
    """Instance a whole collection (multi-object asset) as one empty; hide the source collection from
    rendering with col.hide_render = True or exclude it from the view layer."""
    obj = bpy.data.objects.new(name, None)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = col
    link(obj, parent_col)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    obj.scale = (scale,) * 3 if isinstance(scale, (int, float)) else scale
    return obj


def parent(child, parent_obj, keep_transform=True):
    """keep_transform=True keeps the child where it is now in the world (assembling static parts).
    keep_transform=False treats the child's current location/rotation as an offset in the parent's space:
    use it to mount a camera, light or part on a rig that is animated or moves along a path; otherwise
    the rig's pose at parenting time is baked into matrix_parent_inverse."""
    bpy.context.view_layer.update()  # new objects have identity matrix_world until evaluated
    mw = child.matrix_world.copy()
    child.parent = parent_obj
    if keep_transform:
        child.matrix_parent_inverse = parent_obj.matrix_world.inverted()
        child.matrix_world = mw
    return child


# ----------------------------------------------------------------------------- measuring and placing

def bbox(objects):
    """World-space (min, max) Vectors of the evaluated geometry (modifiers included) of one or more objects."""
    if not isinstance(objects, (list, tuple, set)):
        objects = [objects]
    bpy.context.view_layer.update()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objects:
        if o.type == "EMPTY" and o.instance_type == "COLLECTION" and o.instance_collection:
            sub = [s for s in o.instance_collection.all_objects if s.type != "EMPTY"]
            if not sub:
                continue
            l2, h2 = bbox(sub)
            corners = [Vector((x, y, z)) for x in (l2.x, h2.x) for y in (l2.y, h2.y) for z in (l2.z, h2.z)]
            corners = [o.matrix_world @ c for c in corners]
        elif o.type in {"CAMERA", "LIGHT", "EMPTY"}:
            continue
        else:
            corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        for c in corners:
            lo = Vector(map(min, lo, c))
            hi = Vector(map(max, hi, c))
    return lo, hi


def dimensions(objects):
    lo, hi = bbox(objects)
    return hi - lo


def place_on(obj, z=0.0, xy=None):
    """Move obj so its lowest point rests on height z (optionally centre it at xy)."""
    lo, hi = bbox(obj)
    obj.location.z += z - lo.z
    if xy is not None:
        obj.location.x += xy[0] - (lo.x + hi.x) / 2
        obj.location.y += xy[1] - (lo.y + hi.y) / 2
    return obj


def ground_contacts(objects=None, ground_z=0.0, tol=0.002):
    """Report mesh objects whose lowest point floats above or sinks below ground_z by more than tol."""
    out = []
    for o in objects or [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.parent]:
        lo, _ = bbox(o)
        if abs(lo.z - ground_z) > tol:
            out.append((o.name, round(lo.z - ground_z, 4)))
    return out


# ----------------------------------------------------------------------------- camera

def look_at(obj, target, roll=0.0):
    t = Vector(target if not hasattr(target, "location") else target.location)
    d = t - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if roll:
        obj.rotation_euler.rotate_axis("Z", math.radians(roll))
    return obj


def add_camera(name="Camera", location=(4, -4, 3), target=(0, 0, 0), lens=50.0, make_active=True,
               sensor_width=36.0, clip_end=1000.0):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_width = sensor_width
    cam_data.sensor_fit = "AUTO"
    cam_data.clip_end = clip_end
    cam_data.clip_start = min(0.1, clip_end / 10000)
    cam = link(bpy.data.objects.new(name, cam_data))
    cam.location = location
    look_at(cam, target)
    if make_active:
        bpy.context.scene.camera = cam
    return cam


def frame_objects(cam, objects, azimuth=35.0, elevation=20.0, margin=1.12, target=None, roll=0.0):
    """Aim cam along a view direction and back it off until the objects' bounding box fills the frame.
    azimuth: 0 = camera in front of the subject (on -Y, looking toward +Y), 90 = camera on the right (+X),
    -90 = left, 180 = behind; 35 = front-right three-quarter view. elevation: degrees above the horizon.
    margin > 1 leaves space around the subject (1.05 tight, 1.2 loose). Works for any lens/aspect."""
    scene = bpy.context.scene
    lo, hi = bbox(objects)
    center = Vector(target) if target is not None else (lo + hi) / 2
    az, el = math.radians(azimuth), math.radians(elevation)
    view = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))  # center->cam
    cam.location = center + view
    look_at(cam, center, roll)
    bpy.context.view_layer.update()
    rot = cam.matrix_world.to_3x3()
    right, up, back = rot.col[0], rot.col[1], rot.col[2]
    rx, ry = scene.render.resolution_x * scene.render.pixel_aspect_x, \
        scene.render.resolution_y * scene.render.pixel_aspect_y
    d = cam.data
    if d.type == "ORTHO":
        corners = [Vector((x, y, z)) - center for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
        w = max(abs(c.dot(right)) for c in corners) * 2
        h = max(abs(c.dot(up)) for c in corners) * 2
        d.ortho_scale = max(w, h * rx / ry) * margin if rx >= ry else max(h, w * ry / rx) * margin
        cam.location = center + view.normalized() * (max(hi - lo) * 3 + 1)
        return cam
    fit = d.sensor_fit
    if fit == "AUTO":
        fit = "HORIZONTAL" if rx >= ry else "VERTICAL"
    sensor = d.sensor_width if fit == "HORIZONTAL" or d.sensor_fit == "AUTO" else d.sensor_height
    half = math.atan(sensor / (2 * d.lens))
    if fit == "HORIZONTAL":
        tx, ty = math.tan(half), math.tan(half) * ry / rx
    else:
        ty, tx = math.tan(half), math.tan(half) * rx / ry
    tx, ty = tx / margin, ty / margin
    dist = 0.0
    for x in (lo.x, hi.x):
        for y in (lo.y, hi.y):
            for z in (lo.z, hi.z):
                c = Vector((x, y, z)) - center
                depth = c.dot(back)  # toward camera is positive
                dist = max(dist, depth + abs(c.dot(right)) / tx, depth + abs(c.dot(up)) / ty)
    cam.location = center + back * dist
    d.clip_start = max(0.001, min(d.clip_start, dist / 100))
    d.clip_end = max(d.clip_end, dist * 10)
    return cam


# ----------------------------------------------------------------------------- lighting and world

def _world():
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    w = scene.world
    if hasattr(w, "use_nodes") and not w.use_nodes:
        w.use_nodes = True
    return w


def world_color(value="#ffffff", strength=1.0):
    w = _world()
    bg = w.node_tree.nodes.get("Background")
    if bg is None:
        w.node_tree.nodes.clear()
        bg = w.node_tree.nodes.new("ShaderNodeBackground")
        out = w.node_tree.nodes.new("ShaderNodeOutputWorld")
        w.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
    bg.inputs["Color"].default_value = color(value)
    bg.inputs["Strength"].default_value = strength
    return w


def add_light(kind="AREA", name=None, location=(0, 0, 3), target=(0, 0, 0), energy=500.0, size=1.0,
              light_color="#ffffff", spot_deg=45.0, shadow_soft=None):
    """kind: AREA | POINT | SPOT | SUN. Energy: W for AREA/POINT/SPOT, W/m^2 (irradiance) for SUN."""
    ld = bpy.data.lights.new(name or kind.title(), kind)
    ld.energy = energy
    ld.color = color(light_color)[:3]
    if kind == "AREA":
        ld.shape = "DISK" if size and isinstance(size, (int, float)) else "RECTANGLE"
        ld.size = size if isinstance(size, (int, float)) else size[0]
        if not isinstance(size, (int, float)):
            ld.size_y = size[1]
    elif kind == "SPOT":
        ld.spot_size = math.radians(spot_deg)
        ld.spot_blend = 0.3
    if kind in ("POINT", "SPOT") and shadow_soft is not None:
        ld.shadow_soft_size = shadow_soft
    if kind == "SUN" and shadow_soft is not None:
        ld.angle = math.radians(shadow_soft)
    obj = link(bpy.data.objects.new(name or kind.title(), ld))
    obj.location = location
    look_at(obj, target)
    return obj


def studio_lighting(target=None, key_azimuth=-40.0, key_elevation=45.0, intensity=1.0, contrast=0.6,
                    softness=0.5, warmth=0.0, floor=True, floor_color="#ffffff", shadow_catcher=True,
                    world="#bfc3c8", world_strength=None, side_shadows=False):
    """Product/studio lighting around the target bbox: key area light, opposite fill, rim from behind, a
    dim neutral world, and a floor under the subject. With shadow_catcher=True the floor only records
    shadows (render with render_still(background=...) to composite onto any colour); with False it is a
    visible matte floor.
    contrast 0..1: key-to-fill ratio and world fill (0.3 soft and airy, 0.6 default, 0.85 dramatic with
    deep shadow sides). softness 0..1: key size (0.2 crisp highlights and sharper shadows, 0.8 very soft).
    intensity scales everything (exposure). Energies scale with subject size, so a 5 cm ring and a 5 m car
    get the same exposure. key_azimuth uses frame_objects' convention (0 = from the front, negative =
    from the left side). Only the key casts shadows unless side_shadows=True: the low fill and the rim
    otherwise throw long extra shadows across the floor that product shots on white do not have."""
    objs = target if isinstance(target, (list, tuple)) else ([target] if target else
                                                             [o for o in bpy.context.scene.objects
                                                              if o.type in {"MESH", "CURVE"}])
    lo, hi = bbox(objs) if objs else (Vector((-0.5, -0.5, 0)), Vector((0.5, 0.5, 1)))
    c = (lo + hi) / 2
    r = max((hi - lo).length / 2, 0.01)
    dist = r * 4.0

    def at(az, el):
        a, e = math.radians(az), math.radians(el)
        return c + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist

    contrast = min(max(contrast, 0.0), 1.0)
    softness = min(max(softness, 0.0), 1.0)
    k = (dist ** 2) * intensity  # inverse-square: constant irradiance at the subject (~3 W/m^2 key)
    fill = 0.05 + 0.45 * (1.0 - contrast)
    warm = "#fff1e0" if warmth > 0 else "#ffffff"
    cool = "#e8f0ff" if warmth > 0 else "#ffffff"
    lights = [
        add_light("AREA", "Key", at(key_azimuth, key_elevation), c, energy=10 * k,
                  size=dist * (0.2 + 0.9 * softness), light_color=warm),
        add_light("AREA", "Fill", at(key_azimuth + 110, 15), c, energy=10 * k * fill, size=dist * 1.2,
                  light_color=cool),
        add_light("AREA", "Rim", at(key_azimuth + 200, 50), c, energy=6 * k * (0.6 + contrast),
                  size=dist * 0.4),
    ]
    if not side_shadows:
        for light in lights[1:]:
            _no_shadow(light)
    world_color(world, 0.05 + 0.35 * (1.0 - contrast) if world_strength is None else world_strength)
    fl = None
    if floor:
        fl = add_plane("Floor", size=r * 40, location=(c.x, c.y, lo.z),
                       mat=material("Floor", floor_color, roughness=0.6))
        if shadow_catcher:
            if hasattr(fl, "is_shadow_catcher"):
                fl.is_shadow_catcher = True
            else:  # very old versions
                fl.cycles.is_shadow_catcher = True
    return lights, fl


def _no_shadow(light):
    """Keep a light's illumination but stop it casting shadows (the property moved between versions)."""
    for owner, prop in ((getattr(light.data, "cycles", None), "cast_shadow"), (light.data, "use_shadow"),
                        (light, "visible_shadow")):
        if owner is not None and hasattr(owner, prop):
            setattr(owner, prop, False)


def sun_and_sky(elevation=35.0, azimuth=150.0, strength=0.5, sun_strength=3.0, sun_angle=0.6,
                air=1.0, dust=1.0, ozone=1.0):
    """Physical sky plus a matching sun lamp. azimuth: compass degrees the sun comes FROM, measured
    from +Y toward +X. Sky type falls back across versions (NISHITA -> SINGLE_SCATTERING -> PREETHAM)."""
    w = _world()
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    types = [i.identifier for i in sky.bl_rna.properties["sky_type"].enum_items]
    for t in ("NISHITA", "SINGLE_SCATTERING", "MULTIPLE_SCATTERING", "HOSEK_WILKIE", "PREETHAM"):
        if t in types:
            sky.sky_type = t
            break
    el, az = math.radians(elevation), math.radians(azimuth)
    if hasattr(sky, "sun_elevation"):
        sky.sun_elevation = el
        sky.sun_rotation = az
        if hasattr(sky, "sun_disc"):
            sky.sun_disc = False  # the lamp below casts the controllable shadow
        for prop, val in (("air_density", air), ("ozone_density", ozone)):
            if hasattr(sky, prop):
                setattr(sky, prop, val)
        for prop in ("dust_density", "aerosol_density"):
            if hasattr(sky, prop):
                setattr(sky, prop, dust)
    else:
        sky.sun_direction = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sun_dir = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    sun = add_light("SUN", "Sun", location=tuple(sun_dir * 10), target=(0, 0, 0), energy=sun_strength,
                    shadow_soft=sun_angle, light_color="#fff4e6" if elevation < 20 else "#ffffff")
    return sun


def hdri_world(path, strength=1.0, rotation_deg=0.0):
    w = _world()
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value[2] = math.radians(rotation_deg)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(path, check_existing=True)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


def volume_fog(density=0.001, color_="#ffffff", anisotropy=0.3, size=200.0, center=(0, 0, 0), height=None):
    """Bounded box of scattering medium for haze, fog and light shafts. Density is per metre and must shrink
    with scene scale: start near 0.1 / D, where D is the distance to the farthest thing that should stay
    readable (100 m room-to-street scale -> 0.001; 1 km landscape -> 0.0001), then tune by eye. Too dense
    turns the whole frame milky."""
    h = height or size / 4
    box = add_box("Fog", size=(size, size, h), location=(center[0], center[1], center[2] + h / 2))
    mat = bpy.data.materials.new("FogMat")
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Color"].default_value = color(color_)
    vol.inputs["Anisotropy"].default_value = anisotropy
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    assign(box, mat)
    if hasattr(box, "visible_shadow"):
        box.visible_shadow = False
    return box


# ----------------------------------------------------------------------------- render settings

def _try_set(holder, prop, candidates):
    """Assign the first accepted value. Dynamic enums (engine, view_transform, look) cannot be listed
    reliably through bl_rna in background mode, so try each candidate instead."""
    for cand in candidates:
        try:
            setattr(holder, prop, cand)
            return cand
        except TypeError:
            continue
    return getattr(holder, prop)


def engine_id(name="CYCLES"):
    """Set and return this build's identifier for 'CYCLES' / 'EEVEE' (BLENDER_EEVEE_NEXT only in
    4.2-4.5) / 'WORKBENCH'."""
    r = bpy.context.scene.render
    n = name.upper()
    if "EEVEE" in n:
        return _try_set(r, "engine", ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"])
    if "WORKBENCH" in n:
        return _try_set(r, "engine", ["BLENDER_WORKBENCH"])
    return _try_set(r, "engine", [n, "CYCLES"])


def set_render(engine="CYCLES", resolution=(1920, 1080), samples=64, percentage=100, denoise=True,
               view_transform="AgX", look=None, exposure=0.0, transparent=False, device="CPU",
               time_limit=0.0, motion_blur=False, file_format="PNG"):
    """One call for sane render settings. view_transform: 'AgX' (default, filmic highlight roll-off),
    'Standard' (colours exactly as authored; good for flat/stylised or white-background product looks),
    'Filmic' (pre-4.0). look e.g. 'AgX - Medium High Contrast' / 'AgX - Punchy' / 'None'."""
    scene = bpy.context.scene
    r = scene.render
    engine_id(engine)
    r.resolution_x, r.resolution_y = resolution
    r.resolution_percentage = percentage
    r.film_transparent = transparent
    r.use_motion_blur = motion_blur
    r.image_settings.file_format = file_format
    if file_format == "PNG":
        r.image_settings.color_mode = "RGBA" if transparent else "RGB"
    vs = scene.view_settings
    got = _try_set(vs, "view_transform", [view_transform, "AgX", "Filmic", "Standard"])
    if got != view_transform:
        print(f"[bpy_helpers] view transform {view_transform!r} unavailable; using {got!r}")
    if look and _try_set(vs, "look", [look, "None"]) != look:
        print(f"[bpy_helpers] look {look!r} unavailable; using {vs.look!r}")
    elif not look:
        _try_set(vs, "look", ["None"])
    vs.exposure = exposure
    if r.engine == "CYCLES":
        c = scene.cycles
        c.device = device
        c.samples = samples
        # At low sample counts adaptive sampling stops early on "converged" pixels and leaves visible grain,
        # which matters most when the build has no denoiser.
        c.use_adaptive_sampling = samples > 64
        c.adaptive_threshold = 0.02
        if hasattr(c, "time_limit"):
            c.time_limit = time_limit
        smooth = False
        if denoise and not has_denoiser():
            denoise = False
            if _compositor_in_use(scene):
                print("[bpy_helpers] this Blender build has no OpenImageDenoise; keeping the existing compositor "
                      "setup, so no guided smoothing (raise samples if the task allows)")
            else:
                smooth = _guided_smoothing(scene)
                print("[bpy_helpers] this Blender build has no OpenImageDenoise; "
                      + ("using an edge-aware compositor smoothing guided by albedo and normals instead"
                         if smooth else "denoising off (raise samples if the task allows)"))
        c.use_denoising = denoise
        if smooth:
            c.sample_clamp_indirect = 5.0  # fireflies survive bilateral smoothing
        if denoise and hasattr(c, "denoiser"):
            try:
                c.denoiser = "OPENIMAGEDENOISE"
            except TypeError:
                pass
        # Glass needs refraction depth: every pane or bottle wall is two transmission bounces and
        # max_bounces caps them all (8 visibly darkens stacked glass). transparent_max_bounces is for
        # alpha cut-outs only, not for glass.
        c.max_bounces = 12
        c.transmission_bounces = 12
        c.transparent_max_bounces = 16
        c.caustics_reflective = False
        c.caustics_refractive = False
        if device == "GPU":
            enable_gpu()
    elif "EEVEE" in r.engine:
        ee = scene.eevee
        for prop in ("taa_render_samples",):
            if hasattr(ee, prop):
                setattr(ee, prop, samples)
    return scene


def _compositor_in_use(scene):
    """True when the build script already made a compositor setup (glare, colour balance, ...) that the
    guided smoothing would replace."""
    try:
        nt = scene.node_tree if scene.use_nodes else None
        return nt is not None and any(n.bl_idname not in ("CompositorNodeRLayers", "CompositorNodeComposite")
                                      for n in nt.nodes)
    except AttributeError:
        return False


def _guided_smoothing(scene):
    """Stand-in for OpenImageDenoise: despeckle, then a bilateral blur whose edges come from the albedo and
    normal passes, so lighting noise is smoothed while texture, seams and silhouettes stay sharp. The alpha
    channel (shadow-catcher shadows on a transparent film) gets the same treatment. Returns False when the
    compositor API is not the 4.x one (it changed in 5.x)."""
    try:
        vl = scene.view_layers[0]
        vl.use_pass_normal = True
        vl.use_pass_diffuse_color = True
        scene.use_nodes = True
        nt = scene.node_tree
        nt.nodes.clear()
        rl = nt.nodes.new("CompositorNodeRLayers")
        comp = nt.nodes.new("CompositorNodeComposite")
        guide = nt.nodes.new("CompositorNodeMixRGB")
        guide.blend_type = "ADD"
        guide.inputs[0].default_value = 0.5
        nt.links.new(rl.outputs["DiffCol"], guide.inputs[1])
        nt.links.new(rl.outputs["Normal"], guide.inputs[2])
        speck = nt.nodes.new("CompositorNodeDespeckle")
        nt.links.new(rl.outputs["Image"], speck.inputs["Image"])
        img = nt.nodes.new("CompositorNodeBilateralblur")
        img.iterations, img.sigma_color, img.sigma_space = 3, 0.05, 5.0
        nt.links.new(speck.outputs["Image"], img.inputs["Image"])
        nt.links.new(guide.outputs[0], img.inputs["Determinator"])
        alpha = nt.nodes.new("CompositorNodeBilateralblur")
        alpha.iterations, alpha.sigma_color, alpha.sigma_space = 4, 0.3, 8.0
        nt.links.new(rl.outputs["Alpha"], alpha.inputs["Image"])
        nt.links.new(guide.outputs[0], alpha.inputs["Determinator"])
        set_alpha = nt.nodes.new("CompositorNodeSetAlpha")
        set_alpha.mode = "REPLACE_ALPHA"
        nt.links.new(img.outputs["Image"], set_alpha.inputs["Image"])
        nt.links.new(alpha.outputs["Image"], set_alpha.inputs["Alpha"])
        nt.links.new(set_alpha.outputs["Image"], comp.inputs["Image"])
        scene.render.use_compositing = True
        return True
    except (AttributeError, KeyError, RuntimeError, TypeError):
        return False


def has_denoiser():
    """True when Cycles was built with OpenImageDenoise. Some distro packages (Debian/Ubuntu apt) are not,
    and rendering with denoising on then fails with 'build has no OpenImageDenoise support'."""
    try:
        import _cycles
        return bool(getattr(_cycles, "with_openimagedenoise", True))
    except ImportError:
        return False


def enable_gpu():
    """Turn on the first available Cycles GPU backend; returns its name or None (then stays on CPU)."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return None
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == backend]
        if devs:
            for d in prefs.devices:
                d.use = d.type == backend
            bpy.context.scene.cycles.device = "GPU"
            return backend
    bpy.context.scene.cycles.device = "CPU"
    return None


def _to_display(value):
    """Background colour in display (sRGB-encoded 0..1) units, matching 8-bit PNG pixel values."""
    if isinstance(value, str):
        h = value.lstrip("#")
        return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in value[:3]]


def composite_over(path_in, path_out=None, background="#ffffff"):
    """Flatten an RGBA PNG render (straight alpha) onto a solid background colour without the compositor
    (whose API changed in 5.x). Uses numpy when Blender's Python has it (distro builds often do not),
    otherwise a pure-Python loop (about a second per megapixel)."""
    img = bpy.data.images.load(path_in, check_existing=False)
    w, h = img.size
    bg = _to_display(background)
    try:
        import numpy as np
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        a = px[:, 3:4]
        px[:, :3] = px[:, :3] * a + np.array(bg, dtype=np.float32) * (1.0 - a)
        px[:, 3] = 1.0
        flat = px.ravel()
    except ImportError:
        from array import array
        flat = array("f", bytes(4 * w * h * 4))
        img.pixels.foreach_get(flat)
        r0, g0, b0 = bg
        for i in range(0, len(flat), 4):
            a = flat[i + 3]
            if a < 1.0:
                ia = 1.0 - a
                flat[i] = flat[i] * a + r0 * ia
                flat[i + 1] = flat[i + 1] * a + g0 * ia
                flat[i + 2] = flat[i + 2] * a + b0 * ia
                flat[i + 3] = 1.0
    out = bpy.data.images.new("_flat", w, h, alpha=False)
    out.colorspace_settings.name = img.colorspace_settings.name
    out.pixels.foreach_set(flat)
    out.filepath_raw = path_out or path_in
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)
    return path_out or path_in


def render_still(path, background=None, camera=None):
    """Render the active camera to path. background='#RRGGBB' renders with transparent film and flattens
    onto that colour, so shadow-catcher shadows show while the world lighting stays independent."""
    scene = bpy.context.scene
    if camera is not None:
        scene.camera = camera
    if scene.camera is None:
        raise RuntimeError("no active camera: call add_camera()/frame_objects() first")
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    prev = scene.render.film_transparent
    if background is not None:
        scene.render.film_transparent = True
        scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if background is not None:
        composite_over(path, path, background)
        scene.render.film_transparent = prev
    _CRITIC_HINT["path"] = path
    if not _CRITIC_HINT.get("registered"):
        atexit.register(lambda: _critic_loop_hint(_CRITIC_HINT["path"]))
        _CRITIC_HINT["registered"] = True
    return path


_CRITIC_HINT = {}


def _critic_loop_hint(render_path):
    """Print the next critic-loop step (SKILL.md section 1a) when this render is being matched to a reference."""
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = []
    for d in (os.path.dirname(render_path), os.getcwd()):
        if d not in dirs:
            dirs.append(d)
    refs = [os.path.join(d, f) for d in dirs if os.path.isdir(d) for f in sorted(os.listdir(d))
            if f.lower().startswith("ref") and f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    critic = next((os.path.join(d, "critic") for d in dirs if os.path.isdir(os.path.join(d, "critic"))), None)
    if not refs and not critic:
        return
    ref = refs[0] if refs else "<reference image>"
    if critic is None:
        print(f"[critic loop] {render_path} is matched against {ref} without the critic loop. If the workflow tool "
              f"is available, launching {os.path.dirname(here)}/workflows/critic_loop.js now is required (blender "
              f"skill, 'Reference image? Start here'); otherwise start the manual loop: python3 {here}/critic.py init")
        return
    print(f"[critic loop] next round: python3 {here}/critic.py round --dir {critic}; then "
          f"blender -b --factory-startup --python-exit-code 1 -P {here}/critic_pack.py -- --ref {ref} "
          f"--render {render_path} --out {critic}/pack/round_NN; blind review; fill the round file. "
          f"python3 {here}/critic.py check --dir {critic} shows what is left.")


def save_blend(path):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return path


# ----------------------------------------------------------------------------- animation

def key(obj, frame, location=None, rotation=None, scale=None, interpolation=None, **props):
    """Insert keyframes at frame. rotation in degrees (XYZ euler). props: any keyable attribute path on
    obj, e.g. key(light, 10, energy=500) (keys obj.data.energy if obj has no such attribute)."""
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_euler = [math.radians(a) for a in rotation]
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = (scale,) * 3 if isinstance(scale, (int, float)) else scale
        obj.keyframe_insert("scale", frame=frame)
    for path, val in props.items():
        holder = obj if hasattr(obj, path) else obj.data
        setattr(holder, path, val)
        holder.keyframe_insert(path, frame=frame)
    if interpolation:
        set_interpolation(obj, interpolation)


def fcurves(id_block):
    """All F-curves of an ID's action, for both legacy actions and 4.4+/5.x slotted (layered) actions."""
    ad = getattr(id_block, "animation_data", None)
    act = ad.action if ad else None
    if act is None:
        return []
    if hasattr(act, "layers") and len(getattr(act, "layers", [])):
        out = []
        slot = getattr(ad, "action_slot", None)
        for layer in act.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbag") and slot is not None:
                    cb = strip.channelbag(slot)
                    if cb:
                        out.extend(cb.fcurves)
                elif hasattr(strip, "channelbags"):
                    for cb in strip.channelbags:
                        out.extend(cb.fcurves)
        if out:
            return out
    return list(getattr(act, "fcurves", []))


def set_interpolation(obj, mode="BEZIER", easing=None, extrapolation=None):
    """mode: CONSTANT | LINEAR | BEZIER | SINE | QUAD | CUBIC | BOUNCE | ELASTIC | BACK ...
    easing: AUTO | EASE_IN | EASE_OUT | EASE_IN_OUT. extrapolation: CONSTANT | LINEAR (or 'CYCLES' to loop)."""
    for id_block in (obj, getattr(obj, "data", None)):
        if id_block is None:
            continue
        for fc in fcurves(id_block):
            for kp in fc.keyframe_points:
                kp.interpolation = mode
                if easing:
                    kp.easing = easing
            if extrapolation == "CYCLES":
                if not any(m.type == "CYCLES" for m in fc.modifiers):
                    fc.modifiers.new("CYCLES")
            elif extrapolation:
                fc.extrapolation = extrapolation


def set_frames(start=1, end=120, fps=24):
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = start, end
    scene.render.fps = fps
    scene.render.fps_base = 1.0
    return scene


def follow_path(obj, points, frames=(1, 120), closed=False, follow=True, name="Path"):
    """Make obj travel along a smooth curve through points over the frame range (cars, trains, flybys).
    With follow=True the object turns with the path; model it facing +Y (forward axis FORWARD_Y).
    The object's own location is ADDED to the path point as a local offset: put the path on the ground
    or rail line and set obj.location to (0, 0, ride_height) or (0, 0, 0), not to a world position."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    sp.use_cyclic_u = closed
    cu.use_path = True
    cu.path_duration = frames[1] - frames[0]
    path = link(bpy.data.objects.new(name, cu))
    con = obj.constraints.new("FOLLOW_PATH")
    con.target = path
    con.use_curve_follow = follow
    con.forward_axis = "FORWARD_Y"
    con.up_axis = "UP_Z"
    con.use_fixed_location = True
    con.offset_factor = 0.0
    con.keyframe_insert("offset_factor", frame=frames[0])
    con.offset_factor = 1.0
    con.keyframe_insert("offset_factor", frame=frames[1])
    for fc in fcurves(obj):
        if "offset_factor" in fc.data_path:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return path


def track_to(obj, target):
    """Keep obj (camera/light) aimed at target every frame."""
    con = obj.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return con


def rigid_body(obj, kind="ACTIVE", mass=1.0, shape="CONVEX_HULL", friction=0.5, bounciness=0.1):
    """Add obj to the rigid body world (created on demand). Uses the operator because the RBW is
    managed by it; works headless. kind: ACTIVE (falls) | PASSIVE (static collider)."""
    scene = bpy.context.scene
    if scene.rigidbody_world is None:
        bpy.ops.rigidbody.world_add()
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.rigidbody.object_add(type=kind)
    rb = obj.rigid_body
    rb.mass = mass
    rb.collision_shape = shape
    rb.friction = friction
    rb.restitution = bounciness
    return rb


def bake_physics(frame_end=None):
    """Bake rigid body / cloth / particle caches so renders (and other processes) see the simulation."""
    scene = bpy.context.scene
    if scene.rigidbody_world and frame_end:
        scene.rigidbody_world.point_cache.frame_end = frame_end
    with bpy.context.temp_override(scene=scene):
        bpy.ops.ptcache.bake_all(bake=True)


def render_animation(out_dir, video=False, start=None, end=None, step=1):
    """Render frames to out_dir/frame_####.png, or an MP4 (FFMPEG, H.264) at out_dir/anim.mp4."""
    scene = bpy.context.scene
    r = scene.render
    if start is not None:
        scene.frame_start = start
    if end is not None:
        scene.frame_end = end
    scene.frame_step = step
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    if video:
        if hasattr(r.image_settings, "media_type"):  # 5.0+: choose the media type first
            r.image_settings.media_type = "VIDEO"
        r.image_settings.file_format = "FFMPEG"
        r.ffmpeg.format = "MPEG4"
        r.ffmpeg.codec = "H264"
        r.ffmpeg.constant_rate_factor = "MEDIUM"
        r.filepath = os.path.join(out_dir, "anim.mp4")
    else:
        if hasattr(r.image_settings, "media_type"):
            r.image_settings.media_type = "IMAGE"
        r.image_settings.file_format = "PNG"
        r.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)
    return r.filepath


# ----------------------------------------------------------------------------- reporting

def report(objects=None):
    """Print a compact scene inventory: per object type, world bbox size, lowest z, materials, polys."""
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    rows = []
    for o in objects or bpy.context.scene.objects:
        if o.type in {"MESH", "CURVE", "FONT", "SURFACE"}:
            ev = o.evaluated_get(dg)
            try:
                me = ev.to_mesh()
                polys = len(me.polygons)
                ev.to_mesh_clear()
            except RuntimeError:
                polys = 0
            total += polys
            lo, hi = bbox(o)
            size = hi - lo
            mats = ",".join(m.name for m in o.data.materials if m) if hasattr(o.data, "materials") else ""
            rows.append(f"{o.name:<24} {o.type:<6} size=({size.x:.3f},{size.y:.3f},{size.z:.3f}) "
                        f"zmin={lo.z:.3f} polys={polys} mats=[{mats}]")
        else:
            rows.append(f"{o.name:<24} {o.type:<6} loc=({o.location.x:.2f},{o.location.y:.2f},{o.location.z:.2f})")
    print("\n".join(rows))
    print(f"[report] {len(rows)} objects, {total} evaluated polygons, Blender {bpy.app.version_string}")
    return rows
