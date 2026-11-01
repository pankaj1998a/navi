"""Build the side-by-side evidence a critic needs to compare a render with a reference of the same object.

Run:  blender -b --factory-startup --python-exit-code 1 -P critic_pack.py -- --ref reference.jpg --render render.png
          --out review/round_03            # writes round_03_overview.png and round_03_details.png
          [--grid 3x2]                     # detail cells over the subject's bounding box (cols x rows)
          [--tol 0.3]                      # background tolerance; high enough that soft floor shadows do not count

Both images are cropped to their own subject bounding box (pixels that differ from the border colour), so
the comparison is not thrown off by framing; framing is reported as numbers instead.
- overview: reference subject (blue bar) | render subject (orange bar), same height, each with a strip of its
  main colours below it (band width = share of the subject).
- details: the subject box cut into a grid; each cell is shown as a pair, reference left (blue) and render
  right (orange), cell 1 top-left, reading order. Cell k of the reference and cell k of the render cover the
  same fraction of each subject box, so a part missing from one side is easy to see.
Prints the subject box, fill and aspect of both images; GLOBAL CHECKS: measured exposure, shadow-side, highlight,
floor-shadow and framing differences, each with the usual fix; then `CRITIC_PACK {json}` as the last line.
Uses only bpy and the standard library.
"""
import json
import os
import sys
from array import array

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


REF, REN, OUT = arg("--ref"), arg("--render"), arg("--out", "review/critic")
COLS, ROWS = (int(v) for v in arg("--grid", "3x2").lower().split("x"))
TOL = float(arg("--tol", 0.3))
if not (REF and REN):
    raise SystemExit("critic_pack: --ref and --render are required")
os.makedirs(os.path.dirname(os.path.abspath(OUT)) or ".", exist_ok=True)

BLUE, ORANGE, GREY = (0.15, 0.45, 0.95, 1.0), (1.0, 0.55, 0.1, 1.0), (0.75, 0.75, 0.75, 1.0)


def load(path):
    img = bpy.data.images.load(os.path.abspath(path))
    w, h = img.size
    px = array("f", bytes(4 * w * h * 4))
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return w, h, px  # rows bottom-up, RGBA floats


def subject_box(w, h, px):
    """Bounding box (top-left origin, pixels) of everything that differs from the border colour."""
    ring = [(x, 0) for x in range(0, w, 2)] + [(x, h - 1) for x in range(0, w, 2)] + \
           [(0, y) for y in range(0, h, 2)] + [(w - 1, y) for y in range(0, h, 2)]
    bg = [sorted(px[(y * w + x) * 4 + c] for x, y in ring)[len(ring) // 2] for c in range(3)]
    x0, y0, x1, y1 = w, h, -1, -1
    count = 0
    for y in range(0, h, 2):
        row = y * w * 4
        for x in range(0, w, 2):
            i = row + x * 4
            if abs(px[i] - bg[0]) > TOL or abs(px[i + 1] - bg[1]) > TOL or abs(px[i + 2] - bg[2]) > TOL:
                count += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
    if x1 < 0:
        return (0, 0, w, h), 0.0
    top, bottom = h - 1 - y1, h - 1 - y0  # bottom-up rows -> top-left origin
    return (x0, top, x1 + 2, bottom + 2), count * 4.0 / (w * h)


def crop(w, h, px, box):
    """Crop (top-left origin box) into a new bottom-up pixel array."""
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, max(x1, x0 + 1)), min(h, max(y1, y0 + 1))
    out = array("f")
    for top_row in range(y1 - 1, y0 - 1, -1):  # emit bottom-up
        r = h - 1 - top_row
        out.extend(px[(r * w + x0) * 4:(r * w + x1) * 4])
    return x1 - x0, y1 - y0, out


def resize(w, h, px, nw, nh):
    img = bpy.data.images.new("critic_tmp", w, h, alpha=True, float_buffer=True)
    img.pixels.foreach_set(px)
    img.scale(max(1, nw), max(1, nh))
    out = array("f", bytes(4 * nw * nh * 4))
    img.pixels.foreach_get(out)
    bpy.data.images.remove(img)
    return nw, nh, out


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = array("f", [1.0, 1.0, 1.0, 1.0]) * (w * h)

    def paste(self, iw, ih, ipx, ox, oy):  # (ox, oy) top-left
        for rb in range(ih):
            cy = self.h - oy - ih + rb
            if 0 <= cy < self.h:
                n = min(iw, self.w - ox)
                self.px[(cy * self.w + ox) * 4:(cy * self.w + ox + n) * 4] = ipx[rb * iw * 4:(rb * iw + n) * 4]

    def rect(self, x0, y0, x1, y1, color):
        for ty in range(max(0, y0), min(self.h, y1)):
            cy = self.h - 1 - ty
            self.px[(cy * self.w + x0) * 4:(cy * self.w + x1) * 4] = array("f", color) * (x1 - x0)

    def save(self, path):
        img = bpy.data.images.new("critic_out", self.w, self.h, alpha=False, float_buffer=False)
        img.pixels.foreach_set(self.px)
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)


