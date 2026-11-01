---
name: blender
description: Build, edit, animate and render 3D content in Blender with Python (bpy), usually headless. Covers modeling objects and assemblies from a description or reference image, recreating a photographed scene, laying out environments from a tabletop to a landscape or city, animation (keyframes, paths, physics, camera moves), lighting, materials and still or video renders, each checked with renders. Use whenever a task involves Blender, bpy, a .blend file, 3D modeling, a procedural 3D scene, or rendering a 3D image or animation. Matching a reference image requires its critic loop: when the workflow tool is available, launch the shipped workflows/critic_loop.js right after viewing the reference (it builds, then runs blind critic rounds and fixes); otherwise an observation sheet, then every round a blind review and seven specific critics, until `critic.py check` passes.
---

# Blender 3D work with Python

Deliver what was asked (renders, video, `.blend`, exports) from **one rebuildable build script**, check it by looking at renders, and say plainly what still differs from the brief or reference.

Explicit task requirements (paths, resolution, engine, samples, frame range, background, style) override every default in this skill.

## Reference image? Start here

If the task gives a reference image to match (an object or a scene), the critic loop of section 1a is the method, not an option. A single "render, glance, tweak" pass scores far below what the loop reaches, and your own impression of a render is 2-3 points more lenient than an independent judge.

**If the `{{tool:workflow}}` tool is in your tool list, launching this workflow is required for every reference-matching task, simple or complex.** Matching a reference image is workflow-scale by definition: the blind reviews and fix rounds are what lift the score, and their agent, token and time cost is part of this method, so do not weigh whether the task is big enough and do not build or render anything yourself first. If the user, or their settings, restrict workflows or ask to approve each one, follow that instead (ask, or run the manual loop below). The loop ships as a fixed script and you run it instead of doing the rounds yourself. After viewing the reference, your next tool call is this one launch (absolute paths; `args` as a JSON object, not a string):
```
{{tool:workflow}}(name="blender-critic-loop", scriptPath="<skill-dir>/workflows/critic_loop.js",
         args={"task": "<the task's requirements, verbatim>", "reference": "<abs reference>",
               "render": "<abs deliverable render>", "script": "<abs build script to write>",
               "build": "<the command that rebuilds and renders, e.g. blender -b --python <script>>",
               "skillDir": "<skill-dir>", "rounds": 5,
               "deadline": <output of `date -d '+70 minutes' +%s`>})
```
`deadline` bounds the loop (workflow scripts cannot read the clock; its builders do); with a stated time budget, set it to about 60% of the budget from now.
It runs a first builder (observation sheet, build script, first render), then rounds of blind review (three reviewers carrying the seven critic checklists, plus a grader, in parallel) and a builder that fixes, keeps or reverts. Wait for its result without editing the files. Then confirm every deliverable exists and meets the task's requirements, view the render once, and if time remains and a grader score is still below 8, launch it again without `task` and with `"startRound"` set to one past the last round it reported (rounds only, from the current files; earlier round files and backups are kept). Only if the workflow tool is missing, or the launch itself returns an error, build directly and follow the manual loop below. Report the rounds and the remaining differences.

**Otherwise**, run the loop yourself:
1. Call `{{tool:create_goal}}` with the objective "Match the reference image with the blender skill's critic loop until `critic.py check` prints CRITIC LOOP OK and no blind score is below 8, or time is nearly up; then final render and save". Mark it complete only when that holds. Also `{{tool:write_todos}}`: observation sheet; first complete render; critic rounds 1-3; more rounds while any score is below 8; `critic.py check` passes; final render and save.
2. `python3 <skill-dir>/scripts/critic.py init`, then fill `critic/observations.md` from the reference and zoomed crops, before writing modeling code.
3. Build and render the first complete version (sections 2-5).
4. Every round: `critic.py round`, `critic_pack.py`, a blind review (`{{tool:subagent_spawn}}` with `critic.py prompt`), the seven critics, scores, work sized to the scores, keep or revert (section 1a, steps C-F). `H.render_still` prints the next step after each render.
5. Finish only after `python3 <skill-dir>/scripts/critic.py check` prints `CRITIC LOOP OK`.

## 0. Start (first few minutes)

