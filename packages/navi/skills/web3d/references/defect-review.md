# Defect review: what is wrong in this run, this screenshot, this input chain, and how to fix it

Use this in every repair round and once more before delivery. Every finding points at evidence (a screenshot file,
a check_page.py result, an input and what it did), names the defect, and names a fix. Nothing is rated: a round
ends with a list of defects, and the loop ends when that list has nothing left you can fix. When the user opted out
of verification (SKILL.md section 0), the page is not run, so there is nothing to review here.

## 1. Run defects (fix these before anything visual)

- Any console error, WGSL or WebGPU warning, page error, GPU validation error or failed request. Fix the first root
  error: a WGSL compile message with its source line, then creation-time validation errors, then JS exceptions.
  "Invalid ... due to a previous error" lines are symptoms.
- A blank, uniform or mostly black canvas; a canvas that does not change without input.
- Something other than the canvas on top of it at the centre or the quadrants (a loader, a fallback panel, a
  start overlay that never leaves, an invisible full-screen div that eats clicks).
- A black block in one region: often a NaN in a post-processing or feedback pass, or a failed render target.
- The canvas below the fold or horizontal scrolling at either size.
- Anything listed under `checks_not_run`: find another way to check it, or report it as unverified.

## 2. Screenshot questions (ask for every image)

1. What would a stranger call this in two seconds? Which defining part of the named subject is missing, wrong in
   proportion, or a stand-in shape?
2. Does the subject show what the brief says it is made of, looks like and feels like?
3. Is the subject framed, large enough, and not covered or cropped by UI at this size?
4. Exposure: a white wash from bloom or fog, black voids, crushed shadows, blown highlights on the subject?
5. Does anything float above the surface it should rest on, stick out of or sink into other parts, or flicker
   where two surfaces overlap? Is a side the camera can reach hollow?
6. Is anything cut off by the camera's near or far plane (a hole through a close object, distant scenery
   vanishing)?
7. Is helper or proxy geometry visible (axes, grids, bounding boxes, collision shapes, debug markers)?
8. Do transparent parts draw in the wrong order (glass hiding what is behind it, particles cut off by a window,
   flicker as the camera turns)?
9. Is the space around the subject designed (ground, backdrop, context), or an empty void?
10. Does the UI look designed and consistent, with readable text and no overlap?
11. Compared with the previous round's shot of the same view, is it better? If not, revert the change.

Do not flag what is on purpose: stylised lighting (toon shading, a single coloured key, silhouettes), simple or
voxel geometry that the brief or the art direction chose, and camera motion the page does deliberately (an opening
move, an auto-orbit, a cinematic path).

## 3. Input chains (for every behaviour the brief names)

Drive each one through the page's own controls (keys, drag, wheel, click, touch, buttons, sliders) and check the
whole chain, not one key:
- shoot -> health drops -> enemy dies -> score rises; collect the key -> the door opens;
- die or finish -> results -> play again -> everything reset (score, timers, entities, camera);
- a toggle, preset or slider -> a visible change, and the subject still framed afterwards;
- pause -> nothing moves -> resume without a jump; the first input during a demo or title -> the player is in control;
- hits, explosions and transitions -> no full-screen flash and no strobing faster than about three times a second;
  with `prefers-reduced-motion` set, calmer still;
- cinematic, scripted or preset-driven briefs -> every beat, preset, zoom limit and lighting state the brief names,
  reached by waiting or through the page's own controls, and looked at.

A behaviour that is only reachable from code or the console is missing. On-page text that claims a technique the
page does not visibly do is a defect too: make it true or remove the text.

## 4. Fresh-eyes critique

The fresh look is the player QA in SKILL.md gate P: after the first passing build, a critic that has not seen the
code plays the page with check_page.py and answers the player questions there, and you fix its ranked shortfalls
with the same causal rounds as here (the table in section 5 helps). Do not run a second, separate critique.

## 5. Fixes keyed to defects

| Defect | Typical fix |
|---|---|
| Subject reads as a generic shape | Rebuild the defining part from a profile, lathe, loft or extrusion in real proportions; add the missing landmark |
| Something the brief says about the subject does not show (glass that is opaque, brass that is grey) | Change the material (transmission, clearcoat, metalness with an environment), not only the colour |
| Parts float or clip | Attach trim to the surface with a small offset; set each object's height from the ground height the terrain itself uses; parent moving parts at their real hinge |
| Cut off by the near or far plane | Set `near` and `far` from the scene's bounds and the closest and farthest camera positions |
| Helper geometry visible | Remove helpers from the delivered file; keep them only in a debug copy under `/tmp/w3d/` |
| Transparent parts in the wrong order | `depthWrite: false` on transparent materials, `renderOrder` for layered glass, `alphaTest` for cut-outs |
| Full-screen flash or fast strobe | Flash a small area or a vignette instead, slow it below about three a second, drop it under reduced motion |
| Faceted curves | More segments on hero curves, smooth normals, a small bevel |
| White wash | Raise the bloom threshold, lower its strength, thin the fog, lower exposure |
| Black void or dark metal | Add an environment map and a fill light; check for NaN in post or feedback passes |
| Flat, plain lighting | One warm key with shadows, a cool fill, a rim light, a gradient backdrop |
| UI covers the subject | Move panels to the edges or a bottom sheet on phones; offset the camera view |
| Empty void around the subject | Ground, backdrop, context props, ambient motion |
| Particles drawn as hard squares | A soft round sprite texture as the points' `map`, or instanced quads |
| Idle motion that looks arbitrary | Keep only motion the subject would have (steam, sway, flicker, slow camera drift) |
| A control does nothing | Wire it, then run its input chain end to end; remove it if it cannot work |
| Motion stutters or jumps | Fixed-step simulation with a clamped delta; damped camera; no per-frame allocation |
| A defect survives a round of fixes | Change the approach (rebuild the part, change the light rig) instead of tuning numbers |

## 6. When to stop

Stop repairing when the run is clean and no screenshot question or input chain shows a defect you can fix; then go
to the player QA in SKILL.md gate P, which decides when the page is ready (or the time guard says to freeze). In
the handoff, list what you checked and found fine, rank anything you know is still wrong as high, medium or low, and
name what you could not check.
