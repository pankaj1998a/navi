# Reference-driven 3D and game visuals: the process

This is the step-by-step process the `game-3d-visuals` workflow's children follow (and the parent follows itself only when no `workflow` tool exists). Paths like `scripts/` and `references/` are relative to the skill directory.

Five steps, in order:

1. **References**: a consistent set of target images.
2. **PRD**: a detailed visual spec with a work breakdown and acceptance criteria, checked against the references before building.
3. **PRD review**: one pass that fills the gaps.
4. **Build**: implement against the PRD and the references.
5. **Acceptance**: real renders/screenshots vs references and PRD criteria; failures become a polish list in the PRD, then back to step 4.

Steps 2 and 3 are required: do not write build code before `visual-plan/PRD.md` exists.

For tool technique, also use the matching skill when available: `blender` (its `scripts/compare.py` makes reference-vs-render sheets and metrics inside Blender), `threejs`, `browser-app-delivery`.

## Budget: spend tool calls on renders, not documents

Each of your turns can take a minute or more, so a task often affords only 30–50 tool calls. Plan for that:

- Steps 1–3 together: references 1–3 calls, then the pipeline workflow (or, inline, one PRD write plus the review). No todo-list bookkeeping, no separate crop explorations when generated views exist, no re-reading files you just wrote.
- First render (the blockout, see step 4) by about tool call 12. First complete render of the whole subject within the first ~third of the effort.
- The rest: acceptance + polish rounds. Batch several fixes into one edit/rewrite and one render per round; do not render after every small tweak, and do not spend calls probing API details you can guard with `try/except` or `hasattr`.
- If a time or turn limit is stated, check elapsed time each round (`date`), and stop polishing with margin left.

**Protect the deliverable.** The required output (e.g. `render.png`) must always hold the best version so far, because work can be cut off at any moment:

- After the first good render, keep a copy: `visual-plan/best/` (render + build script).
- Render experiments to a candidate path, compare against the best, and only then copy the winner to the deliverable path and to `best/`. If a round makes things worse, restore from `best/`.

## Workspace

```
visual-plan/
  refs/            # canonical reference(s) + generated views
  PRD.md           # the spec; grows "Polish round N" sections
  best/            # best render + build script so far
  acceptance/round_NN/   # candidate renders, side-by-side sheets, verdict.md
```

Never modify, move or overwrite a reference the user supplied; copy it into `refs/`.

## 1. References (output: `visual-plan/refs/` + reference index in PRD.md)

References are the target for every later step. They must agree with each other: same object, proportions, colors, materials and style.

**If the `image_generation` tool is in your tool list, your first tool call after viewing the input is `image_generation`; this is not optional.** "The reference already looks clear" is not a reason to skip: hidden sides and small details are exactly what generated views add. If that first call fails, go straight to the fallback below.

- **Text-only prompt**: first generate one **hero image** (3D model: the subject in a clean three-quarter studio view; game: a key gameplay screenshot from the real play camera, with HUD). View it; if it misreads the prompt, regenerate it once before going on.
- **User gave reference image(s)**: the user's image is the hero and the ground truth. Generated views add information; they never override it. A generated view that contradicts it is discarded.
- Then generate **2–4 derived views** with the hero in `image_paths` (plus any user references), so the model edits from it instead of reinventing the subject. Choose what the build needs: hidden sides (side, back, top), close-ups of hard details (joints, trims, small parts, material surfaces); for games, a second gameplay moment, the HUD/menu, a character or prop turnaround.
- Put consistency in every derived prompt: "the same <subject> as in the image, identical shape, proportions, colors, materials and style; only the camera changes to <view>" (or "a close-up of <part> of that same <subject>"). Keep background and lighting style the same.
- Example first call for a user reference at `ref.jpg`: `image_generation(prompt="The same <subject> as in the image, identical shape, proportions, colors, materials and style, on the same plain background; only the camera changes: seen from the side, straight on, at the same height.", image_paths=["ref.jpg"])`.
- View each result. Drop any image that changes the design (extra/missing parts, other colors or proportions).
- The PRD's reference index must list each generated view kept, or quote the exact `image_generation` error that sent you to the fallback.
- If a call fails with an HTTP 4xx, "unavailable" or "refused", do not retry it: continue with the fallback below. Retry once only on a timeout or 5xx.