- Probe once: `blender --version`, whether a GPU exists, and whether Blender's own Python has numpy (`blender -b --python-expr "import numpy"`). Distro packages (apt) often lack numpy and OpenImageDenoise; the helpers work without both, but your own scripts must not assume them. Note the time budget, if any.
- Always run Blender as:
  `blender -b --factory-startup --python-exit-code 1 -P build.py -- <args>`.
  Without `--python-exit-code 1`, a Python exception still exits 0 and looks like success.
- Use the helper library instead of re-deriving version-sensitive boilerplate:
  ```python
  import sys; sys.path.insert(0, "<skill-dir>/scripts")   # skill-dir is given with this skill
  import bpy_helpers as H
  ```
  The API below is enough to start; read `scripts/bpy_helpers.py` only for details. Angles are in degrees, sizes in metres, hex colours sRGB. Every shape takes `location=, rotation=, mat=, collection=`.
  ```text
  reset_scene()
  material_preset(name, kind, base_color=None, scale=1.0, **principled)   # kinds: plastic glossy_plastic rubber
      ceramic car_paint chrome steel brushed_metal aluminum gold brass copper painted_metal glass frosted_glass
      water wood leather fabric concrete stone foliage; scale≈10 for a 10 cm prop
  material(name, base_color, roughness=0.5, metallic=0.0, **principled)  # principled: transmission ior coat
      coat_roughness sheen subsurface specular emission emission_strength alpha anisotropic
  add_noise_variation(mat, scale=8, amount=0.15, roughness_amount=0.1, bump=0)   emission_material(name, color, strength)
  add_box(name, size=(x,y,z), bevel=0)        add_cylinder(name, radius, depth, radius_top=None, vertices=64, bevel=0)
  add_cone(name, radius, depth)               add_sphere(name, radius, scale=(1,1,1))
  add_torus(name, major, minor)               add_plane(name, size)
  add_lathe(name, [(r, z), ...], segments=64, thickness=0)        # revolve profile around Z
  add_extrusion(name, [(x, y), ...], depth, bevel=0)             # 2D outline in XY, extruded along Z
  add_tube(name, [(x, y, z), ...], radius, closed=False, smooth_path=True, taper=None)
  add_text(name, body, size, extrude)         shade_smooth(obj, angle=35)
  add_modifier(obj, "SUBSURF"|"ARRAY"|"MIRROR"|"SOLIDIFY"|"BEVEL"..., **props)
  boolean(target, cutter, "DIFFERENCE"|"UNION"|"INTERSECT")    apply_modifiers(obj)    join([objs], name)
  instance(src, name, ...)                    collection(name)    collection_instance(col, name, ..., scale=1)
  radial_array(src, count, radius=0, center=(0,0,0), axis="Z")   # bolts, spokes, keys, ticks, columns
  add_wheel(name, radius, width, location, spokes=5, tread=0)    # tyre+rim+hub(+spokes/tread), axle = local X
  parent(child, parent_obj, keep_transform=True)  # False: child's location is an offset on a moving rig
  bbox(objs) -> (min, max)    dimensions(objs)    place_on(obj, z=0)
  ground_contacts(objects=None, ground_z=0)      report()            # sizes, lowest z, polygon counts
  add_camera(name, location, target, lens=50) frame_objects(cam, objs, azimuth=35, elevation=20, margin=1.12)
  look_at(obj, target)                        add_light("AREA"|"POINT"|"SPOT"|"SUN", name, location, target, energy, size)
  studio_lighting(target=objs, key_azimuth=-40, key_elevation=45, intensity=1, contrast=0.6, softness=0.5)
  sun_and_sky(elevation=35, azimuth=150)      hdri_world(path)    world_color(hex, strength)    volume_fog(density≈0.1/view_distance, size=, center=)
  set_render(engine="CYCLES", resolution=(w,h), samples=64, percentage=100, view_transform="AgX"|"Standard"|
      "Khronos PBR Neutral", look=None, transparent=False, motion_blur=False)    # denoises only when the build can
  render_still(path, background=None)         save_blend(path)    # background="#FFFFFF": transparent film, flattened
  set_frames(start, end, fps)                 key(obj, frame, location=, rotation=, scale=, **data_props)
  set_interpolation(obj, "BEZIER"|"LINEAR"|"CONSTANT", easing=None, extrapolation=None|"CYCLES")
  follow_path(obj, [(x, y, z), ...], frames=(1, 120), closed=False)    track_to(obj, target)    fcurves(obj)
  rigid_body(obj, "ACTIVE"|"PASSIVE", mass=1)  bake_physics(frame_end)    render_animation(out_dir, video=False)
  ```
