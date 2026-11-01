"""Render a review contact sheet: several viewpoints and/or animation frames tiled into one PNG.

Run:  blender -b scene.blend --python-exit-code 1 -P contact_sheet.py -- --out review/sheet.png
          [--views camera,front,right,back,left,top,three_quarter,low] [--frames 1,30,60,90]
          [--objects name1,name2] [--size 480] [--samples 16] [--engine CYCLES|WORKBENCH] [--clay]
          [--cols 4]

- Views are framed automatically on the target objects (default: every visible mesh/curve/text object).
  `camera` is the scene camera as-is. Order in the sheet = order given (left to right, top to bottom).
- --frames renders the scene camera at those frames (checks motion: popping, interpenetration, sliding,
  objects leaving frame). Combine with --views to get one row per frame.
- --clay overrides every material with flat grey (judge form and silhouette without colour).
- The .blend is never saved; temporary cameras and render settings are discarded.
- Prints one line per tile, `tile <index>: <label>`, so the image can be read without text overlays.
"""
import math
import os
import sys
import tempfile

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy_helpers as H  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default


OUT = arg("--out", "contact_sheet.png")
VIEWS = [v for v in str(arg("--views", "")).split(",") if v and v is not True]
FRAMES = [int(f) for f in str(arg("--frames", "")).split(",") if f.strip().lstrip("-").isdigit()]
OBJECTS = [n for n in str(arg("--objects", "")).split(",") if n and n is not True]
SIZE = int(arg("--size", 480))
SAMPLES = int(arg("--samples", 16))
ENGINE = str(arg("--engine", "CYCLES"))
CLAY = bool(arg("--clay", False))
COLS = int(arg("--cols", 0))
if not VIEWS and not FRAMES:
    VIEWS = ["camera", "front", "right", "top", "three_quarter"]

# azimuth/elevation in frame_objects convention (0 = front, camera on -Y; 90 = right side)
PRESETS = {
    "front": (0, 5), "right": (90, 5), "back": (180, 5), "left": (-90, 5), "top": (0, 89.5),
    "three_quarter": (35, 25), "three_quarter_left": (-35, 25), "low": (25, -8), "high": (30, 55),
}

scene = bpy.context.scene
targets = [bpy.data.objects[n] for n in OBJECTS if n in bpy.data.objects] or [
    o for o in scene.objects
    if o.type in {"MESH", "CURVE", "FONT", "SURFACE", "META"} and not o.hide_render
    and not getattr(o, "is_shadow_catcher", False)
    and not (o.type == "MESH" and len(o.data.polygons) <= 1)  # floors/backdrops/ground planes
]
if not targets:
    raise SystemExit("contact_sheet: no renderable target objects")

r = scene.render
aspect = r.resolution_y / r.resolution_x if r.resolution_x else 2 / 3
r.resolution_x = SIZE
r.resolution_y = max(16, int(round(SIZE * aspect)))
r.resolution_percentage = 100
H.engine_id(ENGINE)
if r.engine == "CYCLES":
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = H.has_denoiser()  # distro builds lack OpenImageDenoise
r.film_transparent = False
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "IMAGE"
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGB"

if CLAY:
    clay = H.material("_clay", "#9a9a9a", roughness=0.6)
    vl = bpy.context.view_layer
    vl.material_override = clay

orig_cam = scene.camera
tmp = tempfile.mkdtemp(prefix="contact_")
tiles = []


def render_tile(label):
    path = os.path.join(tmp, f"{len(tiles):03d}.png")
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    tiles.append((label, path))


def view_camera(name):
    if name == "camera":
        if orig_cam is None:
            raise SystemExit("contact_sheet: scene has no camera; use other --views")
        return orig_cam
    if name not in PRESETS:
        raise SystemExit(f"contact_sheet: unknown view {name!r}; choose from camera,{','.join(PRESETS)}")
    cam = H.add_camera(f"_sheet_{name}", lens=50, make_active=False)
    az, el = PRESETS[name]
    H.frame_objects(cam, targets, azimuth=az, elevation=el, margin=1.15)
    return cam


frames = FRAMES or [scene.frame_current]
views = VIEWS or ["camera"]
for f in frames:
    scene.frame_set(f)
    for v in views:
        scene.camera = view_camera(v)
        render_tile(f"{v}" + (f" @frame {f}" if FRAMES else ""))
        if v != "camera":
            bpy.data.objects.remove(scene.camera)
scene.camera = orig_cam

# tile with plain float arrays (no compositor, no PIL, no numpy: distro Blender builds may lack it)
from array import array  # noqa: E402

imgs = []
for label, p in tiles:
    im = bpy.data.images.load(p)
    w, h = im.size
    buf = array("f", bytes(4 * w * h * 4))
    im.pixels.foreach_get(buf)
    imgs.append(buf)
    bpy.data.images.remove(im)
cols = COLS or (len(views) if FRAMES and len(views) > 1 else min(len(imgs), 4))
rows = math.ceil(len(imgs) / cols)
gap = 4
SW, SH = (w + gap) * cols - gap, (h + gap) * rows - gap
sheet = array("f", [0.15, 0.15, 0.15, 1.0]) * (SW * SH)
for i, buf in enumerate(imgs):
    rr, cc = divmod(i, cols)
    y0 = (rows - 1 - rr) * (h + gap)  # bpy images are bottom-up: first tile goes to the top row
    x0 = cc * (w + gap)
    for y in range(h):
        dst = ((y0 + y) * SW + x0) * 4
        sheet[dst:dst + w * 4] = buf[y * w * 4:(y + 1) * w * 4]
out = bpy.data.images.new("_sheet", SW, SH, alpha=False)
out.pixels.foreach_set(sheet)
out_path = os.path.abspath(OUT)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
out.filepath_raw = out_path
out.file_format = "PNG"
out.save()
import shutil  # noqa: E402

shutil.rmtree(tmp, ignore_errors=True)
for i, (label, _) in enumerate(tiles):
    print(f"tile {i}: {label}")
print(f"contact_sheet: wrote {out_path} ({cols}x{rows} tiles of {w}x{h})")
