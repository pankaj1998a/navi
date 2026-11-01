"""Numeric shape and colour check of a render against a reference image of the same subject.

Run:  blender -b --factory-startup --python-exit-code 1 -P ref_check.py -- --ref reference.jpg --render render.png
          [--out review/ref_check.png] [--size 256] [--tol 0.15]

Both images are scaled to a common size. The subject is every pixel that differs from the image's own
background colour (estimated from its border) by more than --tol, so soft ground shadows count on both sides
alike. It reports:
- silhouette overlap (IoU), subject size ratio, bounding-box aspect and centroid shift;
- mean colour, brightness, saturation and hue of each subject;
- one verdict line per difference worth fixing, largest first.

It writes an overlay: grey = both, cyan = reference only (missing in the render), magenta = render only
(extra in the render). Best for objects on a plain background seen from a matching camera; for full scenes
use compare.py. Uses only bpy and the standard library (no numpy).
Prints `REF_CHECK {json}` as the last line.
"""
import colorsys
import json
import math
import os
import sys
from array import array


def border_color(px, w, h):
    """Median colour of the outermost pixel ring: the image's background."""
    ring = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
           [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    chans = [sorted(px[(y * w + x) * 4 + c] for x, y in ring) for c in range(3)]
    return [ch[len(ch) // 2] for ch in chans]


def subject_mask(px, w, h, tol):
    bg = border_color(px, w, h)
    return [max(abs(px[i * 4 + c] - bg[c]) for c in range(3)) > tol for i in range(w * h)], bg


def mask_stats(mask, px, w, h):
    n = sum(mask)
    if n == 0:
        return None
    xs = ys = 0.0
    x0, y0, x1, y1 = w, h, -1, -1
    rgb = [0.0, 0.0, 0.0]
    hx = hy = 0.0
    sat = val = 0.0
    for i, m in enumerate(mask):
        if not m:
            continue
        y, x = divmod(i, w)  # bpy rows are bottom-up; flipped to top-left origin below
        xs += x
        ys += y
        x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
        r, g, b = px[i * 4], px[i * 4 + 1], px[i * 4 + 2]
        rgb[0] += r
        rgb[1] += g
        rgb[2] += b
        hh, ss, vv = colorsys.rgb_to_hsv(min(max(r, 0), 1), min(max(g, 0), 1), min(max(b, 0), 1))
        sat += ss
        val += vv
        hx += ss * math.cos(2 * math.pi * hh)  # saturation-weighted circular hue mean
        hy += ss * math.sin(2 * math.pi * hh)
    return {
        "area": n / (w * h),
        "bbox": [x0 / w, 1 - (y1 + 1) / h, (x1 + 1) / w, 1 - y0 / h],  # normalized, top-left origin
        "aspect": ((x1 - x0 + 1) / w) / max((y1 - y0 + 1) / h, 1e-9) * (w / h),
        "centroid": [xs / n / w, 1 - ys / n / h],
        "rgb": [round(c / n, 4) for c in rgb],
        "brightness": val / n,
        "saturation": sat / n,
        "hue_deg": (math.degrees(math.atan2(hy, hx)) % 360) if (hx or hy) else None,
        "hue_strength": math.hypot(hx, hy) / n,
    }


def analyze(ref_px, ren_px, w, h, tol=0.15):
    """Compare two same-size RGBA float buffers (bpy layout, bottom-up rows). Returns a result dict."""
    rm, rbg = subject_mask(ref_px, w, h, tol)
    nm, nbg = subject_mask(ren_px, w, h, tol)
    rs, ns = mask_stats(rm, ref_px, w, h), mask_stats(nm, ren_px, w, h)
    inter = sum(1 for a, b in zip(rm, nm) if a and b)
    union = sum(1 for a, b in zip(rm, nm) if a or b)
    out = {"size": [w, h], "tol": tol, "reference": rs, "render": ns,
           "iou": round(inter / union, 4) if union else 0.0, "verdicts": []}
    v = out["verdicts"]
    if not rs or not ns:
        v.append("no subject found in " + ("the reference" if not rs else "the render") +
                 " (background estimate or --tol is off, or the subject fills the frame)")
        return out, rm, nm
    size_ratio = math.sqrt(ns["area"] / rs["area"])
    dx = ns["centroid"][0] - rs["centroid"][0]
    dy = ns["centroid"][1] - rs["centroid"][1]
    aspect_ratio = ns["aspect"] / rs["aspect"]
    out.update(size_ratio=round(size_ratio, 4), centroid_shift=[round(dx, 4), round(dy, 4)],
               aspect_ratio=round(aspect_ratio, 4),
               brightness_diff=round(ns["brightness"] - rs["brightness"], 4),
               saturation_diff=round(ns["saturation"] - rs["saturation"], 4))
    items = []
    if out["iou"] < 0.8:
        items.append((1 - out["iou"], f"silhouette overlap is low (IoU {out['iou']:.2f}): see the overlay; "
                      "cyan = missing in render, magenta = extra in render"))
    if abs(size_ratio - 1) > 0.06:
        items.append((abs(size_ratio - 1), f"subject is {abs(size_ratio - 1) * 100:.0f}% "
                      f"{'larger' if size_ratio > 1 else 'smaller'} in the render (framing/margin or scale)"))
    if abs(aspect_ratio - 1) > 0.06:
        items.append((abs(aspect_ratio - 1), f"subject is {abs(aspect_ratio - 1) * 100:.0f}% "
                      f"{'wider' if aspect_ratio > 1 else 'taller'} relative to its height/width in the render "
                      "(proportions or view angle)"))
    if math.hypot(dx, dy) > 0.03:
        horiz = f"{abs(dx) * 100:.0f}% {'right' if dx > 0 else 'left'}" if abs(dx) > 0.015 else ""
        vert = f"{abs(dy) * 100:.0f}% {'lower' if dy > 0 else 'higher'}" if abs(dy) > 0.015 else ""
        items.append((math.hypot(dx, dy), "subject sits " + " and ".join(p for p in (horiz, vert) if p) +
                      " in the render (camera target/framing)"))
    bd, sd = out["brightness_diff"], out["saturation_diff"]
    if abs(bd) > 0.06:
        items.append((abs(bd), f"subject is {'brighter' if bd > 0 else 'darker'} in the render "
                      f"(brightness {ns['brightness']:.2f} vs {rs['brightness']:.2f}): light intensity, "
                      "exposure or albedo"))
    if abs(sd) > 0.06:
        items.append((abs(sd), f"subject is {'more' if sd > 0 else 'less'} saturated in the render "
                      f"({ns['saturation']:.2f} vs {rs['saturation']:.2f}): base colours or view transform"))
    if rs["hue_deg"] is not None and ns["hue_deg"] is not None and min(rs["hue_strength"], ns["hue_strength"]) > 0.08:
        dh = (ns["hue_deg"] - rs["hue_deg"] + 180) % 360 - 180
        if abs(dh) > 12:
            items.append((abs(dh) / 180, f"dominant hue is off by {dh:+.0f}° in the render (base colours)"))
    v.extend(text for _, text in sorted(items, reverse=True))
    if not v:
        v.append("no large shape, framing or colour difference; compare details visually")
    return out, rm, nm


def overlay(rm, nm, w, h):
    buf = array("f", [1.0, 1.0, 1.0, 1.0]) * (w * h)
    for i, (a, b) in enumerate(zip(rm, nm)):
        if a and b:
            buf[i * 4:i * 4 + 3] = array("f", [0.6, 0.6, 0.6])
        elif a:
            buf[i * 4:i * 4 + 3] = array("f", [0.0, 0.75, 0.85])  # reference only: missing in render
        elif b:
            buf[i * 4:i * 4 + 3] = array("f", [0.85, 0.0, 0.75])  # render only: extra in render
    return buf


def main(argv):
    import bpy

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default

    ref, ren = arg("--ref"), arg("--render")
    if not ref or not ren:
        raise SystemExit("ref_check: --ref and --render are required")
    size, tol = int(arg("--size", 256)), float(arg("--tol", 0.15))
    out_path = os.path.abspath(arg("--out", "ref_check.png"))
    a = bpy.data.images.load(os.path.abspath(ref), check_existing=False)
    b = bpy.data.images.load(os.path.abspath(ren), check_existing=False)
    (aw, ah), (bw, bh) = a.size, b.size
    w = size
    h = max(8, round(size * ah / aw))
    note = None
    if abs(aw / ah - bw / bh) > 0.02:
        note = f"aspect ratios differ (reference {aw}x{ah}, render {bw}x{bh}); the render is stretched to match"
    bufs = []
    for im in (a, b):
        im.scale(w, h)
        buf = array("f", bytes(4 * w * h * 4))
        im.pixels.foreach_get(buf)
        bufs.append(buf)
    result, rm, nm = analyze(bufs[0], bufs[1], w, h, tol)
    if note:
        result["verdicts"].insert(0, note)
    img = bpy.data.images.new("_ref_check", w, h, alpha=False)
    img.pixels.foreach_set(overlay(rm, nm, w, h))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.filepath_raw = out_path
    img.file_format = "PNG"
    img.save()
    result["overlay"] = out_path
    for line in result["verdicts"]:
        print("ref_check:", line)
    print("REF_CHECK " + json.dumps(result))
    return result


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