- Review tools:
  - `scripts/critic_pack.py` puts a reference and a render side by side, cropped to the subject, plus matched close-up cells, and prints both framings: the evidence for the critic loop;
  - `workflows/critic_round.js` runs one blind review (the seven critic checklists as three reviewers, plus a grader) in parallel; `workflows/critic_loop.js` runs the whole loop, first build included, when the `{{tool:workflow}}` tool is available;
  - `scripts/contact_sheet.py` renders several views and/or frames into one image;
  - `scripts/zoom.py` enlarges crops of any image (reference or render) so small details can be read;
  - `scripts/ref_check.py` measures a render against a reference of the same object: silhouette overlap, size, proportions, offset and colour, with an overlay;
  - `scripts/motion_check.py` steps an animation frame by frame and reports pops, sinking and objects leaving the view.

## 1. Pick the track and read only its reference

| The task is mainly… | Read |
|---|---|
| One object, product or machine, from text or from a reference image of the object | [object-modeling.md](references/object-modeling.md) |
| Matching a photo, painting or render of a **scene** through its camera (layout, perspective, light, look) | [image-reconstruction.md](references/image-reconstruction.md) (it links its own references and scripts) |
| Motion: keyframed animation, vehicles on paths, physics, turntables, fly-throughs, video output | [animation.md](references/animation.md) |
| A large or grand scene: landscape, city, forest, interior, crowds, epic scale | [environments.md](references/environments.md) |
| Editing an existing `.blend` | Inspect it first (`H.report()`, cameras, frame range, materials), then change only what was asked, then re-render |

**Any task with a reference image** (object or scene) follows the critic loop in the next section. It is required, not optional: it replaces "look at the render and fix the biggest difference".

## 1a. Matching a reference image: the critic loop (required)

A single glance at your own render finds the defects you already expected and misses the rest, and your own scores run 2-3 points more lenient than an independent judge's, above all on material and small detail. The critic loop fixes both: every round an independent reviewer sees only the two images, then seven critics each look for one kind of defect. `scripts/critic.py` writes the files to fill and checks that they were filled; [critic-loop.md](references/critic-loop.md) has the long form of every checklist and the defects self-review misses most. Work in the task directory; `critic/` sits next to the build script.

**Step A: observation sheet, before any modeling code.** Run `python3 <skill-dir>/scripts/critic.py init`, view the reference, zoom (`blender -b --factory-startup --python-exit-code 1 -P <skill-dir>/scripts/zoom.py -- --image ref.jpg --out critic/zoom.png --grid 3x2`) and view that too, then replace every TODO in `critic/observations.md` with checkable facts: orientation (which end points image-left or image-right, visible faces and their share, camera height, lens), frame, parts with relative sizes and counts (thickness of arms, legs and frames as a fraction of the main body), colour map, material map, light, background, signature details.

**Step B: the first complete render** (section 2 steps 2-3), at the final camera and aspect ratio. Then every round repeats C-F, writing into one round file.

**Step C: start the round and build the evidence.** `python3 <skill-dir>/scripts/critic.py round` creates `critic/round_NN.md` (it refuses while the previous round is unfinished). Then `blender -b --factory-startup --python-exit-code 1 -P <skill-dir>/scripts/critic_pack.py -- --ref ref.jpg --render <render> --out critic/pack/round_NN` and view both images it writes: `_overview.png` (reference subject, blue bar, beside render subject, orange bar) and `_details.png` (six matched close-up cells, reference left). It prints both boxes and aspect ratios, then **GLOBAL CHECKS**: measured differences in exposure, shadow-side darkness, highlights, floor-shadow size and darkness, and framing, each with the usual fix. Fix every GLOBAL CHECKS line in the same round, before smaller details: those numbers are more reliable than any eye, yours or a reviewer's. Under the overview, a strip of each subject's main colours (band width = share) shows missing, extra or shifted colour regions.

