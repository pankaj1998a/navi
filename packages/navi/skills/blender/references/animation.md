# Animation, motion and simulation

For anything that moves: keyframed objects, vehicles on paths, mechanisms, camera moves, turntables, fly-throughs, physics (falling, collisions, cloth, particles) and video output. Build and check the still scene first (main SKILL.md), then add motion.

## Plan the motion

Write the shot as **beats with frame numbers**. At 24 fps, 1 s is 24 frames. For example:

> 1–24 the car waits; 24–96 it accelerates along the road and through the bend; 96–120 the camera holds while it exits frame left.

For each moving thing record its path, timing (start, peak, end), speed (in m/s, so motion reads at the right scale), and what it interacts with. Keep the first version short (2–5 s) so preview renders stay cheap.

## Keyframes

- `H.set_frames(1, 120, fps=24)`, then `H.key(obj, frame, location=..., rotation=..., scale=...)`. Rotation is in degrees. Any data property can be keyed, for example `H.key(lamp, 30, energy=800)`.
- Interpolation: `H.set_interpolation(obj, "BEZIER", easing="EASE_IN_OUT")` for natural starts and stops, `"LINEAR"` for constant mechanical motion (conveyors, rotors, wheels), and `"CONSTANT"` for on/off switches.
  - Loops: give the first and last keys the same value and pass `extrapolation="CYCLES"`.
  - Continuous spin: key 0° at the first frame and 360° at the last frame + 1, with LINEAR interpolation, so the loop has no repeated frame.
- Make motion believable:
  - Ease in and out.
  - Follow arcs, not straight lines.
  - Add anticipation before big moves, and overshoot and settle after them.
  - Offset secondary parts by 2–4 frames (follow-through).
  - Keep wheel spin consistent with travel: `angle = distance / radius`.
- **Reading F-curves changed in 4.4/5.0** (slotted actions; `Action.fcurves` was removed in 5.0). Use `H.fcurves(obj)` rather than `obj.animation_data.action.fcurves`.

## Paths, constraints, drivers and hierarchy

- **Travel along a route:** `H.follow_path(obj, points, frames=(start, end), closed=False)`. Model the vehicle facing +Y for path following, or rotate the mesh data once. The object's own location is added to the path point as an offset, so draw the path along the ground or rail and set `obj.location` to the ride height only. Several cars on one path keep their spacing with per-car `offset_factor` keys. Speed is the path length divided by the duration; check it is plausible.
- **Aiming:** `H.track_to(camera_or_light, target)` keeps a camera on a moving subject. Put the target on an empty that you animate smoothly, so the camera does not jitter.
- **Hierarchy:** parent wheels to the chassis, rotors to the helicopter, the camera to a rig empty (`H.parent`). Animate the parent and the children follow. To mount something at an offset on a rig that moves (follow-path vehicle, camera dolly), set the child's location as the offset and call `H.parent(child, rig, keep_transform=False)`. The default keep-transform bakes the rig's current pose into the parent inverse, and the child then drifts.
- **Drivers and procedural motion:** for repetitive motion tied to another value (wheel rotation from car position, pistons from a crank angle), add a driver:
  ```python
  fc = wheel.driver_add("rotation_euler", 0)
  fc.driver.expression = "-frame*0.2"
  ```
  Headless runs (`-b --factory-startup`) evaluate drivers in restricted mode, because Python auto-execution is off. Arithmetic on `frame` and driver variables works. Expressions that reach into `bpy`, or use lambdas and similar code, silently evaluate to 0; stderr only shows "restricted access disallows …". Read other values through driver variables (`d = fc.driver; v = d.variables.new(); v.type = "TRANSFORMS"; v.targets[0].id = obj; v.targets[0].transform_type = "LOC_Y"`, then use `v.name` in the expression). Pass `-y` only when the file is trusted and the expression truly needs full Python.
  For jitter or hand-held camera shake, add a NOISE F-curve modifier: `fc.modifiers.new("NOISE")`, with small strength.
- **Bake to keys** (`bpy.ops.nla.bake`) only when exporting to another tool. Rendering inside Blender evaluates constraints and drivers directly.

## Physics

