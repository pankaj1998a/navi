# Critic brief: play the game as a new player and a demanding art director

The message that started you gives five values: BRIEF (the design file), REFERENCE (a reference image, or `none`),
GAME (a copy of the game folder), CRITIQUE (the file you write) and SKILL (the folder this file is in). Use them
exactly. You are not the builder: do not read the game code, do not change any file in GAME, and do not write a bot
that reads or sets game state.

**Clock.** Run `date` now and again after each area or level. At 20 minutes, stop playing and write the answers.

**Start.** Serve GAME on a free port of your own (for example `python3 -m http.server 0 --bind 127.0.0.1 --directory GAME`, then read the
port) and open it in the browser at 1280x800. Create CRITIQUE now and append to it as you go, so it is useful even if
you are stopped.

**How to play.** Real keys and clicks only. No faster than a person reacts (about 4 inputs a second at most); hold keys
for real time; wait to read menus and dialogue. Route: the first minute with no help, every control, each area or level
once, one loss, and one win if you can reach it.

Write CRITIQUE in this order:

## 1. SCENE
Save the title screen and one play screenshot per area. Run
`python3 -I SKILL/scripts/sheet.py <CRITIQUE folder>/look.png REFERENCE <title.png> <play shots>` (leave REFERENCE out
when it is `none`) and open look.png. With REFERENCE=none, compare to the look the BRIEF describes. Answer each check yes,
partly or no, and name the screenshot:
- L0 drawn, not primitives: list each character, prop and scenery piece in your shots and how it is drawn. no = the
  player or 3 or more pieces are plain boxes, spheres, cones, rectangles or ellipses, or stacks of them; partly = 1 or 2
  pieces other than the player; a no here is a major
- L1 scene share: how much of the screen is scene rather than flat panel, and whether the interface sits at the edges
- L2 size: characters and key objects big enough to read on screen
- L3 surfaces: texture and detail on ground, walls, sky (not flat fills)
- L4 density: props and scenery that make each place feel built
- L5 lettering: a real font, sized and fitted to its panels
- L6 variety: areas or levels that look different from each other
- L7 art in place: list each generated image you see (backdrops, characters, enemies, props, icons) and where.
  no = no generated image in the game at all, a sprite with a coloured or white box or fringe around it, art in
  clearly different styles side by side,
  a character drawn as a plain shape while art exists for it, or a backdrop whose painted objects look like things
  the player can use but cannot; partly = one such defect; n/a when GAME has no `assets/manifest.json` (no art
  director ran)

## 2. RESPONSE
Answer yes, partly or no:
- F1 feedback: for each hit, heal, pickup, buy, reject and enemy action you meet, take one screenshot right after the
  input and another 0.5 s later. yes = both show a mark at the spot (number, burst, flash, outline); partly = only in a
  log or one frame; no = nothing on screen.
- F2 motion: characters and objects animate when they act (not just jump to the new state).
- F3 first minutes: playing with no hints, count failures and deaths and where they happened. yes = you understood
  what to do and failed for fair reasons; no = three failures at one spot you could not understand.

## 3. FINISH
Count defects the way a player notices them. Save five fresh screenshots: the title before any input, play with the
full HUD, the busiest moment (most labels, prompts, toasts and actors on screen), an open panel or pause, and an end
screen. Under X1, list every defect you see in them and in every other screenshot you took, one line each with its screenshot: text clipped, overflowing its
box or off the screen; text over text; a label, prompt, toast or panel covering the player, a target, a button or a
heading; a hint, prompt or highlight still shown after its action is done; sprites in the wrong order, floating or cut
by a wall; a see-through panel; internal ids, design notes or debug text. Then answer yes, partly or no:
- X1 defects: yes = none, partly = 1 to 3, no = 4 or more
- X2 live numbers: no stale or stuck numbers; the HUD does not wrap or jump when values change
- X3 art finish: no reused, placeholder or emoji art; no holes, stray focus rings or broken frames

## 4. RULES
Pick 8 lines of BRIEF your route reaches, in this mix (stated numbers seldom break; these lines often do):
- 3 from its controls: each key, click or mouse action it names, and Escape, Enter and Space in menus and panels. In
  3D, also check that moving the mouse right and pressing D turn and move you right, that the horizon stays level, and
  that what the brief places east is on your right when you face its north; if any of these fails, the line is broken.
- 3 that name something the player is shown: a preview, confirm, warning, tell, list, readout, icon or end-screen row.
- 2 that say what changes after an action: what unlocks, resets, is used up or removed, or stops.
For each: quote the line, say what you did and saw, and mark it holds, broken or not reached. Decide from play only,
never from code.

## 5. RECIPES
For every check not answered yes, name one recipe from this list and say where it applies: shaped parts, never raw
primitives; three tones and a ground shadow on every object; bring it on screen; atmosphere: fog and a backdrop that
fades into the horizon colour; one ink colour in three weights, matched to the reference; each Visual direction item
drawn as its own object, set dressing repeated and varied; light layer over the scene; sub-parts and surface texture on
the biggest props; real fonts; UI kit; fit all text, fixed slot for changing text; effect at the target; title and end
screens over the dimmed live scene; labels and badges as pills; palette, ground, props and weather from a per-level
table; cut a fringed sprite again (`python3 -I SKILL/scripts/sprites.py cut <image> <out> --tol 90`) or regenerate it in
the art plan's style line; scale sprites to the art plan's size table; bake a textured layer; scale it up or move the
camera; full-screen scene with the interface at the edges; gentler first encounter or a clearer warning.

## 6. CARRY-OVER
After your loss, retry. Reload in the middle of play and continue. Start a new game. Write each thing from before that
is still drawn, misplaced or dead, as a major.

## 7. BUGS
Everything else you met, each tagged blocker, major or polish, with its screenshot and the steps to repeat it.

## Last line
`not yes: SCENE n, RESPONSE n, FINISH n | answered no: n | rules broken: n | bugs: blocker n, major n, polish n`
