# lib: the film's helpers

Import from `./lib/film.js`. Write each time once; everything else reads it. `t0` is seconds, or a helper (where it
lands).

**Moves** return a helper with `t0`, `end`, `land` (where it rests) and `peak` (fastest instant, null at constant
speed). Curves, durations and blur devices come from the look; pass `dur` or `curve` only to override.

- `enter(el, t0, dur?, {from, curve})`: from `{x, y, s, b}` (offset px, scale, blur px) to its place; opacity, offset
  and blur ride one progress value. `exit(el, t0, dur?, {to, curve})` mirrors it.
- `move(el, from, to, t0, dur?, {curve, kind, signature})`: `[x, y]` or `{x, y, s, r}`; `from` null continues the last
  move. `kind`: translation, pop, camera or impact (an impact adds a hit event on its contact frame).
- `signature(move)` or `{signature: true}`: the film's one signature move.
- Curves: the time.js `EASE` tokens and `SPRING` presets, plus `jelly`, `gravity`, `bounce`, `beat-snap`, `pen`,
  `key-pose`.

**Timeline entries**

- `hold(after, {read | chart | logo, alive, box, dur})`: starts where `after` lands and lasts what it is for: `read`
  (selector, element or the words) by reading time, `chart` by labelled values, `logo: true`. Without one it is a
  breath and needs `dur`. `alive: true` (the look's kind) marks a hold that keeps moving; `box` records its still
  read box.
- `cue(sound, move, 'start' | 'land' | 'peak', {gain, pan, anchor})`: retimed with its move; `'peak'` throws on a
  constant-speed move.
- `seam(kind, t?)`: untimed seams take scene boundaries in order.
- `flash(t0, dur?, {color})`, `shake(el, t0, dur, {amp})`: effects; at most three flashes a second.
- `nudge(el, {px, deg})`: seeded offsets per drawing.
- `film({...})` completes the timeline: steps, effects, seams, moves, the signature event. Call `apply(t)` first in
  `render(t)`.

**The look** (`./lib/look.js`; `S` is film/style.js). `clock.section(name, a, b)`, called before the helpers it
covers, steps the card's named rate in whole drawings; `T(t)` is drawing time; `clock.drawing(t)`, `clock.rand(t, salt)`
give seeded values per drawing; `clock.snap(v)` rounds to `clock.grid` when snapped. Seeded textures marked texture:
`grain({rms})`, `paper()`, `halftone({cell})`, `dither({cell})`, `scanlines({period})`, `noise({every})`; the card's
own loads with the page.
`ground(el, {period, pxf})` marks and drifts a ground layer; `boil(el, {scale})` re-seeds a line per drawing;
`directional` and `smear` blur moves in the page; `frame` holds the size.

**Time** (`./lib/time.js`): the curves, `progress`, `interpolate`, `held(t, every, fps)`, `beatFrame(k, bpm, phase,
fps)`. `player.js`'s `mountFilm` runs the seek contract and font gate.
