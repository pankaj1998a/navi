---
name: browser-game
description: Spawn an art director subagent and run three critic rounds for every playable browser game (2D, 2.5D or 3D) built from a brief or design document, or a material change to one: the art director makes the game's art while you build, then each play, review and improve round uses a fresh critic. Short or quick game asks stay light (build, play once, hand off), so read it for those too. Read it before you plan; if game code already exists, read it now and switch to its todo list. Not for non-game pages, small fixes, or review-, plan- or explanation-only turns.
user-invocable: false
metadata:
  short-description: Art director subagent plus three critic rounds for full browser-game builds, short game asks stay light; switch to it now even if game code already exists
---

# Browser games: a game-studio process

**Start here, even if you already wrote game code.** Reading this skill does not finish the job; following it does.
First pick the size of the work (**Size the work to the request**, below). For a Full build, if you are mid-build or
already have your own todo list, stop editing now: your next tool call is `{{tool:write_todos}}` with the nine items under
**The process, in order** below, replacing your own list. Keep the code you wrote; the Build item goes on from it.

**A newer user message always wins over everything in this skill, including the todo list: it cancels the open
Round items.** When the
user writes while you work, stop the loop at once:
- Stop, exit, cancel or done: reply in one sentence and make no more tool calls, not even to clean up.
- "Open it" or "just open it": your next tool calls cancel any critic subagent still running (`{{tool:subagent_cancel}}`) and
  serve the delivered folder in the background (for example `setsid -f python3 -m http.server 8765 --bind 127.0.0.1 --directory
  <game folder>`; a server a critic started stops with it); then give that URL, or the file path if you cannot serve it, and
  stop. Do not read a critique, edit the game, check it again or start another round.
- "No need to test", "I'll check it myself" or "don't run it": do not run or screenshot the game; finish the build,
  say in the handoff that it was not run, and say how to open it.
- A new plan or change: do that instead.

**Browser.** Use the browser already on the machine. Playwright's Chromium often sits only in its cache
(`$PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright`, `/root/.cache/ms-playwright`) with nothing named `chromium` on
`PATH`, so look there before you decide there is none. If there is no browser, do not install one: skip the play
rounds, keep the code checks, and say in the handoff that the game was not run and how to open it.


**Files.** Build every game, at every size, in a new folder of its own (for example `game-2048/`), with the page,
the styles and the code in separate files (`index.html`, `style.css`, `game.js`; split the code further as it grows).
Never deliver one big HTML file, and never write the game straight into the workspace root.

**Size the work to the request.** Pick one of three sizes before you start, and say which in your notes:
- **Full** (everything below: the art director, three rounds with fresh critics): only for a long game design document, about
  2,000 words or more with many systems, rules and numbers, or when the user explicitly asks for hours of polishing.
- **Standard**: a detailed game request shorter than that (a page or two). Build the whole game, play it once from a
  fresh load with real input, run one critic with its checklist (Rounds, below), fix its "no" answers and its blockers and majors, do
  the final play of the delivered files, and hand off.
- **Compact**: a short request (a paragraph or less, one page, a prototype or demo). Build it, play it once, fix what
  you saw, and hand off. No critic.
If the user later asks for more polish, move up a size then. Everything from **The process, in order** to the end is the
Full build; a Standard build uses only its section 4 critic step, once, and its section 5 final play.

**The process, in order.** For a Full build, before you write any file (or right now, if you already wrote game code), call `{{tool:write_todos}}`
with these items and keep them until each one is really done; never cancel one, and mark one completed only when the
work it names has happened (a file written, a subagent spawned, a critique read):

1. `Brief: save the whole brief word for word to /tmp/game/brief.md; its last lines match the brief's end`
2. `Art director: spawn it now with the exact message below; it makes every asset while you build`
3. `Spec: write /tmp/game/spec.md (requirements trace, balance targets, feedback plan)`
4. `Build: the whole game; simple shapes where art will go`
5. `Wire the art: wait for the art director, then draw every asset in assets/manifest.json in the game`
6. `Round 1 (playable and cohesive): critic + your own playtest; review.md; fix blockers and majors`
7. `Round 2 (fun and fair): critic + your own playtest; review.md; fix blockers and majors`
8. `Round 3 (impressive and converged): critic + your own playtest; review.md; fix blockers and majors`
9. `Final play of the exact delivered files; sprites.py check prints hand-off: yes`

**Your first tool calls after reading this (Full):** `{{tool:write_todos}}` with this list; save the brief (item 1); then spawn the art
director with `{{tool:subagent_spawn}}` and exactly this message (fill in the values): `Read <this skill's folder>/art-director.md
and follow it exactly. BRIEF=/tmp/game/brief.md REFERENCE=<reference image or none> GAME=<game folder>
SKILL=<this skill's folder>`. Do not wait for it: go on with the spec and the build while it works. Do this even if you
already wrote game code. A brief that says the art is drawn in code, procedural or made by you does not replace the art
director: the art it generates and saves in the game folder meets that brief. Skip it only when no `{{tool:image_generation}}`
tool is in your tool list.

In a Full build, after every step run `python3 -I <this skill's folder>/scripts/sprites.py check <game folder>`: its `next:` line names the
step still missing (brief, art director's manifest, spec, art wired into the game, each Round's critique), and the work
is done only when it prints `hand-off: yes`.
SPRITES below means `python3 -I <this skill's folder>/scripts/sprites.py`.

## 1. Brief and spec

