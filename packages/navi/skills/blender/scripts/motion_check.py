"""Numeric motion check of an animated .blend: steps every frame in order and reports, per moving object,
speed spikes (pops/teleports), frames that sink below the ground, frames where it leaves the camera view, and
whether it moves at all.

Run:  blender -b scene.blend --python-exit-code 1 -P motion_check.py --
          [--objects a,b] [--start N] [--end N] [--ground 0.0] [--spike 3.0] [--camera]

- Objects: those named (unknown names are refused), else every mesh/empty/curve/text/camera whose world
  position changes.
- Frames are evaluated in order from the start frame, which also fills physics caches.
- --camera also checks each moving object's bounding-box centre against the scene camera's view.
- Contact sheets show what moved; this shows where motion is broken. Uses only bpy and the standard library.
Prints `MOTION_CHECK {json}` as the last line.
"""
import json
import math
import sys


GROUND_TOL = 0.01


def analyze_tracks(tracks, ground=0.0, spike=3.0, ground_tol=GROUND_TOL):
    """tracks: {name: [(frame, (x, y, z), min_z or None, in_view or None), ...]} in frame order.
    Returns {name: report} with speed stats, spike frames, ground and view violations."""
    out = {}
    for name, samples in tracks.items():
        frames = [s[0] for s in samples]
        pos = [s[1] for s in samples]
        steps = [math.dist(pos[i], pos[i - 1]) / max(frames[i] - frames[i - 1], 1) for i in range(1, len(pos))]
        moving = [d for d in steps if d > 1e-6]
        med = sorted(moving)[len(moving) // 2] if moving else 0.0
        spikes = [frames[i + 1] for i, d in enumerate(steps) if med > 0 and d > spike * med and d > 1e-4]
        stalls = [frames[i + 1] for i, d in enumerate(steps)
                  if moving and d <= 1e-6 and 0 < i < len(steps) - 1 and steps[i - 1] > 1e-6 and steps[i + 1] > 1e-6]
        below = [s[0] for s in samples if s[2] is not None and s[2] < ground - ground_tol]
        out_of_view = [s[0] for s in samples if s[3] is False]
        rep = {
            "frames": [frames[0], frames[-1]] if frames else [],
            "moves": bool(moving),
            "path_length": round(sum(steps), 4),
            "median_speed_per_frame": round(med, 5),
            "max_speed_per_frame": round(max(steps), 5) if steps else 0.0,
            "spike_frames": spikes,
            "single_frame_stalls": stalls,
            "below_ground_frames": below,
            "out_of_view_frames": out_of_view,
        }
        issues = []
        if spikes:
            issues.append(f"speed spikes (> {spike}x median) at frames {compact(spikes)}: pops, teleports or a "
                          "constraint/parent switch")
        if stalls:
            issues.append(f"one-frame stops at {compact(stalls)}: duplicated keys or a hold that reads as a stutter")
        if below:
            issues.append(f"lowest point below ground {ground} at frames {compact(below)}: sinking or "
                          "interpenetration")
        if out_of_view:
            issues.append(f"centre outside the camera view at frames {compact(out_of_view)}")
        rep["issues"] = issues
        out[name] = rep
    return out


def compact(frames, limit=8):
    """[1,2,3,7,8] -> '1-3, 7-8' (truncated)."""
    runs = []
    for f in frames:
        if runs and f == runs[-1][1] + 1:
            runs[-1][1] = f
        else:
            runs.append([f, f])
    text = ", ".join(f"{a}" if a == b else f"{a}-{b}" for a, b in runs[:limit])
    return text + (" ..." if len(runs) > limit else "")


def main(argv):
    import bpy
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default

    scene = bpy.context.scene
    start, end = int(arg("--start", scene.frame_start)), int(arg("--end", scene.frame_end))
    ground, spike = float(arg("--ground", 0.0)), float(arg("--spike", 3.0))
    check_view = "--camera" in argv and scene.camera is not None
    names = [n for n in str(arg("--objects", "")).split(",") if n]
    missing = [n for n in names if n not in bpy.data.objects]
    if missing:
        raise SystemExit(f"motion_check: unknown objects {missing}; names are exact (check for .001 suffixes)")
    candidates = [bpy.data.objects[n] for n in names] or [
        o for o in scene.objects if o.type in {"MESH", "EMPTY", "CURVE", "CAMERA", "FONT"}]
    tracks = {o.name: [] for o in candidates}
    for f in range(start, end + 1):
        scene.frame_set(f)  # in order: also fills rigid body / cloth caches
        dg = bpy.context.evaluated_depsgraph_get()
        for o in candidates:
            mw = o.evaluated_get(dg).matrix_world
            p = mw.translation
            min_z = None
            centre = p
            if o.type == "MESH":
                ev = o.evaluated_get(dg)
                corners = [mw @ Vector(c) for c in ev.bound_box]
                centre = sum(corners, Vector()) / 8
                min_z = min(c.z for c in corners)
                # The bound box is never higher than the mesh, so only a box that dips below the ground needs
                # the real vertices (a rotated box dips below a ball or wheel that rests correctly). Meshes whose
                # box dips below the ground (terrain, sunk rocks, a ground plane under z=0) are still copied and
                # walked every frame: frames x vertices. A mesh with no vertices is not measured.
                if min_z < ground - GROUND_TOL:
                    me = ev.to_mesh()
                    min_z = min(((mw @ v.co).z for v in me.vertices), default=None)
                    ev.to_mesh_clear()
            in_view = None
            if check_view and o is not scene.camera:
                v = world_to_camera_view(scene, scene.camera, centre)
                in_view = 0.0 <= v.x <= 1.0 and 0.0 <= v.y <= 1.0 and v.z > 0
            tracks[o.name].append((f, (p.x, p.y, p.z), min_z, in_view))
    report = analyze_tracks(tracks, ground, spike)
    moving = {n: r for n, r in report.items() if r["moves"] or n in names}
    for n, r in moving.items():
        status = "; ".join(r["issues"]) or "ok"
        print(f"motion_check: {n}: path {r['path_length']} m, median {r['median_speed_per_frame']} m/frame, {status}")
    if not moving:
        print("motion_check: nothing moves in this frame range (animation not keyed, not baked, or wrong range)")
    print("MOTION_CHECK " + json.dumps({"frames": [start, end], "objects": moving}))
    return moving


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
