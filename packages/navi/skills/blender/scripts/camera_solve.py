#!/usr/bin/env python3
"""Solve a Blender camera from a single image (stdlib only; no Blender needed).

Input JSON (pixel coordinates, origin top-left, y down):
{
  "image_size": [W, H],
  "mode": "2vp" | "1vp_horizon" | "horizon",
  "lines": {"x": [[x1,y1,x2,y2], ...], "y": [...], "z": [...]},   # segments following world axes
  "horizon": [x1, y1, x2, y2],            # two points on the horizon (modes 1vp_horizon / horizon)
  "focal_mm": 35.0,                       # 36 mm-wide-sensor equivalent; required unless mode == 2vp
  "principal_point": [cx, cy],            # optional, default image center
  "camera_height": 1.6,                   # optional (m); camera sits at (0, 0, h)
  "ground_ref": [x1, y1, x2, y2, metres],  # optional: two ground pixels a known distance apart -> height
  "origin_pixel": [x, y]                  # optional: ground pixel that becomes the world origin
}
Axis convention: world Z is up. For "2vp", supply segments for exactly two axes (e.g. x and y for
two horizontal directions, or x and z where z are verticals). Directions are made right-handed with
+Z up and the camera looking toward +Y as much as possible.

Usage:  camera_solve.py input.json [-o camera.json]
Output camera.json: lens_mm (sensor_width 36, sensor_fit HORIZONTAL), rotation_euler (XYZ, rad),
location, focal_px, fov_deg, residual_deg per axis, and the rotation matrix.
"""
import json
import math
import sys
import argparse


# ---------------------------------------------------------------------------
# small vector helpers
# ---------------------------------------------------------------------------
def sub(a, b): return [a[i] - b[i] for i in range(len(a))]
def add(a, b): return [a[i] + b[i] for i in range(len(a))]
def mul(a, s): return [x * s for x in a]
def dot(a, b): return sum(a[i] * b[i] for i in range(len(a)))
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def norm(a): return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    if n < 1e-12:
        raise ValueError("degenerate vector")
    return [x / n for x in a]


# ---------------------------------------------------------------------------
# vanishing points
# ---------------------------------------------------------------------------
def line_coeffs(seg):
    """Normalized line a x + b y + c = 0 through a segment."""
    x1, y1, x2, y2 = seg
    a, b = y1 - y2, x2 - x1
    n = math.hypot(a, b)
    if n < 1e-9:
        raise ValueError(f"zero-length segment {seg}")
    a, b = a / n, b / n
    return a, b, -(a * x1 + b * y1)


def vanishing_point(segs):
    """Least-squares intersection of >= 2 segments (finite VP)."""
    if len(segs) < 2:
        raise ValueError("need at least two segments per axis")
    L = [line_coeffs(s) for s in segs]
    saa = sum(a * a for a, b, c in L)
    sab = sum(a * b for a, b, c in L)
    sbb = sum(b * b for a, b, c in L)
    sac = sum(a * c for a, b, c in L)
    sbc = sum(b * c for a, b, c in L)
    det = saa * sbb - sab * sab
    if abs(det) < 1e-9:
        raise ValueError("segments are (nearly) parallel in the image; VP at infinity - use horizon mode")
    x = (-sac * sbb + sbc * sab) / det
    y = (-sbc * saa + sac * sab) / det
    return [x, y]


def angular_residual(segs, vp):
    """Mean angle (deg) between each segment and the ray from its midpoint to the VP."""
    out = []
    for x1, y1, x2, y2 in segs:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        d1 = unit([x2 - x1, y2 - y1])
        d2 = unit([vp[0] - mx, vp[1] - my])
        c = abs(dot(d1, d2))
        out.append(math.degrees(math.acos(min(1.0, c))))
    return sum(out) / len(out)


def pixel_ray(px, pp, f):
    """Camera-space direction (Blender camera: +X right, +Y up, looks -Z) for an image pixel."""
    return unit([px[0] - pp[0], -(px[1] - pp[1]), -f])


# ---------------------------------------------------------------------------
# rotation utilities
# ---------------------------------------------------------------------------
def mat_from_cols(c0, c1, c2):
    return [[c0[i], c1[i], c2[i]] for i in range(3)]


def transpose(m):
    return [[m[j][i] for j in range(3)] for i in range(3)]


def matvec(m, v):
    return [dot(m[i], v) for i in range(3)]


def euler_xyz(R):
    """Blender XYZ euler from rotation matrix R = Rz @ Ry @ Rx."""
    sy = -R[2][0]
    sy = max(-1.0, min(1.0, sy))
    b = math.asin(sy)
    if abs(sy) < 0.999999:
        a = math.atan2(R[2][1], R[2][2])
        c = math.atan2(R[1][0], R[0][0])
    else:
        a = math.atan2(-R[1][2], R[1][1])
        c = 0.0
    return [a, b, c]


def orient_axes(dx, dy, dz):
    """Make world-axis directions (in camera space) right-handed with Z up and Y forward-ish."""
    # Z up: world up should point to camera +Y (image up) for a normal upright photo
    if dz[1] < 0:
        dz = mul(dz, -1)
    # Y should point away from the camera (camera looks -Z)
    if dy[2] > 0:
        dy = mul(dy, -1)
    dx = unit(cross(dy, dz))
    dy = unit(cross(dz, dx))
    return dx, dy, dz


