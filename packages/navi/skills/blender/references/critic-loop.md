# Critic loop: matching a render to a reference image

Use this loop whenever a render must match a reference image of an object or scene. It replaces "look at
the render and fix the biggest difference" with a fixed sequence of specific critics. Each critic answers
one narrow question, by pointing at evidence in both images. Run every critic every round. A loop that
skips critics keeps fixing what it already noticed and never finds the defects it did not look for.

The loop has three parts:

1. **Before modeling:** write the observation sheet (section 1) once.
2. **Every round after the first complete render:** build the evidence (section 2), run the seven
   critics (section 3), score them (section 4), fix the top items (section 5), and keep or revert the
   change (section 6).
3. **Before finishing:** get a blind second opinion (section 7) and pass the exit check (section 8).

Write everything to files under `critic/` next to the build script. The files are the proof that the
loop ran, and they let you come back after a long build or render without re-deriving anything:

```
critic/observations.md     # section 1, written once, corrected when you notice an error
critic/round_01.md ...     # one file per round: critic findings, scores, chosen fixes, keep/revert
critic/pack/round_01_overview.png, round_01_details.png
```

## Defects self-review misses most

Observed when the builder's own round notes were compared with an independent judge on the same render.
Look for each of these on purpose; the builder tends to rate them "fine".

| Pattern | What it looks like | Fix direction |
|---|---|---|
| Thin members too thick | Booms, legs, rails, frames, rotor blades, handles drawn as chunky boxes; the object reads as a toy | Measure member thickness as a fraction of the main body height in the reference and match it; taper long members |
| Angular where the reference curves | A banana-curved arm built from two straight boxes; a curved scoop built as a prism | Sweep a profile along a curve (`add_tube`, extruded outlines from Bezier points), lathe round forms |
| Stub secondary parts | Hydraulic rams, struts, cables and pipes drawn short and floating instead of spanning their attachment points | Compute both end points on the parts they connect and run the part between them |
| Solid where the reference is open | Buckets, cups, cabs, lamp shades, cages and frames closed off | Give shells thickness (`solidify`), cut openings, leave see-through gaps open |
| Invented parts | Extra pins, knobs or blocks added "for detail" that the reference does not have | Every added part must point to a feature in the reference |
| Wrong gloss level | Matte "CG plastic" where the reference is glossy, or the opposite over-correction: a mirror-chrome body where the reference is satin paint | Compare highlight size and sharpness and how much the surface reflects; high gloss roughness 0.1-0.25 with coat, satin 0.3-0.45 |
| Metal too bright and flat | A light-grey, evenly lit "silver" for steel parts | Darker base, metallic 1, roughness 0.3-0.5, something to reflect; worn steel is mid to dark grey |
| Flat light | Soft even light, weak highlights, little shadow-side falloff | Stronger key, more contrast, smaller or sharper highlights on curved surfaces |
| Over-dark or over-wide shadow | A contact shadow darker and wider than the reference's soft one | Lower shadow-catcher strength or raise fill; check the floor shadow in the overview |
| Render grain | Speckle on flat surfaces and in the floor shadow at 32 samples without a denoiser; the judge marks both lighting and texture down | `H.set_render` (it substitutes an albedo- and normal-guided compositor smoothing when OpenImageDenoise is missing); clamp indirect light; large soft lights |
| Flat grey windows | Glass drawn as an opaque light-grey panel with no frame | Dark tinted glass with reflections (`material_preset("glass")` over a dark interior, or a dark glossy pane), with a frame proud of the body |
| Crushed black, blown white | A black leather chair as a flat silhouette; a white body with no shading | Black albedo about 0.03-0.06 with a specular sheen and a rim light; white about 0.75-0.85; check the shadow side keeps detail |
| Primitive body | A rocket or bottle as a straight cylinder, a cartoon bus as a sharp box | Lathe the measured profile; round the box with large bevels and subdivision |
| Shadow mismatch | No contact shadow (object floats), or a hard, dark, long cast shadow where the reference has a soft one; a floor shadow under a hanging object | Shadow-catcher floor with only the key casting shadows; adjust key height, size and fill until GLOBAL CHECKS shows the reference's spread and darkness; no shadow catcher for a hanging object whose reference shows none |
| Wrong main colour region | A silver chrome lens and top plate rendered black; a black saddle rendered white; dark iron bands and rivets rendered as flat wood | Compare the colour strips under the overview band by band; every large region in the reference's colour map gets its own material |
| Sculpted housing built from boxes | A stand-mixer head, sewing-machine arm, typewriter body, bus front or violin body made of sharp boxes and cylinders | Trace the side profile and extrude it with large bevels and subdivision, or loft cross-sections; keep the reference's swelling and waist |
| Merged multi-part forms | A snowman's three balls fused into one pear, foliage as a single blob, a flame as one cone | Keep the necks and gaps between stacked parts; build foliage from many separate leaf clusters with visible gaps; build flames from several tongues |
| Sparse repeated detail | A saxophone with a handful of keys, a lens with no rings, a watch bracelet of a few blocks, a chest without rivets | Count the repeats in the zoomed reference and generate them with loops or arrays at that count and spacing |
| Long side shadows | Extra long shadows streaking across the floor from low fill or rim lights | Only the key casts shadows (the `studio_lighting` default); check the floor-shadow size in GLOBAL CHECKS |
| Too small in frame | A good model that fills half the area the reference's object fills, so its details vanish | Match the subject box to the reference's (GLOBAL CHECKS FRAMING) before judging detail |
| Wrong composition share | The body fills too much of the frame and the long parts look compressed | Compare each major part's share of the box width in both images, then fix proportions or camera |

