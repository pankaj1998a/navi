---
name: web3d
description: Use before building or materially changing a single-file 3D web page, 3D scene, 3D model viewer or 3D browser game (three.js, WebGL, WebGPU or WGSL). It gives a method for getting from the brief to a page that opens without errors, shows a recognisable subject and does everything the brief asks. Not for 2D pages or 2D games, changes inside an existing multi-file or framework project, UI-only edits, Blender renders, server or API work, or review-only, plan-only and explanation-only turns.
user-invocable: false
---

# Web 3D pages and browser games

Goal: a 3D page that opens without a console error or warning, shows what the brief asks for, does everything the
brief names through its own controls, and that a fresh player, after playing it, calls ready. Read this whole file
before writing any page code; page code written earlier is a draft: plan in section 1 and rebuild what falls short.

**A newer user message always wins over this method.** When the user writes while you work, stop the loop at once:
no more check_page runs, screenshots, browser scripts, critique rounds or repair rounds. Then do what they asked:
- Stop, exit, cancel or done: reply in a sentence and make no more tool calls, not even to clean up.
- "Open it" or "just open it": open the delivered file (or serve it and give the URL) and stop. Do not check it again.
- "Don't test", "I'll check it myself", or a new plan: drop the remaining gates and follow the new instruction.

Three habits decide most outcomes:
- **Build forms before effects.** Plan each part's real shape, the world around it and its materials (section 1),
  then build forms, materials, light and effects, in that order. Glow, bloom and fog over boxes still read as boxes.
- **Run it and look.** Load the exact file in a real browser, headless, after every meaningful change, read every
  console level (WGSL compile errors arrive as warnings), open the screenshots, and drive each feature through the
  page's own controls. A shader error you never see ships as a blank canvas; a defect you never look for ships too.
- **Then let a fresh player play it.** A clean run says the page works, not that someone who asked for it would be
  pleased. After the first passing build, a critic who has not seen your code plays the page and writes a critique
  file (gate P); you rebuild what it names and ask again until it says ready or the time guard stops new rounds.

Reference files (read the one you need when you reach that step):
- [browser-harness.md](references/browser-harness.md): finding the browser, check_page.py and its flags, own views.
- [webgpu-wgsl.md](references/webgpu-wgsl.md): WebGPU path, import maps, safe init and fallback, traps, root error.
- [defect-review.md](references/defect-review.md): screenshot questions, input chains, fixes keyed to defects.
- `scripts/check_page.py` runs the page in headless Chromium and reports the renderer, what the page drew with,
  console messages, page and GPU errors, failed requests, and a blank, frozen, covered or black canvas (`--help`).

If `plugin:threejs:threejs` is available, read its references for API details; this skill does not repeat them. Its
WebGPU post-processing snippet (`three/addons/nodes/Nodes.js`) is out of date: follow webgpu-wgsl.md instead.

## 0. Contract

Settle these before writing code. Current user instructions always win; otherwise use the defaults.