def measure(w, h, px):
    """Global look of an image of one object on a plain background, in 0-255 display values:
    subject brightness (mean, 10th and 90th percentile), floor-shadow area and depth, subject area,
    and the subject's main colours. Background and floor shadow are found by flooding in from the
    border through smooth, neutral pixels (a soft shadow is a gentle gradient; the object has edges),
    so a dark cast shadow is not mistaken for dark parts of the object."""
    step = max(1, int((w * h / 120_000) ** 0.5))
    gw, gh = (w + step - 1) // step, (h + step - 1) // step
    lum, sat, rgb = [0.0] * (gw * gh), [0.0] * (gw * gh), [None] * (gw * gh)
    for gy in range(gh):
        y = min(h - 1, gy * step)
        for gx in range(gw):
            i = (y * w + min(w - 1, gx * step)) * 4
            r, g, b = (min(max(px[i + c], 0.0), 1.0) * 255 for c in range(3))
            k = gy * gw + gx
            lum[k], sat[k], rgb[k] = 0.299 * r + 0.587 * g + 0.114 * b, max(r, g, b) - min(r, g, b), (r, g, b)
    border = [lum[gx] for gx in range(gw)] + [lum[(gh - 1) * gw + gx] for gx in range(gw)]
    bg = sorted(border)[len(border) // 2]
    open_ = [False] * (gw * gh)
    stack = [k for k in list(range(gw)) + [(gh - 1) * gw + gx for gx in range(gw)] +
             [gy * gw for gy in range(gh)] + [gy * gw + gw - 1 for gy in range(gh)] if sat[k] < 20 and abs(lum[k] - bg) < 40]
    for k in stack:
        open_[k] = True
    while stack:
        k = stack.pop()
        gy, gx = divmod(k, gw)
        for n in ((k - gw) if gy else -1, (k + gw) if gy < gh - 1 else -1, (k - 1) if gx else -1, (k + 1) if gx < gw - 1 else -1):
            if n >= 0 and not open_[n] and sat[n] < 20 and abs(lum[n] - lum[k]) <= 4 and bg - lum[n] < 150:
                open_[n] = True
                stack.append(n)
    subj = sorted(lum[k] for k in range(gw * gh) if not open_[k])
    # A white object on a white ground floods like a shadow; compare with a plain threshold to notice.
    plain = sum(1 for k in range(gw * gh) if abs(bg - lum[k]) > 40 or sat[k] >= 18)
    shadow = [bg - lum[k] for k in range(gw * gh) if open_[k] and bg - lum[k] > 6]
    colors = [rgb[k] for k in range(gw * gh) if not open_[k]]
    cells = [divmod(k, gw) for k in range(gw * gh) if not open_[k]]
    if cells:
        ys, xs = [c[0] for c in cells], [c[1] for c in cells]
        box = ((max(xs) - min(xs) + 1) / gw, (max(ys) - min(ys) + 1) / gh)
    else:
        box = (0.0, 0.0)
    total = gw * gh
    pick = lambda q: round(subj[int(q * (len(subj) - 1))]) if subj else None
    return {
        "subject_mean": round(sum(subj) / len(subj), 1) if subj else None,
        "subject_p10": pick(0.10), "subject_p90": pick(0.90),
        "subject_area": round(len(subj) / total, 4),
        "shadow_area": round(len(shadow) / total, 4),
        "shadow_depth": round(sum(shadow) / len(shadow), 1) if shadow else 0.0,
        "palette": palette(colors),
        "reliable": len(subj) >= 0.8 * plain,
        "box": [round(box[0], 3), round(box[1], 3)],
    }


def palette(colors, k=5, iters=8):
    """Main colours of the subject as (rgb, share), largest first: a small k-means on sampled pixels."""
    if not colors:
        return []
    pts = colors[:: max(1, len(colors) // 3000)]
    cents = [pts[int(i * (len(pts) - 1) / max(k - 1, 1))] for i in range(k)]
    for _ in range(iters):
        groups = [[] for _ in cents]
        for p in pts:
            j = min(range(len(cents)), key=lambda c: sum((p[t] - cents[c][t]) ** 2 for t in range(3)))
            groups[j].append(p)
        cents = [tuple(sum(q[t] for q in g) / len(g) for t in range(3)) if g else cents[j] for j, g in enumerate(groups)]
    out = [([round(v) for v in c], len(g) / len(pts)) for c, g in zip(cents, groups) if g]
    return sorted(out, key=lambda cs: -cs[1])


def global_checks(m_ref, m_ren, box_ref, box_ren):
    """Plain-language findings for the measurable global differences, with the usual fix. box_*: subject
    box (width, height) as fractions of the frame."""
    out = []
    kw, kh = box_ref[0] / max(box_ren[0], 1e-3), box_ref[1] / max(box_ren[1], 1e-3)
    k = (kw + kh) / 2
    if k > 1.2 or k < 0.83:
        out.append(f"FRAMING: the render's subject box is {box_ren[0]:.0%} x {box_ren[1]:.0%} of the frame vs {box_ref[0]:.0%} x "
                   f"{box_ref[1]:.0%} in the reference: {'move the camera closer / lower the framing margin' if k > 1 else 'move the camera back / raise the margin'} "
                   f"so the object is about {k:.2f}x its current size on screen.")
    if not m_ref["reliable"]:
        out.append("LIGHT OBJECT ON A LIGHT GROUND: brightness and floor-shadow numbers are unreliable here, so they are not "
                   "checked; compare exposure, shadow-side darkness and the floor shadow by eye in the overview.")
        return out
    if m_ref["subject_mean"] is not None and m_ren["subject_mean"] is not None:
        d = m_ren["subject_mean"] - m_ref["subject_mean"]
        if abs(d) >= 10:
            ev = round(-d / 45, 2)
            out.append(f"EXPOSURE: render subject {'brighter' if d > 0 else 'darker'} than the reference by {abs(d):.0f} levels "
                       f"(mean {m_ren['subject_mean']:.0f} vs {m_ref['subject_mean']:.0f}): change exposure by about {ev:+.2f} EV "
                       f"(scene.view_settings.exposure) or scale light energy by about {2 ** ev:.2f}.")
        dl = m_ren["subject_p10"] - m_ref["subject_p10"]
        dh = m_ren["subject_p90"] - m_ref["subject_p90"]
        if dl >= 12:
            out.append(f"SHADOW SIDE: render darks are {dl} levels lighter than the reference's (10th percentile {m_ren['subject_p10']} vs "
                       f"{m_ref['subject_p10']}): less fill and world light, or more contrast.")
        elif dl <= -12:
            out.append(f"SHADOW SIDE: render darks are {-dl} levels darker (crushed) than the reference's: more fill, or lift black albedo.")
        if dh >= 12:
            out.append(f"HIGHLIGHTS: render brights are {dh} levels brighter than the reference's (90th percentile {m_ren['subject_p90']} vs "
                       f"{m_ref['subject_p90']}): lower the key or albedo; whites are washing out.")
    ra, na = m_ref["shadow_area"], m_ren["shadow_area"]
    if ra < 0.02 and na > 0.04:
        out.append(f"FLOOR SHADOW: the reference has almost none ({ra:.1%} of the frame) but the render has {na:.1%}: "
                   "the object hangs or floats, or the shadow is far fainter; weaken or remove the shadow catcher.")
    elif na > 1.6 * ra + 0.01:
        out.append(f"FLOOR SHADOW: render shadow covers {na:.1%} of the frame vs {ra:.1%} in the reference ({na / max(ra, 1e-3):.1f}x): "
                   "make it shorter and softer (raise the key light toward overhead, enlarge it, add fill) so it sits under the object.")
    elif na < 0.5 * ra and ra > 0.02:
        out.append(f"FLOOR SHADOW: render shadow covers {na:.1%} vs {ra:.1%} in the reference: add or strengthen the soft contact shadow.")
    if abs(m_ren["shadow_depth"] - m_ref["shadow_depth"]) >= 12 and na > 0.02 and ra > 0.02:
        out.append(f"SHADOW DARKNESS: render shadow {'darker' if m_ren['shadow_depth'] > m_ref['shadow_depth'] else 'lighter'} "
                   f"({m_ren['shadow_depth']:.0f} vs {m_ref['shadow_depth']:.0f} levels below the background).")
    return out


def fit(w, h, max_w, max_h):
    s = min(max_w / w, max_h / h)
    return max(1, int(w * s)), max(1, int(h * s))


ref, ren = load(REF), load(REN)
boxes, raw_boxes, fills = [], [], []
for w, h, px in (ref, ren):
    b, f = subject_box(w, h, px)
    raw_boxes.append(b)
    pad = 0.04 * max(b[2] - b[0], b[3] - b[1])
    boxes.append((b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad))
    fills.append(f)

measures = [measure(*ref), measure(*ren)]
# The flood-fill box leaves the floor shadow out; on a light object (unreliable flood) use the plain box.
box_fracs = ([tuple(m["box"]) for m in measures] if measures[0]["reliable"] else
             [((b[2] - b[0]) / img[0], (b[3] - b[1]) / img[1]) for b, img in zip(raw_boxes, (ref, ren))])
checks = global_checks(*measures, *box_fracs)

# Overview: both subjects at the same height, each with a strip of its main colours (width = share).
W, BAR, GAP, STRIP = 1600, 10, 16, 46
over_h = 700
crops = [crop(*img, box) for img, box in zip((ref, ren), boxes)]
sizes = [fit(c[0], c[1], (W - 3 * GAP) // 2, over_h) for c in crops]
canvas = Canvas(W, over_h + BAR + 3 * GAP + STRIP)
x = GAP
half = (W - 3 * GAP) // 2
for (cw, ch, cpx), (nw, nh), color, m in zip(crops, sizes, (BLUE, ORANGE), measures):
    canvas.rect(x, GAP, x + nw, GAP + BAR, color)
    canvas.paste(*resize(cw, ch, cpx, nw, nh), x, GAP + BAR)
    sx, sy = x, GAP + BAR + over_h + GAP
    for rgb, share in m["palette"]:
        sw = max(2, int(half * share))
        canvas.rect(sx, sy, min(sx + sw, x + half), sy + STRIP, tuple(v / 255 for v in rgb) + (1.0,))
        sx += sw
    x += half + GAP
canvas.save(os.path.abspath(OUT + "_overview.png"))

# Details: matched cells over each subject box, two pairs per canvas row.
pair_w = (W - 3 * GAP) // 2
img_w = (pair_w - GAP) // 2
cells = []
for r in range(ROWS):
    for c in range(COLS):
        pair = []
        for img, (bx0, by0, bx1, by1) in zip((ref, ren), boxes):
            cw_, ch_ = (bx1 - bx0) / COLS, (by1 - by0) / ROWS
            pair.append(crop(*img, (bx0 + c * cw_, by0 + r * ch_, bx0 + (c + 1) * cw_, by0 + (r + 1) * ch_)))
        cells.append(pair)
cell_h = max(fit(p[0][0], p[0][1], img_w, 10_000)[1] for p in cells)
cell_h = min(cell_h, 520)
rows_needed = (len(cells) + 1) // 2
canvas = Canvas(W, rows_needed * (cell_h + BAR + 2 * GAP) + GAP)
for k, pair in enumerate(cells):
    ox = GAP + (k % 2) * (pair_w + GAP)
    oy = GAP + (k // 2) * (cell_h + BAR + 2 * GAP)
    canvas.rect(ox - 4, oy - 4, ox + pair_w + 4, oy - 1, GREY)
    for j, ((cw, ch, cpx), color) in enumerate(zip(pair, (BLUE, ORANGE))):
        nw, nh = fit(cw, ch, img_w, cell_h)
        px0 = ox + j * (img_w + GAP)
        canvas.rect(px0, oy, px0 + img_w, oy + BAR, color)
        canvas.paste(*resize(cw, ch, cpx, nw, nh), px0, oy + BAR)
canvas.save(os.path.abspath(OUT + "_details.png"))

info = {}
for name, (w, h, _), box, fill in zip(("reference", "render"), (ref, ren), raw_boxes, fills):
    bw, bh = box[2] - box[0], box[3] - box[1]
    info[name] = {
        "box_norm": [round(box[0] / w, 3), round(box[1] / h, 3), round(box[2] / w, 3), round(box[3] / h, 3)],
        "center_norm": [round((box[0] + box[2]) / 2 / w, 3), round((box[1] + box[3]) / 2 / h, 3)],
        "box_width_frac": round(bw / w, 3),
        "box_height_frac": round(bh / h, 3),
        "aspect_w_over_h": round(bw / max(bh, 1), 3),
        "pixel_fill": round(fill, 3),
    }
    print(f"{name:9s} box={info[name]['box_norm']} aspect={info[name]['aspect_w_over_h']} "
          f"width_frac={info[name]['box_width_frac']} height_frac={info[name]['box_height_frac']}")
for k in range(len(cells)):
    print(f"cell {k + 1}: row {k // COLS + 1}, col {k % COLS + 1}")
info["measures"] = {"reference": measures[0], "render": measures[1]}
info["global_checks"] = checks
print("GLOBAL CHECKS (measured; fix every line before smaller details):" if checks else "GLOBAL CHECKS: exposure, shadow and framing are within tolerance.")
for line in checks:
    print("  - " + line)
print("Colour strips under the overview: reference left, render right; a missing or extra band is a colour-region error.")
info["files"] = [os.path.abspath(OUT + "_overview.png"), os.path.abspath(OUT + "_details.png")]
print(f"Next: view {info['files'][0]} and {info['files'][1]}, then fill this round's critic/round_NN.md "
      "(python3 <skill-dir>/scripts/critic.py round creates it): blind review first, then all seven critics.")
print("CRITIC_PACK " + json.dumps(info))