## 1. Observation sheet (before modeling)

Run `python3 <skill-dir>/scripts/critic.py init`. Open the reference with the image viewer, then zoom into it
(`blender -b --python-exit-code 1 -P <skill-dir>/scripts/zoom.py -- --image ref.jpg --out critic/zoom.png --grid 3x2`).
Fill `critic/observations.md`, which has these headings. Every line must be something you can later check in
your own render, so state it as a measurable fact, not a feeling.

1. **Orientation and view.** Which end of the object points to image-left and which to image-right. Which
   faces are visible (front, left or right side, top) and roughly how much of each, for example "front
   face about 35% of the visible width, right side about 65%". Is the camera above the object, and by how
   much (how much of the top surface shows, how flat the ellipses of round parts are)? Are vertical edges
   parallel (long lens) or converging (wide lens)?
2. **Frame.** The object's bounding box as fractions of the image (left, top, right, bottom) and its
   width:height ratio. `critic_pack.py` prints these numbers for both images later.
3. **Part inventory.** Every visible part, largest first, each with: where it is (which grid cell), its
   size relative to the whole ("boom length about 0.7 of total width"), its shape in a few words, and its
   count when it repeats (4 wheels, 6 keys per row, 3 rotor blades, 12 balusters). Include holes and see-
   through gaps (between legs, inside a handle, between spokes): negative space is part of the silhouette.
4. **Colour map.** For each part: colour family, light or dark, saturated or muted, for example "body:
   saturated mid yellow; tracks: near-black; bucket: mid grey steel". Note stripes, two-tone borders, trim
   and accents and exactly where they run.
5. **Material map.** For each part: metal or not; mirror-polished, brushed, or matte; glossy or matte
   paint; clear or tinted glass; rubber; wood with visible grain; fabric; ceramic. Note where you can see
   reflections and what they look like.
6. **Light.** Where the brightest highlights sit (which side, which faces), how dark the shadow side is
   compared with the lit side, the cast shadow under the object (present, soft or hard, which direction,
   how far it spreads), and any glow (lamps, screens, flames).
7. **Background.** Plain white, grey, gradient, floor plane, or scene.
8. **Signature details.** The 5-10 small features that make this object recognizable and that a viewer
   would miss first: grille slats, rivet rows, keys, dials, mirrors, handles, seams, cables, hinges, vents,
   logos-free markings.

## 2. Evidence for each round

After each render, build the comparison pack:

```
blender -b --factory-startup --python-exit-code 1 -P <skill-dir>/scripts/critic_pack.py -- \
    --ref ref.jpg --render /tmp/preview.png --out critic/pack/round_NN --grid 3x2
```

It crops both subjects, prints both bounding boxes and aspect ratios, and writes:
- `round_NN_overview.png`: reference subject (blue bar) beside render subject (orange bar), same height;
- `round_NN_details.png`: the subject box cut into 6 cells, each shown as a reference/render pair.