**Fallback (no `image_generation`, or it failed):** with a user reference, it is the target; look at zoomed crops of the subject (crop with Blender/PIL/ImageMagick, then view) and write the hidden sides as explicit assumptions. Text-only: write the hero you would have generated as a precise description (composition, palette with hex, lighting, materials) and use that as the target.

**Exit check:** every visible part of the subject appears clearly in some reference, or is listed as an assumption.

## 2. PRD (output: `visual-plan/PRD.md`)

Write it from the references and the prompt, in one file write. It must be precise enough that someone who never saw the references could build the same thing: numbers, ratios, hex colors, counts and positions, never "nice", "realistic" or "some details". Aim for 60–150 lines. Template: [references/prd-template.md](references/prd-template.md).

Sections:

1. **Goal and visual pillars**: what is made; the 3–5 qualities that make it look right.
2. **Reference index**: each image, what it shows, what it is authoritative for; assumptions for unseen parts.
3. **Global look**: style; palette (hex per named color, sampled from the reference where possible); lighting (key/fill/rim direction and softness, environment, shadow look); camera and framing (angle, height, lens feel, how much of the frame the subject fills); background and ground (e.g. "pure white #FFFFFF everywhere outside the subject and its soft contact shadow"); render settings.
4. **Per object, per part**: shape and silhouette with proportions as ratios to one base unit; parts list with count, size, position, attachment; material (base color hex, roughness, metallic, transmission, emission, pattern); details (bevels/edge softness, seams, knurling, decals, wear); which reference shows it.
5. **Games only**: core loop, controls, camera behavior, states (start, play, win/lose, restart), HUD/menus, feedback and juice, animation, audio. Spec only the UI, controls and states the request or the game itself needs; a scene or model request gets no added title overlays, buttons or panels.
6. **Technical constraints**: tool/engine, required output paths and formats, resolution, render engine/samples, performance.
7. **Work breakdown**: ordered parts, foundation first: camera, framing, background and light rig → big forms → secondary parts → materials → details → polish.
8. **Acceptance criteria**: numbered, each observable in a render/screenshot and naming its reference ("AC-07: handle top at 80–85% of body height, as in hero.png"). Cover silhouette and proportions, each part's presence and count, colors and materials, lighting and shadow, background, camera and framing, and for games each state and interaction. Include measurable checks where possible (background pixel values, subject bounding box as a fraction of the frame, sampled colors). End with: "side by side with the hero, a viewer would call them the same object/game".

## 3. PRD review

View the hero reference again (and crops of dense areas) with the PRD next to it. Walk the image in a 3×3 grid: anything visible that the PRD does not specify with numbers? Usual gaps: missing small parts, wrong counts, unspecified colors, edge treatment, texture, ground shadow, background. Measure proportions from pixel bounding boxes, not by eye. Apply all fixes in one edit and add a short "Review" list of what changed.

## 4. Build

- Write the build as one reproducible script/source (e.g. one `bpy` script that rebuilds the scene from scratch), so each round is an edit plus a rerun. Use the PRD numbers. When the reference and the PRD disagree, the reference wins; fix the PRD.
- **Blockout gate first.** The first render contains only the big forms, but with the final camera, light rig, background and base colors. Before adding any detail, compare it with the hero and fix until all four hold:
  1. **Camera and framing**: same viewpoint (azimuth, elevation, lens feel); the subject is fully in frame and fills the same fraction of the frame as in the hero (measure both bounding boxes, e.g. "subject spans 62% of width in the hero, 81% in the render → pull the camera back").
  2. **Silhouette and proportions** of the major masses (measured ratios, not impressions).
  3. **Values and colors of the big masses**: a near-black object renders near-black, a white one white, with the hero's contrast between them.
  4. **Background and ground**: matches the hero (e.g. pure white with a soft contact shadow; check corner pixel values).
  These four dominate how similar the result looks; detail on a wrong camera, silhouette or value is wasted. Re-check them in every later round, since edits can break them.
  For a Blender build against a reference image, check 1, 3 and 4 with the measuring script after each blockout render (`<skill dir>` is the directory of this SKILL.md, shown as `path:` in the read_skill result):
  `blender -b --factory-startup --python <skill dir>/scripts/tone_compare.py -- <reference> <render>`