| Question | Default |
|---|---|
| Deliverable | What the user asked for, at the path they name. One HTML file with inline CSS and JS when they ask for a single file, a paste-ready page or an offline page. |
| External resources | Libraries pinned to an exact version, addons from the same version. When the brief says single-file, offline or no external assets, generate models, textures and sound in code. Any URL you keep must load: a failed request is a bug to fix, never one to hide behind a procedural stand-in. |
| Start | The 3D scene renders and moves as soon as the page opens; nothing waits on a blank or frozen screen. A title card may sit over a live world; a game shows a running demo or its live world until the player acts. |
| Console | No errors and no WGSL, WebGPU or shader warnings. |
| Screens | Desktop and a phone in portrait with touch. The canvas is visible without scrolling; no horizontal scroll. |
| Renderer | three.js `WebGLRenderer` unless the brief asks for WebGPU, WGSL, TSL or compute (then webgpu-wgsl.md). |
| Quality | The machine you build on may render in software and run the page slowly; the people who open it have a GPU. Never lower the default quality, shadows, antialiasing or effects because of a frame rate measured here, and never pick a tier from measured frame time. Look at the full tier when you check the page (force it in a copy under `/tmp` if the page would drop it). |
| Comfort | No full-screen flashes and no strobing faster than about three times a second; honour `prefers-reduced-motion` (calmer camera, no shake or flashing). |
| Questions | When the user says not to ask, make every design choice yourself. |
| Browser | Use the browser already on the machine. Playwright's Chromium often sits only in its cache (`$PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright`, `/root/.cache/ms-playwright`) with nothing named `chromium` on `PATH`, so a failed `command -v chromium` does not mean there is no browser: run check_page.py, which looks in all of them. If it finds no browser, do not install one: keep the static checks in gate B (with `scripts/wgsl_lint.py` on WebGPU pages and browser-harness.md section 8), skip gates R, L, Q and P and the final run in gate D, and say in the handoff that the page was not run and how to open it. |
| Testing | Headless, in the background: check_page.py and your own headless Playwright scripts. While you iterate, never open the page in the user's browser or a visible window (`open`, `xdg-open`, a headed browser): it takes focus and windows jump around. Open one visible window only if a check cannot run headless or the user asks. |
| Verification | If the user says they will open or check it themselves, or declines verification, do not run the page: skip gates R, L, Q and P and the final run in gate D, keep the static checks in gate B, and say in the handoff that the page was not run. |

## 1. Plan (before the first write)

Write down, in your working notes, in concrete terms (shape words, sizes, hex colours, inputs):
1. **Test list.** Every behaviour, control, mode and UI element the brief names, one line each, with the input that
   reaches it in the page's own UI and the visible result that shows it works. For cinematic, scripted or
   preset-driven briefs, also every beat, preset, zoom limit and lighting state the brief names. Gate L uses it.
2. **Renderer.** The path and pinned version (webgpu-wgsl.md section 1 for WebGPU, TSL or WGSL briefs).
3. **Forms.** For each part a person looks at first: its silhouette, real proportions and the parts that make it what
   it is, each with a technique taken from the real part: `LatheGeometry` from a traced profile (turned parts),
   `Shape` + `ExtrudeGeometry` (outlines with thickness), `TubeGeometry` on a curve (pipes, cables, limbs), rings
   lofted along a spine (hulls, bodies), `InstancedMesh` along the real path (repeats). Hold every part to this bar:
   bevel or round the visible hard edges of manufactured objects; cut openings (windows, vents, sockets, a mouth)
   into one closed shell (holes in the `Shape`, a gap in the lathe or loft), never a dark slab stacked on a solid;
   use a plain primitive only where the real part is one (a ball, a rod, a crate). Voxel, brick and low-poly briefs
   use boxes and flat facets on purpose; plan their silhouettes all the same. Watch lugs made as rotated boxes read
   as crude slabs; a curved lug outline extruded with a rounded bevel and drilled for its spring bar reads as a lug.
4. **World layers.** Ground or play area, near, mid, far and moving elements, each with its own technique, and no
   floor edge or empty void shows from any view the page allows. Props scattered on a flat plane read as a toy; a
   ground drawn in code that fades into the backdrop, detailed props near the camera, instanced variants behind them,
   far silhouettes fading into haze and one moving layer (drifting particles, cloud, water) read as a place.
5. **Material roles.** Each role the subject needs, with a hex colour and a starting roughness/metalness tuned by eye
   (say, steel 0.25/1, brass 0.3/1, paint or plastic 0.4/0, skin 0.6/0, wood or stone 0.8/0, rubber or cloth 0.9/0,
   glass a `MeshPhysicalMaterial` with transmission); glossy and metal roles reflect an environment map
   (`PMREMGenerator` + `RoomEnvironment`) or render grey. Emissive is for signals only (lamps, screens, exhausts,
   pickups), never a whole object. Draw textures and detail maps in code: a `CanvasTexture` for seams, grain, labels
   and panel lines, noise for variation, a roughness or bump map from the same canvas.

## Time guard

Note the start time (`date`) before the first write; it decides when to stop.
- From the first clean run on, the delivery path always holds the latest passing build: make repair edits in a copy,
  check the copy, and copy it over the delivery file only when it passes.
- Run check_page or a browser script again only after an edit since its last run. A check that passed on the same
  bytes is not repeated; the final run in gate D on the cleaned file is the one exception.