Open both images with the image viewer. Every few rounds, and always before finishing, also run
`ref_check.py` for silhouette overlap numbers and `contact_sheet.py` for other viewing angles (floating or
buried parts only show there). Preview renders must use the final aspect ratio and camera, or the critics
compare different pictures.

## 3. The seven critics

Run them in this order. For each critic write its findings into `critic/round_NN.md` as lines of the form

`[severity] where: what the reference shows -> what the render shows -> likely cause -> fix`

Severity is `critical` (a viewer would say "that is a different object" or the part is missing or wrong
at first glance), `major` (clearly visible at normal viewing size), or `minor` (visible only when looking
for it). "Looks good" is not a finding: if a critic finds nothing, write which checks you made and what
you compared. Never write findings from memory of what you built; write them from what the image shows.

### Critic 1: viewpoint and framing

Check, comparing the overview images and the printed numbers:
- **Facing.** The object's front points the same way as in the reference (image-left or image-right). A
  mirrored object is the most expensive error in this list: every later critic will look wrong. Fix it by
  moving the camera to the other side (negative azimuth), never by rebuilding geometry.
- **Visible faces.** The same faces are visible in the same proportions (front versus side width). If the
  render shows more side than the reference, rotate the camera toward the front, and the other way round.
- **Elevation.** The same amount of top surface is visible; round parts (wheels, rims, cups) have the same
  ellipse flatness.
- **Lens.** Edges converge as much as in the reference. Too much perspective: longer lens, camera farther.
- **Size and position.** The render's box width and height fractions are within about 10% of the
  reference's, and its centre within about 5% of the frame. Too small or too large: change the framing
  margin, not the model.

### Critic 2: silhouette and proportions

Compare outlines, not colours. Squint, or run the clay contact sheet.
- Overall width:height ratio within about 5%.
- Each major part's size relative to the whole, from the observation sheet: measure it in the render the
  same way (fractions of the box) and list every part that is off by more than about 10%.
- Outline features: bumps, notches, overhangs, tapers, curves versus straight lines, pointed versus
  rounded ends. Follow the outline of the reference all the way round and name every place the render's
  outline departs from it.
- Negative space: holes and gaps that are open in the reference must be open in the render, at a similar
  size; gaps that are closed must be closed.
- Thickness of thin members (legs, rails, arms, frames, cables, rotor blades): too thick reads as a toy,
  too thin disappears.

### Critic 3: part inventory and detail

Go through the details image cell by cell. For each cell, list every part visible in the reference half
and mark it in the render half as: present and right; present but wrong (shape, size, position, count);
missing. Then list anything in the render that the reference does not have (an invented part costs as
much as a missing one). Check every count from the observation sheet. Check the signature details
explicitly: each one present and visible at the output size? A detail smaller than a few pixels needs
only the right colour or a dark line, not geometry.

### Critic 4: colour

For each part, compare the colour you see in the two images under the final light: hue (redder, more
orange, greener...), lightness (darker or lighter) and saturation (duller or more vivid). Name the
direction of each error, for example "render yellow is darker and more orange than the reference". Check
that stripes, two-tone borders and trim run in the same places. Check the share of the image each colour
covers: a large part in the wrong colour is critical. Common causes: AgX or Filmic desaturating (use
Standard or Khronos PBR Neutral for product shots), too little light making colours muddy, too much light
washing them out, a base colour picked from a shadowed pixel, metallic parts tinted by their reflections.

### Critic 5: material and surface finish

For each part, does the surface read as the same material? Check: metal versus paint versus plastic;
mirror chrome (sharp reflections of surroundings), brushed metal (stretched highlights), matte metal;
glossy paint (crisp highlight streaks and a clear coat) versus matte; glass (see-through with reflections
and darker edges) versus a flat grey pane; rubber (dark, soft highlight); wood (grain visible and running
along the board); fabric or leather (soft sheen, fine texture). Uniform flat colour with one soft highlight
is the "CG plastic" look; fix it with the right `material_preset`, roughness, coat, a little noise
variation, and something for metals and glass to reflect (a dim world or extra area lights).

### Critic 6: light and shading