**Step D: blind review, then seven critics.**
- Blind review first. If the `{{tool:workflow}}` tool is available: `{{tool:workflow}}(name="blender-critic", scriptPath="<skill-dir>/workflows/critic_round.js", args={"reference": "<abs ref>", "render": "<abs render>", "pack": ["<abs overview png>", "<abs details png>"]})`, with `args` as a JSON object; it runs the seven critic checklists (as three reviewers) and a grader as fresh reviewers in parallel; wait for its result. Otherwise spawn one fresh subagent (`{{tool:subagent_spawn}}`, then `{{tool:subagent_wait}}`) whose whole task is the text printed by `python3 <skill-dir>/scripts/critic.py prompt --ref <abs ref> --render <abs render> --pack <abs overview> <abs details>`. Never tell a reviewer what you built or changed. Paste its scores and differences into the `blind review` section.
- Then fill the seven critic sections. Answer every blind difference (agree and plan a fix, or disagree with what you see), and add what the reviewer missed. Each finding is `- [critical|major|minor] where: reference shows X -> render shows Y -> cause -> fix`; write from the images, not from memory of what you built.
  1. **Viewpoint:** same facing (a mirrored view is critical: move the camera, not the model), same visible faces in the same proportions, same camera height and lens, box width, height and centre close to the reference's printed numbers, same share of the frame for each major part.
  2. **Silhouette:** width:height ratio; each major part's size and position relative to the whole; every bump, notch, overhang, taper and curve of the outline; a body that is a plain cylinder or box where the reference swells, tapers or rounds (an egg or ogive needs a lathe profile, a rounded body needs bevels or subdivision); open gaps and holes; **thickness of arms, legs, frames, rods and blades** (drawn too thick is the commonest toy-look cause).
  3. **Parts:** cell by cell, each reference part right, wrong (shape, size, position, count) or missing; secondary parts spanning their true attachment points (a ram runs its full length between two pins, a cable between two ends); parts that are hollow or open in the reference (scoops, cups, cabins, frames) open in the render; invented parts; every signature detail.
  4. **Colour:** per part, hue, lightness and saturation as seen, with the direction of each error; stripes, borders and accents in the same places; the colour strips under the overview have the same bands in about the same widths (a chrome lens rendered black, or black iron bands rendered as wood, is a missing band). Black parts crushed to a flat silhouette and white parts blown out with no shading are colour errors: black needs albedo about 0.03-0.06 plus a visible specular sheen, white about 0.75-0.85.
  5. **Material:** per part, the same material read: glossy paint shows crisp highlight streaks and reflections, chrome sharp reflections, brushed or dark steel stretched dim highlights, glass dark and reflective with the interior partly visible (never a flat light-grey pane), rubber soft dark highlights, wood grain. A uniform satin look is "CG plastic" even when the colour is right.
  6. **Light:** key on the same side; highlights as strong and crisp; gradient shading across curved surfaces; shadow side as dark (not black, not flat); exposure (GLOBAL CHECKS measures it); a contact shadow under the object of similar darkness, softness and spread: missing, faint, hard-edged, too dark, over-wide, and long shadows streaking sideways are all defects, and a hanging or floating object whose reference shows no floor shadow gets none; glows; **grain**: zoom into a flat surface and the floor shadow at full size, any speckle is a major defect (use `H.set_render`, which smooths noise when the build has no denoiser).
  7. **Integrity:** floating or intersecting parts, gaps, faceted curves, black faces, noise, cut-off parts; run `contact_sheet.py` every few rounds for the hidden sides.

**Step E: score and plan.** Score each critic 1-10 the way a strict judge would (10 nearly identical, 7-9 minor differences, 6 noticeably different, 5 major differences, 2-4 mostly wrong); a critical finding caps that critic at 5, a major one at 7, and no critic scores above the blind reviewer's matching dimension plus one. Fill the `scores:` line. Then plan the round's work in the `plan` section, sized to the scores:
- **Round 1 also fixes the global look once**, because it is cheap and lifts every later judgement: exposure (no crushed blacks or blown whites), a soft contact shadow of the reference's darkness and spread, the reference's gloss level on paint and plastic (high gloss: roughness 0.1-0.25 with coat; satin: 0.3-0.45; a mirror-chrome body where the reference is satin paint is as wrong as a matte one), dark reflective glass, metals with something to reflect, and noise (`H.set_render`).
- **Any score of 5 or less means a big change this round**, not a parameter tweak: either a **rebuild** of the component behind the worst finding with a different construction (a lathe from the measured profile instead of a cylinder, a swept curve instead of two boxes, a hollow shell instead of a solid, thin members at the measured thickness), or a **detail batch**: add at least eight small features from the observation sheet's parts and signature details (seams, panel lines, frames, handles, bolts, hubs and spokes, rams, links, vents, lights), each checked visible at the output size.
- While any score is 6 or less, do not spend a round on minor findings.
- Order the work: viewpoint, then silhouette rebuilds, then parts and detail batches, then colour and material, then light refinements.

