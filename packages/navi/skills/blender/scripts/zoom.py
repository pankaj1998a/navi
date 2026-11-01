"""Enlarge parts of an image (a reference or a render) so small details can be inspected and listed.

Run:  blender -b --factory-startup --python-exit-code 1 -P zoom.py -- --image reference.jpg --out zoom.png
          [--grid 2x2]                 # tile the whole image into C x R crops, each enlarged (default)
          [--box x0,y0,x1,y1]          # or one crop in normalized coords, origin top-left
          [--size 1024]                # long side of each enlarged crop in pixels

Uses only bpy (no numpy, no PIL). Prints `tile <i>: box=x0,y0,x1,y1` so findings can be mapped back to the
image. Read the output with the image viewer.
"""
import os
import sys
from array import array

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


IMAGE = arg("--image")
OUT = arg("--out", "zoom.png")
SIZE = int(arg("--size", 1024))
if not IMAGE:
    raise SystemExit("zoom: --image is required")
src = bpy.data.images.load(os.path.abspath(IMAGE))
W, H = src.size
px = array("f", bytes(4 * W * H * 4))
src.pixels.foreach_get(px)

if arg("--box"):
    boxes = [tuple(float(v) for v in arg("--box").split(","))]
    cols = 1
else:
    cols, rows = (int(v) for v in arg("--grid", "2x2").lower().split("x"))
    boxes = [(c / cols, r / rows, (c + 1) / cols, (r + 1) / rows) for r in range(rows) for c in range(cols)]


def crop(box):
    x0, y0, x1, y1 = box
    # normalized top-left origin -> bpy bottom-up pixel rows
    cx0, cx1 = int(x0 * W), max(int(x0 * W) + 1, int(x1 * W))
    cy0, cy1 = int((1 - y1) * H), max(int((1 - y1) * H) + 1, int((1 - y0) * H))
    cw, ch = cx1 - cx0, cy1 - cy0
    buf = array("f", bytes(4 * cw * ch * 4))
    for y in range(ch):
        s = ((cy0 + y) * W + cx0) * 4
        buf[y * cw * 4:(y + 1) * cw * 4] = px[s:s + cw * 4]
    im = bpy.data.images.new("_crop", cw, ch, alpha=False)
    im.pixels.foreach_set(buf)
    scale = SIZE / max(cw, ch)
    tw, th = max(1, int(cw * scale)), max(1, int(ch * scale))
    im.scale(tw, th)
    out = array("f", bytes(4 * tw * th * 4))
    im.pixels.foreach_get(out)
    bpy.data.images.remove(im)
    return tw, th, out


tiles = [crop(b) for b in boxes]
tw = max(t[0] for t in tiles)
th = max(t[1] for t in tiles)
rows = (len(tiles) + cols - 1) // cols
gap = 6
SW, SH = cols * tw + (cols - 1) * gap, rows * th + (rows - 1) * gap
sheet = array("f", [0.15, 0.15, 0.15, 1.0]) * (SW * SH)
for i, (w, h, buf) in enumerate(tiles):
    r, c = divmod(i, cols)
    y0 = (rows - 1 - r) * (th + gap)  # first tile at the top
    x0 = c * (tw + gap)
    for y in range(h):
        d = ((y0 + y) * SW + x0) * 4
        sheet[d:d + w * 4] = buf[y * w * 4:(y + 1) * w * 4]
img = bpy.data.images.new("_zoom", SW, SH, alpha=False)
img.colorspace_settings.name = src.colorspace_settings.name
img.pixels.foreach_set(sheet)
out_path = os.path.abspath(OUT)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
img.filepath_raw = out_path
img.file_format = "PNG"
img.save()
for i, b in enumerate(boxes):
    print(f"tile {i}: box={','.join(f'{v:.3f}' for v in b)}")
print(f"zoom: wrote {out_path} ({cols}x{rows} tiles, {tw}x{th} each)")