- Key light side: the brightest highlights sit on the same side and faces as in the reference.
- Shadow side: as dark as the reference's, not black, not flat.
- Exposure: whites not clipped flat, darks not crushed, overall brightness of the object matching.
- Contact shadow: present under the object, soft, about the same darkness and spread, falling the same
  way. A missing contact shadow makes the object float; a hard black shadow looks pasted.
- Highlights on curved surfaces in the same places; no blown highlight areas the reference lacks.
- Glow: lamps, screens and flames that glow in the reference glow in the render.

### Critic 7: construction and render integrity

From the contact sheet (other angles) and close crops: floating parts, gaps where parts should touch,
parts pushing through each other, missing back or under sides that show from the camera, faceted curves,
black faces or streaks (flipped normals, coplanar faces), noise or fireflies, parts cut off by the frame,
render resolution, path and camera matching the requirements.

## 4. Score the round

Give each critic a score from 1 to 10, as a strict judge who sees only the two images would:
10 nearly identical; 7-9 clearly matching with minor differences; 6 noticeably different but related;
5 partly matching with major differences; 2-4 mostly wrong; 1 missing. Any critical finding caps that
critic at 5; any major finding caps it at 7. Write the scores as a line in the round file, for example
`scores: view 8, silhouette 6, parts 5, colour 8, material 6, light 7, integrity 9`. The lowest scores
decide where the next round's effort goes.

## 5. Choose and make the fixes

- Take the critical findings first, then the majors from the lowest-scoring critics.
- Fix at most three causes per round, so you can tell which change helped. Write the planned fixes in the
  round file before editing.
- Fix in dependency order: viewpoint before silhouette, silhouette before parts, parts before colour and
  material, light last among the big items. A colour fix on a part that will be rebuilt is wasted.
- Fix the cause, not the symptom: a wrong-looking colour may be a lighting problem; a wrong-looking
  silhouette may be a camera problem.
- After two failed attempts at the same finding, change the approach: a different construction (lathe
  instead of scaled spheres, extrusion from a traced outline instead of boxes), or move on and come back.

## 6. Keep or revert

Render the candidate to a separate preview path, build the pack again, and compare the candidate with the
current best (the incumbent) against the reference. Keep the candidate only if the targeted findings are
visibly fixed and nothing else got visibly worse; otherwise revert the script change. Record the decision
in the round file. Copy the kept render to the deliverable path when it is the new best, so a timeout
never loses the improvement.

## 7. Blind review (every round)

Your own critique is biased by what you meant to build, and it runs lenient. Every round, before the seven
critics, get an independent review of the current render:

- If the `workflow` tool is available, run the critic workflow; it runs the seven critic checklists (as three
  reviewers) plus a grader as separate fresh reviewers in parallel and returns their merged findings, sorted by severity:
  `workflow(name="blender-critic", scriptPath="<skill-dir>/workflows/critic_round.js", args={"reference": "<abs path>", "render": "<abs path>", "pack": ["<overview png>", "<details png>"]})`.
  Pass `args` as a JSON object, not a JSON string, and wait for the result.
- Otherwise spawn one fresh subagent (`subagent_spawn`, then `subagent_wait`) whose whole task is the text
  printed by `python3 <skill-dir>/scripts/critic.py prompt --ref <abs ref> --render <abs render> --pack <abs overview> <abs details>`.
  Never add what you built, what you changed, or which parts you think are good.
- With neither tool, run the seven critics yourself on the full-resolution render, writing each finding
  before reading your earlier round files, and lower your scores by one where you are unsure.

Paste the reviewer's scores and differences into the round file's `blind review` section. Answer every
difference in the critic sections. When it disagrees with your own score by 2 or more on a dimension,
believe it and look again; its lowest dimension is the next round's first target.

## 8. Exit check

Stop improving only when one of these holds, and write which one in the last round file:
- every critic scores 8 or more, there is no critical or major finding left, and the blind critique
  agrees; or
- the time budget is nearly used (see the main skill's timing rule); or
- two consecutive rounds were reverted and the remaining findings are minor.

Before stopping, make sure the deliverable render was produced by the final build at the required
settings, and that the round files name the findings still open. Do not stop after fewer than three
critic rounds unless the time budget forces it: the first renders almost always have major findings that
only appear once every critic has looked.
