"""Compare a render with the reference image, or sample reference colors. Runs inside Blender (uses numpy).

Compare:
  blender -b -P compare.py -- compare --ref reference.png --render evidence/r03_Cam_ref.png --out evidence/round_03
        [--grid 6x4] [--panel 640]
  -> <out>/sheet.png  (row 1: reference | render | 50% overlay; row 2: edge overlay | difference heat | worst cells)
  -> <out>/metrics.json (ssim, edge IoU with 2 px tolerance, exposure difference in stops, mean dE, per-cell table,
                         worst cells; cell [col,row] counted from top-left)

Sample colors (points or boxes in normalized coords, origin top-left):
  blender -b -P compare.py -- sample --ref reference.png --points "0.42,0.61;0.80,0.30" --boxes "0.1,0.7,0.2,0.8"
  -> prints sRGB 0-255, linear RGB and relative luminance for each sample (use for albedo / exposure matching)

Inputs are treated as display-referred sRGB images (PNG/JPEG). Float images (EXR) are converted linear->sRGB.
Metrics are advisory evidence for the review; they never override a visible failure.
"""
import bpy
import sys
import os
import json
import argparse
import numpy as np


def load(path, size=None):
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    if size and tuple(img.size) != tuple(size):
        img.scale(int(size[0]), int(size[1]))
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = buf.reshape(h, w, 4)[::-1, :, :3].copy()  # top-down
    if img.is_float:
        arr = linear_to_srgb(np.clip(arr, 0, None))
    bpy.data.images.remove(img)
    return np.clip(arr, 0, 1)


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = os.path.abspath(path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def lab(srgb):
    lin = srgb_to_linear(srgb)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    A = 500 * (f[..., 0] - f[..., 1])
    B = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, A, B], -1)


def luma(srgb):
    return srgb @ np.array([0.299, 0.587, 0.114])


def lin_lum(srgb):
    return srgb_to_linear(srgb) @ np.array([0.2126, 0.7152, 0.0722])


def box(x, r):
    """Mean filter with window (2r+1)^2 via integral image (edge-padded)."""
    p = np.pad(x, r + 1, mode='edge')
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s[:x.shape[0], :x.shape[1]] / (k * k)


def ssim(a, b, r=4):
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    ma, mb = box(a, r), box(b, r)
    va = box(a * a, r) - ma * ma
    vb = box(b * b, r) - mb * mb
    cov = box(a * b, r) - ma * mb
    m = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma ** 2 + mb ** 2 + C1) * (va + vb + C2))
    return m


def edges(y):
    gx = np.zeros_like(y)
    gy = np.zeros_like(y)
    gx[1:-1, 1:-1] = (y[:-2, 2:] + 2 * y[1:-1, 2:] + y[2:, 2:]) - (y[:-2, :-2] + 2 * y[1:-1, :-2] + y[2:, :-2])
    gy[1:-1, 1:-1] = (y[2:, :-2] + 2 * y[2:, 1:-1] + y[2:, 2:]) - (y[:-2, :-2] + 2 * y[:-2, 1:-1] + y[:-2, 2:])
    g = np.hypot(gx, gy)
    return g > np.percentile(g, 88)


def dilate(m, r=2):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def heat(v, vmax):
    t = np.clip(v / vmax, 0, 1)[..., None]
    c0, c1, c2 = np.array([0, 0, 0.0]), np.array([0.85, 0.1, 0.05]), np.array([1, 0.95, 0.3])
    return np.where(t < 0.5, c0 + (c1 - c0) * (t / 0.5), c1 + (c2 - c1) * ((t - 0.5) / 0.5))


def resize_nn(arr, w, h):
    ys = (np.arange(h) * arr.shape[0] / h).astype(int)
    xs = (np.arange(w) * arr.shape[1] / w).astype(int)
    return arr[ys][:, xs]