- **Rigid bodies:** `H.rigid_body(obj, "ACTIVE")` for falling objects and `H.rigid_body(ground, "PASSIVE")` for colliders.
  - Use the `CONVEX_HULL` shape for active objects and `MESH` only for passive concave colliders.
  - Never start objects interpenetrating; separate them by a few millimetres.
  - Set mass realistically. Raise `scene.rigidbody_world.substeps_per_frame` and `solver_iterations` (for example 10) for fast or stacked objects.
- **Cloth, soft bodies and fluids:** add the modifier with `obj.modifiers.new(...)`. Pin cloth through a vertex group set as `settings.vertex_group_mass`. Keep resolution modest. Fluid simulations are slow on CPU, so budget for them or fake them with animated shapes.
- **Particles and scattering over time:** a particle system (`obj.modifiers.new("P", "PARTICLE_SYSTEM")`, then edit `particle_systems[0].settings`), or Geometry Nodes for instanced debris, rain or sparks.
- **Bake before rendering or inspecting:** `H.bake_physics(frame_end)`, which wraps `ptcache.bake_all`. If baking fails headless, step through the frames in order from the start frame (`scene.frame_set(f)` for each f), which fills the caches. The rigid body cache has its own frame range: set `rigidbody_world.point_cache.frame_end`.
- Check the result numerically. For example, after a drop, print `obj.matrix_world.translation.z` at the last frame: it should equal the resting height, not keep falling or sit below the floor.

## Camera moves

| Shot | How |
|---|---|
| Turntable | parent the camera to an empty at the subject's centre; key the empty's Z rotation 0→360° with LINEAR interpolation; or rotate the subject |
| Dolly or push-in | key the camera location along its view axis; ease in and out |
| Orbit or fly-through | `follow_path` on the camera with `track_to` a target empty; keep the path smooth (few control points, AUTO handles) |
| Crane or reveal | animate height and tilt together; start occluded, end on the hero |
| Tracking shot | parent the camera to the moving subject's rig, or `follow_path` along a parallel path |

Keep focal-length animation slow, and avoid more than about 30°/s of camera rotation unless the shot calls for energy. Enable `set_render(motion_blur=True)` for fast motion in the final render.

## Check motion before rendering everything

- **Numeric motion check:**
  `blender -b scene.blend --python-exit-code 1 -P <skill-dir>/scripts/motion_check.py -- --camera [--ground 0]`
  This steps every frame in order (which also fills physics caches). For each moving object it reports the path length, speed spikes (pops and teleports), one-frame stalls, frames below the ground, and frames where its centre leaves the camera view. It catches broken frames that a few contact-sheet samples skip. Fix every reported issue, or explain it, before the final render.
- **Contact sheet of frames:**
  `blender -b scene.blend --python-exit-code 1 -P <skill-dir>/scripts/contact_sheet.py -- --frames 1,30,60,90,120 --out review/motion.png`
  Look for:
  - popping or teleporting between frames;
  - interpenetration;
  - objects leaving the frame unintentionally;
  - wheels sliding or sinking;
  - a visible seam at the loop point;
  - a subject too small to read.
- Print positions at sampled frames (`scene.frame_set(f)`, then `matrix_world.translation`) to verify speeds, contact and end states.
- Render a low-resolution, low-sample preview of the full range (25% size, 8 samples, `frame_step=2`) before the final render, when time allows.

## Rendering animation

- `H.render_animation(out_dir)` writes a PNG sequence (`frame_####.png`), which is safe: a crash keeps the finished frames. `H.render_animation(out_dir, video=True)` writes `anim.mp4` (H.264). The helper sets `media_type="VIDEO"` first, which 5.x requires.
- To join a PNG sequence into a video afterwards: `ffmpeg -framerate 24 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p anim.mp4`, if ffmpeg is installed.
- **Cost is frames × time per frame.** Time one frame at the final settings and multiply before you commit.
  - Reduce samples (animation noise is less visible with denoising) or resolution.
  - Turn on `scene.render.use_persistent_data = True` (Cycles) to reuse scene data across frames.
  - Use `frame_step` for previews.
  - EEVEE is much faster but needs a GPU or display. Headless servers without a GPU should use Cycles on CPU.
- Deliver what was asked: frames, video, or both, plus the `.blend` with the animation and caches baked.