- Known budget: open no new critique round (gate P) after about half of it; freeze at about two thirds, go to gate D.
- Unknown budget: stop after the second critique round (sooner if a round leaves the page no better), then gate D.

## 2. Build (gate B)

- Write the page in banner-commented sections (config, helpers, renderer and scene, content, state, input, camera,
  audio, UI, main loop, boot). For a very large page, write part files and concatenate them with a small script;
  reassemble the delivery file every round.
- Build in this order: forms (every planned part with its technique and the bar, every world layer), then materials
  (the planned roles and code-drawn maps), then light (key, fill, shadows where things touch, tone mapping with sRGB
  output), then effects. Effects (bloom, fog, glow, particles, darkness) never stand in for missing form: fighters
  built from stacked boxes still looked crude with bloom, hit-stop and screen shake all in place.
- Make the page alive at boot: start the frame loop at once and run idle motion.
- Show a readable error overlay (from `window.onerror`, `unhandledrejection` and GPU init failure) instead of a black
  page. A raw-WebGPU page switches to its fallback on compile errors, `uncapturederror` and device loss too, on a
  fresh canvas (webgpu-wgsl.md section 2).
- Write shaders multi-line, one statement per line, and go through the trap tables in webgpu-wgsl.md before the
  first load. On WebGPU pages also run `scripts/wgsl_lint.py page.html`: advisory, and not Chrome's compiler.
- Test through the page's own controls; a debug hook goes in a copy under `/tmp/w3d/`, never in the delivered file.

Gate B passes when the delivery path holds the whole plan and each test-list line is reachable through its own UI.

## 3. Run (gate R)

Gates R, L, Q and P run the page; skip them under the verification opt-out or without a browser (section 0). The scripts are in the
`scripts/` folder next to this SKILL.md (`<skill-dir>` is the path {{tool:read_skill}} returned). Run them without a pipe, so
the exit code and the end of the output cannot be cut off:

```bash
python3 <skill-dir>/scripts/check_page.py /path/to/index.html --out /tmp/w3d/r1; echo exit=$?
python3 <skill-dir>/scripts/check_page.py /path/to/index.html --phone --out /tmp/w3d/r1p; echo exit=$?
```

- Run check_page.py, the runtime check already on hand (it installs nothing), before any claim about how the page
  looks or runs. It finds Playwright's Chromium even if `command -v chromium` does not (browser-harness.md section 1).
- Fix the first root error: a WGSL compile message with its source line, then creation-time validation errors, then
  JS exceptions and failed requests. "Invalid ... due to a previous error" lines are symptoms.
- WebGPU pages: check_page.py enables WebGPU and reports the adapter. If it is null, say so, keep testing the
  fallback (`--webgpu off`), and spend no more than a few minutes trying other flags (browser-harness.md section 3).
- Read the renderer line: a software renderer is slow, so a motion result there can be inconclusive, and shadows
  and heavy post cost a lot; measure them, but keep them in the default (section 0, Quality; browser-harness.md
  section 3). Anything under `checks_not_run` is unknown, not passed.

Gate R passes when check_page.py exits 0 at both sizes, or when the only items left are checks it could not run
that you have covered another way and will name in the handoff.

## 4. Look (gate L)