# ---------------------------------------------------------------------------
# solvers
# ---------------------------------------------------------------------------
def solve(cfg):
    W, H = cfg["image_size"]
    pp = cfg.get("principal_point") or [W / 2.0, H / 2.0]
    mode = cfg.get("mode", "2vp")
    lines = cfg.get("lines", {})
    report = {"mode": mode, "image_size": [W, H], "principal_point": pp, "residual_deg": {}}

    if mode == "2vp":
        axes = [a for a in ("x", "y", "z") if len(lines.get(a, [])) >= 2]
        if len(axes) != 2:
            raise ValueError("mode 2vp needs >= 2 segments for exactly two axes")
        vps = {a: vanishing_point(lines[a]) for a in axes}
        for a in axes:
            report["residual_deg"][a] = round(angular_residual(lines[a], vps[a]), 3)
        v1, v2 = vps[axes[0]], vps[axes[1]]
        f2 = -dot(sub(v1, pp), sub(v2, pp))
        if f2 <= 0:
            raise ValueError("VPs inconsistent with orthogonal axes (f^2 <= 0); check axis labels or principal point")
        f = math.sqrt(f2)
        d = {a: pixel_ray(vps[a], pp, f) for a in axes}
        if "z" not in d:
            d["z"] = unit(cross(d["x"], d["y"]))
        elif "y" not in d:
            d["y"] = unit(cross(d["z"], d["x"]))
        else:
            d["x"] = unit(cross(d["y"], d["z"]))
        dx, dy, dz = orient_axes(d["x"], d["y"], d["z"])
        report["vanishing_points"] = {a: [round(v, 2) for v in vps[a]] for a in axes}
    else:
        if "focal_mm" not in cfg:
            raise ValueError(f"mode {mode} needs focal_mm (36 mm sensor-width equivalent)")
        f = cfg["focal_mm"] * W / 36.0
        hz = cfg.get("horizon")
        if not hz:
            raise ValueError(f"mode {mode} needs 'horizon' [x1,y1,x2,y2]")
        r1 = pixel_ray(hz[:2], pp, f)
        r2 = pixel_ray(hz[2:], pp, f)
        dz = unit(cross(r1, r2))
        if dz[1] < 0:
            dz = mul(dz, -1)
        if mode == "1vp_horizon":
            ax = next((a for a in ("y", "x") if len(lines.get(a, [])) >= 2), None)
            if ax is None:
                raise ValueError("1vp_horizon needs >= 2 segments on axis y (or x)")
            vp = vanishing_point(lines[ax])
            report["residual_deg"][ax] = round(angular_residual(lines[ax], vp), 3)
            report["vanishing_points"] = {ax: [round(v, 2) for v in vp]}
            dv = pixel_ray(vp, pp, f)
            dv = unit(sub(dv, mul(dz, dot(dv, dz))))  # project onto ground plane
            if ax == "y":
                dy = dv
                dx = unit(cross(dy, dz))
            else:
                dx = dv
                dy = unit(cross(dz, dx))
        else:  # horizon only: yaw is free -> world +Y = camera forward projected on ground
            fwd = [0.0, 0.0, -1.0]
            dy = unit(sub(fwd, mul(dz, dot(fwd, dz))))
            dx = unit(cross(dy, dz))
        dx, dy, dz = orient_axes(dx, dy, dz)

    # world->camera rotation has the world axes (in camera coords) as columns; camera->world = transpose
    M = mat_from_cols(dx, dy, dz)
    R = transpose(M)

    # scale / location
    h = float(cfg.get("camera_height", 1.6))
    gr = cfg.get("ground_ref")
    if gr:
        def ground_hit(px, hh):
            ray = matvec(R, pixel_ray(px, pp, f))
            if ray[2] >= -1e-6:
                raise ValueError(f"ground_ref pixel {px} is above the horizon")
            t = hh / -ray[2]
            return [ray[0] * t, ray[1] * t]
        a = ground_hit(gr[0:2], 1.0)
        b = ground_hit(gr[2:4], 1.0)
        d1 = math.hypot(a[0] - b[0], a[1] - b[1])
        h = gr[4] / d1
        report["height_from_ground_ref"] = round(h, 4)
    loc = [0.0, 0.0, h]
    op = cfg.get("origin_pixel")
    if op:
        ray = matvec(R, pixel_ray(op, pp, f))
        if ray[2] >= -1e-6:
            raise ValueError("origin_pixel is above the horizon")
        t = h / -ray[2]
        loc = [-ray[0] * t, -ray[1] * t, h]

    lens = f * 36.0 / W
    report.update({
        "focal_px": round(f, 3),
        "lens_mm": round(lens, 3),
        "sensor_width": 36.0,
        "sensor_fit": "HORIZONTAL",
        "fov_deg": {"horizontal": round(math.degrees(2 * math.atan(W / (2 * f))), 3),
                    "vertical": round(math.degrees(2 * math.atan(H / (2 * f))), 3)},
        "rotation_euler": [round(v, 6) for v in euler_xyz(R)],
        "rotation_euler_deg": [round(math.degrees(v), 3) for v in euler_xyz(R)],
        "location": [round(v, 4) for v in loc],
        "camera_to_world": [[round(v, 6) for v in row] for row in R],
        "shift_x": round(-(pp[0] - W / 2.0) / W, 6),
        "shift_y": round((pp[1] - H / 2.0) / W, 6),
    })
    tilt = math.degrees(math.asin(max(-1, min(1, matvec(R, [0, 0, -1])[2]))))
    report["pitch_deg"] = round(tilt, 3)
    report["horizon_y_px"] = round(pp[1] + f * math.tan(math.radians(tilt)), 2) if abs(tilt) < 89 else None
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("-o", "--output")
    a = ap.parse_args()
    with open(a.input) as fh:
        cfg = json.load(fh)
    res = solve(cfg)
    txt = json.dumps(res, indent=2)
    if a.output:
        with open(a.output, "w") as fh:
            fh.write(txt + "\n")
    print(txt)


if __name__ == "__main__":
    main()