**Step F: fix, then keep or revert.** Edit the script, render the candidate to a separate path, build its pack, and compare it with the current best against the reference. Keep it only if the targeted findings are visibly fixed and nothing got visibly worse; copy a kept render to the deliverable path. A round is typically 5-15 minutes of modeling; a round that changes one or two numbers while scores are at 6 or less is too small. Write the decision in the `decision` section. After two failed attempts at one finding, change the construction or move to another finding.

**Exit.** `python3 <skill-dir>/scripts/critic.py check` must print `CRITIC LOOP OK` (at least three complete rounds) before you finish, unless the time budget forces an earlier stop. Keep going while any blind score or critic is below 8 or a major finding is open, within the time rule of section 2: with no stated budget, about six to eight complete rounds; with a budget of an hour or more, stopping in its first quarter with major findings open wastes the time you have. The last round file names the findings still open.

## 2. The workflow (every track)

**Plan → block out → first complete deliverable → improve in rounds → finish.**

1. **Plan in a few lines.** No long documents.
   - List the parts and their real-world sizes in metres.
   - Say how they relate: what sits on, attaches to, or repeats along what.
   - Give materials per part, camera (lens, view direction, framing), lighting, and the output spec.
   - With a reference image, this is the observation sheet (section 1a, step A).
2. **Block out.** Use primitives at true scale and frame the camera. Render small (about 25–50% resolution, 8–16 samples). Fix proportions, placement and composition now, while it is cheap.
3. **Produce the complete deliverable early.** When roughly a quarter of the time budget is spent, every required output should exist: the render at the requested path and size, the `.blend`, and video if asked. From then on, every round only improves a working result.
   - Re-render and re-save from the same build, so the outputs never disagree.
   - Write candidate renders to a separate path and replace the deliverable only when the new render is better.
4. **Improve in rounds.** With a reference image, every round is one pass of the critic loop (section 1a, steps C-F). Without a reference, each round:
   - Render.
   - Look at the image with the image viewer (`{{tool:read_file}}`), next to the brief.
   - Name the **single most visible difference** and fix its cause in the script, in this order:
     1. missing or wrong parts, or a wrong silhouette;
     2. proportions and placement;
     3. camera and framing;
     4. light and exposure;
     5. colour and materials;
     6. small details.
   - Rebuild. If the result is worse, revert.
   - Every few rounds, check other angles with `contact_sheet.py`. Floating parts, parts buried inside others, wrong depth and missing back sides are invisible from the main camera.
   - **Detail pass.** Once silhouette, proportions, light and colours agree, details become the largest remaining gap. For a reference image:
     - Zoom into it: `blender -b --python-exit-code 1 -P <skill-dir>/scripts/zoom.py -- --image ref.jpg --out /tmp/zoom.png --grid 2x2`, or `--box x0,y0,x1,y1`.
     - List the small recognizable features you see: wheel rims and spokes, treads, vents, seams, fasteners, dial markings, handles, mirrors, cables, labels, repeated keys or slats.
     - Add them in order of visual size, checking each one is visible at the output size. Recipes are in object-modeling.md.
5. **Finish.** See section 7.

**Time.** Time the first preview render and extrapolate before you choose final samples or resolution. With a fixed budget, stop starting large changes at about 80% of it and spend the rest on the final render, saving and checking the outputs. An unfinished improvement is worth less than a finished deliverable. With no stated budget, still bound the loop: after about six to eight improvement rounds, or once the remaining differences are small details, finish unless the user asked for open-ended refinement. Returns diminish quickly, and a render still running when the session ends can lose everything.

## 3. Build script rules