- Then add secondary parts, materials and details in work-breakdown order.
- **Studio look on white** (a single subject on a seamless white background with a soft shadow, a very common reference style): set it up from the start with [references/studio-look.md](references/studio-look.md). It keeps the background pure white while the subject gets contrasty light and a soft contact shadow; the naive setup renders a gray background and flat subject.
- Hard-surface objects: build from clean primitives with bevels (e.g. a Bevel modifier with 2–3 segments) so edges catch highlights; avoid displacement or heavy subdivision that makes rigid forms look lumpy.
- References are targets, not assets: do not paste, project or trace them into the deliverable unless the user asked for that.

## 5. Acceptance loop (output: Polish rounds in PRD.md, best version in `visual-plan/best/`)

Judge the real artifact, never the code.

1. **Capture** the output at final quality from the reference viewpoint(s): hero camera first, then other reference angles that exist. Games: run the game and screenshot each state on the acceptance list (headless browser such as Playwright, or the engine's screenshot path).
2. **Compare side by side** (reference | output) and **measure**. Run `scripts/tone_compare.py` (relative to this file) inside Blender: `blender -b --factory-startup --python <skill dir>/scripts/tone_compare.py -- <reference> <render>`. It reports background, subject size and position in frame, and subject brightness, contrast, darkest and brightest areas against the reference, with what to change; renders typically come out too small or large in frame, with shadow sides too light and too little contrast. It needs only Blender's own Python. For Blender, the `blender` skill's `compare.py` adds overlay and difference sheets but needs numpy, which some Linux Blender packages lack; if it fails on `import numpy`, skip it. View the sheet and the output alone at full size.
3. **Score every acceptance criterion** pass/fail with evidence in `verdict.md`, then list every other visible difference ranked by impact: camera/framing and silhouette/proportions/missing parts > color, value and material > lighting, shadow, background > small details. Write each difference as a measurement with a target ("lens barrel 15% too short", "body #5A5A5A, target #1A1A1A"), not an adjective. Be adversarial: look for what is wrong. A subagent reviewer that gets only the reference and output images, if available, is less biased than you.
4. **Decide**: all criteria pass, the measuring script reports framing and tone close, and no major or moderate visible difference remains → accept and finish. Otherwise append **"Polish round N"** to PRD.md: each defect, the exact target from the reference (numbers, hex, positions), and the code part that owns it. Fix the whole list in one batch, highest impact first, re-render, and repeat from 1.
5. **Keep the best**: promote a candidate only if it is better overall than `best/`; otherwise restore and try a different fix. After two failed attempts at one defect, change approach (rebuild that part another way) or move on.
6. Stop when accepted, or when the budget is nearly spent: make sure the deliverable holds the best version, then finish.

Common causes of a lower match, worth checking every round: background not pure white (world too dark or a gray floor; check corner pixels), flat lighting with no clear key highlight or contact shadow, plastic-looking materials (wrong roughness/metallic, no bevels to catch highlights), missing small parts that the reference clearly shows, and subject framed larger or smaller than in the reference.

In a long interactive session (not a single headless run), `cron_create` can schedule a recurring prompt such as "re-run the pipeline with stages ["accept"] on the latest build" so review keeps pace with ongoing edits; delete the job when done.

## Final message

What was built, where the deliverables are, how many acceptance rounds ran, which criteria pass, and the remaining visible differences, if any.