Open and read every screenshot; numbers do not replace looking. Cover the default view after the page has run a
while with no input at both sizes; the subject from all the way round and from above (browser-harness.md section 4,
or the page's own presets); close views of the parts that make the subject what it is; a frame after each test-list
input, reached through the page's own controls; and each beat, preset, zoom limit and lighting state on the test
list. Ask the screenshot questions in defect-review.md section 2 for each image. On WebGPU, a blank screenshot may
be a capture problem rather than a page problem: check with browser-harness.md section 5 before changing the page.

## 5. Repair rounds (gate Q)

Each round: list the defects from the run, the screenshots and the input chains (defect-review.md sections 1-3),
fix the most visible one with one causal change set (section 5 lists typical fixes), rerun gate R, retake the
affected screenshots, and compare with the previous round. Revert a change that made the page worse. Run every
test-list input chain end to end through real input. When the run is clean and no screenshot question or input
chain shows a defect you can fix, go to gate P; come back here for any run defect a later change causes. A defect
that survives a round of fixes needs a different approach. A new user message ends the rounds at once (the rule at
the top): no further run, screenshot, critique or fix.

## 6. Player QA (gate P)

After the first build that passes gates R and L, and again after each round of fixes until the time guard stops new
rounds, a fresh player plays the page and says whether it is ready. This gate is required, not optional: a first
build that runs clean usually still has shortfalls a player sees at once, and gate D waits for a critique file.

**The critic.** Start a new subagent each round (for example `{{tool:subagent_spawn}}`, then `{{tool:subagent_wait}}` until its result
is ready; a wait that times out leaves it running). Give it only the brief word for word, the delivery file's path
(to run, not to read), the check_page.py path, the paths of the fresh screenshots and checker reports (`report.json`,
`console.txt`) of the current build, for round n its own folder `/tmp/w3d/qa<n>/` and critique file
`/tmp/w3d/critique-<n>.md`, and the prompt below. Its reply reaches you cut to a few hundred characters, so the
objective tells it to write its full critique to that file and reply with only the path and a one-line verdict; read
the whole file before you act. No code, plan, notes or earlier answers: they tell it what the page is meant to show,
and it should report only what is on the screen. Leave the delivery file unchanged while it plays (keep working in your
copy). Without subagents, take the fresh look yourself on purpose: re-read the brief, play the page and open the
shots in a new order before you look at code, and write every answer to the same critique file before you edit.

Prompt (keep its substance; fit the wording to the brief):

> You are a player and QA tester trying this page for the first time; someone asked for it with the brief below.
> Do not open the page source or any notes, and edit nothing. Play it headless with check_page.py (`--out` into your
> folder; run it without a pipe and read the summary): desktop and `--phone`, `--drag` to look around, and `--keys`
> with long holds on every key the page or the brief suggests (for example `KeyW:4000,ArrowLeft:1500,Space`). For
> longer play (its buttons, playing on to a win or a loss, playing again) write a short headless Playwright script
> that launches with the flags in a report.json. Play as a player would: start, look around, use every control, go
> for the goal, lose or win, restart. Open every screenshot. Answer each question with yes or not yet, what a
> player sees, and the screenshot file:
> 1. Opening it cold, are you in a running 3D world at once or after one obvious click, with no blank screen,
>    endless loader, error box or black patch?
> 2. Through all that play, does it keep running: no error, freeze, crash, things flying apart, or a state you
>    cannot get out of?
> 3. When the view moves, do near and far things slide past each other, and does the subject hold together from the
>    side, behind and above, with no hollow backs, holes or cardboard cut-outs?
> 4. Does every key, drag, scroll, tap and button the page shows or the brief suggests do what you expect, at once,
>    and is it easy to work out?
> 5. Does what should move move, smoothly and believably, with no stutter, jumps, or parts that freeze or fly off?
> 6. If it is a game or a challenge: can you tell what you are trying to do, does it show how you are doing as you
>    play, can you win or lose, and does playing again start clean?
> 7. Would a stranger name the subject at a glance, and does it show everything the brief says about it (what it is
>    made of, how it looks, its period and mood)?
> 8. Going down the brief line by line, is each thing it asks for there, reachable on the page, and working well?
> 9. Beyond that list, is there more worth a player's time: things to try, places to explore, detail that rewards a
>    close look, reasons to keep playing?
> 10. Does it look good: light that shapes the subject, shadows where things touch, surfaces that read as their
>     material, colours that sit together, a view that leads the eye to the subject, detail that holds up close?
> 11. Would you show it to a friend as it is, or does something look half-done: UI over the scene, clipped text,
>     seams, flicker where surfaces overlap, parts poking through each other, the camera inside an object?
> Verdict: "ready" only when every answer is a clear yes. Otherwise list the visible shortfalls, the one a player
> would notice most first; for each, the screenshot, what a player sees now, and the change you would make. Slowness
> that comes only from this machine's software renderer is not a shortfall. No numbers or ratings, no praise.
> Write all of this to the critique file you were given; reply with only its path and a one-line verdict.

**The fix round.** Work from the top of the list in the working copy. An item that names a part's construction or
material (boxes, spheres or blobs; a plastic look) is addressed only by replacing that part's technique: rewrite its
builder function to the bar in section 1 (form first, then its material role) and check it in a close view; extra
parts, resizing, recolouring, glow or tuned numbers do not count. Keep the rebuild only if the same views, old and
new side by side, look better; else revert and try another technique. A missing or weak feature goes in through the
page's own UI and joins the test list. Under each critique item write `fixed:` and the screenshot that shows it, or
`answered:` and the reason. Rerun gate R at both sizes, retake and open the shots, and copy the working copy to the
delivery path only when it passes. Then start a fresh critic on the new build. Repeat until the verdict is ready or
the time guard stops new rounds. Treat the list as what a player sees: do not argue it away. A shortfall that
survives two rounds needs a different approach.

## 7. Deliver (gate D)

- Critique closed (skip under the verification opt-out or without a browser): the newest `/tmp/w3d/critique-<n>.md` covers the delivered
  build or the build its fixes started from, and every item in it is marked fixed, with the screenshot that shows
  it, or answered with a reason. Without such a file, do not deliver: run gate P first.
- Remove test code: no `window.__*` hooks and no test-only URL switches unless the brief asks for an API
  (`grep -n "window\.__" index.html`). Every test-list feature is reachable through the page's own UI, and no
  on-page text claims a technique the page does not visibly do.
- Confirm external URLs match the contract (`grep -o "https\?://[^\"' )]*" index.html | sort -u`).
- Final run, after the cleanup (skip it under the verification opt-out or without a browser): `check_page.py --final` on the exact bytes
  you hand off, at both sizes, in a fresh browser context with nothing injected (browser-harness.md section 2). It
  shows the page as a user gets it: open its screenshots, fix what it shows, and run it again after any edit.
- Remove temporary files and stop servers you started, unless the user asked you to stop.
- Hand off briefly, with the path for the user to open (do not open a window yourself): what the page does, the
  controls, what you verified (browser and renderer, sizes, inputs, console), the last player verdict and any
  shortfalls left ranked high, medium or low, and what could not be verified. Claim only what a screenshot at normal
  viewing distance shows; a detail that exists in the code but cannot be seen at that distance is not claimed: make
  it visible or leave it out.

## Pitfalls (full lists in the references)

- Filtering the console to `error` only: WGSL compile errors and many WebGPU validation messages are warnings.
- WGSL reserved words as names (`target`, `ref`, `patch`; in GLSL also `active`, `half`), comma `let` lists, a
  missing `;` after `return`, reassigning a `let`, scalars where a builtin needs vectors, mixing bitwise and
  arithmetic operators without parentheses, a two-argument `atan(y, x)` (WGSL spells it `atan2`), `textureSample`
  in non-uniform branches, two `@builtin(position)` inputs.
- `writeBuffer` on a buffer without `COPY_DST`; `depthBias` on line or point pipelines; colour targets over the
  device's bytes-per-sample limit; a `NaN` buffer size or a JS `NaN` fed into a TSL node.
- three.js `ShaderMaterial`, `onBeforeCompile` or `EffectComposer` under `WebGPURenderer`; addon or build files from
  another version; a `three/tsl` path that does not exist in the pinned version; `PointsMaterial.size` under
  `WebGPURenderer` and `linewidth` above 1 (both ignored).
- Idle motion added for its own sake: keep it intentional (steam, sway, flicker, slow camera drift) and only where
  the subject calls for it. `PointsMaterial` without a `map` draws hard squares: use a soft round sprite texture or
  instanced quads, and look at a close screenshot.
- A WebGPU fallback that starts only on a thrown error or reuses the WebGPU canvas; an overlay that a CSS `display`
  rule keeps visible despite `hidden`.
- Bloom and fog that wash frames to white; a NaN in a feedback pass that grows into a black block.
- Test hooks or switches left in the delivered file; features reachable only from code.
- Handing off at the first clean run with no critique file, or claiming details no screenshot shows.
- Declaring "done" before the final run has checked the delivered file (unless the user opted out of verification).
