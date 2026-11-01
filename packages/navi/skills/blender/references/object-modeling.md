# Object and assembly modeling

For one object, product, vehicle, machine, instrument, furniture piece or character-like prop, built from a text brief or from a reference image of the object. The shared workflow, helpers and finish checklist are in the main SKILL.md.

## Read the subject before modeling

From a brief, decide the real-world size and the 3–8 major parts first, then the parts that make the object recognizable (a bicycle's chainring, a teapot's spout, an F1 car's halo).

From a reference image, write a short **observation list**. Each line should be checkable against your render:

1. **Silhouette and aspect.** Measure the object's bounding box in image pixels: the width:height ratio of the whole, and the main parts as fractions of it ("tank top at 22% of the height, wheels 38% of the length"). Use these ratios to set dimensions; they are the strongest cue the eye uses.
2. **Parts inventory** by size: primary masses, secondary parts and repeated elements, with counts. Counts matter: four legs, five spokes, two bells.
3. **Viewpoint.**
   - Which faces are visible (front/back, left/right, top) and how much: this gives the azimuth and elevation for `frame_objects`. A typical product "three-quarter" view is azimuth 25–45° and elevation 15–30°.
   - Vertical edges that stay parallel mean a long lens (85 mm+) or little tilt. Strongly converging edges mean a wide lens and a close camera.
   - Note how much of the frame the object fills and where it sits.
4. **Colour and finish per part.** Glossy or matte, metallic or not, transparent, emissive. Sample by eye in the lit and the shadowed region; the true base colour lies between them.
5. **Light.** Note:
   - where the highlights are (they give the key light direction);
   - the shadow-side darkness (fill amount);
   - the cast shadow on the ground: direction and softness;
   - any rim light.

   A product shot on white usually has a large soft key from upper front-left or right, gentle fill, and a soft contact shadow.
6. **Background.** Plain colour, gradient, floor-and-wall, or an environment. Match it: a plain background means `render_still(background=...)`.

Then plan dimensions in metres from typical real sizes: a mug is about 9.5 cm tall, a chair seat 45 cm, a car about 4.5 × 1.8 × 1.4 m, a guitar about 1 m. Keep the ratios measured from the image.

## Build order

1. **Primary masses** at true size, resting on z = 0, front facing −Y. Frame the camera to the reference viewpoint and render a clay preview. Compare the silhouette and proportions with the reference; this is the step that decides most of the score.
2. **Secondary parts** attached to computed positions on the primary masses (bbox corners, profile radii, attachment frames), not to guessed coordinates. Re-render.
3. **Materials and lighting** set up the way the final image needs them. Re-render at preview quality and compare the colours and the light/dark structure.
4. **Repeated elements and details** in order of visual size: the large ones first, fine ones last, only where visible.
5. Then improvement rounds (main SKILL.md section 2).

## Construction recipes by object family

These are starting points. Adapt them to what the reference shows.

| Family | Recipe |
|---|---|
| Vessels and turned forms: cups, vases, bottles, teapots, lamps, bells, vases, chess pieces | `add_lathe` from a measured (radius, z) profile with `thickness` for open walls; liquid as a lathe or cylinder just below the rim; spouts and handles as `add_tube` with radius taper |
| Furniture: chairs, tables, shelves, beds | boxes with bevels for boards, cylinders or tapered cylinders for legs; place legs from the seat bbox; slats with a loop or `ARRAY`; cushions as boxes with `SUBSURF` level 2 and a bevel |
| Vehicles: cars, trucks, trains, buses | build the body from a side-profile `add_extrusion` (outline traced from the reference proportions), rotated so the profile lies in XZ, then shape it with bevels and `SUBSURF`, or loft sections. Add the cabin and windows as a darker glossy inset or a separate glass shell. Wheels: tyre `add_torus` or a lathe, rim lathe, spokes by loop; place them at the wheelbase and track measured from the reference. Add lights as emissive or glossy insets |
| Aircraft, boats, rockets | fuselage or hull as a lathe or scaled sphere/cylinder with tapered ends; wings, fins and sails as `add_extrusion` of the planform with a small thickness and bevel; engines as lathes; masts, rigging and antennas as tubes |
| Machines and appliances: espresso machines, mixers, cameras, PCs, robots | bevelled boxes and cylinders as the main housings; panel seams by `boolean` grooves or slightly inset boxes; buttons, knobs and dials as small cylinders arranged in a loop; displays as emissive planes; vents with `ARRAY` |
| Frames and structures: bicycles, cranes, towers, bridges, cages, scaffolds | members as `add_tube` (round) or thin boxes (square) between computed joint points; build a list of nodes, then connect pairs; lattices by loops; cables along points with sag (catenary or parabola) |
| Instruments: guitars, violins, pianos, horns | body outline as `add_extrusion` from a traced 2D outline (smooth curves: generate points from math); strings as thin tubes; brass tubing as `add_tube` along coil points; keys with `ARRAY` or loops |
| Plants, food, organic props | scaled spheres or ellipsoids with `SUBSURF` and noise displacement; leaves as small extrusions instanced with random rotation; stems as tapered tubes |
| Stylised or cartoon objects | simple primitives, smooth shading, saturated flat materials (roughness 0.4–0.6), clean bevels; Standard or Khronos PBR Neutral view transform keeps the colours exact |
| Characters and animals (only when asked) | blobby primitives (head, torso and limbs as scaled spheres and capsules) joined by overlap, symmetric via `MIRROR`; keep them stylised: realistic figures are a separate discipline |

**Smooth outlines from math.** Generate profile and outline points from a function instead of hand-typing many coordinates. For example, a superellipse `|x/a|^n + |y/b|^n = 1` makes rounded rectangles (tablet, TV, cabinet), and Bézier or Catmull-Rom interpolation through a few control points gives car profiles, guitar bodies and wings. Resample to 64–256 points.

**Text and labels.** Use `add_text` for raised or printed lettering; for flat printing, put the text slightly in front of the surface (about 0.2 mm), facing out.

## Matching a reference image of an object

**Measure, don't only eyeball.** After each render, run
`blender -b --factory-startup --python-exit-code 1 -P <skill-dir>/scripts/ref_check.py -- --ref reference.jpg --render render.png --out /tmp/ref_check.png`.
It prints the differences largest first (silhouette overlap, subject size, proportions, offset, brightness, saturation, hue) and writes an overlay. In the overlay, cyan marks parts missing from the render and magenta marks extra parts. Fix the top verdict, re-render and re-check. The verdicts give direction, not the score: a matching silhouette with wrong details still needs the detail pass.

1. **Camera first.** Set `set_render` to the required resolution, then use `frame_objects` with the azimuth and elevation read from the image. Compare a clay render with the reference side by side: the same faces visible, the object filling the same fraction of the frame, at the same position. Adjust azimuth, elevation, lens and margin until they agree, then leave the camera alone.
2. **Silhouette and proportions.** Compare outline shapes and part ratios. Re-measure the reference rather than trusting memory.
3. **Light and background.**
   - For a white or plain studio background, use `studio_lighting(target=objs, key_azimuth=...)`, putting the key on the side where the reference has highlights, then `render_still(background="#FFFFFF")`.
   - If the reference shadow falls toward the right, the key is on the left: use a negative `key_azimuth`.
   - Increase `intensity` if the render is darker overall. If it looks flatter or brighter than the reference, raise `contrast`; if its highlights are broader and softer, lower `softness`.
4. **Materials and colours.** Use `material_preset` kinds for recognizable surfaces (wood grain, brushed or polished metal, leather, rubber, glass, ceramic); a flat single colour reads as plastic or clay to any viewer. Scale the pattern to the object (`scale≈10` for a 10 cm prop). Compare colours under the final light. A render that looks paler than the reference usually means too much light or AgX desaturation: try `view_transform="Khronos PBR Neutral"` or `"Standard"` for product looks. A render that looks darker or muddier needs more key light or higher albedo.
5. **Details last.** Add detail only after the silhouette, light and colours agree. Each added part must be visible at the output size.

## Detail pass: small parts that make an object read as real

Inventory the details from enlarged crops of the reference (`scripts/zoom.py --grid 2x2`, then `--box` on busy areas), not from memory of what such an object usually has. Then add them in order of visual size:

| Detail | Construction |
|---|---|
| Wheels with rims, spokes, hubs, tyre tread | `add_wheel(name, radius, width, location, spokes=N, tread=N)`; spokes=0 for solid or disc wheels; rotate 180° about Z for wheels on the −X side so the face points out |
| Bolts, rivets, studs, dial ticks, keys round a dial, spokes, chair legs round a table | `radial_array(src, count, radius, center, axis)` |
| Rows: keys, slats, vents, windows, fins, tracks, railings | `ARRAY` modifier (`relative_offset_displace`, `count`), or a loop with `instance` |
| Panel seams, door gaps, grooves | thin `boolean` cuts (about 1–3 mm wide) or a slightly inset darker box; they catch shadow lines |
| Grilles and perforations | a plane or box with an `ARRAY` of slot cutters, or an emission or dark material with a brick or checker texture at small scale |
| Hoses, cables, wires, piping, rope, springs | `add_tube` along points, with sag for cables and a helix for springs |
| Dials, gauges, clock faces, screens | a flat disc or plane plus `add_text` numerals, `radial_array` ticks and thin box hands; emission for lit screens |
| Labels, logos, number plates, markings | `add_text` slightly proud of the surface, or a contrasting material zone |
| Glass in frames: windows, lenses, displays | a dark glossy or `glass` pane set into a slightly raised frame; give lenses concentric rings via lathe profiles |
| Mechanisms: hinges, pistons, hydraulic cylinders, pivots | nested cylinders (`add_cylinder`) between computed joint points, with small end caps |
| Tracks (tanks, excavators) | a rounded loop path with `add_tube` or instanced tread plates along it, plus road wheels via `add_wheel(spokes=0)` |

A detail that occupies a handful of pixels still matters when it is recognizable (spokes, typebars, dial numerals). Spend most detail effort on the hero side the camera sees, and stop when what remains is invisible at the output size.

## Common object defects

| Visible symptom | Usual cause | Fix |
|---|---|---|
| Parts float or have gaps between them | Hand-typed coordinates | Derive positions from the parent's bbox or profile; make the parts overlap by 1–2 mm |
| Object looks like a toy or blob | No bevels, everything rounded the same, too few parts | Bevel hard edges, keep flat faces flat, add the 3–5 most recognizable secondary parts |
| Faceted curves | Too few segments, flat shading | 48–128 segments on lathes and cylinders; `shade_smooth`; `SUBSURF` on organic parts |
| Dark streaks or black faces | Flipped normals, overlapping coplanar faces (z-fighting) | `recalc_face_normals` (the helpers do this); offset coplanar faces by about 0.1 mm |
| Glass looks black or invisible | Nothing to refract or reflect, too few transmission bounces, or glass with no thickness | Keep a lit environment behind it; keep `max_bounces` and `transmission_bounces` at 12 or more (`set_render` does this; `transparent_max_bounces` only affects alpha cut-outs); give the glass thickness. For tinted glass, tint the base colour; for tint that deepens with thickness (bottles, liquids), add a Volume Absorption node to the material Volume output and tune its density by eye, higher for thin walls |
| Metal looks black | No environment to reflect | Dim world colour or HDRI, plus area lights; metals need things to reflect |
| Colours washed out or white blown | White world lighting, lights too strong, AgX on a product shot | Use the studio recipe; lower `intensity`; use the Khronos PBR Neutral view transform |
| Wrong viewpoint (seen from the wrong side or too high) | Azimuth or elevation sign error | Convention: azimuth 0 = front (camera on −Y), positive = toward the right side, elevation above the horizon |
