"""Compare a render's framing and tone with a reference that has a plain light background.

Runs inside Blender with only the standard library (some Linux Blender packages ship without numpy):
  blender -b --factory-startup --python tone_compare.py -- reference.jpg render.png

Prints, for reference and render: background brightness, subject bounding box (fraction of frame) and
center, and subject luminance (mean, contrast, darkest 5%, brightest 5%), then the render-minus-reference
deltas and what to change. The subject is every pixel that is clearly darker than the background or
clearly colored. Numbers are evidence for the next fix, not a goal in themselves: a visible shape, color
or material error still comes first.
"""
import math
import os
import sys

import bpy

WIDTH = 300  # analysis width; enough for framing and tone


def load(path):
    """Return (w, h, rows) with rows[y][x] = (r, g, b) in display 0-255, top row first."""
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    w, h = img.size
    if w > WIDTH:
        img.scale(WIDTH, max(1, round(h * WIDTH / w)))
        w, h = img.size
    px = img.pixels[:]
    is_float = img.is_float
    bpy.data.images.remove(img)

    def enc(v):
        if is_float:  # linear float data: convert to display sRGB
            v = max(v, 0.0)
            v = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return min(max(v, 0.0), 1.0) * 255.0

    rows = []
    for y in range(h - 1, -1, -1):  # Blender stores the bottom row first
        base = y * w * 4
        rows.append([(enc(px[base + 4 * x]), enc(px[base + 4 * x + 1]), enc(px[base + 4 * x + 2]))
                     for x in range(w)])
    return w, h, rows


def pct(sorted_vals, q):
    return sorted_vals[min(len(sorted_vals) - 1, int(q * (len(sorted_vals) - 1)))]


def stats(path):
    w, h, rows = load(path)
    lum = [[0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in row] for row in rows]
    k = max(2, min(w, h) // 40)
    corner = sorted(lum[y][x] for ys, xs in ((range(k), range(k)), (range(k), range(w - k, w)),
                                             (range(h - k, h), range(k)), (range(h - k, h), range(w - k, w)))
                    for y in ys for x in xs)
    background = pct(corner, 0.5)
    xs, ys, vals = [], [], []
    for y in range(h):
        for x in range(w):
            r, g, b = rows[y][x]
            if lum[y][x] < background - 35 or max(r, g, b) - min(r, g, b) > 40:
                xs.append(x)
                ys.append(y)
                vals.append(lum[y][x])
    if len(vals) < 50:
        return None
    xs.sort()
    ys.sort()
    vals.sort()
    x0, x1 = pct(xs, 0.01), pct(xs, 0.99)
    y0, y1 = pct(ys, 0.01), pct(ys, 0.99)
    mean = sum(vals) / len(vals)
    return {
        "background": background,
        "box_w": (x1 - x0) / w, "box_h": (y1 - y0) / h,
        "center_x": (x0 + x1) / 2 / w, "center_y": (y0 + y1) / 2 / h,
        "mean": mean, "contrast": math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals)),
        "dark5": pct(vals, 0.05), "bright5": pct(vals, 0.95),
    }


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) != 2:
        print("usage: blender -b --factory-startup --python tone_compare.py -- reference.png render.png")
        return
    ref, ren = stats(args[0]), stats(args[1])
    if ref is None or ren is None:
        print("could not find a subject on a light background in", args[0] if ref is None else args[1])
        return
    print(f"{'':12s}{'reference':>11s}{'render':>9s}{'delta':>8s}")
    for key in ref:
        print(f"{key:12s}{ref[key]:11.2f}{ren[key]:9.2f}{ren[key] - ref[key]:+8.2f}")
    advice = []
    if ren["background"] < 250 <= ref["background"] + 5:
        advice.append("background is not white: show the camera pure white (see studio-look.md)")
    size = ren["box_w"] / max(ref["box_w"], 1e-6)
    if abs(size - 1) > 0.08:
        advice.append(f"subject is {size:.0%} of the reference's width in frame: move the camera "
                      f"{'back' if size > 1 else 'closer'} or change the focal length")
    if abs(ren["center_x"] - ref["center_x"]) > 0.05 or abs(ren["center_y"] - ref["center_y"]) > 0.05:
        advice.append("subject is off-center relative to the reference: re-aim the camera")
    if ren["dark5"] - ref["dark5"] > 12:
        advice.append("shadow side and dark parts are too light: lower ambient/fill, or darken base colors")
    if ren["dark5"] - ref["dark5"] < -12:
        advice.append("dark parts are too dark: raise ambient/fill")
    if ren["contrast"] - ref["contrast"] < -6:
        advice.append("subject is flatter than the reference: stronger or smaller key light, less fill, "
                      "glossier materials where the reference shows crisp highlights")
    if ren["mean"] - ref["mean"] > 12:
        advice.append("subject is brighter overall: lower key/ambient energy or exposure")
    if ren["mean"] - ref["mean"] < -12:
        advice.append("subject is darker overall: raise key energy or exposure")
    print("\n".join(["advice:"] + [f"- {a}" for a in advice]) if advice else "advice: framing and tone are close")


main()