Copy the user's whole brief word for word into `/tmp/game/brief.md` (several appends are fine; `tail -n 3` must show the
brief's end). Never summarize it for a critic; pass the path. Then write `/tmp/game/spec.md`:
- **Route.** A detailed design document (fixed core loop, controls, flow, concrete content and numbers) is the design:
  build it faithfully, add no mechanics beyond it, and use your own ideas only for feel, feedback and polish. A short or
  partial prompt is a floor: expand it into a complete design with one clear hook.
- **Requirements trace:** each section of the brief -> how it is built -> how you will check it in play. Every stated
  requirement is kept verbatim or stronger, never dropped or softened. List the ambiguities and the reading you chose.
- **Art:** the art director's `/tmp/game/art/plan.md` holds the style block, size table and asset list; use its sizes.
- **Balance targets** (time to first setback, win rate over 3 runs, ramp) and a **feedback plan** (what every input and
  event shows on screen).

## 2. Art: the art director makes it, you wire it

When the `{{tool:image_generation}}` tool is in your tool list, the game's art is generated and shipped in the game folder (a
brief that asks you to make every image yourself, drawn in code or as files you generate and save in the game folder,
allows it). The art director subagent you spawned right after the brief writes the art plan, generates and cuts every
asset into `<game folder>/assets/` and lists them in `<game folder>/assets/manifest.json`. After your build, call
`{{tool:subagent_wait}}` on it (`timeout_ms` 300000, repeat while it works), read its reply and the manifest, open
`/tmp/game/art/sheet.png`, and wire every asset in: backdrops behind the play layer, each sprite at its `draw_height`
anchored at its feet with a soft ground shadow, pose strips stepped by `cell_w`, items and icons in the HUD and world,
the title picture behind your title text. If it reports a missing or broken asset, generate that one yourself the same
way (`python3 -I <this skill's folder>/scripts/sprites.py cut|fit ...`). If the tool is missing from your tool list or
fails twice, draw everything in code and run sprites.py check with `--no-art-tool`; never use that flag because the
brief says the art is drawn in code.

## 3. Build

Build the whole game from spec.md: every system, screen and control the brief names, at the art plan's sizes. Load
every image from `assets/` with a relative path before the title shows (`await img.decode()`); draw sprites standing on
their ground point with a soft ground shadow; flip for the other facing; step pose strips for movement; draw backdrops
behind the play layer with a darker band behind text. Wrap the per-frame step in try/catch and reschedule it in
`finally`; map pointer events to CSS pixels; load one display font and one body font (`document.fonts.load()` before
the first draw); synthesize sounds with Web Audio. Start directly in playable space with one obvious action; teach the
core loop through a first success, not a wall of text.

## 4. Three rounds: verify, review, improve

Each round has a theme; check every axis, dig deepest into the theme:
- Round 1, playable and cohesive: every brief requirement reachable, no crash or console error, assets cohesive in the
  running game, a first balance baseline (3 fresh runs, numbers written down).
- Round 2, fun and fair: balance toward every target, immediate visible feedback on every input, readable threats, a
  fair difficulty ramp.
- Round 3, impressive and converged: the hook clear in the first 10 seconds, juice, art direction, title and end
  screens, a moment worth sharing; balance re-measured.

Every round:
1. **Snapshot and critic:** `rm -rf /tmp/game/snap-N && cp -r <game folder> /tmp/game/snap-N`, then spawn the critic with
   `{{tool:subagent_spawn}}` and exactly this message: `Read <this skill's folder>/critic.md and follow it exactly.
   BRIEF=/tmp/game/brief.md REFERENCE=<reference image or none> GAME=/tmp/game/snap-N
   CRITIQUE=/tmp/game/critique-N/critique.md SKILL=<this skill's folder>`. Without subagents, play the copy yourself with
   critic.md before reading any code.
2. **Your own check while it plays** (`{{tool:subagent_wait}}` with `timeout_ms` 300000 between steps): a visual comparison
   (save `/tmp/game/iterations/round_N/opening.png` from a fresh load and view it beside the reference image: camera,
   framing, palette, object scale, control placement) and a functional playtest with real keys and mouse only, at a
   human pace (the core loop, this round's changes, a win and a loss, restart, save and reload).
3. **Review:** write `/tmp/game/iterations/round_N/review.md`: the theme, what you checked and how, findings tagged
   blocker / major / polish with their screenshot, the measured balance numbers, and from Round 3 a "Would I share
   this?" line. Then read the critic's whole file; every "no" answer, every rule it marks broken and every blocker or
   major is yours to fix.
4. **Improve:** list the changes (file + what changes), blockers first, at least half serving the round's theme; make
   them; replay what changed. After the sixth wait send the critic "Time is up: write your scores and last line now",
   wait once more, then cancel it and work from its file.
A round is done only when its critique file exists, its review.md is written and its blockers and majors are fixed.
After each round whose play passed, copy the game folder to `/tmp/game-good-<N>`.

## 5. Done

Done when three rounds ran after the build with their blockers and majors fixed, `SPRITES check <game folder>` prints
PASS and `hand-off: yes`, and a final play of the exact delivered folder from a fresh load (title, real start control,
reach play, do the core action once, no console errors) is clean; if that final play fails and you cannot fix it within
a few minutes, restore the last good snapshot. **Clock:** note `date` in spec.md at the start; at 2.5 hours start no new
round: do the final play and hand off. Hand off briefly: what was built, how to open it, what was not checked.
