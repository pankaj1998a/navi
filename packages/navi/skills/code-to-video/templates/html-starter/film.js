// film.js: the film's one timeline module. new.py init copied this starter; new.py look wrote style.js beside it (the
// chosen look with the register's numbers), and lib/look.js applies that look as the page loads. Mechanics only:
// replace the placeholder scene with your film. Lint fails while a [data-placeholder] element shows or styles.css keeps
// the starter's --ground, --ink and --accent. Every frame is a pure function of t: render(t) sets everything from t.
//
// The timeline: render.mjs writes it to <out>.timeline.json for mix.py and vqa.py. Write each time once, in a helper
// (lib/README.md), and let everything else read it from there:
//   register, format, style   the look's, from style.js; never edit them here
//   names     names exactly as the brief spells them; lint fails any other case (new.py init fills it)
//   text      lines the brief demands verbatim; lint fails a film that never shows one (new.py init fills it)
//   scenes    {id, start, end, label}: the beats in seconds; --range renders and the review board read them
//   holds     hold(after, {read | chart | logo, alive, box}): starts where a move lands and lasts what its words
//             need; a breath (no words) takes dur
//   events    {t, kind, label}: picture changes the checks match (kind transition, land, wave, hit or cut);
//             film() adds the signature event from the one move marked signature: true
//   cues      cue(sound, move, 'start' | 'land' | 'peak', {gain}): a sound on a move, retimed with it
//   layers    sound that follows the picture, never sync-checked: {id, sound, start, gain_db} plays a file once;
//             {id, sound: [names], times: [s], gain_db} plays one hit per time. A layer with id 'room' replaces
//             the room tone mix.py lays under a film with no music
//   music     null: mix.py lays room tone. A bed {file, gain_db, fade_in, fade_out, duck_db} only when the brief
//             asks for music or the card names one
//   steps, effects, seams, moves   added by film(): the clock's stepped spans, flash() and shake() spans,
//             seam() devices, and every helper with its start, land and peak
// Times are in seconds, so a new fps changes no timing.
import { S, FPS, frame, move, hold, cue, apply, film } from './lib/film.js';
import { mountFilm } from './lib/player.js';

// The placeholder scene: one box moving from frame 0, landing, held for its one word. Delete it with its markup.
const box = document.querySelector('[data-placeholder]');
const slide = move(box, [-0.3 * frame.W, 0], [0, 0], 0, 2.4, { curve: 'entrance', signature: true });
const rest = hold(slide, { read: box });
const DURATION = rest.end;

export const timeline = film({
  register: S.register,
  format: S.format,
  style: S.id,
  names: [],
  text: [],
  scenes: [{ id: 'placeholder', start: 0, end: DURATION, label: 'placeholder' }],
  holds: [rest],
  events: [],
  cues: [cue('thud', slide, 'land')],
  layers: [],
  music: null,
});

function render(t) {
  apply(t); // every helper at t; draw anything else from t here
}

// fonts: every @font-face styles.css declares, as CSS font shorthands: the font gate loads them before frame 0.
mountFilm({ width: frame.width, height: frame.height, fps: FPS, duration: DURATION, timeline, render,
  fonts: ['800 96px "Inter"', '400 40px "JetBrains Mono"'] });