- **One idempotent script** (`build.py`). Put `H.reset_scene()` first and a `P = {...}` dict of tunables at the top. Write one function per part or component and a `main()` that builds, frames, lights, renders and saves. Rerunning it must reproduce the scene exactly; use seeded `random.Random(seed)` for any randomness.
- **Preview and final modes in the same script.** Rendering at full quality every round wastes most of a time budget: one 1200×800 Cycles CPU frame can take minutes. For example:
  ```python
  FINAL = "--final" in sys.argv
  H.set_render(resolution=(1200, 800), samples=32 if FINAL else 12, percentage=100 if FINAL else 50)
  H.render_still("/out/render.png" if FINAL else "/tmp/preview.png", background="#FFFFFF")
  if FINAL:
      H.save_blend("/out/scene.blend")
  ```
  Run `--final` once early, as soon as a complete first version exists, and again at the end.
- **Conventions.** Units are metres and Z is up. The subject's front faces **−Y**, so the front-view camera sits on −Y and `frame_objects(azimuth=0)` looks at the front; azimuth 35 is front-right three-quarter. Build objects resting on z = 0.
- **Derive positions from what is already built.** Wheels go at the body's bbox corners, a lid on the rim height, a handle at the wall radius. Avoid magic coordinates. Joined parts should touch or overlap slightly; gaps and floating pieces are the most common defect. Verify with `H.bbox`, `H.ground_contacts()` and a side or top view.
- **Prefer the data API and the helpers to `bpy.ops`.** Most operators need a UI context that background mode lacks. Keep Python references to objects, because names collide and get `.001` suffixes.
- **Shape toolbox.** Pick the construction that matches the visible form:

  | Form | Construction |
  |---|---|
  | Round, symmetric: cups, bottles, lamps, wheels, domes, bells, columns | `add_lathe` with a measured profile |
  | Flat or extruded silhouette: fins, wings, brackets, gears, signs, side panels | `add_extrusion` |
  | Thin round members: handles, pipes, frames, cables, rails, legs, spokes, ropes | `add_tube` along points |
  | Hard-surface blocks | boxes with `bevel` |
  | Holes, slots, windows, cut panels | `boolean` |
  | Smooth organic forms | scaled spheres plus `SUBSURF`, or a lathe |
  | Symmetry | `MIRROR` modifier |
  | Rows and rings of identical parts | `ARRAY` modifier, or loops with `instance` |
  | Hundreds to millions of repeats (grass, trees, rocks, crowds) | instancing or Geometry Nodes scattering (see environments.md) |

- **Bevel hard edges slightly** (about 1–3% of the part size) and use smooth shading by angle. Perfectly sharp edges and faceted curves read as CG.
- **Spend detail where the camera looks.** A part that covers ten pixels needs the right colour, not geometry.

## 4. Materials

- Start from `H.material_preset(name, kind, "#RRGGBB", scale=...)` for any common material. It sets physically sensible values and adds the grain, pores or brushing that make a surface read as that material. Use `H.material(name, "#RRGGBB", roughness, metallic, ...)` for anything else. Hex colours are sRGB; tuples are linear. Keep the base colour between about 0.03 and 0.9 linear. Pure black or white albedo looks fake and clips.
- Typical settings:

  | Material | Settings |
  |---|---|
  | Metal | `metallic=1`, colour carries the tint (gold, brass, copper), roughness 0.15–0.4 |
  | Glass | `transmission=1`, `roughness=0`, `ior=1.45` |
  | Glossy plastic or paint | roughness 0.2–0.4, plus `coat` for car paint and lacquer |
  | Rubber or tyres | dark, roughness 0.7–0.9 |
  | Wood, leather, fabric, stone, brushed metal | `material_preset` kinds: they add the grain or texture |
  | Glowing screens and lamps | `emission=` colour with `emission_strength` |

- Uniform colour on large surfaces is the strongest CG tell. Add `H.add_noise_variation`, procedural textures, wear in crevices, or several material zones. Match colours to the reference by eye under the final lighting, not under a debug light.

## 5. Camera, light and colour management

- **Camera.** Use `H.frame_objects(cam, objs, azimuth, elevation, margin)` for exact framing. A margin of about 1.1–1.2 leaves breathing room; a subject that should fill about 80% of the frame needs about 1.1.
  - Object shots: 50–85 mm.
  - Environments and interiors: 20–35 mm.
  - Telephoto (100–200 mm) compresses depth and makes large things look massive.
  - Match a reference's viewpoint (azimuth, elevation, lens feel) before judging anything else.