def compare(a):
    ref_probe = bpy.data.images.load(os.path.abspath(a.ref), check_existing=False)
    W, H = ref_probe.size
    bpy.data.images.remove(ref_probe)
    rend_probe = bpy.data.images.load(os.path.abspath(a.render), check_existing=False)
    rw, rh = rend_probe.size
    bpy.data.images.remove(rend_probe)
    warn = []
    if abs(rw / rh - W / H) > 0.01 * (W / H):
        warn.append(f"aspect mismatch: reference {W}x{H} vs render {rw}x{rh} (render is stretched to compare)")
    # work at panel-ish resolution for speed
    work_w = min(W, 1280)
    work_h = int(round(work_w * H / W))
    ref = load(a.ref, (work_w, work_h))
    ren = load(a.render, (work_w, work_h))

    yr, yn = luma(ref), luma(ren)
    smap = ssim(yr, yn)
    er, en = edges(yr), edges(yn)
    inter = (er & dilate(en)).sum() + (en & dilate(er)).sum()
    edge_iou = float(inter / max(1, er.sum() + en.sum()))
    Lr, Ln = lab(ref), lab(ren)
    dE = np.linalg.norm(Lr - Ln, axis=-1)
    lr, ln = lin_lum(ref), lin_lum(ren)
    stops = float(np.log2((ln.mean() + 1e-5) / (lr.mean() + 1e-5)))

    gc, gr = map(int, a.grid.lower().split("x"))
    cells = []
    for j in range(gr):
        for i in range(gc):
            ys = slice(j * work_h // gr, (j + 1) * work_h // gr)
            xs = slice(i * work_w // gc, (i + 1) * work_w // gc)
            mr, mn = Lr[ys, xs].reshape(-1, 3).mean(0), Ln[ys, xs].reshape(-1, 3).mean(0)
            cells.append({
                "cell": [i, j],
                "mean_color_dE": round(float(np.linalg.norm(mr - mn)), 2),
                "exposure_stops": round(float(np.log2((ln[ys, xs].mean() + 1e-5) / (lr[ys, xs].mean() + 1e-5))), 2),
                "ssim": round(float(smap[ys, xs].mean()), 3),
                "edge_density_ref": round(float(er[ys, xs].mean()), 3),
                "edge_density_render": round(float(en[ys, xs].mean()), 3),
                "ref_Lab": [round(float(v), 1) for v in mr],
                "render_Lab": [round(float(v), 1) for v in mn],
            })
    for c in cells:
        c["score"] = c["mean_color_dE"] / 10 + abs(c["exposure_stops"]) + (1 - c["ssim"]) * 2
    worst = sorted(cells, key=lambda c: -c["score"])[:5]
    metrics = {
        "reference": os.path.abspath(a.ref), "render": os.path.abspath(a.render),
        "size_compared": [work_w, work_h],
        "ssim": round(float(smap.mean()), 4),
        "edge_iou_2px": round(edge_iou, 4),
        "exposure_diff_stops": round(stops, 3),
        "mean_dE": round(float(dE.mean()), 2),
        "p90_dE": round(float(np.percentile(dE, 90)), 2),
        "grid": [gc, gr],
        "worst_cells": [{k: c[k] for k in ("cell", "mean_color_dE", "exposure_stops", "ssim")} for c in worst],
        "cells": [{k: v for k, v in c.items() if k != "score"} for c in cells],
        "warnings": warn,
        "note": "advisory evidence; visible failures and the blind review decide acceptance",
    }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)

    # ---- sheet
    pw = a.panel
    ph = int(round(pw * work_h / work_w))
    R = resize_nn(ref, pw, ph)
    N = resize_nn(ren, pw, ph)
    ov = 0.5 * R + 0.5 * N
    eR = resize_nn(er, pw, ph)
    eN = resize_nn(en, pw, ph)
    eo = R * 0.35
    eo[eR] = [0.0, 0.9, 1.0]
    eo[eN] = [1.0, 0.2, 0.9]
    eo[eR & eN] = [1.0, 1.0, 1.0]
    hm = heat(resize_nn(dE, pw, ph), 30.0)
    wc = N * 0.6 + R * 0.0
    for rank, c in enumerate(worst):
        i, j = c["cell"]
        x0, x1 = i * pw // gc, (i + 1) * pw // gc - 1
        y0, y1 = j * ph // gr, (j + 1) * ph // gr - 1
        col = np.array([1.0, 0.15, 0.1]) if rank == 0 else np.array([1.0, 0.7, 0.1])
        t = 3 if rank == 0 else 2
        wc[y0:y0 + t, x0:x1] = col
        wc[y1 - t:y1, x0:x1] = col
        wc[y0:y1, x0:x0 + t] = col
        wc[y0:y1, x1 - t:x1] = col
    gap = 6
    sheet = np.full((2 * ph + 3 * gap, 3 * pw + 4 * gap, 3), 0.08, dtype=np.float32)
    for k, panel in enumerate([R, N, ov, eo, hm, wc]):
        r, c = divmod(k, 3)
        y = gap + r * (ph + gap)
        x = gap + c * (pw + gap)
        sheet[y:y + ph, x:x + pw] = panel
    save(sheet, os.path.join(a.out, "sheet.png"))
    print(json.dumps({k: metrics[k] for k in ("ssim", "edge_iou_2px", "exposure_diff_stops", "mean_dE", "p90_dE",
                                              "worst_cells", "warnings")}, indent=2))
    print(f"[compare] sheet: {os.path.join(a.out, 'sheet.png')}  (panels: reference | render | overlay / "
          f"edges cyan=ref magenta=render white=both | dE heat (0-30) | worst cells red/orange)")


def sample(a):
    img = load(a.ref)
    h, w = img.shape[:2]
    out = []

    def rep(label, px):
        s = px.reshape(-1, 3).mean(0)
        lin = srgb_to_linear(s)
        out.append({"sample": label, "srgb_255": [round(float(v) * 255, 1) for v in s],
                    "linear": [round(float(v), 4) for v in lin],
                    "rel_luminance": round(float(lin @ np.array([0.2126, 0.7152, 0.0722])), 4)})

    for p in [q for q in (a.points or "").split(";") if q.strip()]:
        x, y = map(float, p.split(","))
        xi, yi = min(w - 1, int(x * w)), min(h - 1, int(y * h))
        rep(f"point {x:.3f},{y:.3f}", img[max(0, yi - 2):yi + 3, max(0, xi - 2):xi + 3])
    for b in [q for q in (a.boxes or "").split(";") if q.strip()]:
        x0, y0, x1, y1 = map(float, b.split(","))
        rep(f"box {x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}", img[int(y0 * h):max(int(y0 * h) + 1, int(y1 * h)),
                                                             int(x0 * w):max(int(x0 * w) + 1, int(x1 * w))])
    print(json.dumps(out, indent=2))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    c = sp.add_parser("compare")
    c.add_argument("--ref", required=True)
    c.add_argument("--render", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--grid", default="6x4")
    c.add_argument("--panel", type=int, default=640)
    s = sp.add_parser("sample")
    s.add_argument("--ref", required=True)
    s.add_argument("--points")
    s.add_argument("--boxes")
    a = ap.parse_args(argv)
    compare(a) if a.cmd == "compare" else sample(a)


main()