- **Pick the lighting setup from the situation:**

  | Situation | Setup |
  |---|---|
  | Object or product on a plain or white background | `H.studio_lighting(target=objs, contrast=0.6, softness=0.5)` plus `H.render_still(path, background="#FFFFFF")` (see below), with `set_render(view_transform="Khronos PBR Neutral")` (4.2+, falls back) for true colours and clean whites. Match the reference: raise `contrast` (up to about 0.85) for deep shadow sides, lower `softness` for crisp specular highlights and sharper shadows, and put `key_azimuth` on the side the highlights come from |
  | Outdoor daylight | `H.sun_and_sky(elevation, azimuth)` with AgX. Use a low sun (5–20°) for warm, long shadows and drama |
  | Overcast | sky or HDRI only, no sun, soft shadows |
  | Interior | area lights at windows and ceiling fixtures, plus visible practical lamps (emission), with a dim world |
  | Night or dramatic | few strong, coloured practical lights, a weak cool moon or sky, haze (`volume_fog`) for light shafts |

  `render_still(path, background="#FFFFFF")` renders with a transparent film, so the shadow-catcher floor keeps a soft contact shadow, then flattens the result onto the background colour. The background stays exactly the requested colour while the subject is lit independently. Never light an object with a bright white world: it flattens the form and washes out colours. If the background must be a real visible surface (a coloured backdrop or table), use a real floor and backdrop instead.
- **Exposure.** Check that the subject has a lit side, a shadow side and specular highlights, that whites are not clipped flat, and that darks are not crushed. Adjust light power first, then `exposure`.

## 6. Verify every round (cheaply)

- **Preview settings.** 25–50% resolution, 12–32 samples, with denoising when the build supports it (`set_render` checks). Final settings only at the end.
- **Look at every render you make** (`{{tool:read_file}}` the PNG). With a reference, look at it through the critic pack and the seven critics (section 1a), not as a single glance; without one, compare against the brief: silhouette, proportions, part count, colours, light direction, framing, background. Write down the findings before changing anything.
- **Multiple angles.**
  `blender -b scene.blend --python-exit-code 1 -P <skill-dir>/scripts/contact_sheet.py -- --out review/views.png`
  This renders front, right, top and three-quarter views plus the scene camera. Add `--clay` to judge form without colour, and `--frames 1,40,80,120` for motion.
- **Reference numbers.** With a reference image of an object, run `ref_check.py` after each render and fix its top verdict (see object-modeling.md). With animation, run `motion_check.py` before the final render (see animation.md).
- **Numbers, not impressions.** `H.report()` prints sizes, the lowest z of each object and polygon counts. Compare sizes with the plan; any object whose lowest z is not 0 (or not resting on its support) is floating or sunk. For animations, sample positions at several frames.
- **Independent review.** With a reference, get the blind second opinion of section 1a after the first complete render and before finishing. Never give the reviewer your intent.

## 7. Finish checklist

- Every requested output exists at the exact path, resolution, engine, samples and frame range. Each was produced by the final build, and the `.blend` was saved after that build.
- With a reference image, the critic loop ran: the workflow returned its round summary, or, for the manual loop, `python3 <skill-dir>/scripts/critic.py check` prints `CRITIC LOOP OK`; otherwise the report says why the loop stopped early.
- `blender -b --factory-startup --python-exit-code 1 -P build.py` reruns cleanly. For video, frames or MP4 exist and were spot-checked.
- Report: what was built, which checks were run and what they showed, and remaining differences or assumptions, stated plainly.

## Pitfalls that cost the most

- Detailing before proportions, framing and light are right.
- Running out of time with a missing or stale deliverable. Produce it early and update it as you go.
- Judging only from the main camera: floating parts, intersecting parts and missing back sides hide there.
- Washed-out renders from a white world or overpowered lights; muddy renders from a single weak light. Use the recipes above.
- A subject too small in frame or cut off. Use `frame_objects`, and check the margin on the render.
- Socket and enum names that differ by version (Principled inputs, EEVEE engine id, sky types, `Action.fcurves`). Use the helpers or read [bpy-pitfalls.md](references/bpy-pitfalls.md).
- `bpy.ops` calls that silently do nothing in background mode. Use the data API or `temp_override`.
- Physics that is never baked, or renders from the wrong frame. Bake, then `scene.frame_set(f)` before reading or rendering.
