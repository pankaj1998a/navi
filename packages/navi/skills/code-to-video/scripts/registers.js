on{
  "schema": 1,
  "about": "The one copy of every register and format number (spec S26). Scripts read this file; SKILL text names the rule and the command that prints the number. Every number is a start value, logged per film and re-set only from judged results.",
  "provisional": "frozen_share_pct.fail in every register: provisional, pending the stillness calibration gate (spec 2.6)",
  "registers": {
    "calm": {
      "words": {"en": ["subtle", "calm", "quiet", "gentle", "relaxing", "serene", "peaceful"],
                "zh": ["\u5b89\u9759", "\u514b\u5236", "\u4f4e\u8c03", "\u8212\u7f13"]},
      "loudness": {"target_lufs": -18, "accept_lufs": [-22, -17], "true_peak_max_dbtp": -1},
      "room_tone_db": -40,
      "cue_margin_lu": 10,
      "cue_density_note_per_10s": [1, 4],
      "entrance_default_s": [0.8, 1.4],
      "frozen_share_pct": {"warn": 40, "fail": 50, "fail_provisional": true},
      "breath_cap_s": 1.5,
      "hook": false
    },
    "neutral": {
      "words": {"en": ["clear", "explain", "teach", "tutorial", "walkthrough", "onboarding"],
                "zh": ["\u8bb2\u89e3", "\u6e05\u6670", "\u6559\u7a0b"]},
      "loudness": {"target_lufs": -16, "accept_lufs": [-19, -15], "true_peak_max_dbtp": -1},
      "room_tone_db": -40,
      "cue_margin_lu": 8,
      "cue_density_note_per_10s": [2, 6],
      "entrance_default_s": [0.5, 0.9],
      "frozen_share_pct": {"warn": 35, "fail": 45, "fail_provisional": true},
      "breath_cap_s": 1.0,
      "hook": false
    },
    "energetic": {
      "words": {"en": ["launch", "teaser", "impressive", "hype", "bold", "trailer", "fun", "playful", "energetic", "upbeat", "exciting"],
                "zh": ["\u53d1\u5e03\u4f1a", "\u9884\u544a", "\u9707\u64bc", "\u6709\u8da3"]},
      "loudness": {"target_lufs": -14, "accept_lufs": [-15, -13], "true_peak_max_dbtp": -1},
      "room_tone_db": -40,
      "cue_margin_lu": 6,
      "cue_density_note_per_10s": [4, 12],
      "entrance_default_s": [0.25, 0.6],
      "frozen_share_pct": {"warn": 25, "fail": 35, "fail_provisional": true},
      "breath_cap_s": 1.0,
      "hook": true
    }
  },
  "precedence": {
    "loudness": ["destination", "register"],
    "register": {"brief_words": ["calm", "energetic", "neutral"], "then": "card", "default": "neutral"}
  },
  "destinations": {
    "web": {"target_lufs": -14, "accept_lufs": [-15, -13], "true_peak_max_dbtp": -1},
    "voice": {"target_lufs": -16, "accept_lufs": [-17, -15], "true_peak_max_dbtp": -1},
    "ebu": {"target_lufs": -23, "accept_lufs": [-23.5, -22.5], "true_peak_max_dbtp": -1},
    "atsc": {"target_lufs": -24, "accept_lufs": [-26, -22], "true_peak_max_dbtp": -2}
  },
  "pacing": {
    "alive_share_warn_pct": 35,
    "rest": {"start_within_frames": 1, "max_beats": 1, "share_warn_pct": 40},
    "declared_hold_share_note_pct": 35,
    "poster_allowance": [{"film_up_to_s": 10, "s": 2.5, "share": 0.4},
                         {"film_up_to_s": 30, "s": 2.5},
                         {"film_up_to_s": null, "s": 3.0}],
    "hook_rule": {"run_min_s": 0.5, "window_s": 3.0, "window_share": 0.5}
  },
  "holds": {
    "need_s": {"read_min": 1.0, "chart": 1.2, "chart_per_value": 0.3, "logo": 1.0},
    "reading": {"latin_s_per_word": 0.3, "chinese_chars_per_s": 7, "japanese_chars_per_s": 4,
                "korean_syllables_per_s": 12},
    "cap_x_need": 2,
    "growth_warn_s": 1.0
  },
  "text": {"floor_px_1080p": {"read": 32, "caption": 56, "cjk": 40}},
  "formats": {
    "teaser": {"hook": true},
    "sting": {"hook": true},
    "data": {"frozen_share_add_pct": 10},
    "overlay": {"frozen_share": false, "poster": false, "sound_by_default": false, "layout_min_alpha_box_pct": 30},
    "loop": {"poster": false, "seam_fail_levels": 1},
    "explainer": {},
    "tutorial": {},
    "promo": {}
  },
  "tiers": {"LF": {"budgets_per_chapter": true}}
}
skills/code-to-video/scripts/render.mjs#!/usr/bin/env node
// render.mjs: deterministic HTML/CSS/SVG/canvas -> MP4 / PNG renderer for the code-to-video skill.
// Each frame is captured after seek(t = frame / fps); nothing plays in real time. Run with --help.
// Needs Node >= 20, ffmpeg/ffprobe on PATH, and playwright-core in the work folder (--doctor prints the install line).
// It never writes into the skill folder: a bundled skill is a read-only snapshot.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HELP = `Usage: node render.mjs PAGE.html|URL [options]

Renders a page that sets window.__video = { width, height, fps, duration, ready, seek(t), timeline }
frame by frame (seek, then screenshot) and encodes H.264 High, yuv420p, BT.709 tags, CRF 18, +faststart.
A render, --frames-dir, and --timeline-only (unless it refuses) write <out>.timeline.json (size, fps,
duration, scenes, holds with their measured kind, read text, counts and need, events, cues, layers, music,
the page's data-layer inventory). --stills, --lint, and --speed never write it, so it keeps describing the
render it was written with. When a layer the stillness checks leave out moves (an ambient layer: blended,
at most 0.6 opaque, or a moving bottom layer, sweeping >= 10% of the frame; data-layer texture or ground; an
opaque data-layer="content" layer covering half the frame with no read text), a render and --frames-dir also
write <out stem>.content.mkv without those layers (640 px wide, FFV1) and name it there. A layer the page
rebuilds with innerHTML is followed by where it sits, and hidden only on the frames it is in the page.

Output
  --out FILE          MP4 path (default renders/out.mp4 next to the page; --range and --draft add
                      -A-B and -draft to the default name so they never overwrite the full render)
  --stills T1,T2,...  write still-<t>s.png at these times (seconds) beside --out, plus stills-sheet.png
                      (all of them tiled, at most 1600 px wide, for viewing); no video
  --frames-dir DIR    write the PNG sequence frame-000000.png ... instead of encoding, and
                      <out>.timeline.json for it; prints the command that encodes it to --out (give
                      --out the name you will encode it to)
  --lint              sample the timeline (and every 0.25 s around scene boundaries and events); report
                      small text (the read floors in registers.json; CJK under its floor is an error),
                      unsafe, clipped and overflowing read text (by where its glyphs reach), overlapping
                      and low-contrast read text, widows, names in another case, demanded lines never
                      drawn as read text (a <br>, the edge of a box, a new line, or a gap of about 0.15 em
                      between two words reads as a space; a space between two Chinese or Japanese
                      characters is ignored), texture text over 25% of the frame, the card's stroke and
                      integer-scale guards, the starter's placeholders, empty Look fields, unloaded
                      fonts, glyphs drawn by a fallback face, and display-size text drawn by a system
                      face. Texture (data-lint="texture" or "off") and aria-hidden copies get only the
                      glyph and font checks; text not drawn on a sampled frame is listed apart as
                      hidden; writes lint.json beside --out; exit 1 only on errors
  --speed             measure every frame's fastest element in px per frame (elements with an id or
                      data-track); list segments at >= 30 px/f to motion-blur (--motion-blur does it),
                      or as covered when a data-blur device other than shutter leads them; containers
                      that only grew as children appeared (their size, place and transform held) and
                      stepped keys apart. WARNs a constant-speed move (>= 0.5 s within 10% that is at
                      least 60% of its move: the frames around it at over half its speed and no faster,
                      up to the next level stretch, so each piece of a piecewise-linear move WARNs and an
                      eased peak does not; data-curve="mechanical" allows it), a crisp move over 60 px/f
                      at 30 fps unless the look's clock steps, and the card's guards.peak_pxf_30fps; a
                      one-frame jump (a cut, a reposition) is not a move for either. Writes speed.json
                      beside --out
  --timeline-only     write <out>.timeline.json only, no frames, for a remux after a sound-only edit (T6);
                      pass the same --out, --range, --draft as the render. Exit 1, timeline unchanged,
                      when that render's frame count, size, or rate no longer matches the page
  --check-determinism A-B
                      render A..B seconds twice, each in a browser of its own, as a render would, and
                      compare the two encodes frame by frame (ffmpeg framemd5); prints the number of
                      differing frames, exit 1 when any differ; writes nothing beside --out
  --alpha             transparent background, straight alpha. --out NAME.mov: ProRes 4444 (editors;
                      the default, renders/out-alpha.mov); --out NAME.webm: VP9 with alpha (Chrome,
                      Firefox); --frames-dir and --stills: RGBA PNGs. The page must leave html and body
                      transparent (no background color or image). Not with .mp4 (H.264 has no alpha)
                      or --draft (JPEG capture)
Timing and size (override window.__video)
  --fps N  --width W  --height H  --duration S
  --range A-B         render only A..B seconds (the timeline is shifted to the clip)
Quality and speed
  --draft             half size, JPEG q90 capture, CRF 23 veryfast: timing checks only
  --scale K           supersample: capture at K x size, downscale with lanczos (1-4)
  --workers N         N browser processes over frame ranges, joined into one final encode
  --motion-blur       with a render or --frames-dir: measure speeds as --speed does, then replace every
                      frame of a segment at >= 30 px/f with the average of S/2+1 subframes centred on it
                      (a 180-degree shutter; S a multiple of 4, >= peak/3, at most 1000/fps),
                      in the same output; a segment over that cap gets the cap and a WARN. One-frame
                      jumps, segments the page's own data-blur device covers, containers that only grew,
                      stepped keys, and frames whose window would cross a scene boundary stay sharp. An
                      average that stalls is stopped (30-60 s) and tried once more; a frame that fails
                      twice stays sharp, and so does every later blur frame, without calling ffmpeg
                      again (one WARN gives the count); the summary lists the sharp fast frames.
                      Works with --range, --workers, --scale, --alpha; not with --draft
Environment
  --browser PATH      Chrome/Chromium binary (default: $CHROME, newest Playwright headless shell,
                      newest Playwright Chromium, system Chrome)
  --chrome-arg FLAG   extra Chromium switch for every browser launch, repeatable; e.g.
                      --chrome-arg --use-angle=metal draws WebGL on the GPU (macOS)
  --doctor            print node, playwright-core, browser (and its WebGL renderer), and ffmpeg
                      this script would use, and an install line for anything missing (it installs
                      in the work folder, never in the skill folder); honours --browser, --chrome-arg

Every ffmpeg and ffprobe call has a time limit, and capture, encode and blur print a progress line at
least every 10 s, so a stall ends in an error naming the step instead of silence.

Exit codes: 0 ok, 1 render or lint failure (or a --timeline-only render that no longer matches, or
--check-determinism frames that differ), 2 usage error.`;

// Starting points, not measured limits: generous enough for heavy pages, short enough to fail loudly.
const SEEK_TIMEOUT_MS = 30_000;   // spec: a seek taking > 30 s is a failure
const READY_TIMEOUT_MS = 60_000;
const VIDEO_WAIT_MS = 1_000;      // wait for window.__video after load (define it synchronously; await in ready)
const IMAGE_TIMEOUT_MS = 10_000;
// One --motion-blur average's time limit: 20 times its measured ~15 ns per subframe pixel, clamped to 30-60 s.
const AVERAGE_LIMIT = { msPerPx: 3e-4, min: 30_000, max: 60_000 };
// Child processes (S2): a blocking call past its limit, or a streaming ffmpeg idle for STALL_MS, is killed, so a stall
// ends in a named error, never silence. Test hooks inject limits, never clocks: C2V_CHILD_TIMEOUT (seconds, the three
// child limits), C2V_HEARTBEAT_MS (the heartbeat) and C2V_BLUR_LIMIT_MS (each blur average).
const badEnv = [];
const envNumber = (name) => {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  badEnv.push(`${name} must be a positive number, got "${v}"`);
  return undefined;
};
const CHILD_S = envNumber('C2V_CHILD_TIMEOUT');
const PROBE_MS = CHILD_S ? CHILD_S * 1000 : 60_000;      // ffprobe, -version, -encoders, npm --version
const CONVERT_MS = CHILD_S ? CHILD_S * 1000 : 120_000;   // one-image conversions, the stills sheet, framemd5
const STALL_MS = CHILD_S ? CHILD_S * 1000 : 120_000;     // an encoder that takes no frame, or a decoder that gives none
const HEARTBEAT_MS = envNumber('C2V_HEARTBEAT_MS') ?? 10_000;
const BLUR_LIMIT_MS = envNumber('C2V_BLUR_LIMIT_MS');
// Each worker captures and discards this much film before its range: Chromium's output depends on render history
// (layer promotion), and a pre-roll covering its last change keeps worker frames bit-identical to a serial render.
const PREROLL_SECONDS = 1;
// Subframe blur renders at fps x S with S a multiple of 4, samples <= 3 px apart, so the --fps cap
// bounds S (32 at 30 fps) and the fastest motion it can blur (96 px/f at 30 fps). C11 blurs from 30 px/f.
const MAX_FPS = 1000;
const maxSubframes = (fps) => 4 * Math.floor(MAX_FPS / fps / 4);
const BLUR_PX = 30;
// --speed (S4): a constant-speed move is a flat stretch at least `share` of its move. Smoothstep and sine peaks stay
// under half of theirs; a linear cruise with eased ends is two thirds or more (linearRuns has the rest). Sharp motion
// holds up to about SHARP_PX_30 px/f at 30 fps, so a crisp move past it WARNs unless the clock steps.
const LINEAR = { minS: 0.5, minPx: 5, spread: 0.1, share: 0.6, move: 0.5, level: 0.03, piece: 0.03, even: 0.01, step: 0.3 };
const SHARP_PX_30 = 60;
// Page layers (S6) are sampled ten times a second, so a 2 s window's sweep barely depends on where samples fall;
// measureLayers explains the thresholds.
const LAYERS = { hz: 10, windowS: 2, sweep: 0.1, translucent: 0.6, opaque: 0.95, capped: 0.5, passW: 640 };
// --lint (S5): overlap is a share of the smaller text, texture of the frame; text from 6% of the short side needs 3:1;
// a glyph whose size or opacity moved under `settle` since the frame before has landed and is judged.
const LINT = { overlap: 0.1, texture: 0.25, contrast: 4.5, large: { share: 0.06, contrast: 3 }, settle: 0.01 };
// 9:16 posted to several apps: the cross-app clear box (references/delivery.md) at 1080x1920 (clear 14% top, 35% bottom,
// 6% left, 17% right), scaled to the frame for --lint's social-ui-zone check.
const SOCIAL_916 = { x: [65, 900], y: [269, 1248], w: 1080, h: 1920 };
// --disable-partial-raster: with partial raster, two renders of a polygon-heavy SVG page differed on most frames
// (anti-aliased edges up to 17/255); without it they were byte-identical (S7; check with --check-determinism).
const CHROME_ARGS = ['--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--disable-partial-raster'];
const SETPARAMS = 'setsar=1,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

// ---------------------------------------------------------------- logging and cleanup
const log = (...a) => console.error(...a);
const warned = new Set();
const warn = (msg) => { if (!warned.has(msg)) { warned.add(msg); log(`WARN ${msg}`); } };
class UsageError extends Error {}

// Everything this run started, stopped by handle (never by process name) and removed exactly once.
const live = { browsers: new Set(), procs: new Set(), servers: new Set(), tmp: new Set(), partial: new Set() };
let cleaning = null;
function cleanup() {
  cleaning ??= (async () => {
    for (const p of live.procs) { try { p.kill('SIGKILL'); } catch {} }
    for (const d of live.tmp) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    for (const f of live.partial) { try { fs.rmSync(f, { force: true }); } catch {} }
    await Promise.allSettled([...live.browsers].map((b) => b.close()));
    for (const s of live.servers) { try { s.close(); } catch {} }
  })();
  return cleaning;
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log(`\n${sig}: stopping browsers and ffmpeg`); cleanup().finally(() => process.exit(130)); });

function withTimeout(promise, ms, message) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
const fmtT = (t) => String(Number(t.toFixed(3)));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Every blocking child goes through here (S2): SIGKILL past its limit (PROBE_MS or CONVERT_MS), and a timeout throws,
// naming the step. Node closes the pipes on that kill, so a wrapper's child holding them cannot stall the return.
function runSync(step, cmd, args, opts, ms) {
  const r = spawnSync(cmd, args, { ...opts, timeout: ms, killSignal: 'SIGKILL' });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${step} timed out after ${fmtT(ms / 1000)} s: killed`);
  return r;
}

// A streaming ffmpeg (S2) gets STALL_MS per wait on it; then it is killed and its pipes destroyed (a wrapper that does
// not exec keeps them open after the kill), and the step fails, named.
async function stallGuard(promise, proc, step) {
  let timer;
  const stalled = new Promise((_, rej) => {
    timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      for (const s of [proc.stdin, proc.stdout, proc.stderr]) s?.destroy();
      rej(new Error(`${step} stalled (no progress for ${fmtT(STALL_MS / 1000)} s): killed`));
    }, STALL_MS);
  });
  try { return await Promise.race([promise, stalled]); } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- arguments
const FLAGS = {
  out: 'str', stills: 'str', range: 'str', draft: 'bool', scale: 'num', workers: 'int', fps: 'num', width: 'int',
  height: 'int', duration: 'num', 'frames-dir': 'str', lint: 'bool', browser: 'str', doctor: 'bool', help: 'bool',
  alpha: 'bool', 'chrome-arg': 'list', speed: 'bool', 'timeline-only': 'bool', 'motion-blur': 'bool',
  'check-determinism': 'str',
};
const MODES = ['stills', 'frames-dir', 'lint', 'speed', 'timeline-only', 'check-determinism'];
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] === '-h' ? '--help' : argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
    const type = FLAGS[key];
    if (!type) throw new UsageError(`unknown option --${key} (see --help)`);
    if (type === 'bool') { if (eq >= 0) throw new UsageError(`--${key} takes no value`); o[key] = true; continue; }
    let v = eq < 0 ? argv[++i] : a.slice(eq + 1);
    // A Chromium switch starts with -- itself, so a list value is taken as is (validate checks it).
    if (v === undefined || (eq < 0 && v.startsWith('--') && type !== 'list')) throw new UsageError(`--${key} needs a value`);
    if (type === 'list') { (o[key] ??= []).push(v); continue; }
    if (type !== 'str') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || (type === 'int' && !Number.isInteger(n))) {
        throw new UsageError(`--${key} must be a positive ${type === 'int' ? 'integer' : 'number'}, got "${v}"`);
      }
      v = n;
    }
    o[key] = v;
  }
  return o;
}

function validate(o) {
  for (const c of o['chrome-arg'] ?? []) {
    if (!c.startsWith('-')) throw new UsageError(`--chrome-arg takes a Chromium switch such as --use-angle=metal, got "${c}"`);
    const name = c.replace(/^-+/, '').split('=')[0];
    if (FLAGS[name]) throw new UsageError(`--chrome-arg got the render.mjs option ${c}: give each --chrome-arg its switch (--chrome-arg=--switch)`);
  }
  if (o.help || o.doctor) return;
  if (o._.length !== 1) throw new UsageError(o._.length ? `expected one page, got: ${o._.join(' ')}` : 'missing PAGE.html or URL (see --help)');
  const modes = MODES.filter((k) => o[k] !== undefined);
  if (modes.length > 1) throw new UsageError(`choose one of ${MODES.map((m) => '--' + m).join(', ')} (got ${modes.map((m) => '--' + m).join(', ')})`);
  // The output extension picks the codec only for --alpha; an opaque render is always H.264 MP4 (T8).
  // --check-determinism encodes as the render would, so the same rules apply to it.
  const ext = o.out ? path.extname(o.out).toLowerCase() : '';
  const encodes = !modes.length || modes[0] === 'check-determinism';
  if (encodes && o.alpha && o.out && ext !== '.mov' && ext !== '.webm') {
    throw new UsageError(ext === '.mp4'
      ? '--alpha cannot write .mp4: H.264 has no alpha channel. Use --out NAME.mov (ProRes 4444, editors), --out NAME.webm (VP9 with alpha, Chrome and Firefox), or --frames-dir DIR (RGBA PNGs)'
      : `--alpha writes .mov (ProRes 4444) or .webm (VP9 with alpha), got --out ${o.out}`);
  }
  if (encodes && !o.alpha && (ext === '.mov' || ext === '.webm')) throw new UsageError(`--out ${o.out}: opaque renders are H.264 MP4; add --alpha for a transparent ${ext}, or convert the MP4 per delivery.md`);
  if (o.alpha && o.draft) throw new UsageError('--alpha needs PNG capture and --draft captures JPEG: check timing with an opaque --draft, then render --alpha without it');
  if (o['motion-blur'] && o.draft) throw new UsageError('--motion-blur averages full-size PNG subframes and --draft captures half-size JPEG for timing checks: check timing with --draft, then render the blur without it (add --range to keep it short)');
  if (o.scale !== undefined && (o.scale < 1 || o.scale > 4)) throw new UsageError('--scale must be between 1 and 4');
  if (o.scale > 1 && o.draft) throw new UsageError('--scale supersamples and --draft halves: use one');
  if (o.fps > MAX_FPS) throw new UsageError(`--fps above ${MAX_FPS} is not supported (subframe blur renders at fps x S, so S <= ${maxSubframes(30)} at 30 fps)`);
  if (o.workers > 32) throw new UsageError('--workers above 32 is not supported');
  if (o.range !== undefined && o['check-determinism'] !== undefined) throw new UsageError('--check-determinism takes its own range (A-B): drop --range');
  for (const key of ['range', 'check-determinism']) { // the range rendered: the clip, or the one rendered twice
    if (o[key] === undefined) continue;
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(o[key]);
    if (!m || +m[1] >= +m[2]) throw new UsageError(`--${key} must look like 3-6 (seconds, start < end), got "${o[key]}"`);
    o.rangeAB = [+m[1], +m[2]];
  }
  if (o.stills !== undefined) {
    o.stillTimes = o.stills.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    if (!o.stillTimes.length || o.stillTimes.some((t) => !Number.isFinite(t) || t < 0)) throw new UsageError(`--stills must be comma-separated seconds >= 0, got "${o.stills}"`);
  }
}

// ---------------------------------------------------------------- the skill folder and the work folder
// A bundled skill is a read-only, content-addressed snapshot (S3): render.mjs never writes into it, and no install line
// it prints targets it. Paths compare by real path, so a symlinked skill or work folder is still recognised.
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const realish = (p) => { // the real path of p's nearest existing ancestor, plus the rest of p
  const rest = [];
  for (let d = path.resolve(p); ; d = path.dirname(d)) {
    try { return path.join(fs.realpathSync.native(d), ...rest); } catch {} // native: the on-disk case too (macOS)
    if (path.dirname(d) === d) return path.resolve(p);
    rest.unshift(path.basename(d));
  }
};
const SKILL_REAL = realish(SKILL_DIR);
const insideSkill = (p) => { const r = realish(p); return r === SKILL_REAL || r.startsWith(SKILL_REAL + path.sep); };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// The work folder, where installs and caches go (S3): the nearest folder at or above the page, else the current folder,
// that holds new.py's .c2v/; else the current folder. Null inside the skill folder.
function workFolder(pageDir) {
  for (const start of [pageDir, process.cwd()].filter(Boolean)) {
    for (let d = path.resolve(start); ; d = path.dirname(d)) {
      if (isDir(path.join(d, '.c2v'))) return insideSkill(d) ? null : d;
      if (path.dirname(d) === d) break;
    }
  }
  return insideSkill(process.cwd()) ? null : process.cwd();
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // one POSIX shell word

// scripts/registers.json (S26) holds the one copy of the read-text floors and hold needs render.mjs uses (S5, S8).
let registersRead = null;
function registers() {
  if (registersRead) return registersRead;
  const file = path.join(SCRIPT_DIR, 'registers.json');
  try { return (registersRead = JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { throw new Error(`cannot read ${file} (${e.code ?? e.message}): render.mjs takes the read-text floors and hold needs from it`); }
}
// The read floors on this frame: registers.json gives px on a frame whose short side is 1080 px.
const floorsFor = (W, H) => Object.fromEntries(Object.entries(registers().text.floor_px_1080p).map(([k, v]) => [k, (v * Math.min(W, H)) / 1080]));
// The starter's placeholder colours (S5 tripwire), read from the shipped starter's :root, their one copy; null when the
// starter declares none.
function starterColours() {
  let css = '';
  try { css = fs.readFileSync(path.join(SKILL_DIR, 'templates', 'html-starter', 'styles.css'), 'utf8'); } catch { return null; }
  const root = (/:root\s*\{([^}]*)\}/.exec(css) ?? [])[1] ?? '';
  const v = Object.fromEntries(['ground', 'ink', 'accent'].map((k) => [k, ((new RegExp(`--${k}\\s*:\\s*([^;]+);`).exec(root) ?? [])[1] ?? '')
    .replace(/\/\*.*?\*\//g, '').trim().toLowerCase()]));
  return v.ground && v.ink && v.accent ? v : null;
}

// ---------------------------------------------------------------- toolchain discovery
// Upward from the page, the work folder's .c2v/node_modules (where new.py may install it), upward from the current
// folder, then the skill's own scripts folder (read only: a maintainer's checkout may carry one).
function loadPlaywright(pageDir) {
  const work = workFolder(pageDir);
  const bases = [...new Set([pageDir, work && path.join(work, '.c2v'), process.cwd(), SCRIPT_DIR].filter(Boolean))];
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'noop.js'));
      const resolved = req.resolve('playwright-core');
      let version = '?';
      try { version = req('playwright-core/package.json').version; } catch {}
      return { mod: req('playwright-core'), resolved, version, base, work };
    } catch {}
  }
  return { missing: bases, work };
}
// `npm` may be Bun's shim (npm --version prints Bun's 1.x; the binary is bun): it has no npm --cache ("Could not find
// package.json for file:.npm-cache") and `npm init` runs `bun init`. Null when there is no npm.
function npmKind() {
  let r;
  try { r = runSync('npm --version', 'npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }, PROBE_MS); } // npm.cmd there
  catch (e) { warn(`${e.message}; npm is taken as missing`); return null; }
  const version = (r.stdout || '').trim();
  if (r.error || r.status !== 0 || !version) return null;
  const bin = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'npm')).find(isExe);
  let real = '';
  try { real = path.basename(fs.realpathSync(bin)); } catch {}
  return { version, bun: /^1\./.test(version) || /^bun/.test(real) };
}
const NO_WORK = 'run this from your work folder (video-work/<slug>), not from the skill folder, for the line that installs there';
// The install line cds into the work folder in a subshell (Bun's npm shim ignores --prefix), keeps the package cache
// there (Bun's: BUN_INSTALL_CACHE_DIR) and gives the folder its own package.json, so no enclosing project's is edited.
const playwrightHint = (pw, npm = npmKind()) => {
  let spec = 'playwright-core';
  try { const v = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8')).dependencies['playwright-core']; if (v) spec += `@${v}`; } catch {}
  const head = `playwright-core not found (searched from ${pw.missing.join(', ')}). Install it once:\n  `;
  if (!pw.work) return head + NO_WORK;
  const cache = npm?.bun ? `BUN_INSTALL_CACHE_DIR=${shq(path.join(pw.work, '.c2v', 'bun-cache'))}` : `npm_config_cache=${shq(path.join(pw.work, '.c2v', 'npm-cache'))}`;
  return head + `(cd ${shq(pw.work)} && { [ -f package.json ] || echo '{}' > package.json; } && ${cache} npm install ${shq(spec)})\n  `
    + (npm?.bun ? `npm here is Bun ${npm.version}: it has no npm --cache and npm init runs bun init, so use this line; ` : '')
    + 'render.mjs finds it from any page under that folder (references/troubleshooting.md)';
};
const browserHint = (pw) => {
  const cmd = pw?.resolved ? `node "${path.join(path.dirname(pw.resolved), 'cli.js')}" install --no-remove chromium-headless-shell`
    : 'install playwright-core first (the line above), then run --doctor again for this line';
  return `no Chrome/Chromium found. Install the headless shell once:\n  ${cmd}\nor pass --browser /path/to/chrome (or set $CHROME).`;
};

const isExe = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };
const PW_REL = {
  chromium_headless_shell: ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-linux-arm64/chrome-headless-shell',
    'chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-linux/headless_shell', 'chrome-mac/headless_shell', 'chrome-win/headless_shell.exe'],
  chromium: ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome', 'chrome-linux-arm64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
};
// work: the work folder, whose .c2v/browsers holds the headless shell new.py installs when no browser exists (S24).
function findBrowser(explicit, work) {
  if (explicit) {
    if (isExe(explicit)) return { path: path.resolve(explicit), source: '--browser' };
    throw new UsageError(`--browser ${explicit} is not an executable file`);
  }
  if (process.env.CHROME) {
    if (isExe(process.env.CHROME)) return { path: process.env.CHROME, source: '$CHROME' };
    warn(`$CHROME=${process.env.CHROME} is not executable; looking elsewhere`);
  }
  const home = os.homedir(), mine = work && path.join(work, '.c2v', 'browsers');
  const caches = [mine, process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, 'Library/Caches/ms-playwright'), path.join(home, '.cache/ms-playwright'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter((c) => c && c !== '0');
  for (const kind of ['chromium_headless_shell', 'chromium']) {
    const found = [];
    for (const c of caches) {
      let names = [];
      try { names = fs.readdirSync(c); } catch {}
      for (const n of names) { const m = new RegExp(`^${kind}-(\\d+)$`).exec(n); if (m) found.push({ rev: +m[1], dir: path.join(c, n), mine: c === mine }); }
    }
    found.sort((a, b) => b.rev - a.rev);
    for (const f of found) for (const rel of PW_REL[kind]) {
      const p = path.join(f.dir, rel);
      if (isExe(p)) return { path: p, source: `${f.mine ? 'work folder .c2v/browsers' : 'Playwright cache'} ${path.basename(f.dir)}` };
    }
  }
  const pf = process.env.PROGRAMFILES, pf86 = process.env['PROGRAMFILES(X86)'], lad = process.env.LOCALAPPDATA;
  const system = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    pf && path.join(pf, 'Google/Chrome/Application/chrome.exe'), pf86 && path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    lad && path.join(lad, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const p of system) if (isExe(p)) return { path: p, source: 'system' };
  return null;
}

// Null when bin is missing or fails; throws when it hangs (runSync), so a stuck ffmpeg is not reported as missing.
function ffmpegVersion(bin) {
  const r = runSync(`${bin} -version`, bin, ['-hide_banner', '-version'], { encoding: 'utf8' }, PROBE_MS);
  if (r.error || r.status !== 0) return null;
  return (/version (\S+)/.exec(r.stdout) || [])[1] || '?';
}
function requireFfmpeg() {
  if (!ffmpegVersion('ffmpeg')) throw new Error('ffmpeg not found on PATH (install it, e.g. brew install ffmpeg / apt install ffmpeg)');
  if (!ffmpegVersion('ffprobe')) throw new Error('ffprobe not found on PATH (it ships with ffmpeg)');
}

// ---------------------------------------------------------------- static server for the page folder
async function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let p = path.resolve(root, '.' + rel);
      if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      let st = await fsp.stat(p).catch(() => null);
      if (st?.isDirectory()) { p = path.join(p, 'index.html'); st = await fsp.stat(p).catch(() => null); }
      if (!st?.isFile()) { res.writeHead(404).end(); return; }
      const body = await fsp.readFile(p);
      res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(500).end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  live.servers.add(server);
  return server;
}

// ---------------------------------------------------------------- a browser page that honours the seek contract
// --chrome-arg switches go last: Chromium keeps the last value of a repeated switch.
const chromeArgs = (cli) => [...CHROME_ARGS, ...(cli['chrome-arg'] ?? [])];

// What the in-page checks share, an init script in every page. kind(el): read, texture, copy (aria-hidden) or null
// (script, style); size(el): the computed font size times the scale the element is drawn at.
function pageKit() {
  const INLINE = /^(inline|inline-block|inline-flex|inline-grid|inline-table|contents|ruby.*)$/;
  window.__c2vKit = {
    kind: (el) => (el.closest('script,style,noscript,template') ? null
      : el.closest('[data-lint="texture"],[data-lint="off"],[data-layer="texture"]') ? 'texture' : el.closest('[aria-hidden="true"]') ? 'copy' : 'read'),
    size(el, cs = getComputedStyle(el)) {
      let transformed = false, scale = 1;
      for (let a = el; a && !transformed; a = a.parentElement) { const s = getComputedStyle(a); transformed = s.transform !== 'none' || s.scale !== 'none' || s.rotate !== 'none'; }
      const rect = el.getBoundingClientRect();
      if (el instanceof SVGGraphicsElement) {
        const bb = el.getBBox();
        if (bb.width > 0 && bb.height > 0) scale = Math.min(rect.width / bb.width, rect.height / bb.height);
      } else if (transformed && el.offsetWidth > 0 && el.offsetHeight > 0) scale = Math.min(rect.width / el.offsetWidth, rect.height / el.offsetHeight);
      return parseFloat(cs.fontSize) * scale;
    },
    opacity(el) { let o = 1; for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity); return o; },
    desc(el) {
      const d = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      return cls.length ? d + '.' + cls.join('.') : d;
    },
    // The nearest ancestor-or-self laid out as a block (for SVG, its <text>): the inline and inline-block runs of one
    // paragraph share it.
    block(el) {
      if (el instanceof SVGElement) return el.closest('text') ?? el;
      let a = el;
      while (a.parentElement && a !== document.body && INLINE.test(getComputedStyle(a).display)) a = a.parentElement;
      return a;
    },
    // a, b: the last rect of a run and the first of the next in its block, nothing between. Two words when b starts a
    // new line or a gap of an eighth of the text height parts them; letter spans abut, so they stay one word.
    apart(a, b) {
      const half = Math.min(a.height, b.height) / 2;
      if (b.top >= a.bottom - half || b.bottom <= a.top + half) return true;
      return Math.max(b.left - a.right, a.left - b.right) >= Math.max(a.height, b.height) / 8;
    },
    // Its id, else its tag and place among its parent's children, up to the nearest id: text the page rebuilds on every
    // seek keeps its key, so it compares with the frame before. memo: { keys, at } Maps, new per evaluation.
    key(el, memo) {
      let k = memo.keys.get(el);
      if (k === undefined) {
        const p = el.parentElement;
        if (el.id || !p) k = el.id ? `#${el.id}` : el.localName;
        else {
          let at = memo.at.get(p);
          if (!at) memo.at.set(p, (at = new Map([...p.children].map((c, i) => [c, i]))));
          k = `${this.key(p, memo)}>${el.localName}:${at.get(el)}`;
        }
        memo.keys.set(el, k);
      }
      return k;
    },
  };
}

async function openSession(cfg, mode, viewport) {
  const browser = await cfg.chromium.launch({ executablePath: cfg.browser.path, headless: true, args: chromeArgs(cfg.cli) });
  live.browsers.add(browser);
  const close = async () => { live.browsers.delete(browser); await browser.close().catch(() => {}); };
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    // Tells the page it runs under the renderer (the starter's player hides its preview bar); alpha lets
    // one page drop its backdrop for an --alpha render.
    await context.addInitScript((info) => { window.__videoRender = info; },
      { tool: 'render.mjs', mode, width: cfg.cli.width ?? null, height: cfg.cli.height ?? null, fps: cfg.cli.fps ?? null, alpha: Boolean(cfg.cli.alpha) });
    await context.addInitScript(pageKit);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    const badUrls = new Set();
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) warn(`page console error: ${m.text().slice(0, 300)}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) { badUrls.add(r.url()); warn(`HTTP ${r.status()} for ${r.url()}`); } });
    page.on('requestfailed', (r) => { if (!badUrls.has(r.url())) warn(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`); });
    const s = { browser, page, errors, close };
    await loadPage(s, cfg);
    s.cdp = await page.context().newCDPSession(page);
    // --alpha: the browser's default white page background becomes transparent, so PNG captures keep alpha.
    if (cfg.cli.alpha) await s.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    return s;
  } catch (e) { await close(); throw e; }
}

function throwPageErrors(s, when) {
  if (s.errors.length) { const e = s.errors[0]; throw new Error(`page error ${when}: ${e.message}${e.stack ? '\n' + e.stack.split('\n').slice(1, 4).join('\n') : ''}`); }
}

async function loadPage(s, cfg) {
  await s.page.goto(cfg.url, { waitUntil: 'load', timeout: 60_000 });
  throwPageErrors(s, 'while loading');
  s.contract = await s.page.evaluate(async (waitMs) => {
    const t0 = performance.now();
    while (!window.__video && performance.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 50));
    const v = window.__video;
    if (!v) return { hasVideo: false };
    return { hasVideo: true, hasSeek: typeof v.seek === 'function', width: v.width, height: v.height, fps: v.fps, duration: v.duration };
  }, VIDEO_WAIT_MS);
  throwPageErrors(s, 'while setting up window.__video');
}

// Read after ready, fonts, and images: a page may derive cue times or positions from its loaded layout.
async function readTimeline(s) {
  s.contract.timeline = await s.page.evaluate(() => {
    try { return JSON.parse(JSON.stringify(window.__video?.timeline ?? null)); } catch (e) { return { error: String(e) }; }
  });
  throwPageErrors(s, 'while reading window.__video.timeline');
  // The look new.py wrote (film/style.js sets window.__style): what the checks read from the card (S4, S5, S8).
  s.contract.look = await s.page.evaluate(() => {
    const S = window.__style;
    if (!S || typeof S !== 'object') return null;
    try { return JSON.parse(JSON.stringify({ id: S.id, register: S.register, format: S.format, guards: S.guards, clock: S.motion?.clock?.kind, textureText: S.type?.texture_text, fill: S.fill })); }
    catch { return null; }
  });
}

async function prepare(s) {
  const readyResult = await withTimeout(s.page.evaluate(async () => {
    const v = window.__video;
    if (!v || !v.ready) return null;
    const r = await v.ready;
    try { return JSON.parse(JSON.stringify(r ?? null)); } catch { return String(r); }
  }), READY_TIMEOUT_MS, `window.__video.ready did not resolve within ${READY_TIMEOUT_MS / 1000} s`);
  throwPageErrors(s, 'while awaiting ready');
  // Load every declared face before frame 0: a face first used mid-film otherwise renders blank or in a
  // fallback on the frames captured while it loads (document.fonts.ready alone misses it).
  const prep = await s.page.evaluate(async (imgTimeout) => {
    const faces = () => [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, status: f.status }));
    const before = faces();
    await Promise.all([...document.fonts].map((f) => (f.status === 'loaded' ? null : f.load().catch(() => null))));
    await document.fonts.ready;
    const after = faces();
    const badImages = [];
    await Promise.all([...document.images].map(async (img) => {
      if (!img.getAttribute('src') && !img.srcset) return;
      img.loading = 'eager';
      try { await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), imgTimeout))]); }
      catch { badImages.push(img.currentSrc || img.src); }
    }));
    return { before, after, badImages };
  }, IMAGE_TIMEOUT_MS);
  return { readyResult, ...prep };
}

// --alpha replaces only the browser's default white: a background on html or body paints every pixel.
async function requireTransparentPage(s) {
  const painted = await s.page.evaluate(() => [document.documentElement, document.body].filter(Boolean).flatMap((el) => {
    const cs = getComputedStyle(el), name = el.tagName.toLowerCase(), out = [];
    // Zero alpha only: rgba(r, g, b, 0) or "... / 0)". An opaque rgb(0, 0, 0) also ends in ", 0)".
    const clear = (c) => c === 'transparent' || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?%?\)$/.test(c);
    if (!clear(cs.backgroundColor)) out.push(`${name} background-color ${cs.backgroundColor}`);
    if (cs.backgroundImage !== 'none') out.push(`${name} background-image ${cs.backgroundImage.slice(0, 60)}`);
    return out;
  }));
  if (painted.length) throw new UsageError(`--alpha needs a transparent page, but it paints ${painted.join(', ')}: set html and body to background: transparent and keep any backdrop in a layer you can hide`);
}

function reportReadiness(info, { lint = false } = {}) {
  const rr = info.readyResult;
  if (rr !== null && rr !== undefined && !(typeof rr === 'object' && !Object.keys(rr).length)) log(`ready: ${JSON.stringify(rr).slice(0, 300)}`);
  const findings = [];
  info.before.forEach((f, i) => {
    const a = info.after[i] || f, name = `${f.family} ${f.weight} ${f.style}`;
    if (a.status !== 'loaded') {
      warn(`font face "${f.family}" ${f.weight} ${f.style} failed to load (status ${a.status}): text set in it renders in a fallback`);
      findings.push({ check: 'font-failed', severity: 'error', el: '@font-face', text: name, detail: `status ${a.status}` });
    } else if (f.status !== 'loaded') {
      warn(`font face "${f.family}" ${f.weight} ${f.style} was not loaded by window.__video.ready; render.mjs preloaded it (load it in ready so previews match)`);
      findings.push({ check: 'font-late', severity: 'warn', el: '@font-face', text: name, detail: 'not loaded by ready; preloaded by render.mjs' });
    }
  });
  for (const u of info.badImages) {
    warn(`image did not decode: ${u}`);
    findings.push({ check: 'image-failed', severity: lint ? 'error' : 'warn', el: 'img', text: u, detail: 'decode failed or timed out' });
  }
  return findings;
}

// The seek used for every frame: the page's own seek, or the Web Animations fallback.
async function seekTo(s, cfg, t) {
  const job = cfg.hasSeek
    ? s.page.evaluate(async (tt) => { await window.__video.seek(tt); }, t)
    : s.page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, t * 1000);
  try { await withTimeout(job, SEEK_TIMEOUT_MS, `took longer than ${SEEK_TIMEOUT_MS / 1000} s`); }
  catch (e) {
    const msg = /garbage collected/.test(e.message) ? 'it returned a Promise that never settles' : e.message.split('\n')[0];
    throw new Error(`seek(${t.toFixed(4)}) failed: ${msg}`);
  }
  throwPageErrors(s, `during seek(${t.toFixed(4)})`);
}

async function capture(s, cfg, { format = 'png', scale = 1 } = {}) {
  const params = { format, captureBeyondViewport: false, optimizeForSpeed: true };
  if (format === 'jpeg') params.quality = 90;
  if (scale !== 1) params.clip = { x: 0, y: 0, width: cfg.W, height: cfg.H, scale };
  const { data } = await s.cdp.send('Page.captureScreenshot', params);
  return Buffer.from(data, 'base64');
}

// Chromium writes a fully opaque frame as an RGB PNG even under --alpha; converting it keeps an --alpha
// sequence from mixing RGB and RGBA files (IHDR colour type 6 = RGBA).
function toRGBA(buf) {
  if (buf[25] === 6) return buf;
  const r = runSync('ffmpeg RGBA conversion', 'ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', 'format=rgba', '-f', 'image2pipe',
    '-c:v', 'png', '-'], { input: buf, maxBuffer: 1 << 28 }, CONVERT_MS);
  if (r.status !== 0) throw new Error(`ffmpeg could not convert a frame to RGBA: ${String(r.stderr).trim()}`);
  return r.stdout;
}

// --alpha: a first frame without a fully transparent pixel means a layer covering the frame paints, either a
// background (every pixel opaque) or partly (grain, a vignette, a light: every pixel slightly opaque).
function warnIfOpaque(buf, t) {
  let r;
  try {
    r = runSync('ffmpeg alpha check', 'ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', 'format=rgba,alphaextract',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { input: buf, maxBuffer: 1 << 28 }, CONVERT_MS);
  } catch (e) { warn(`--alpha: the frame at ${fmtT(t)} s was not checked for transparency: ${e.message}`); return; }
  if (r.status !== 0) return;
  let min = 255;
  for (const a of r.stdout) if (a < min && (min = a) === 0) break;
  if (min === 255) warn(`--alpha: the frame at ${fmtT(t)} s has no transparent pixel: a full-frame layer paints a background; make it transparent or the output stays opaque`);
  else if (min > 0) warn(`--alpha: no pixel of the frame at ${fmtT(t)} s is fully transparent (lowest alpha ${min}): a layer covering the frame paints partly `
    + '(grain, a vignette, a light); hide it under --alpha unless the tint is meant');
}

// ---------------------------------------------------------------- configuration from page + CLI
async function resolveConfig(cli) {
  const raw = cli._[0];
  const isUrl = /^https?:\/\//i.test(raw);
  let pagePath = null, pageDir = null;
  if (!isUrl) {
    pagePath = path.resolve(raw.startsWith('file://') ? fileURLToPath(raw) : raw);
    if (fs.existsSync(pagePath) && fs.statSync(pagePath).isDirectory()) pagePath = path.join(pagePath, 'index.html');
    if (!fs.existsSync(pagePath)) throw new UsageError(`page not found: ${pagePath}`);
    pageDir = path.dirname(pagePath);
  }
  refuseSkillWrites(cli, pageDir);
  const pw = loadPlaywright(pageDir);
  if (pw.missing) throw new Error(playwrightHint(pw));
  const browser = findBrowser(cli.browser, pw.work);
  if (!browser) throw new Error(browserHint(pw));
  const cfg = { cli, isUrl, pagePath, pageDir, chromium: pw.mod.chromium, pw, browser };
  if (isUrl) cfg.url = raw;
  else {
    const server = await startServer(pageDir);
    cfg.url = `http://127.0.0.1:${server.address().port}/${encodeURI(path.basename(pagePath))}`;
  }
  return cfg;
}

// Refuse, before any work, output into the read-only skill folder (S3): --out, its default beside a page there, or
// --frames-dir. --check-determinism writes only temporary files.
function refuseSkillWrites(cli, pageDir) {
  if (cli['check-determinism'] !== undefined) return;
  const outDir = cli.out ? path.dirname(path.resolve(cli.out)) : pageDir ? path.join(pageDir, 'renders') : path.resolve('renders');
  const why = `inside the skill folder ${SKILL_DIR}, which render.mjs never writes into (a bundled skill is read-only)`;
  if (insideSkill(outDir)) {
    throw new UsageError(cli.out ? `--out ${path.resolve(cli.out)} is ${why}: give --out a path in your work folder`
      : `the default output folder ${outDir} is ${why}: pass --out with a path in your work folder (e.g. --out renders/v1.mp4), or copy the page there first`);
  }
  if (cli['frames-dir'] && insideSkill(cli['frames-dir'])) throw new UsageError(`--frames-dir ${path.resolve(cli['frames-dir'])} is ${why}: give it a folder in your work folder`);
}

function finishConfig(cfg, contract, animInfo) {
  const { cli } = cfg;
  const v = contract.hasVideo ? contract : {};
  cfg.hasSeek = Boolean(contract.hasSeek);
  cfg.fps = cli.fps ?? (Number(v.fps) > 0 ? Number(v.fps) : 30);
  cfg.W = cli.width ?? (Number.isInteger(v.width) && v.width > 0 ? v.width : 1920);
  cfg.H = cli.height ?? (Number.isInteger(v.height) && v.height > 0 ? v.height : 1080);
  if ((cli.width || cli.height) && Number.isInteger(v.width) && Number.isInteger(v.height) && (cfg.W !== v.width || cfg.H !== v.height)) {
    warn(`rendering ${cfg.W}x${cfg.H} but the page declares ${v.width}x${v.height}: the page must lay itself out for this size or it will be cropped (for a half-size preview use --draft)`);
  }
  let duration = cli.duration ?? (Number(v.duration) > 0 ? Number(v.duration) : null);
  if (!cfg.hasSeek) {
    const why = contract.hasVideo ? 'window.__video has no seek(t)' : `no window.__video after load (+${VIDEO_WAIT_MS / 1000} s)`;
    if (animInfo && animInfo.count === 0) warn(`${why} and no Web Animations: every frame shows the page as loaded`);
    else {
      warn(`${why}: falling back to seeking Web Animations only`);
      warn('CSS animations, CSS transitions and element.animate() are captured; JS-driven motion (requestAnimationFrame, timers, canvas, GSAP tickers) is NOT');
    }
    if (duration === null && animInfo) {
      if (animInfo.infinite) throw new UsageError('the page has infinite animations and no duration: pass --duration S');
      if (animInfo.end > 0) { duration = animInfo.end; log(`duration ${fmtT(duration)} s taken from the longest Web Animation (${plural(animInfo.count, 'animation')})`); }
    }
  }
  if (!(duration > 0)) throw new UsageError('no duration: set window.__video.duration or pass --duration S');
  cfg.duration = duration;
  cfg.N = Math.round(duration * cfg.fps);
  if (cfg.N < 1) throw new UsageError(`duration ${duration} s at ${cfg.fps} fps gives no frames`);
  let [a, b] = cli.rangeAB ?? [0, duration];
  const rangeFlag = cli['check-determinism'] !== undefined ? '--check-determinism' : '--range';
  if (a >= duration) throw new UsageError(`${rangeFlag} starts at ${a} s, at or after the end (${fmtT(duration)} s)`);
  if (b > duration + 1e-9) { warn(`${rangeFlag} end ${b} s is past the end; clamped to ${fmtT(duration)} s`); b = duration; }
  cfg.f0 = Math.round(a * cfg.fps);
  cfg.f1 = Math.min(cfg.N, Math.max(cfg.f0 + 1, Math.round(b * cfg.fps)));
  cfg.range = cli.rangeAB ? [cfg.f0 / cfg.fps, cfg.f1 / cfg.fps] : null;
  cfg.timeline = contract.hasVideo && contract.timeline && typeof contract.timeline === 'object' ? contract.timeline : {};
  if (cfg.timeline.error) { warn(`window.__video.timeline is not JSON-serializable (${cfg.timeline.error}); treated as empty (size and timing only)`); cfg.timeline = {}; }
  cfg.look = contract.look ?? null;
  // Output naming: the default never lets a range or draft overwrite the full render.
  const outDir = cfg.pageDir ? path.join(cfg.pageDir, 'renders') : path.resolve('renders');
  const suffix = (cfg.range ? `-${fmtT(cfg.range[0])}-${fmtT(cfg.range[1])}` : '') + (cli.draft ? '-draft' : '');
  cfg.out = cli.out ? path.resolve(cli.out) : path.join(outDir, `out${suffix}${cli.alpha ? '-alpha.mov' : '.mp4'}`);
  const ext = path.extname(cfg.out);
  cfg.timelinePath = (ext ? cfg.out.slice(0, -ext.length) : cfg.out) + '.timeline.json';
  cfg.scale = cli.draft ? 0.5 : (cli.scale ?? 1);
  cfg.outW = cli.draft ? 2 * Math.round(cfg.W / 4) : cfg.W;
  cfg.outH = cli.draft ? 2 * Math.round(cfg.H / 4) : cfg.H;
  return cfg;
}

// ---------------------------------------------------------------- timeline export
const AUDIO_EXT = /\.(wav|mp3|flac|aiff?|ogg|oga|opus|m4a|aac|caf)$/i;
function exportTimeline(cfg) {
  const src = cfg.timeline;
  const [a, b] = cfg.range ?? [0, cfg.duration];
  const dur = b - a;
  const tl = { version: 1, width: cfg.outW, height: cfg.outH, fps: cfg.fps, duration: +dur.toFixed(6) };
  if (cfg.range) tl.range = { start: a, end: b };
  const sh = (t) => +(t - a).toFixed(6);
  const inRange = (t) => Number.isFinite(t) && t >= a - 1e-9 && t <= b + 1e-9;
  const bad = [];
  const spans = (list, name) => list.filter((x) => {
    const ok = Number.isFinite(x?.start) && Number.isFinite(x?.end) && x.end > x.start;
    if (!ok) bad.push(`${name} ${JSON.stringify(x)}`);
    return ok && x.end > a && x.start < b;
  }).map((x) => ({ ...x, start: sh(Math.max(x.start, a)), end: sh(Math.min(x.end, b)) }));
  const points = (list, name) => list.filter((x) => {
    if (!Number.isFinite(x?.t)) { bad.push(`${name} ${JSON.stringify(x)}`); return false; }
    return inRange(x.t);
  }).map((x) => ({ ...x, t: sh(x.t) }));
  // Sound paths in film.js (cues, layers, music) are relative to the page; the timeline file may live elsewhere,
  // so rebase them.
  const rebase = (p) => {
    if (typeof p !== 'string' || !cfg.pageDir || path.isAbsolute(p) || /^[a-z]+:\/\//i.test(p) || !(/[\\/]/.test(p) || AUDIO_EXT.test(p))) return p;
    return path.relative(path.dirname(cfg.timelinePath), path.resolve(cfg.pageDir, p)).split(path.sep).join('/');
  };
  for (const [key, val] of Object.entries(src)) {
    if (['version', 'width', 'height', 'fps', 'duration', 'range'].includes(key)) continue;
    // steps and effects are spans of the film too (vqa.py reads them on the clip's clock): cut and shifted like holds.
    // A hold also carries what the page measured for it (S8: its kind, read text, counts, need, read box).
    if (key === 'holds') { if (Array.isArray(val)) tl[key] = spans(val.map((h, i) => (cfg.holdFacts?.[i] ? { ...h, ...cfg.holdFacts[i] } : h)), 'hold'); }
    else if (['scenes', 'steps', 'effects'].includes(key)) { if (Array.isArray(val)) tl[key] = spans(val, key.slice(0, -1)); }
    // a move (lib/film.js) is a span whose land and speed peak shift with it; a peak of null means constant speed
    else if (key === 'moves') {
      if (Array.isArray(val)) {
        tl[key] = spans(val, 'move').map((x) => ({ ...x, ...(Number.isFinite(x.land) ? { land: sh(x.land) } : {}),
          ...('peak' in x ? { peak: Number.isFinite(x.peak) ? sh(x.peak) : null } : {}) }));
      }
    } else if (key === 'events' || key === 'seams') { if (Array.isArray(val)) tl[key] = points(val, key.slice(0, -1)); }
    // a cue on a move says where on it as `at` (start, land or peak): lib/film.js writes it as move_anchor, vqa.py reads at
    else if (key === 'cues') {
      if (Array.isArray(val)) {
        tl[key] = points(val, 'cue').map((c) => ({ ...c, sound: rebase(c.sound),
          ...(c.move !== undefined && c.at === undefined && c.move_anchor !== undefined ? { at: c.move_anchor } : {}) }));
      }
    }
    else if (key === 'layers') {
      // A layer's start shifts with --range, unclamped: mix.py trims or skips it. A `times` layer keeps only the
      // hits in the clip, its sound list rotated so each kept hit keeps the sound it has in the full film (times
      // ascending).
      if (Array.isArray(val)) {
        tl[key] = [];
        for (const x of val) {
          const ok = Boolean(x) && typeof x === 'object' && (x.start === undefined || Number.isFinite(x.start))
            && (x.times === undefined || Array.isArray(x.times));
          if (!ok) { bad.push(`layer ${JSON.stringify(x)}`); continue; }
          const sound = Array.isArray(x.sound) ? x.sound.map(rebase) : rebase(x.sound);
          if (!Array.isArray(x.times)) { tl[key].push({ ...x, sound, ...(x.start !== undefined || a ? { start: sh(x.start ?? 0) } : {}) }); continue; }
          const kept = [];
          x.times.forEach((t, i) => { if (!Number.isFinite(t)) bad.push(`layer ${x.id ?? '?'} time ${JSON.stringify(t)}`); else if (inRange(t)) kept.push(i); });
          if (!kept.length) continue;
          const k = Array.isArray(sound) && sound.length ? kept[0] % sound.length : 0;
          tl[key].push({ ...x, sound: k ? [...sound.slice(k), ...sound.slice(0, k)] : sound, times: kept.map((i) => sh(x.times[i])),
            ...(x.start !== undefined ? { start: sh(x.start) } : {}) });
        }
      }
    } else if (key === 'music') {
      if (val && typeof val === 'object') {
        const m = { ...val, file: rebase(val.file) };
        const start = Number(val.start) || 0;
        if (start < a) { m.offset = +((Number(val.offset) || 0) + (a - start)).toFixed(6); m.start = 0; } else m.start = sh(start);
        tl.music = m;
      } else if (val === null) tl.music = null; // no bed: mix.py lays room tone (S21, the starter's music: null)
    } else tl[key] = val; // e.g. a beat grid: passed through untouched
  }
  // The look's register, format and style id when the timeline names none (S8; film/style.js from new.py look).
  for (const [k, v] of [['register', cfg.look?.register], ['format', cfg.look?.format], ['style', cfg.look?.id]]) if (tl[k] === undefined && typeof v === 'string' && v) tl[k] = v;
  // S6: the page's data-layer inventory, the spans where a capped content layer changes (on the content pass those
  // frames show only what it hides: S9 counts them as alive) and the capture without ambient or capped layers.
  if (cfg.layers) {
    if (cfg.layers.inventory.length) tl.data_layers = cfg.layers.inventory;
    const alive = cfg.layers.alive.map(([s0, e0, names]) => ({ start: sh(Math.max(s0, a)), end: sh(Math.min(e0, b)), layers: names })).filter((x) => x.end > x.start);
    if (alive.length) tl.content_alive = alive;
    if (cfg.layers.pass) tl.content_pass = path.relative(path.dirname(cfg.timelinePath), cfg.layers.pass).split(path.sep).join('/');
  }
  for (const x of bad.slice(0, 5)) warn(`timeline entry with missing or invalid times skipped: ${x.slice(0, 160)}`);
  fs.mkdirSync(path.dirname(cfg.timelinePath), { recursive: true });
  fs.writeFileSync(cfg.timelinePath, JSON.stringify(tl, null, 2) + '\n');
  const count = (k) => (tl[k] ? plural(tl[k].length, k.slice(0, -1)) : null);
  log(`timeline -> ${cfg.timelinePath} (${['scenes', 'holds', 'events', 'cues', 'layers'].map(count).filter(Boolean).join(', ') || 'size and timing only'}${tl.music ? ', music' : ''})`);
  return tl;
}

// ---------------------------------------------------------------- page facts: layers (S6), holds (S8)
// Runs inside the page once per sample i: each element's box, style signature and canvas pixel hash, kept in the page
// so only a summary crosses over (flash() overlays and SVG resources are not layers). An element rebuilt in place (same
// tag, data-layer and read text, a shared class or neither has one) takes over the gone one's record, so a layer rebuilt on every seek is
// still seen to move and a scene's elements stay apart from those of the scene that replaces it.
function pageLayers({ i, W, H }) {
  const kit = window.__c2vKit, st = (window.__c2vLayers ??= { recs: [], of: new WeakMap(), at: new Map(),
    sel: (r) => r.at.replace(/:nth-child\(\d+\)$/, (m) => r.cls.map((c) => `.${CSS.escape(c)}`).join('') + m) });
  const holders = new Set(), range = document.createRange(), tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!p || holders.has(p) || !/\S/.test(n.data) || kit.kind(p) !== 'read') continue;
    range.selectNodeContents(n);
    if ([...range.getClientRects()].some((r) => r.width > 0.5 && r.height > 0.5)) for (let a = p; a && !holders.has(a); a = a.parentElement) holders.add(a);
  }
  const SKIP = /^(script|style|noscript|template|defs|mask|clippath|pattern|symbol|marker|lineargradient|radialgradient|filter|metadata|title|desc)$/i;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT,
    { acceptNode: (e) => (SKIP.test(e.localName) || e.hasAttribute('data-c2v-flash') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const thumb = (st.thumb ??= Object.assign(Object.assign(document.createElement('canvas'), { width: 64, height: 36 }).getContext('2d', { willReadFrequently: true }),
    { imageSmoothingEnabled: true, imageSmoothingQuality: 'high' }));
  const cum = new Map(), places = new Map(), nth = new Map();
  const place = (el) => { // memoized per sample: places change when the page adds or removes elements
    let p = places.get(el);
    if (p === undefined) {
      const up = el.parentElement;
      if (el === document.body || !up) p = el.localName;
      else if (el.id && document.getElementById(el.id) === el) p = `#${CSS.escape(el.id)}`;
      else {
        let at = nth.get(up);
        if (!at) nth.set(up, (at = new Map([...up.children].map((c, k) => [c, k + 1]))));
        p = `${place(up)} > ${CSS.escape(el.localName)}:nth-child(${at.get(el)})`;
      }
      places.set(el, p);
    }
    return p;
  };
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    const cs = getComputedStyle(el), o = (cum.get(el.parentElement) ?? 1) * parseFloat(cs.opacity);
    cum.set(el, o);
    const r = el.getBoundingClientRect(), box = [Math.max(0, r.left), Math.max(0, r.top), Math.min(W, r.right), Math.min(H, r.bottom)];
    const shown = cs.visibility === 'visible' && o > 0.01 && box[2] > box[0] && box[3] > box[1];
    let px = '';
    if (shown && el instanceof HTMLCanvasElement && el.width && el.height) {
      try {
        thumb.clearRect(0, 0, 64, 36);
        thumb.drawImage(el, 0, 0, 64, 36);
        let h = 2166136261;
        for (const v of thumb.getImageData(0, 0, 64, 36).data) h = Math.imul(h ^ v, 16777619);
        px = (h >>> 0).toString(36);
      } catch { px = '?'; }
    }
    const sig = [cs.transform, cs.translate, cs.scale, cs.rotate, cs.filter, cs.backgroundPosition, cs.opacity, cs.visibility, cs.mixBlendMode,
      r.left.toFixed(2), r.top.toFixed(2), r.width.toFixed(2), r.height.toFixed(2), px].join('|');
    const at = place(el), layer = el.getAttribute('data-layer'), holds = holders.has(el);
    let rec = st.of.get(el);
    if (!rec) {
      const old = st.at.get(at);
      if (old && !old.el.isConnected && old.tag === el.localName && old.layer === layer && old.holds === holds
        && (old.cls.length ? old.cls.some((c) => el.classList.contains(c)) : !el.classList.length)) rec = old;
      else st.recs.push((rec = { id: st.recs.length, tag: el.localName, layer, cls: [...el.classList], sig, changes: [], boxes: [], maxO: 0, blend: '', text: false, first: i }));
      rec.el = el;
      st.of.set(el, rec);
    }
    if (rec.sig !== sig) { rec.changes.push(i); rec.sig = sig; }
    st.at.set(at, rec);
    // up: the record it was last drawn in; holds: whether it held read text on its last sample
    Object.assign(rec, { at, last: i, holds, cls: rec.cls.filter((c) => el.classList.contains(c)), up: st.of.get(el.parentElement) ?? null });
    if (shown) {
      rec.boxes.push([i, ...box.map((v) => Math.round(v))]);
      rec.maxO = Math.max(rec.maxO, o);
      if (!/^(normal|multiply|darken|color-burn)$/.test(cs.mixBlendMode)) rec.blend = cs.mixBlendMode;
    }
    if (holds) rec.text = true;
  }
}

// The summary: each element that changed or carries data-layer. sel adds its classes to where it was last seen, so
// another element in its place is left alone; group (parent, tag, class) measures siblings together, an id ending in a
// number standing in for a class (sprite copies) and any other id naming one thing.
function pageLayerList() {
  const kit = window.__c2vKit, st = window.__c2vLayers, out = [];
  if (!st) return out;
  for (const r of st.recs) {
    const layer = r.el.getAttribute('data-layer');
    if (!r.changes.length && !layer) continue;
    const anc = [];
    for (let a = r.up; a; a = a.up) anc.push(a.id);
    const cls = (r.el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
    const series = !cls.length && r.el.id ? /^(.*?)[-_]?\d+$/.exec(r.el.id) : null, like = cls.length ? `.${cls.join('.')}` : series?.[1] ? `[id^=${series[1]}]` : '';
    out.push({ id: r.id, desc: kit.desc(r.el), sel: st.sel(r), first: r.first, last: r.last,
      group: r.el.id && !cls.length && !series ? null : `${r.up?.id ?? 'body'} ${r.el.localName}${like}`,
      kind: r.el.localName + (cls.length ? `.${cls[0]}` : like), parent: r.up ? kit.desc(r.up.el) : 'body', layer, text: r.text,
      maxO: +r.maxO.toFixed(3), blend: r.blend, boxes: r.boxes, changes: r.changes, anc, canvas: r.el instanceof HTMLCanvasElement });
  }
  return out;
}

// Runs inside the page (S6): whether q matches an element that holds no drawn read text (a layer the content pass hides
// never does; a caption another scene put in its place may).
function pagePresent(q) {
  const kit = window.__c2vKit, range = document.createRange();
  let el = null;
  try { el = document.querySelector(q); } catch {}
  if (!el) return false;
  for (let tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!/\S/.test(n.data) || !n.parentElement || kit.kind(n.parentElement) !== 'read') continue;
    range.selectNodeContents(n);
    if ([...range.getClientRects()].some((r) => r.width > 0.5 && r.height > 0.5)) return false;
  }
  return true;
}

// Runs inside the page (S6) on one sample: for each element, whether it is a bottom layer under the text, read off the
// paint order at points of its box (document.elementsFromPoint, pointer-events on for everything in this session):
// nothing but its own ancestors under it, and drawn read text over it where the two meet.
function pageBottom({ ids, W, H }) {
  const kit = window.__c2vKit, st = window.__c2vLayers, out = {};
  if (!document.getElementById('__c2v_hits')) document.head.append(Object.assign(document.createElement('style'), { id: '__c2v_hits', textContent: '*{pointer-events:auto!important}' }));
  const texts = [], range = document.createRange(), tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!p || !/\S/.test(n.data) || kit.kind(p) !== 'read' || getComputedStyle(p).visibility !== 'visible' || kit.opacity(p) < 0.2) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) texts.push([p, r.left, r.top, r.right, r.bottom]);
  }
  // The element now in a record's place, when the seek to this sample rebuilt it.
  const elOf = (r) => { if (!r || r.el.isConnected) return r?.el; try { return document.querySelector(st.sel(r)); } catch { return null; } };
  const hit = (el, x, y) => { const list = document.elementsFromPoint(x, y), k = list.findIndex((e) => e === el || el.contains(e)); return k < 0 ? null : { list, k }; };
  for (const id of ids) {
    const el = elOf(st.recs[id]), b = el?.getBoundingClientRect();
    if (!b) continue;
    const l = Math.max(0, b.left), t = Math.max(0, b.top), r = Math.min(W, b.right), bt = Math.min(H, b.bottom);
    if (r - l < 1 || bt - t < 1) continue;
    let tested = false, bottom = true, under = false;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const h = hit(el, l + fx * (r - l), t + fy * (bt - t));
      if (!h) continue;
      tested = true;
      if (h.list.slice(h.k + 1).some((e) => !(e === el || el.contains(e) || e.contains(el)))) bottom = false;
    }
    for (const [p, x0, y0, x1, y1] of texts) {
      const ix0 = Math.max(l, x0), iy0 = Math.max(t, y0), ix1 = Math.min(r, x1), iy1 = Math.min(bt, y1);
      if (el.contains(p) || ix1 - ix0 < 1 || iy1 - iy0 < 1) continue;
      const h = hit(el, (ix0 + ix1) / 2, (iy0 + iy1) / 2);
      if (h && h.list.slice(0, h.k).some((e) => e === p || p.contains(e))) { under = true; break; }
    }
    out[id] = { tested, bottom: tested && bottom, under };
  }
  return out;
}

// The largest share of the frame that sets of boxes sweep in any LAYERS.windowS window: each box at its sample, and the
// box spanning two consecutive samples of one element (its path between them), on a grid of cell centres 1/160 of the
// width apart. Each box is added and removed once as the window slides: O(cells covered), never quadratic in samples.
function sweptShare(members, times, W, H) {
  const gw = 160, gh = Math.max(1, Math.round((gw * H) / W)), cnt = new Uint32Array(gw * gh), at = times.map(() => []);
  for (const boxes of members) {
    boxes.forEach(([i, l, t, r, b], k) => {
      at[i].push([l, t, r, b]);
      const p = boxes[k - 1];
      if (p && p[0] === i - 1) at[i].push([Math.min(l, p[1]), Math.min(t, p[2]), Math.max(r, p[3]), Math.max(b, p[4])]);
    });
  }
  let covered = 0, best = 0, z = -1;
  const mark = ([l, t, r, b], d) => {
    const x0 = Math.max(0, Math.ceil((l * gw) / W - 0.5)), x1 = Math.min(gw, Math.ceil((r * gw) / W - 0.5));
    const y0 = Math.max(0, Math.ceil((t * gh) / H - 0.5)), y1 = Math.min(gh, Math.ceil((b * gh) / H - 0.5));
    for (let y = y0; y < y1; y++) {
      for (let c = y * gw + x0, e = y * gw + x1; c < e; c++) {
        if (d > 0) { if (cnt[c]++ === 0) covered++; } else if (--cnt[c] === 0) covered--;
      }
    }
  };
  for (let a = 0; a < times.length; a++) {
    while (z + 1 < times.length && times[z + 1] - times[a] <= LAYERS.windowS + 1e-9) for (const q of at[++z]) mark(q, 1);
    best = Math.max(best, covered);
    for (const q of at[a]) mark(q, -1);
  }
  return best / (gw * gh);
}

// Ambient (S6): changed, no read text, and a blend other than normal or darkening (ink), opacity <= LAYERS.translucent
// or a moving bottom layer, sweeping LAYERS.sweep of the frame in a window (swept area, never box size; sibling groups
// too). data-layer texture and ground are ambient by declaration; content is honoured only on an opaque element with no
// such blend, and capped (hidden, its changes exported) over half the frame with no read text. hide: selectors q,
// applied strictly between frames from and to.
async function measureLayers(cfg, s) {
  const { fps, W, H } = cfg, step = Math.max(1, Math.round(fps / LAYERS.hz)), frames = [];
  for (let f = cfg.f0; f < cfg.f1; f += step) frames.push(f);
  if (frames.at(-1) !== cfg.f1 - 1) frames.push(cfg.f1 - 1);
  const times = frames.map((f) => f / fps), meter = progressMeter(frames.length, 'layers');
  try {
    for (const [i, f] of frames.entries()) { await seekTo(s, cfg, f / fps); await s.page.evaluate(pageLayers, { i, W, H }); meter.tick(); }
  } finally { meter.stop(); }
  const recs = await s.page.evaluate(pageLayerList), byId = new Map(recs.map((r) => [r.id, r]));
  const area = (r) => Math.max(0, ...r.boxes.map(([, l, t, rr, b]) => ((rr - l) * (b - t)) / (W * H)));
  const declared = (r) => r.layer === 'texture' || r.layer === 'ground';
  const honoured = (r) => r.layer === 'content' && !r.blend && r.maxO >= LAYERS.opaque;
  const loose = recs.filter((r) => r.changes.length && !r.text && !declared(r) && !honoured(r));
  // The bottom-layer test, at up to three samples where it shows, for opaque normal-blend elements that could sweep enough.
  const groups = new Map();
  for (const r of loose) if (r.group !== null) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const swept = new Map(), sweepOf = (r) => swept.get(r) ?? swept.set(r, sweptShare([r.boxes], times, W, H)).get(r);
  const groupSweep = new Map([...groups].filter(([, g]) => g.length > 1).map(([k, g]) => [k, sweptShare(g.map((r) => r.boxes), times, W, H)]));
  const tests = loose.filter((r) => !r.blend && r.maxO > LAYERS.translucent && r.boxes.length && (sweepOf(r) >= LAYERS.sweep || (groupSweep.get(r.group) ?? 0) >= LAYERS.sweep));
  const at = new Map();
  for (const r of tests) for (const k of new Set([0, r.boxes.length >> 1, r.boxes.length - 1])) at.set(r.boxes[k][0], [...(at.get(r.boxes[k][0]) ?? []), r.id]);
  const hits = new Map();
  for (const [i, ids] of [...at].sort((x, y) => x[0] - y[0])) {
    await seekTo(s, cfg, frames[i] / fps);
    for (const [id, v] of Object.entries(await s.page.evaluate(pageBottom, { ids, W, H }))) (hits.get(+id) ?? hits.set(+id, []).get(+id)).push(v);
  }
  for (const r of tests) { const v = (hits.get(r.id) ?? []).filter((x) => x.tested); r.bottom = v.length > 0 && v.every((x) => x.bottom) && v.some((x) => x.under); }
  const why = (r) => (r.blend ? `mix-blend-mode ${r.blend}` : r.maxO <= LAYERS.translucent ? `opacity ${r.maxO}` : r.bottom ? 'a moving bottom layer under the text' : null);
  // Each element's verdict; a group of qualifying siblings sweeping enough together is ambient as a whole.
  for (const r of recs) {
    if (declared(r)) r.status = r.layer;
    else if (honoured(r)) r.status = !r.text && area(r) >= LAYERS.capped ? 'capped' : 'content';
    else if (r.changes.length && !r.text && why(r) && sweepOf(r) >= LAYERS.sweep) r.status = 'ambient';
  }
  for (const [k, g] of groups) {
    const q = g.filter((r) => why(r));
    if (q.length > 1 && sweptShare(q.map((r) => r.boxes), times, W, H) >= LAYERS.sweep) for (const r of q) Object.assign(r, { status: 'ambient', unit: k });
  }
  // Inside a hidden element is hidden with it: listed once, by the outermost.
  const hidden = new Set(recs.filter((r) => ['texture', 'ground', 'capped', 'ambient'].includes(r.status)).map((r) => r.id));
  const shown = recs.filter((r) => r.status && !r.anc.some((a) => hidden.has(a)));
  // One line and one inventory entry per element, or per group of siblings with the same verdict.
  const units = new Map();
  for (const r of shown) { const k = r.unit ?? (['texture', 'ground'].includes(r.status) && r.group !== null ? `${r.group}|${r.status}` : `#${r.id}`); units.set(k, [...(units.get(k) ?? []), r]); }
  const pct = (v) => (v < 0.1 ? +(100 * v).toFixed(1) : Math.round(100 * v)), inventory = [], hide = [], alive = [];
  let moving = false;
  for (const g of units.values()) {
    const r = g[0], many = g.length > 1, sw = many ? sweptShare(g.map((x) => x.boxes), times, W, H) : sweepOf(r), box = Math.max(...g.map(area));
    const name = many ? `group ${g.length}x ${r.kind} in ${r.parent}` : r.desc, moves = g.some((x) => x.changes.length);
    const big = r.boxes.reduce((m, [, l, t, rr, b]) => ((rr - l) * (b - t) > m[0] * m[1] ? [rr - l, b - t] : m), [0, 0]);
    const entry = { el: name, layer: r.status === 'capped' ? 'content' : r.status, declared: Boolean(r.layer) && r.status !== 'ambient', hidden: r.status !== 'content',
      moves, box_pct: +(100 * box).toFixed(1), swept_pct: +(100 * sw).toFixed(1), ...(many ? { members: g.length } : {}) };
    if (r.status === 'ambient') {
      entry.why = why(r);
      warn(`ambient layer ${name} sweeps ${pct(sw)}% of the frame (${many ? `each box at most ${pct(box)}%` : `box ${pct(box)}%, ${big.map(Math.round).join('x')} px`}, ${why(r)})`
        + `${r.layer === 'content' ? '; data-layer="content" is honoured only on opaque, normal-blend elements' : ''}: hidden from the stillness checks`);
    } else if (r.status === 'texture' || r.status === 'ground') {
      log(`NOTE declared ${r.status} layer ${name} (data-layer="${r.status}") ${moves ? `sweeps ${pct(sw)}% of the frame` : 'holds still'}: hidden from the stillness checks`);
    } else {
      entry.capped = r.status === 'capped';
      log(`NOTE content layer ${name} (data-layer="content") covers ${pct(box)}% of the frame${entry.capped ? ' and holds no read text: capped like an alive '
        + 'hold (frames where only it changes go to the alive bucket) and hidden from the content pass' : ': counted as content'}`);
      const spans = [];
      for (const i of entry.capped ? r.changes : []) { const last = spans.at(-1); if (last && times[i - 1] <= last[1] + 1e-9) last[1] = times[i]; else spans.push([times[i - 1], times[i], [name]]); }
      alive.push(...spans);
    }
    inventory.push(entry);
    if (!entry.hidden) continue;
    hide.push(...g.map((x) => ({ q: x.sel, first: x.first, last: x.last })));
    moving ||= g.some((x) => x.changes.length);
  }
  // Each hidden only on the frames it is in the page, so its selector cannot hide what another scene put in its place
  // before or after it (from and to: the frames just outside them). Where it enters or leaves between two samples, the
  // frames between are looked at one by one: at most two sample steps of seeks for each layer that does.
  for (const h of hide) {
    const here = async (f) => { await seekTo(s, cfg, f / fps); return s.page.evaluate(pagePresent, h.q); };
    h.from = h.first > 0 ? frames[h.first - 1] : -1;
    if (h.first > 0) for (let f = frames[h.first] - 1; f > h.from; f--) if (!(await here(f))) { h.from = f; break; }
    h.to = h.last < frames.length - 1 ? frames[h.last + 1] : Infinity;
    if (h.last < frames.length - 1) for (let f = frames[h.last] + 1; f < h.to; f++) if (!(await here(f))) { h.to = f; break; }
    delete h.first;
    delete h.last;
  }
  return { inventory, hide, alive, moving, pass: null };
}

// Per-script counts of read text (S10) by the rule lib/film.js's hold() uses, so a need agrees whichever measured it.
// ja: count Han as Japanese (by default when s has kana; a caller counting part of a text passes the whole text's).
const KANA = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u, HAN = /\p{Script=Han}/u, HANGUL = /\p{Script=Hangul}/u;
const CJK_ANY = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc]/u;
const CJK_ALL = new RegExp(CJK_ANY.source, 'gu');
function scriptCounts(s, c = { latin_words: 0, chinese_chars: 0, japanese_chars: 0, korean_syllables: 0 }, { latin = true, cjk = true, ja = KANA.test(s) } = {}) {
  if (cjk) {
    for (const ch of s) {
      if (KANA.test(ch) || (ja && HAN.test(ch))) c.japanese_chars++;
      else if (HAN.test(ch)) c.chinese_chars++;
      else if (HANGUL.test(ch)) c.korean_syllables++;
    }
  }
  if (latin) c.latin_words += (s.replace(CJK_ALL, ' ').match(/[\p{L}\p{N}]+(?:['\u2019.-][\p{L}\p{N}]+)*/gu) ?? []).length;
  return c;
}
// A hold's `read` names elements when it starts with #, . or [, or a tag name followed by one: vqa.py's is_selector.
const isSelector = (s) => /^\s*[#.[]|^[A-Za-z][\w-]*[#.[]/.test(s);

// Runs inside the page at a hold's midpoint: the named elements' drawn read text, node by node with whether it reaches
// each read floor, a space at each word break no text node holds (<br>, a box edge, kit.apart), chart values, the box.
function pageHold({ read, chart, box, W, H, floors }) {
  const kit = window.__c2vKit, all = (q) => { try { return [...document.querySelectorAll(q)]; } catch { return null; } }, out = {};
  const els = read ? all(read) : null;
  if (els) {
    out.found = els.length;
    out.parts = [];
    const range = document.createRange(), gap = () => out.parts.push([' ', true, true]);
    const textOrBr = { acceptNode: (n) => (n.nodeType === Node.TEXT_NODE || n.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) };
    for (const el of els) {
      gap();
      let last = null, run = null; // the flow block of the last run kept, and its last client rect (none after a break)
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, textOrBr);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType !== Node.TEXT_NODE) { gap(); run = null; continue; }
        const p = n.parentElement;
        if (!p || kit.kind(p) !== 'read') continue;
        if (!/\S/.test(n.data)) { gap(); run = null; continue; }
        const cs = getComputedStyle(p);
        range.selectNodeContents(n);
        const rs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        if (cs.visibility !== 'visible' || kit.opacity(p) < 0.2 || !rs.some((r) => r.right > 0 && r.bottom > 0 && r.left < W && r.top < H)) continue;
        const px = kit.size(p, cs), b = kit.block(p);
        if ((last && b !== last) || (run && kit.apart(run, rs[0]))) gap();
        last = b;
        run = rs.at(-1);
        out.parts.push([n.data, px >= floors.read - 0.5, px >= floors.cjk - 0.5]);
      }
    }
  }
  if (chart) {
    const cs = all(chart) ?? [], items = cs.flatMap((el) => [...el.querySelectorAll('[data-value]')]);
    out.values = items.length || cs.reduce((k, el) => k + (el.textContent.match(/\d[\d.,]*/g) ?? []).length, 0);
  }
  const bs = box ? all(box) : null;
  if (bs?.length) {
    const rs = bs.map((e) => e.getBoundingClientRect());
    out.box = [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom))];
  }
  return out;
}

// Each hold's kind and need (registers.json's numbers), measured at its midpoint (S8, S10): read text counts only at or
// above its floor, as one text however it is split into nodes (letter spans make one word, kana makes a caption's Han
// Japanese), so the need agrees with hold()'s. An alive hold naming read elements gets its read box; a read given as
// words is counted as written, and one hold() already measured is kept.
async function measureHolds(cfg, s) {
  const holds = Array.isArray(cfg.timeline.holds) ? cfg.timeline.holds : [], facts = [];
  const [a, b] = cfg.range ?? [0, cfg.duration], k = cfg.outW / cfg.W;
  let R = null; // registers.json is read only when a hold needs a number from it
  const reg = () => (R ??= registers().holds);
  const needOf = (c) => +Math.max(reg().need_s.read_min, c.latin_words * R.reading.latin_s_per_word + c.chinese_chars / R.reading.chinese_chars_per_s
    + c.japanese_chars / R.reading.japanese_chars_per_s + c.korean_syllables / R.reading.korean_syllables_per_s).toFixed(6);
  const nonzero = (c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v));
  for (const [i, h] of holds.entries()) {
    if (!h || typeof h !== 'object' || !(Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start) || h.end <= a || h.start >= b) continue;
    // A hold that declares no kind and names nothing to read gets none: vqa.py asks for one rather than assume a breath.
    const kind = ['read', 'chart', 'logo', 'breath'].includes(h.kind) ? h.kind : h.read != null ? 'read' : h.chart != null ? 'chart' : h.logo ? 'logo' : null;
    const f = kind ? { kind } : {}, sel = kind === 'read' && typeof h.read === 'string' && isSelector(h.read) ? h.read : null;
    const boxSel = h.alive && !Array.isArray(h.read_box) ? (typeof h.box === 'string' ? h.box : sel) : null, chartSel = kind === 'chart' && typeof h.chart === 'string' ? h.chart : null;
    let m = {};
    if (sel || chartSel || boxSel) {
      await seekTo(s, cfg, (h.start + h.end) / 2);
      m = await s.page.evaluate(pageHold, { read: sel, chart: chartSel, box: boxSel, W: cfg.W, H: cfg.H, floors: sel ? floorsFor(cfg.W, cfg.H) : null });
    }
    if (kind === 'read' && sel) {
      if (m.found) {
        // Text under a floor is a word break in the text counted against that floor.
        let latinText = '', cjkText = '', whole = '';
        const kept = [];
        for (const [t, latin, cjk] of m.parts) {
          latinText += latin ? t : ' ';
          cjkText += cjk ? t : ' ';
          whole += t;
          if (!/\S/.test(t) || (latin && /[\p{L}\p{N}]/u.test(t.replace(CJK_ALL, ''))) || (cjk && CJK_ANY.test(t))) kept.push(t);
        }
        const c = scriptCounts(latinText, undefined, { cjk: false });
        scriptCounts(cjkText, c, { latin: false, ja: KANA.test(whole) });
        Object.assign(f, { read_text: kept.join('').replace(/\s+/g, ' ').trim(), counts: nonzero(c), need: needOf(c) });
      } else warn(`hold ${fmtT(h.start)}-${fmtT(h.end)} s: read '${h.read}' names no element at its midpoint, so its need is not measured`);
    } else if (kind === 'read' && typeof h.read === 'string' && h.read_text === undefined) {
      const c = scriptCounts(h.read);
      Object.assign(f, { read_text: h.read.replace(/\s+/g, ' ').trim(), counts: nonzero(c), need: needOf(c) });
    } else if (kind === 'chart') {
      const values = chartSel ? m.values : Number.isFinite(h.values) ? h.values : h.counts?.values;
      if (Number.isFinite(values)) Object.assign(f, { counts: { values }, need: +(reg().need_s.chart + R.need_s.chart_per_value * values).toFixed(6) });
    } else if (kind === 'logo') f.need = reg().need_s.logo;
    if (m.box) f.read_box = m.box.map((v) => Math.round(v * k));
    if (Object.keys(f).length) facts[i] = f;
  }
  return facts;
}

// The page facts a render, --frames-dir and --timeline-only export: its layers and its holds, in a session of its own so
// the render's frames keep a plain render's capture history.
async function measurePage(cfg, s) {
  cfg.layers = await measureLayers(cfg, s);
  cfg.holdFacts = await measureHolds(cfg, s);
}

// <out>.content.mkv (S6): the render with its ambient and capped layers hidden (!important beats the page's inline
// styles), for vqa.py's stillness measures; each layer's rule holds only between its from and to frames.
const contentPassPath = (cfg) => cfg.timelinePath.replace(/\.timeline\.json$/, '.content.mkv');
async function renderContentPass(cfg) {
  const file = contentPassPath(cfg), part = `${file}.part`, total = cfg.f1 - cfg.f0, w = LAYERS.passW, h = 2 * Math.round((w * cfg.H) / cfg.W / 2);
  const rules = cfg.layers.hide, workers = Math.max(1, Math.min(cfg.cli.workers ?? 1, total)), on = (f) => rules.filter((x) => f > x.from && f < x.to);
  const enc = ['-vf', `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,${SETPARAMS}`, '-c:v', 'ffv1', '-level', '3'];
  const input = ['-f', 'image2pipe', '-framerate', String(cfg.fps), '-c:v', 'png', '-i', '-'];
  log(`content pass: ${total} frames at ${w}x${h} with ${plural(rules.length, 'layer')} hidden -> ${file}`);
  live.partial.add(part);
  const tmp = workers > 1 ? fs.mkdtempSync(path.join(os.tmpdir(), 'render-mjs-content-')) : null;
  if (tmp) live.tmp.add(tmp);
  const meter = progressMeter(total, 'content pass');
  // A rule counts as found once its selector matches on a frame it is in force; one that never does leaves its layer visible.
  const unseen = new Set(rules);
  try {
    const chunks = splitRange(cfg.f0, cfg.f1, workers), segs = chunks.map((_, i) => (tmp ? path.join(tmp, `seg-${i}.mkv`) : part));
    await Promise.all(chunks.map(async (c, i) => {
      const s = await openSessionReady(cfg, 'content');
      try {
        const sink = new FFmpegSink([...input, ...enc, '-f', 'matroska', segs[i]], `content pass${tmp ? ` segment ${i}` : ''}`);
        let sheet = null;
        for (let f = Math.max(0, c.start - (i ? Math.round(PREROLL_SECONDS * cfg.fps) : 0)); f < c.end; f++) {
          await seekTo(s, cfg, f / cfg.fps);
          const now = on(f), text = now.map((x) => `${x.q} { opacity: 0 !important; }`).join('\n'), look = now.filter((x) => unseen.has(x));
          if (text !== sheet || look.length) {
            const found = await s.page.evaluate(({ text, qs }) => {
              let st = document.getElementById('__c2v_content');
              if (!st) document.head.append((st = Object.assign(document.createElement('style'), { id: '__c2v_content' })));
              if (st.textContent !== text) st.textContent = text;
              return qs.map((q) => { try { return Boolean(document.querySelector(q)); } catch { return false; } });
            }, { text, qs: look.map((x) => x.q) });
            look.forEach((x, k) => { if (found[k]) unseen.delete(x); });
            sheet = text;
          }
          const buf = await capture(s, cfg, { format: 'png', scale: w / cfg.W });
          if (f >= c.start) { await sink.write(buf); meter.tick(); }
        }
        await sink.end();
      } finally { await s.close(); }
    }));
    for (const x of [...unseen].slice(0, 3)) warn(`content pass: ${x.q} matches nothing on any frame it was in the page, so that layer stays visible`);
    if (tmp) {
      fs.writeFileSync(path.join(tmp, 'list.txt'), segs.map((x) => `file ${shq(x)}`).join('\n') + '\n');
      const r = runSync('ffmpeg content pass join', 'ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', '-f', 'matroska', part],
        { encoding: 'utf8' }, CONVERT_MS);
      if (r.status !== 0) throw new Error(`ffmpeg could not join the content pass: ${(r.stderr || '').trim()}`);
    }
  } finally {
    meter.stop();
    if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); live.tmp.delete(tmp); }
  }
  const p = probeVideo(part, true), frames = Number(p.nb_read_packets);
  if (frames !== total) throw new Error(`content pass: encoded ${frames} frames, expected ${total}`);
  fs.renameSync(part, file);
  live.partial.delete(part);
  return file;
}
// After a render or --frames-dir: the content pass when a layer it hides moves; otherwise an older one beside --out
// pairs with no render any more, and goes.
async function contentPass(cfg) {
  const file = contentPassPath(cfg);
  if (cfg.layers.moving) cfg.layers.pass = await renderContentPass(cfg);
  else if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); log(`removed ${file}: nothing it would hide moves in this render`); }
}
// --timeline-only: the content pass beside --out, named when a layer it hides still moves and it has this render's frames.
function existingContentPass(cfg) {
  if (!cfg.layers.moving) return null;
  const file = contentPassPath(cfg), total = cfg.f1 - cfg.f0;
  let frames = -1;
  try { frames = Number(probeVideo(file, true).nb_read_packets); } catch {}
  if (frames === total) return file;
  warn(`${fs.existsSync(file) ? `${file} does not have this render's ${total} frames` : `no content pass at ${file}`}: render again to write it; the timeline names none`);
  return null;
}

// ---------------------------------------------------------------- ffmpeg sinks
class FFmpegSink {
  constructor(args, label) {
    this.label = label;
    this.stderr = '';
    this.proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    live.procs.add(this.proc);
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdin.on('error', () => {}); // EPIPE surfaces through the exit code below
    this.exited = new Promise((res) => {
      this.proc.on('error', (e) => { this.stderr += String(e); res({ code: -1 }); });
      this.proc.on('close', (code, signal) => { live.procs.delete(this.proc); res({ code, signal }); });
    });
  }
  failure(r) { return new Error(`ffmpeg (${this.label}) exited ${r.code ?? r.signal}: ${this.stderr.trim().split('\n').slice(-4).join(' | ') || 'no message'}`); }
  // Stall watchdog (S2): ffmpeg that takes no frame from a full pipe, or does not exit once its input ends, for
  // STALL_MS is killed and the step fails, named. Waiting on the page (a slow seek) never counts against it.
  async write(buf) {
    if (this.proc.stdin.write(buf)) return;
    const r = await stallGuard(Promise.race([once(this.proc.stdin, 'drain').then(() => null), this.exited]), this.proc, `ffmpeg ${this.label}`);
    if (r) throw this.failure(r);
  }
  async end() {
    this.proc.stdin.end();
    const r = await stallGuard(this.exited, this.proc, `ffmpeg ${this.label}`);
    if (r.code !== 0) throw this.failure(r);
  }
}

// The T8 path: BT.709 matrix, limited range, tags in the bitstream and the container (MP4/MOV colr atom,
// WebM Colour). pix is yuv420p, or the --alpha format of videoFormat().
function colorChain(cfg, pix) {
  const conv = `out_color_matrix=bt709:out_range=tv,format=${pix},${SETPARAMS}`;
  if (cfg.scale === 1) return `scale=${conv}`;
  if (!cfg.cli.alpha) return `scale=${cfg.outW}:${cfg.outH}:flags=lanczos+accurate_rnd+full_chroma_int:${conv}`;
  return `${alphaDownscale(cfg.outW, cfg.outH)},scale=${conv}`;
}
// Downscaling straight alpha blends the black of transparent pixels into edges (a dark fringe), so an
// --alpha capture is downscaled premultiplied, in 16 bits.
const alphaDownscale = (w, h) => `format=gbrap16le,premultiply=inplace=1,scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int,unpremultiply=inplace=1`;

// --alpha outputs by extension (references/overlay.md): ProRes 4444 for editors, VP9 with alpha for Chrome and Firefox.
// bitexact drops WebM's random segment UID, so identical frames give identical files, as with MP4.
const ALPHA_FORMATS = {
  '.mov': { pix: 'yuva444p10le', codec: ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0'], mux: ['-f', 'mov'] },
  '.webm': { pix: 'yuva420p', codec: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-auto-alt-ref', '0'], mux: ['-fflags', '+bitexact', '-f', 'webm'] },
};
// validate() leaves --alpha only .mov or .webm, so the lookup always hits.
function videoFormat(cfg) {
  if (!cfg.cli.alpha) return { pix: 'yuv420p', codec: x264(cfg), mux: ['-movflags', '+faststart', '-f', 'mp4'] };
  return ALPHA_FORMATS[path.extname(cfg.out).toLowerCase()];
}
const imageInput = (cfg) => ['-f', 'image2pipe', '-framerate', String(cfg.fps), '-c:v', cfg.cli.draft ? 'mjpeg' : 'png', '-i', '-'];
const x264 = (cfg) => (cfg.cli.draft
  ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high']
  : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high']);

// WebM stores no frame count, so countPackets reads every packet instead (nb_read_packets).
function probeVideo(file, countPackets) {
  const r = runSync(`ffprobe on ${file}`, 'ffprobe', ['-v', 'error', ...(countPackets ? ['-count_packets'] : []), '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames,nb_read_packets,color_range,color_space,color_transfer,color_primaries:stream_tags=alpha_mode',
    '-of', 'json', file], { encoding: 'utf8' }, PROBE_MS);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout).streams?.[0] ?? {};
}

// ---------------------------------------------------------------- frame loop
// Heartbeat (S2): a line every HEARTBEAT_MS on a timer, not per frame, so a stall shows as a repeating count, never
// silence. phase() names a step with no frame count; stop() it on every path.
function progressMeter(total, label) {
  const t0 = performance.now();
  let done = 0, phase = null;
  const timer = setInterval(() => {
    const sec = Math.round((performance.now() - t0) / 1000);
    log(phase ? `  ${phase}, ${sec} s` : `  ${label} ${done}/${total} frames, ${sec} s`);
  }, HEARTBEAT_MS);
  timer.unref();
  return {
    tick() { done++; },
    phase(p) { phase = p; },
    stop() { clearInterval(timer); },
    seconds: () => (performance.now() - t0) / 1000,
  };
}

async function captureRange(s, cfg, start, end, preroll, onFrame, meter) {
  const shot = { format: cfg.cli.draft ? 'jpeg' : 'png', scale: cfg.scale };
  for (let f = Math.max(0, start - preroll); f < end; f++) {
    await seekTo(s, cfg, f / cfg.fps);
    const buf = await capture(s, cfg, shot);
    if (f < start) continue;
    if (f === cfg.f0 && cfg.cli.alpha) warnIfOpaque(buf, f / cfg.fps);
    await onFrame(f, buf);
    meter?.tick();
  }
}

function splitRange(f0, f1, n) {
  const total = f1 - f0, out = [];
  for (let k = 0; k < n; k++) out.push({ start: f0 + Math.floor((total * k) / n), end: f0 + Math.floor((total * (k + 1)) / n) });
  return out.filter((c) => c.end > c.start);
}

// ---------------------------------------------------------------- modes
async function renderVideo(cfg, probe) {
  const total = cfg.f1 - cfg.f0;
  const workers = Math.max(1, Math.min(cfg.cli.workers ?? 1, total));
  const fmt = videoFormat(cfg);
  const part = `${cfg.out}.part`;
  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  live.partial.add(part);
  log(`render ${total} frames ${cfg.outW}x${cfg.outH} @${cfg.fps} fps${cfg.range ? ` (range ${fmtT(cfg.range[0])}-${fmtT(cfg.range[1])} s)` : ''}`
    + `${cfg.cli.draft ? ', draft' : ''}${cfg.scale > 1 ? `, supersampled x${cfg.scale}` : ''}${cfg.cli.alpha ? `, alpha ${fmt.pix}` : ''}, ${plural(workers, 'worker')} -> ${cfg.out}`);
  const meter = progressMeter(total, 'capture');
  try { await encodeVideo(cfg, probe, { total, workers, fmt, part, meter }); } finally { meter.stop(); }
  const p = probeVideo(part, fmt.mux.includes('webm'));
  const frames = Number(p.nb_frames ?? p.nb_read_packets);
  if (frames !== total) throw new Error(`encoded ${frames} frames, expected ${total}`);
  fs.renameSync(part, cfg.out);
  live.partial.delete(part);
  const sec = meter.seconds();
  // ffprobe names VP9-with-alpha yuv420p; the alpha_mode tag is what marks its alpha stream.
  log(`wrote ${cfg.out}: ${total} frames, ${p.width}x${p.height}, ${p.r_frame_rate} fps, ${p.codec_name} ${p.profile} ${p.pix_fmt}${p.tags?.alpha_mode ? ` alpha_mode=${p.tags.alpha_mode}` : ''}, `
    + `${p.color_space}/${p.color_transfer}/${p.color_primaries} ${p.color_range} (${sec.toFixed(1)} s, ${(total / sec).toFixed(1)} fps overall)`);
  if (cfg.blur) log(blurCost(cfg, sec));
}

// Capture and encode to part, serially or with workers; the meter's heartbeat names each step as it runs.
async function encodeVideo(cfg, probe, { total, workers, fmt, part, meter }) {
  if (workers === 1) {
    const sink = new FFmpegSink([...imageInput(cfg), '-vf', colorChain(cfg, fmt.pix), ...fmt.codec, ...fmt.mux, part], 'encode');
    await captureRange(probe, cfg, cfg.f0, cfg.f1, 0, (f, buf) => sink.write(blurred(cfg, f, buf)), meter);
    await probe.close();
    meter.phase(`encode: ${plural(total, 'frame')} captured, finishing the file`);
    await sink.end();
  } else {
    // Each worker writes a lossless segment (FFV1, output pixel format, alpha included) through the same
    // colour path; one final encode then sees exactly the frames a serial render would, so GOP and rate
    // control match too.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-mjs-'));
    live.tmp.add(tmp);
    const chunks = splitRange(cfg.f0, cfg.f1, workers);
    const segs = chunks.map((_, k) => path.join(tmp, `seg-${k}.mkv`));
    await Promise.all(chunks.map(async (c, k) => {
      const s = k === 0 ? probe : await openSessionReady(cfg, 'render');
      const sink = new FFmpegSink([...imageInput(cfg), '-vf', colorChain(cfg, fmt.pix), '-c:v', 'ffv1', '-level', '3', '-f', 'matroska', segs[k]], `segment ${k}`);
      await captureRange(s, cfg, c.start, c.end, k === 0 ? 0 : Math.round(PREROLL_SECONDS * cfg.fps), (f, buf) => sink.write(blurred(cfg, f, buf)), meter);
      await s.close();
      await sink.end();
    }));
    const capSec = meter.seconds();
    log(`  captured in ${capSec.toFixed(1)} s (${(total / capSec).toFixed(1)} fps); joining ${segs.length} segments into one encode`);
    const enc = new FFmpegSink(['-f', 'rawvideo', '-pix_fmt', fmt.pix, '-s', `${cfg.outW}x${cfg.outH}`, '-framerate', String(cfg.fps), '-i', '-',
      '-vf', SETPARAMS, ...fmt.codec, ...fmt.mux, part], 'final encode');
    for (const [k, seg] of segs.entries()) {
      meter.phase(`encode: joining segment ${k + 1} of ${segs.length}`);
      const dec = spawn('ffmpeg', ['-v', 'error', '-i', seg, '-f', 'rawvideo', '-pix_fmt', fmt.pix, '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
      live.procs.add(dec);
      let err = '';
      dec.stderr.on('data', (d) => { err += d; });
      const closed = once(dec, 'close');
      // The decoder's own stall watchdog runs only while it is awaited, never while the encoder is (enc.write).
      const step = `ffmpeg decode of ${path.basename(seg)}`;
      for (const chunks = dec.stdout[Symbol.asyncIterator](); ;) {
        const { value, done } = await stallGuard(chunks.next(), dec, step);
        if (done) break;
        await enc.write(value);
      }
      const [code] = await stallGuard(closed, dec, step);
      live.procs.delete(dec);
      if (code !== 0) throw new Error(`ffmpeg could not decode ${seg}: ${err.trim()}`);
    }
    meter.phase(`encode: ${plural(total, 'frame')} joined, finishing the file`);
    await enc.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    live.tmp.delete(tmp);
  }
}

// --check-determinism A-B (S7): the range rendered twice (the probe's browser, then a fresh one) through the full
// encode, frames compared by the framemd5 of their decoded pixels. Returns the exit code: 1 when any frame differs.
async function checkDeterminism(cfg, probe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-mjs-det-'));
  live.tmp.add(tmp);
  const sums = [];
  for (const k of [1, 2]) {
    log(`check-determinism: render ${k} of 2`);
    const out = path.join(tmp, `run-${k}${path.extname(cfg.out)}`);
    await renderVideo({ ...cfg, out }, k === 1 ? probe : await openSessionReady(cfg, 'render'));
    const r = runSync(`ffmpeg framemd5 of render ${k}`, 'ffmpeg', ['-v', 'error', '-i', out, '-map', '0:v:0', '-f', 'framemd5', '-'],
      { encoding: 'utf8', maxBuffer: 1 << 28 }, CONVERT_MS);
    if (r.status !== 0) throw new Error(`ffmpeg framemd5 failed on render ${k}: ${(r.stderr || '').trim()}`);
    sums.push(r.stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').at(-1).trim()));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  live.tmp.delete(tmp);
  const [a, b] = sums, n = Math.max(a.length, b.length), differ = [];
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) differ.push(cfg.f0 + i);
  const span = `${fmtT(cfg.f0 / cfg.fps)}-${fmtT(cfg.f1 / cfg.fps)} s`;
  const sizes = a.length === b.length ? `${a.length} frames` : `${a.length} and ${b.length} frames`;
  console.log(`check-determinism: ${span} rendered twice: ${sizes}, ${plural(differ.length, 'differing frame')}`
    + (differ.length ? `: ${differ.slice(0, 12).map((f) => `${f} (${fmtT(f / cfg.fps)} s)`).join(', ')}${differ.length > 12 ? ` +${differ.length - 12} more` : ''}` : ''));
  if (differ.length) console.log('check-determinism: the page does not draw the same twice: look for Math.random or Date.now without a seed, motion '
    + 'driven by timers or requestAnimationFrame instead of seek(t), and fonts or images that load late; a Chromium switch (--chrome-arg) can be the cause too');
  return differ.length ? 1 : 0;
}

async function renderFrames(cfg, probe) {
  const dir = path.resolve(cfg.cli['frames-dir']);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.readdirSync(dir).some((n) => /^frame-\d{6}\.(png|jpg)$/.test(n))) throw new UsageError(`${dir} already holds frame-*.png files: use an empty folder`);
  const total = cfg.f1 - cfg.f0;
  const workers = Math.max(1, Math.min(cfg.cli.workers ?? 1, total));
  const ext = cfg.cli.draft ? 'jpg' : 'png';
  log(`frames ${total} at ${cfg.outW}x${cfg.outH} -> ${dir}/frame-%06d.${ext} (${plural(workers, 'worker')})`);
  const meter = progressMeter(total, 'capture');
  try { await captureFrames(cfg, probe, { dir, workers, ext, meter }); } finally { meter.stop(); }
  const written = fs.readdirSync(dir).filter((n) => /^frame-\d{6}\.(png|jpg)$/.test(n)).length;
  if (written !== total) throw new Error(`wrote ${written} frames, expected ${total}`);
  const sec = meter.seconds();
  if (cfg.blur) log(blurCost(cfg, sec));
  // The encode writes --out, the name <out>.timeline.json pairs with; under --alpha its stem with either master.
  log(`wrote ${total} frames${cfg.cli.alpha ? ' (RGBA)' : ''} to ${dir} in ${sec.toFixed(1)} s. Encode them with:`);
  const input = `ffmpeg -framerate ${cfg.fps} -i "${path.join(dir, `frame-%06d.${ext}`)}"`;
  if (cfg.cli.alpha) {
    const stem = cfg.out.slice(0, cfg.out.length - path.extname(cfg.out).length);
    for (const [x, f] of Object.entries(ALPHA_FORMATS)) log(`  ${input} -vf "scale=out_color_matrix=bt709:out_range=tv,format=${f.pix},${SETPARAMS}" ${f.codec.join(' ')} "${stem}${x}"`);
  } else {
    log(`  ${input} -vf "${cfg.cli.draft ? `scale=${cfg.outW}:${cfg.outH}:` : 'scale='}out_color_matrix=bt709:out_range=tv,format=yuv420p,${SETPARAMS}" -c:v libx264 -preset slow -crf 18 -profile:v high -movflags +faststart "${cfg.out}"`);
  }
}

async function captureFrames(cfg, probe, { dir, workers, ext, meter }) {
  await Promise.all(splitRange(cfg.f0, cfg.f1, workers).map(async (c, k) => {
    const s = k === 0 ? probe : await openSessionReady(cfg, 'frames');
    let sink = null;
    if (cfg.scale > 1) {
      const down = cfg.cli.alpha ? `${alphaDownscale(cfg.outW, cfg.outH)},format=rgba` : `scale=${cfg.outW}:${cfg.outH}:flags=lanczos+accurate_rnd+full_chroma_int`;
      sink = new FFmpegSink([...imageInput(cfg), '-vf', down,
        '-start_number', String(c.start - cfg.f0), '-f', 'image2', path.join(dir, 'frame-%06d.png')], `frames ${k}`);
    }
    const write = (f, shot) => {
      const buf = blurred(cfg, f, shot);
      return sink ? sink.write(buf) : fsp.writeFile(path.join(dir, `frame-${String(f - cfg.f0).padStart(6, '0')}.${ext}`), cfg.cli.alpha ? toRGBA(buf) : buf);
    };
    await captureRange(s, cfg, c.start, c.end, k === 0 ? 0 : Math.round(PREROLL_SECONDS * cfg.fps), write, meter);
    await s.close();
    if (sink) await sink.end();
  }));
}

async function renderStills(cfg, s) {
  const dir = path.dirname(cfg.out);
  fs.mkdirSync(dir, { recursive: true });
  if (cfg.cli.draft) warn('--draft is ignored for stills: stills are always full-size PNG');
  const scale = cfg.cli.scale ?? 1, files = [];
  for (const t of cfg.cli.stillTimes) {
    let f = Math.round(t * cfg.fps);
    if (f >= cfg.N) { warn(`still at ${t} s is at or past the end; using the last frame (${fmtT((cfg.N - 1) / cfg.fps)} s)`); f = cfg.N - 1; }
    await seekTo(s, cfg, f / cfg.fps);
    let buf = await capture(s, cfg, { format: 'png', scale });
    if (cfg.cli.alpha && t === cfg.cli.stillTimes[0]) warnIfOpaque(buf, f / cfg.fps);
    if (scale !== 1) {
      const down = cfg.cli.alpha ? `${alphaDownscale(cfg.W, cfg.H)},format=rgba` : `scale=${cfg.W}:${cfg.H}:flags=lanczos+accurate_rnd+full_chroma_int`;
      const r = runSync('ffmpeg still downscale', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf',
        down, '-f', 'image2pipe', '-c:v', 'png', '-'], { input: buf, maxBuffer: 1 << 28 }, CONVERT_MS);
      if (r.status !== 0) throw new Error(`ffmpeg downscale failed: ${String(r.stderr).trim()}`);
      buf = r.stdout;
    } else if (cfg.cli.alpha) buf = toRGBA(buf);
    const file = path.join(dir, `still-${fmtT(t)}s.png`);
    fs.writeFileSync(file, buf);
    if (!files.includes(file)) files.push(file);
    log(`still ${fmtT(t)} s (frame ${f}, t=${(f / cfg.fps).toFixed(3)}) -> ${file}`);
  }
  await s.close();
  stillsSheet(cfg, files);
}

// Q1: full-size frames bloat a reviewer's context, so every --stills run also tiles its stills, in the order given
// (left to right, then down), into one sheet at most 1600 px wide; no tile is enlarged.
function stillsSheet(cfg, files) {
  const n = files.length, cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols), gap = 8;
  const tw = 2 * Math.floor(Math.min((1600 - gap * (cols - 1)) / cols, cfg.W) / 2), th = 2 * Math.round((tw * cfg.H) / cfg.W / 2);
  const sheet = path.join(path.dirname(files[0]), 'stills-sheet.png');
  const tiles = files.map((_, i) => `[${i}:v]scale=${tw}:${th}:flags=lanczos,format=rgba[t${i}]`).join(';');
  let r;
  try {
    r = runSync('ffmpeg stills sheet', 'ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex',
      `${tiles};${files.map((_, i) => `[t${i}]`).join('')}concat=n=${n}:v=1:a=0,tile=${cols}x${rows}:padding=${gap}:color=gray`, '-frames:v', '1', sheet], { encoding: 'utf8' }, CONVERT_MS);
  } catch (e) { warn(`stills sheet not written: ${e.message}`); return; }
  if (r.status !== 0) { warn(`stills sheet not written: ${(r.stderr || '').trim().split('\n').slice(-2).join(' | ')}`); return; }
  log(`stills sheet ${cols * tw + gap * (cols - 1)}x${rows * th + gap * (rows - 1)} (${n === 1 ? 'one still' : `${n} stills, ${cols} across, in the order given`}) -> ${sheet}`);
}

// Runs inside the page: text findings for the frame on screen (S5). Texture and aria-hidden copies get only the glyph
// and font checks; read text is judged for size and contrast once settled (the same size and opacity in prev, from
// pageSizes). Returns each flow block's text for runLint's name and demand checks, texture areas, contrast candidates.
function pageLint({ W, H, hold, social, floors, prev, guards, settle, overlap }) {
  const kit = window.__c2vKit, out = [], families = new Set(), glyphs = [];
  // Text nodes whose rendered fonts runLint reads over DevTools: for glyph-fallback when their text changes, and for
  // system-face once per element, on the first sampled frame that shows it at display size.
  const reg = (window.__lintNodes ??= { list: [], seen: new WeakMap(), faced: new WeakSet() });
  const declared = new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '')));
  const u = Math.min(W, H) / 100, desc = kit.desc;
  // Text not drawn on this frame is listed as hidden, never measured (SVG text under display: none still has rects).
  // A display: contents element has no box of its own: its nearest ancestor with one stands in.
  const hidden = [];
  const unrendered = (el, cs, box) => {
    let b = el;
    while (b.parentElement && getComputedStyle(b).display === 'contents') b = b.parentElement;
    if (!b.getClientRects().length) {
      for (let a = b; a; a = a.parentElement) if (getComputedStyle(a).display === 'none') return 'display:none';
      return 'no box';
    }
    if (b.checkVisibility && !b.checkVisibility()) return 'not rendered';
    if (cs.visibility !== 'visible') return `visibility:${cs.visibility}`;
    return box.nodes.length ? '' : 'zero size';
  };
  // A flow block (kit.block): inline and inline-block runs inside one paragraph share it. Its words never overlap each
  // other, and its text is read as one line of copy.
  const roots = new Map(), flowRoot = (el) => roots.get(el) ?? roots.set(el, kit.block(el)).get(el);
  // The same names pageSizes gave the frame before (kit.key), so text rebuilt on every seek is still compared.
  const memo = { keys: new Map(), at: new Map() };
  const texts = new Map(), order = [], runs = new Map(), range = document.createRange(); // runs: each drawn node's first and last client rect
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    { acceptNode: (n) => (n.nodeType === Node.TEXT_NODE || n.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType !== Node.TEXT_NODE) { order.push([n, true]); continue; } // a <br>: "queues<br>keep" is two words
    const el = n.parentElement;
    if (!el || !kit.kind(el)) continue;
    if (!/\S/.test(n.data)) { order.push([n, true]); continue; } // a word break between inline elements
    let e = texts.get(el);
    if (!e) texts.set(el, (e = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity, text: '', nodes: [], all: '', rects: [] }));
    e.all += n.data;
    range.selectNodeContents(n);
    const rs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rs.length) continue;
    for (const r of rs) { e.l = Math.min(e.l, r.left); e.t = Math.min(e.t, r.top); e.r = Math.max(e.r, r.right); e.b = Math.max(e.b, r.bottom); e.rects.push(r); }
    e.text += n.data;
    e.nodes.push(n);
    runs.set(n, [rs[0], rs.at(-1)]);
    order.push([n, false]);
  }
  const px = (v) => `${Math.round(v)} px`, CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const clear = (c) => c === 'transparent' || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?%?\)$/.test(c);
  const rgba = (v) => {
    const m = /^rgba?\(([^)]*)\)$/.exec(v ?? ''), p = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [];
    return p.length >= 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] : null;
  };
  // The part of a box left visible by the frame and every ancestor that clips overflow.
  const visibleArea = (el, b) => {
    let l = Math.max(0, b.l), t = Math.max(0, b.t), r = Math.min(W, b.r), bt = Math.min(H, b.b);
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const q = a.getBoundingClientRect();
      if (s.overflowX !== 'visible') { l = Math.max(l, q.left); r = Math.min(r, q.right); }
      if (s.overflowY !== 'visible') { t = Math.max(t, q.top); bt = Math.min(bt, q.bottom); }
    }
    return Math.max(0, r - l) * Math.max(0, bt - t);
  };
  const shown = (s, tt) => (tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase()
    : tt === 'capitalize' ? s.replace(/(^|[^\p{L}\p{N}'\u2019])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()) : s);
  // Where the glyphs reach (canvas measureText), not the box: tight display type's ascent and descent overrun a snug
  // tile its letters fit. A line not at the text's own scale (vertical, rotated, a fallback face) keeps its whole box.
  const meter = (window.__c2vMeter ??= document.createElement('canvas').getContext('2d'));
  const glyphBox = (cs, s, box, scale) => {
    meter.font = '10px c2v-unset'; // a font canvas cannot parse leaves this, not the last text's font
    meter.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (meter.font.includes('c2v-unset')) return box;
    const m = meter.measureText(s), fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent, g = { l: box.l, r: box.r, t: Infinity, b: -Infinity };
    if (!(fa + fd > 0) || !(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 0)) return box;
    for (const r of box.rects) {
      const k = r.height / (fa + fd), base = r.top + fa * k, line = Math.abs(k - scale) <= 0.05 * scale;
      g.t = Math.min(g.t, line ? base - m.actualBoundingBoxAscent * k : r.top);
      g.b = Math.max(g.b, line ? base + m.actualBoundingBoxDescent * k : r.bottom);
    }
    return g;
  };
  // Read text whose size, opacity or place in its flow block changed since the frame before (a word mid-pop or sliding in):
  // the widow check waits until it holds still.
  const restless = new Set();
  const drawn = new Map(), reads = [], textures = [], contrast = [];
  for (const [el, box] of texts) {
    const kind = kit.kind(el), cs = getComputedStyle(el), why = unrendered(el, cs, box);
    if (why) { hidden.push({ el: desc(el), text: box.all.replace(/\s+/g, ' ').trim().slice(0, 40), why }); continue; }
    const opacity = kit.opacity(el);
    if (opacity < 0.2) continue; // fading or hidden at this instant: judged when it is visible
    if (box.r <= 0 || box.b <= 0 || box.l >= W || box.t >= H) continue; // entirely off-frame
    drawn.set(el, kind);
    const text = box.text.replace(/\s+/g, ' ').trim().slice(0, 40), id = desc(el);
    families.add(cs.fontFamily);
    const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const eff = kit.size(el, cs);
    // Display size: at least C1's headline size (6u). Its face carries the look, so a system face there is a draft.
    let face = eff >= 6 * u - 0.5 && !reg.faced.has(el);
    if (face) reg.faced.add(el);
    for (const n of box.nodes) {
      const changed = reg.seen.get(n) !== n.data;
      if (!changed && !face) continue;
      reg.seen.set(n, n.data);
      const odd = [...new Set(n.data.replace(/[\x00-\x7f]/g, '').replace(/\s/g, ''))].slice(0, 8).join(' ');
      glyphs.push({ i: reg.list.push(n) - 1, el: id, text: n.data.replace(/\s+/g, ' ').trim().slice(0, 40), first, declared: declared.has(first), odd,
        glyph: changed, size: face ? +eff.toFixed(1) : 0, sizeU: +(eff / u).toFixed(1) });
      face = false;
    }
    try {
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if (!document.fonts.check(font, box.text.slice(0, 64))) out.push({ check: 'font-not-loaded', severity: 'error', el: id, text, detail: `${font} is not loaded at this time` });
    } catch {}
    if (kind === 'texture') {
      const off = el.closest('[data-lint="off"]');
      if (off) out.push({ check: 'lint-off', severity: 'note', el: desc(off), text: off.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
        detail: 'data-lint="off" counts as texture: only the glyph and font checks run; mark it data-lint="texture"' });
      textures.push({ el: id, area: visibleArea(el, box) });
    }
    if (kind !== 'read') continue;
    const p = prev?.[kit.key(el, memo)], settled = prev === null || (!!p && Math.abs(p[0] - eff) <= settle * eff && Math.abs(p[1] - opacity) <= settle);
    if (prev !== null && settled) {
      const at = el.getBoundingClientRect(), blk = flowRoot(el).getBoundingClientRect(), tol = Math.max(0.5, settle * eff);
      if (Math.abs(at.left - blk.left - p[2]) > tol || Math.abs(at.top - blk.top - p[3]) > tol) restless.add(el);
    } else if (!settled) restless.add(el);
    if (settled) { // the read floors of registers.json; Chinese, Japanese or Korean text under its floor is an error
      const cjk = CJK.test(box.text), floor = cjk ? Math.max(floors.read, floors.cjk) : floors.read;
      if (eff < floor - 0.5) out.push({ check: 'small-text', severity: cjk ? 'error' : 'warn', el: id, text, value: +eff.toFixed(1),
        detail: `${eff.toFixed(1)} px, below the ${cjk ? 'CJK' : 'read'} floor of ${px(floor)} (text.floor_px_1080p.${cjk ? 'cjk' : 'read'} in scripts/registers.json, at this frame's size)` });
    }
    // The edge checks below measure where the glyphs reach (g), not the font's ascent and descent.
    const g = glyphBox(cs, shown(box.text, cs.textTransform), box, eff / parseFloat(cs.fontSize)), edges = [];
    if (g.l < 0.05 * W - 0.5) edges.push(`left ${px(0.05 * W - g.l)}`);
    if (g.r > 0.95 * W + 0.5) edges.push(`right ${px(g.r - 0.95 * W)}`);
    if (g.t < 0.05 * H - 0.5) edges.push(`top ${px(0.05 * H - g.t)}`);
    if (g.b > 0.95 * H + 0.5) edges.push(`bottom ${px(g.b - 0.95 * H)}`);
    if (edges.length) out.push({ check: 'outside-title-safe', severity: 'warn', el: id, text, detail: `past the 90% title-safe box: ${edges.join(', ')}` });
    if (social) { // 9:16: the cross-app clear box (references/delivery.md), passed in scaled to this frame
      const z = [];
      if (g.t < social.t - 0.5) z.push(`top ${px(social.t - g.t)}`);
      if (g.b > social.b + 0.5) z.push(`bottom ${px(g.b - social.b)}`);
      if (g.l < social.l - 0.5) z.push(`left ${px(social.l - g.l)}`);
      if (g.r > social.r + 0.5) z.push(`right ${px(g.r - social.r)}`);
      if (z.length) out.push({ check: 'social-ui-zone', severity: 'warn', el: id, text, detail: `past the 9:16 cross-app box, under app UI: ${z.join(', ')}` });
    }
    const cut = [];
    if (g.l < -0.5) cut.push(`left ${px(-g.l)}`);
    if (g.r > W + 0.5) cut.push(`right ${px(g.r - W)}`);
    if (g.t < -0.5) cut.push(`top ${px(-g.t)}`);
    if (g.b > H + 0.5) cut.push(`bottom ${px(g.b - H)}`);
    if (cut.length) out.push({ check: 'cut-by-frame', severity: hold ? 'error' : 'warn', el: id, text, detail: `text runs off the frame: ${cut.join(', ')}` });
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const cx = s.overflowX !== 'visible', cy = s.overflowY !== 'visible';
      if (!cx && !cy) continue;
      const ar = a.getBoundingClientRect();
      let clip = { l: ar.left, t: ar.top, r: ar.right, b: ar.bottom };
      if (a instanceof HTMLElement && a.offsetWidth > 0 && a.offsetHeight > 0) {
        const sx = ar.width / a.offsetWidth, sy = ar.height / a.offsetHeight; // clipping happens at the padding box
        clip = { l: ar.left + a.clientLeft * sx, t: ar.top + a.clientTop * sy, r: ar.left + (a.clientLeft + a.clientWidth) * sx, b: ar.top + (a.clientTop + a.clientHeight) * sy };
      }
      if (clip.l <= 0.5 && clip.t <= 0.5 && clip.r >= W - 0.5 && clip.b >= H - 0.5) continue; // frame-sized: cut-by-frame covers it
      if (g.r <= clip.l || g.l >= clip.r || g.b <= clip.t || g.t >= clip.b) break; // fully hidden by the clip (e.g. before a mask reveal)
      const over = [];
      if (cx && g.l < clip.l - 1) over.push(`left ${px(clip.l - g.l)}`);
      if (cx && g.r > clip.r + 1) over.push(`right ${px(g.r - clip.r)}`);
      if (cy && g.t < clip.t - 1) over.push(`top ${px(clip.t - g.t)}`);
      if (cy && g.b > clip.b + 1) over.push(`bottom ${px(g.b - clip.b)}`);
      if (over.length) out.push({ check: 'clipped', severity: hold ? 'error' : 'warn', el: id, text, detail: `cut by overflow:${s.overflowX === s.overflowY ? s.overflowX : s.overflowX + '/' + s.overflowY} on ${desc(a)}: ${over.join(', ')}` });
      break; // report the innermost clipping box only
    }
    // text-overflow: past the border box of its nearest ancestor-or-self with a background or border (a pill, a card).
    // Not the page, a frame-sized stage, or a box that clips its overflow (clipped covers that).
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const deco = !clear(s.backgroundColor) || s.backgroundImage !== 'none'
        || ['Top', 'Right', 'Bottom', 'Left'].some((d) => parseFloat(s[`border${d}Width`]) > 0 && s[`border${d}Style`] !== 'none');
      if (!deco) continue;
      const ar = a.getBoundingClientRect();
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || (ar.width >= W - 1 && ar.height >= H - 1)) break;
      const over = [];
      if (g.l < ar.left - 1) over.push(`left ${px(ar.left - g.l)}`);
      if (g.r > ar.right + 1) over.push(`right ${px(g.r - ar.right)}`);
      if (g.t < ar.top - 1) over.push(`top ${px(ar.top - g.t)}`);
      if (g.b > ar.bottom + 1) over.push(`bottom ${px(g.b - ar.bottom)}`);
      if (over.length) out.push({ check: 'text-overflow', severity: 'warn', el: id, text, detail: `runs past ${a === el ? 'its own' : `the ${desc(a)}`} box (background or border): ${over.join(', ')}` });
      break;
    }
    if (settled && cs.backgroundClip !== 'text' && cs.webkitBackgroundClip !== 'text') { // gradient text has no one colour
      const svg = el instanceof SVGElement, c = rgba(svg ? cs.fill : cs.webkitTextFillColor || cs.color);
      const a = c && c[3] * opacity * (svg ? parseFloat(cs.fillOpacity) : 1);
      if (a > 0) contrast.push({ el: id, text, rgb: c.slice(0, 3), a, size: eff, box: [Math.max(0, box.l), Math.max(0, box.t), Math.min(W, box.r), Math.min(H, box.b)] });
    }
    if (opacity >= 0.5) { // glyph bands: the middle 80% of the font size on each line of text
      const bands = box.rects.map((r) => [r.left, (r.top + r.bottom) / 2 - 0.4 * eff, r.right, (r.top + r.bottom) / 2 + 0.4 * eff]);
      reads.push({ el, id, text, flow: flowRoot(el), bands, area: bands.reduce((s, q) => s + (q[2] - q[0]) * (q[3] - q[1]), 0),
        l: Math.min(...bands.map((q) => q[0])), r: Math.max(...bands.map((q) => q[2])), t: Math.min(...bands.map((q) => q[1])), b: Math.max(...bands.map((q) => q[3])) });
    }
  }
  // text-overlap: read texts from different flows whose glyph bands intersect by over `overlap` of the smaller. Sorted by
  // left edge, each text meets only those starting before its right edge: O(n log n) plus the pairs that touch.
  reads.sort((a, b) => a.l - b.l);
  for (let i = 0; i < reads.length; i++) {
    for (let j = i + 1; j < reads.length && reads[j].l < reads[i].r; j++) {
      const [A, B] = [reads[i], reads[j]].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      if (A.flow === B.flow || A.el.contains(B.el) || B.el.contains(A.el) || A.t >= B.b || B.t >= A.b) continue;
      let both = 0;
      for (const p of A.bands) for (const q of B.bands) {
        const w = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), h = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
        if (w > 0 && h > 0) both += w * h;
      }
      const share = both / Math.min(A.area, B.area);
      if (share > overlap) out.push({ check: 'text-overlap', severity: 'warn', el: `${A.id} + ${B.id}`, text: `${A.text} / ${B.text}`.slice(0, 40),
        detail: `the glyphs of ${A.id} "${A.text}" and ${B.id} "${B.text}" overlap by ${Math.round(100 * share)}% of the smaller` });
    }
  }
  // Flow blocks in document order: their text after text-transform, and the widow check for space-separated scripts.
  // kit.apart also breaks words, unless a run is still moving into place (a letter mid-pop leaves a gap that closes).
  const blocks = new Map(), tail = new Map(); // tail: each block's last run since its last word break
  for (const [n, gap] of order) {
    const el = n.parentElement, kind = drawn.get(el);
    if (!gap && !kind) continue;
    const root = flowRoot(el);
    let b = blocks.get(root);
    if (!b) { if (gap) continue; blocks.set(root, (b = { read: '', readRaw: '', texture: '', textureRaw: '', parts: [] })); }
    const space = () => { b.read += ' '; b.readRaw += ' '; b.texture += ' '; b.textureRaw += ' '; b.parts.push([null, ' ']); };
    if (gap || kind === 'copy') { space(); tail.delete(root); continue; }
    const [first, last] = runs.get(n), prev = tail.get(root);
    if (prev && !restless.has(el) && !restless.has(prev.el) && kit.apart(prev.rect, first)) space();
    tail.set(root, { el, rect: last });
    const tt = getComputedStyle(el).textTransform;
    if (kind === 'read') { b.read += shown(n.data, tt); b.readRaw += n.data; b.parts.push([n, n.data]); }
    else { b.texture += shown(n.data, tt); b.textureRaw += n.data; }
  }
  const KANA_HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, flat = (s) => s.replace(/\s+/g, ' ').trim();
  for (const [root, b] of blocks) {
    const raw = b.parts.map((x) => x[1]).join('');
    if (!/\S/.test(raw) || KANA_HAN.test(raw) || b.parts.some(([n]) => n && restless.has(n.parentElement))) continue;
    const words = [];
    let k = 0, base = 0;
    const at = (i) => { while (base + b.parts[k][1].length <= i) base += b.parts[k++][1].length; return [b.parts[k][0], i - base]; };
    for (const m of raw.matchAll(/\S+/g)) {
      const [sn, so] = at(m.index), [en, eo] = at(m.index + m[0].length - 1);
      range.setStart(sn, so);
      range.setEnd(en, eo + 1);
      const r = range.getBoundingClientRect();
      if (r.width > 0.5 && r.height > 0.5) words.push(r);
    }
    let lines = 0, last = 0, top = -Infinity;
    for (const r of words) { if (r.top >= top + r.height / 2) { lines++; last = 0; top = r.top; } last++; }
    if (lines >= 2 && last === 1) out.push({ check: 'widow', severity: 'warn', el: desc(root), text: flat(raw).slice(0, 40),
      detail: `the last of its ${lines} lines is one word: rewrap it (width, a line break, or a word moved down)` });
  }
  // The card's guards: line art drawn thinner than guards.min_stroke_px; raster art at a scale that is not a whole number.
  const shownEl = (el) => { // a straight line's box has no height or no width
    const r = el.getBoundingClientRect();
    return (r.width > 0 || r.height > 0) && r.right >= 0 && r.bottom >= 0 && r.left <= W && r.top <= H && getComputedStyle(el).visibility === 'visible' && kit.opacity(el) >= 0.2;
  };
  if (guards?.min_stroke_px > 0) {
    for (const el of document.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')) {
      if (el.closest('defs,mask,clipPath,pattern,symbol,marker,[data-lint="off"]')) continue;
      const s = getComputedStyle(el), w0 = parseFloat(s.strokeWidth);
      if (s.stroke === 'none' || !(w0 > 0) || parseFloat(s.strokeOpacity) === 0 || !shownEl(el)) continue;
      const m = el.getScreenCTM(), w = w0 * (s.vectorEffect === 'non-scaling-stroke' || !m ? 1 : Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)));
      if (w < guards.min_stroke_px - 0.05) out.push({ check: 'stroke', severity: 'warn', el: desc(el), text: '', value: +w.toFixed(2),
        detail: `stroke ${w.toFixed(1)} px on screen, under the card's ${guards.min_stroke_px} px (guards.min_stroke_px)` });
    }
  }
  if (guards?.integer_scale) {
    for (const el of document.querySelectorAll('img,canvas,video')) {
      const [nw, nh] = el instanceof HTMLCanvasElement ? [el.width, el.height] : el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];
      if (!(nw > 0 && nh > 0) || !shownEl(el)) continue;
      const r = el.getBoundingClientRect(), sx = r.width / nw, sy = r.height / nh, whole = (v) => v >= 1 - 0.01 && Math.abs(v - Math.round(v)) <= 0.01;
      if (!whole(sx) || !whole(sy)) out.push({ check: 'integer-scale', severity: 'warn', el: desc(el), text: '', value: +sx.toFixed(2),
        detail: `its ${nw}x${nh} pixels drawn at ${sx.toFixed(2)}x${Math.abs(sx - sy) > 0.01 ? ` by ${sy.toFixed(2)}x` : ''}, not a whole multiple (guards.integer_scale)` });
    }
  }
  // The starter's placeholder box on screen (S5 tripwire; the colours are checked once, in runLint).
  for (const el of document.querySelectorAll('[data-placeholder]')) {
    if (shownEl(el)) out.push({ check: 'placeholder', severity: 'error', el: desc(el), text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
      detail: "the starter's placeholder box is on screen: replace it with the film" });
  }
  return { findings: out, families: [...families], glyphs, hidden, textures, contrast,
    blocks: [...blocks].map(([root, b]) => ({ el: desc(root), read: flat(b.read), readRaw: flat(b.readRaw), texture: flat(b.texture), textureRaw: flat(b.textureRaw) }))
      .filter((b) => b.read || b.texture) };
}

// Runs inside the page: each read text's size, opacity and place in its flow block, by kit.key, so pageLint can tell
// settled text from text mid-pop, mid-fade or sliding in.
function pageSizes() {
  const kit = window.__c2vKit, out = {}, seen = new Set(), memo = { keys: new Map(), at: new Map() };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !/\S/.test(n.data) || kit.kind(el) !== 'read') continue;
    seen.add(el);
    const at = el.getBoundingClientRect(), blk = kit.block(el).getBoundingClientRect();
    out[kit.key(el, memo)] = [kit.size(el), kit.opacity(el), at.left - blk.left, at.top - blk.top];
  }
  return out;
}

// The fonts that drew a text node (DevTools CSS.getPlatformFontsForNode). glyph-fallback: a glyph the face lacks comes
// from a system face that varies by machine. system-face: display-size text no loaded @font-face draws.
async function textFonts(s, g) {
  const { result } = await s.cdp.send('Runtime.evaluate', { expression: `window.__lintNodes.list[${g.i}]` });
  const { nodeId } = await s.cdp.send('DOM.requestNode', { objectId: result.objectId });
  const { fonts } = await s.cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  const out = [];
  if (g.glyph && (g.declared ? fonts.some((f) => !f.isCustomFont) : fonts.length >= 2)) {
    const by = fonts.map((f) => `${f.familyName}${f.isCustomFont ? '' : ' (system)'} ${plural(f.glyphCount, 'glyph')}`).join(', ');
    out.push({ check: 'glyph-fallback', severity: 'warn', el: g.el, text: g.text, detail: `${g.first} text drawn by ${by}${g.odd ? ` (non-ASCII: ${g.odd})` : ''}: `
      + 'a glyph the face lacks comes from a system fallback that varies by machine; use a face that has it or draw it as SVG' });
  }
  if (g.size && fonts.length && !fonts.some((f) => f.isCustomFont)) {
    out.push({ check: 'system-face', severity: 'warn', el: g.el, text: g.text, face: fonts.map((f) => `"${f.familyName}"`).join(', '), size: g.size, sizeU: g.sizeU });
  }
  return out;
}

// Runs inside the page: is the first family of each font-family list actually available?
function pageFamilies(lists) {
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont)$/i;
  const ctx = document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmmmlli1WQ@#&gR';
  const has = (fam) => ['monospace', 'serif', 'sans-serif'].some((base) => {
    ctx.font = `72px ${base}`; const w0 = ctx.measureText(sample).width;
    ctx.font = `72px "${fam}", ${base}`; return ctx.measureText(sample).width !== w0;
  });
  const declared = new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '')));
  const out = [];
  for (const list of lists) {
    const fams = list.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (!fams.length || generic.test(fams[0]) || declared.has(fams[0]) || has(fams[0])) continue;
    const used = fams.slice(1).find((f) => generic.test(f) || has(f)) || 'the browser default';
    out.push({ check: 'font-fallback', severity: 'warn', el: 'font-family', text: fams[0], detail: `"${fams[0]}" is neither declared nor installed: text renders in ${used}` });
  }
  return out;
}

// Contrast (S5): each settled read text's colour against the per-channel median of the frame under its box, captured
// with every glyph transparent: one capture and decode per sampled frame. A failed decode costs only that frame's
// check; after a second timeout no later frame calls ffmpeg for contrast (an ffmpeg that hung twice hangs again).
const NO_TEXT_CSS = '*, *::before, *::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; '
  + 'text-shadow: none !important; text-decoration-color: transparent !important; } ::marker { color: transparent !important; } '
  + 'text, tspan, textPath { fill: transparent !important; stroke: transparent !important; }';
async function contrastFindings(s, cfg, cands, t, decode) {
  if (decode.off) { decode.unchecked.push(+t.toFixed(3)); return []; }
  await s.page.evaluate((css) => { const st = document.createElement('style'); st.id = '__c2v_notext'; st.textContent = css; document.head.append(st); }, NO_TEXT_CSS);
  let png;
  try { png = await capture(s, cfg); } finally { await s.page.evaluate(() => document.getElementById('__c2v_notext')?.remove()); }
  const { W, H } = cfg;
  let r = null;
  for (let attempt = 1; !r; attempt++) {
    try {
      r = runSync('ffmpeg contrast decode', 'ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { input: png, maxBuffer: 1 << 28 }, CONVERT_MS);
    } catch (e) {
      if (attempt === 1) { log(`contrast: the frame at ${fmtT(t)} s: ${e.message}; trying once more`); continue; }
      decode.off = true;
      decode.unchecked.push(+t.toFixed(3));
      warn(`contrast: the frame at ${fmtT(t)} s could not be decoded (${e.message}, on both tries): contrast is unchecked on it, and later frames skip the decode`);
      return [];
    }
  }
  if (r.status !== 0 || r.stdout.length !== W * H * 3) {
    decode.unchecked.push(+t.toFixed(3));
    warn(`contrast: the frame at ${fmtT(t)} s could not be decoded (${String(r.stderr).trim().split('\n').at(-1) || 'wrong size'}): contrast is unchecked on it`);
    return [];
  }
  const card = cfg.look?.guards?.read_contrast_min, min = card > 0 ? card : LINT.contrast, out = [];
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
  const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  for (const c of cands) {
    const x0 = Math.max(0, Math.floor(c.box[0])), y0 = Math.max(0, Math.floor(c.box[1])), x1 = Math.min(W, Math.ceil(c.box[2])), y1 = Math.min(H, Math.ceil(c.box[3]));
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let y = y0; y < y1; y++) for (let x = x0, i = (y * W + x0) * 3; x < x1; x++, i += 3) { hist[0][r.stdout[i]]++; hist[1][r.stdout[i + 1]]++; hist[2][r.stdout[i + 2]]++; }
    const n = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (!n) continue;
    const bg = hist.map((h) => { let k = 0; for (let acc = h[0]; acc < n / 2; acc += h[++k]); return k; });
    const fg = c.rgb.map((v, i) => c.a * v + (1 - c.a) * bg[i]), L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = c.size >= LINT.large.share * Math.min(W, H), need = large ? Math.min(min, LINT.large.contrast) : min;
    if (ratio < need) out.push({ check: 'contrast', severity: 'warn', el: c.el, text: c.text, value: +ratio.toFixed(2),
      detail: `${ratio.toFixed(2)}:1 against the median background ${hex(bg)} under it, below ${need}:1 (${large
        ? `text from ${Math.round(100 * LINT.large.share)}% of the short side` : card > 0 ? "the card's guards.read_contrast_min" : 'read text'})` });
  }
  return out;
}

async function runLint(cfg, s, readinessFindings) {
  const fps = cfg.fps, last = cfg.N - 1;
  const samples = new Map();
  const add = (t, why) => {
    const f = Math.min(last, Math.max(0, Math.round(t * fps)));
    if (!samples.has(f)) samples.set(f, []);
    samples.get(f).push(why);
  };
  for (let sec = 0; sec * fps <= last; sec++) add(sec, 'second');
  const tl = cfg.timeline;
  const scenes = (Array.isArray(tl.scenes) ? tl.scenes : []).filter((sc) => Number.isFinite(sc?.start) && Number.isFinite(sc?.end));
  for (const sc of scenes) {
    add((sc.start + sc.end) / 2, `scene ${sc.id ?? '?'} middle`);
    add(sc.end - 1 / fps, `scene ${sc.id ?? '?'} end`);
  }
  const holds = (Array.isArray(tl.holds) ? tl.holds : []).filter((h) => Number.isFinite(h?.start) && Number.isFinite(h?.end));
  for (const h of holds) add(h.start, `hold start${h.purpose ? ` (${h.purpose})` : ''}`);
  // S5: every 0.25 s from 0.5 s before to 0.5 s after each scene boundary and planned event, where collisions and pops sit.
  const around = (t0, why) => {
    for (let k = -2; k <= 2; k++) if (t0 + 0.25 * k >= 0 && t0 + 0.25 * k <= cfg.duration) add(t0 + 0.25 * k, k ? `${why} ${k > 0 ? '+' : ''}${0.25 * k} s` : why);
  };
  for (const b of new Set(scenes.flatMap((sc) => [sc.start, sc.end]))) around(b, `scene boundary ${fmtT(b)} s`);
  for (const ev of Array.isArray(tl.events) ? tl.events : []) if (Number.isFinite(ev?.t)) around(ev.t, `event ${ev.label ?? ev.kind ?? fmtT(ev.t)}`);
  const frames = [...samples.keys()].filter((f) => f >= cfg.f0 && f < cfg.f1).sort((a, b) => a - b); // --range limits the samples
  const { W, H } = cfg, k = { x: W / SOCIAL_916.w, y: H / SOCIAL_916.h };
  const social = H / W >= 1.7 ? { l: SOCIAL_916.x[0] * k.x, r: SOCIAL_916.x[1] * k.x, t: SOCIAL_916.y[0] * k.y, b: SOCIAL_916.y[1] * k.y } : null;
  const boxes = { title_safe: { x: [0.05 * W, 0.95 * W], y: [0.05 * H, 0.95 * H] }, social: social && { x: [social.l, social.r], y: [social.t, social.b] } };
  for (const b of Object.values(boxes)) if (b) for (const a of ['x', 'y']) b[a] = b[a].map(Math.round);
  const span = (b) => `x ${b.x.join('-')}, y ${b.y.join('-')}`;
  log(`lint: title-safe 90% box: ${span(boxes.title_safe)}; social-ui-zone: ${social
    ? `cross-app 9:16 box (references/delivery.md): ${span(boxes.social)} (clear 14% top, 35% bottom, 6% left, 17% right)` : 'off (frame is not 9:16)'}`);
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.replace(/\s+/g, ' ').trim()) : []);
  const names = strings(tl.names), demands = strings(tl.text), floors = floorsFor(W, H), guards = cfg.look?.guards ?? null;
  // A name with cased letters is matched case-insensitively as a whole word; a name in Han, kana or Hangul as written.
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = names.map((nm) => [nm, /\p{Lu}|\p{Ll}/u.test(nm) ? new RegExp(`(?<![\\p{L}\\p{N}])${esc(nm)}(?![\\p{L}\\p{N}])`, 'giu') : null]);
  const seen = new Map(), tex = { frames: 0, max: 0, at: 0, els: [] };
  const agg = new Map(), familyLists = new Set(), hid = new Map(), decode = { off: false, unchecked: [] };
  // Chinese and Japanese put no spaces between words, so a space between two of their characters (a <br>, a box edge, a
  // gap between glyph spans, or one typed in the timeline) is left out when names and demands are matched.
  const CJK_CH = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef';
  const CJK_SPACE = new RegExp(`(?<=[${CJK_CH}]) (?=[${CJK_CH}])`, 'gu'), CJK_END = new RegExp(`[${CJK_CH}]$`, 'u'), CJK_START = new RegExp(`^[${CJK_CH}]`, 'u');
  const tight = (x) => x.replace(CJK_SPACE, ''), wanted = demands.map((d) => [d, tight(d)]);
  // The blocks a demanded line runs through when the frame sets it across boxes (flex items, lines set as blocks): the
  // frame's flow blocks in document order with a space between two, as a viewer reads them; null when it is not there.
  const across = (blocks, kind, d) => {
    for (const k of [kind, `${kind}Raw`]) {
      let all = '';
      const at = blocks.filter((b) => b[k]).map((b) => {
        if (all && !(CJK_END.test(all) && CJK_START.test(b[k]))) all += ' ';
        const start = all.length;
        all += b[k];
        return [start, all.length, b.el];
      });
      const i = all.indexOf(d);
      if (i >= 0) return at.filter(([a, z]) => a < i + d.length && z > i).map((x) => x[2]).join(' + ');
    }
    return null;
  };
  await s.cdp.send('DOM.enable');
  await s.cdp.send('CSS.enable');
  await s.cdp.send('DOM.getDocument', { depth: -1 }); // DOM.requestNode needs the document pushed first
  for (const f of frames) {
    const t = f / fps;
    const hold = holds.some((h) => t >= h.start - 0.5 / fps && t < h.end - 0.5 / fps);
    // Sizes and opacities on a neighbouring frame first: read text still popping or fading in is not judged on this one.
    const nb = f > 0 ? f - 1 : f + 1;
    let prev = null;
    if (nb <= last) { await seekTo(s, cfg, nb / fps); prev = await s.page.evaluate(pageSizes); }
    await seekTo(s, cfg, t);
    const r = await s.page.evaluate(pageLint, { W, H, hold, social, floors, prev, guards, settle: LINT.settle, overlap: LINT.overlap });
    if (r.contrast.length) r.findings.push(...await contrastFindings(s, cfg, r.contrast, t, decode));
    r.families.forEach((x) => familyLists.add(x));
    for (const x of r.hidden) { // listed apart: text not drawn on this frame is not checked on it
      const a = hid.get(`${x.el}|${x.text}`) ?? { el: x.el, text: x.text, why: x.why, times: [] };
      if (!a.why.split(', ').includes(x.why)) a.why += `, ${x.why}`;
      if (!a.times.includes(+t.toFixed(3))) a.times.push(+t.toFixed(3));
      hid.set(`${x.el}|${x.text}`, a);
    }
    for (const g of r.glyphs) { // each text node on the first sampled frame that shows it, and when its text changes
      try { r.findings.push(...await textFonts(s, g)); }
      catch (e) { warn(`glyph-fallback, system-face: could not read the rendered fonts (${e.message.split('\n')[0]}); those checks are incomplete`); }
    }
    // name-case: a timeline name drawn in another case after text-transform; demands: where each name and line is drawn.
    for (const b of r.blocks) for (const k of ['read', 'readRaw', 'texture', 'textureRaw']) b[k] = tight(b[k]);
    for (const b of r.blocks) {
      for (const [nm, re] of nameRe) {
        for (const kind of ['read', 'texture']) {
          const found = re ? [...b[kind].matchAll(re)].map((m) => m[0]) : b[kind].includes(tight(nm)) ? [nm] : [];
          if (!found.length) continue;
          const w = seen.get(`name|${nm}`) ?? seen.set(`name|${nm}`, {}).get(`name|${nm}`);
          w[kind] ??= b.el;
          for (const x of new Set(found.filter((x) => x !== nm))) r.findings.push({ check: 'name-case', el: b.el, text: x,
            severity: (x === nm.toUpperCase() || x === nm.toLowerCase()) && !/\p{Ll}\p{Lu}/u.test(nm) ? 'note' : 'error',
            detail: `"${x}" is the name "${nm}" (timeline names) in another case, after text-transform` });
        }
      }
      for (const [d, dt] of wanted) {
        for (const kind of ['read', 'texture']) {
          if (!b[kind].includes(dt) && !b[`${kind}Raw`].includes(dt)) continue;
          const w = seen.get(`text|${d}`) ?? seen.set(`text|${d}`, {}).get(`text|${d}`);
          w[kind] ??= b.el;
        }
      }
    }
    for (const [d, dt] of wanted) {
      for (const kind of ['read', 'texture']) {
        if (seen.get(`text|${d}`)?.[kind]) continue;
        const el = across(r.blocks, kind, dt);
        if (el) (seen.get(`text|${d}`) ?? seen.set(`text|${d}`, {}).get(`text|${d}`))[kind] = el;
      }
    }
    if (r.textures.length) {
      const area = Math.min(1, r.textures.reduce((a, x) => a + x.area, 0) / (W * H));
      tex.frames++;
      if (area > tex.max) Object.assign(tex, { max: area, at: t });
      for (const x of r.textures) if (!tex.els.includes(x.el)) tex.els.push(x.el);
    }
    for (const x of r.findings) {
      if (x.check === 'system-face') { // one row per system face, listing the display-size text it draws
        const a = agg.get(`system-face|${x.face}`) ?? { check: 'system-face', severity: 'warn', el: x.face, text: '', elements: [], size: 0, times: [] };
        if (!a.elements.includes(`${x.el} "${x.text}"`)) a.elements.push(`${x.el} "${x.text}"`);
        if (x.size > a.size) Object.assign(a, { size: x.size, sizeU: x.sizeU });
        if (!a.times.includes(+t.toFixed(3))) a.times.push(+t.toFixed(3));
        a.detail = `a system face draws display-size text (up to ${a.size} px, ${a.sizeU}u) in ${a.elements.join(', ')}: fine for drafts; before delivery `
          + 'vendor an open-licensed face and load it with @font-face (references/troubleshooting.md; CJK: references/cjk.md)';
        agg.set(`system-face|${x.face}`, a);
        continue;
      }
      const key = `${x.check}|${x.el}|${x.text}`;
      const a = agg.get(key) ?? { ...x, times: [] };
      if (x.severity === 'error') { a.severity = 'error'; a.detail = x.detail; }
      if (x.value !== undefined && (a.value === undefined || x.value < a.value)) { a.value = x.value; if (a.severity === x.severity) a.detail = x.detail; }
      if (!a.times.includes(+t.toFixed(3))) a.times.push(+t.toFixed(3));
      agg.set(key, a);
    }
  }
  const fam = await s.page.evaluate(pageFamilies, [...familyLists]);
  // The placeholder tripwire's colours (S5): --ground, --ink and --accent all still the starter's (its styles.css).
  const starter = starterColours(), once = [];
  if (starter && await s.page.evaluate((st) => {
    const g = document.createElement('canvas').getContext('2d'), norm = (v) => { g.fillStyle = '#010203'; g.fillStyle = v; return g.fillStyle; };
    const cs = getComputedStyle(document.documentElement);
    return Object.entries(st).every(([k, v]) => { const p = cs.getPropertyValue(`--${k}`).trim(); return p !== '' && norm(v) !== '#010203' && norm(p) === norm(v); });
  }, starter)) once.push({ check: 'placeholder', severity: 'error', el: ':root', text: '--ground --ink --accent', detail: "the starter's placeholder colours: set --ground, --ink and --accent from the look" });
  await s.close();
  if (decode.unchecked.length) {
    once.push({ check: 'contrast', severity: 'note', el: 'ffmpeg', text: '', times: decode.unchecked,
      detail: `contrast unchecked on ${plural(decode.unchecked.length, 'sampled frame')}: their capture could not be decoded (WARN above)` });
  }
  // The look new.py wrote still leaves required Look fields open (S25).
  const fill = Array.isArray(cfg.look?.fill) ? cfg.look.fill.filter((x) => typeof x === 'string' && x) : [];
  if (fill.length) once.push({ check: 'look', severity: 'error', el: 'style.js', text: fill.join(', '), detail: "empty Look fields: fill them on plan.md's Look line, then rerun new.py look" });
  // Demands: each timeline text line drawn verbatim as read text on some sampled frame; a line or name drawn only as
  // texture is an error too (a viewer does not read it).
  for (const d of demands) {
    const w = seen.get(`text|${d}`);
    if (!w?.read) once.push({ check: 'demand', severity: 'error', el: 'timeline.text', text: d, detail: w?.texture
      ? `drawn only as texture text (${w.texture}): a demanded line is read text; take it out of data-lint="texture"`
      : `never drawn verbatim on the ${plural(frames.length, 'sampled frame')}: show it as read text, or fix the line in the timeline` });
  }
  for (const [nm] of nameRe) {
    const w = seen.get(`name|${nm}`);
    if (w?.texture && !w.read) once.push({ check: 'demand', severity: 'error', el: 'timeline.names', text: nm,
      detail: `drawn only as texture text (${w.texture}): a name the film demands is read text; take it out of data-lint="texture"` });
  }
  // Texture text: its share of the sampled frames and its largest area; over LINT.texture of the frame WARNs unless the
  // card's texture text is telemetry or material (a readout or a printed surface is meant to fill the frame).
  if (tex.frames) {
    const els = tex.els.length > 3 ? `${tex.els.slice(0, 3).join(', ')} +${tex.els.length - 3}` : tex.els.join(', ');
    const pct = (v) => `${Math.round(100 * v)}%`;
    once.push({ check: 'texture', severity: 'note', el: els, text: '', detail: `texture text (data-lint="texture") on ${tex.frames} of ${plural(frames.length, 'sampled frame')}, `
      + `largest area ${pct(tex.max)} of the frame at ${fmtT(tex.at)} s: not checked for size or safe areas` });
    if (tex.max > LINT.texture && !['telemetry', 'material'].includes(cfg.look?.textureText)) {
      once.push({ check: 'texture', severity: 'warn', el: els, text: '', value: +tex.max.toFixed(3), times: [+tex.at.toFixed(3)],
        detail: `texture text covers ${pct(tex.max)} of the frame at ${fmtT(tex.at)} s, over ${pct(LINT.texture)}: shrink or thin it (a card whose type.texture_text is telemetry or material allows more)` });
    }
  }
  const rank = { error: 0, warn: 1, note: 2 };
  const findings = [...readinessFindings.map((x) => ({ ...x, times: [] })), ...fam.map((x) => ({ ...x, times: [] })), ...once.map((x) => ({ times: [], ...x })), ...agg.values()]
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
  const count = (sev) => findings.filter((x) => x.severity === sev).length;
  const errors = count('error'), warnings = count('warn'), notes = count('note'), hidden = [...hid.values()];
  const report = { version: 1, page: cfg.pagePath ?? cfg.url, width: cfg.W, height: cfg.H, fps, duration: cfg.duration, u: +(Math.min(cfg.W, cfg.H) / 100).toFixed(2),
    boxes, samples: frames.map((f) => ({ t: +(f / fps).toFixed(3), why: samples.get(f) })), errors, warnings, notes, findings, hidden };
  const file = path.join(path.dirname(cfg.out), 'lint.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  const times = (ts) => (ts.length ? (ts.length > 4 ? `${ts.slice(0, 3).map(fmtT).join(',')} +${ts.length - 3}` : ts.map(fmtT).join(',')) : 'all');
  const table = (head, rows) => {
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('  ');
    return [line(head), ...rows.map(line)].join('\n');
  };
  const rows = findings.map((x) => [x.severity.toUpperCase(), x.check, times(x.times), (x.text ? `${x.el} "${x.text}"` : x.el).slice(0, 48), x.detail]);
  log(`lint: ${frames.length} sampled frames (${frames.map((f) => fmtT(f / fps)).join(', ')} s)`);
  // Hidden text comes apart from the findings and before them, so the end of the output still shows the findings.
  if (hidden.length) {
    console.log(`lint: ${plural(hidden.length, 'element')} not drawn on some sampled frames, so not checked on them:\n`
      + table(['HIDDEN AT (s)', 'ELEMENT', 'WHY'], hidden.slice(0, 10).map((x) => [x.times.length === frames.length ? 'all' : times(x.times), `${x.el} "${x.text}"`.slice(0, 48), x.why]))
      + (hidden.length > 10 ? `\n+${hidden.length - 10} more under "hidden" in ${file}` : ''));
  }
  console.log(rows.length ? table(['SEV', 'CHECK', 'TIMES (s)', 'ELEMENT', 'DETAIL'], rows) : 'lint: no findings');
  log(`lint: ${plural(errors, 'error')}, ${plural(warnings, 'warning')}${notes ? `, ${plural(notes, 'note')}` : ''}${hidden.length ? `, ${hidden.length} hidden listed apart` : ''} -> ${file}`);
  return errors;
}

// Runs inside the page (--speed, --motion-blur): the frame-clipped box of each element with an id or data-track, except
// data-lint="off" subtrees, SVG resources, hidden or nearly transparent elements and boxes over 90% of the frame (stage
// and backdrop containers). A text element that paints nothing is measured by its text: a block's box spans its
// container, so a scale or rotation would read its empty corner. Each entry adds its blur device, flags, nearest
// tracked ancestor and, for a container, where it sits, its drawn descendants and what it was told (percentages kept),
// so frameSpeed can tell a box that only grew around its children from a move; that costs its subtree per frame.
function pageBoxes({ W, H }) {
  const SKIP = 'head,script,style,noscript,template,defs,mask,clipPath,pattern,symbol,marker,linearGradient,radialGradient,filter,[data-lint="off"]';
  const REPLACED = /^(img|canvas|video|audio|iframe|embed|object|picture|input|textarea|select|button)$/i;
  const clear = (c) => c === 'transparent' || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?%?\)$/.test(c);
  const clipText = (cs) => cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text'; // gradient text paints only its glyphs
  const paints = (el, cs) => (!clipText(cs) && (!clear(cs.backgroundColor) || cs.backgroundImage !== 'none')) || cs.boxShadow !== 'none'
    || ['Top', 'Right', 'Bottom', 'Left'].some((d) => parseFloat(cs[`border${d}Width`]) > 0)
    || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.backdropFilter ?? 'none') !== 'none'
    || ['::before', '::after'].some((p) => !/^(none|normal)$/.test(getComputedStyle(el, p).content));
  const textual = (el) => el instanceof HTMLElement && !REPLACED.test(el.tagName) && /\S/.test(el.textContent)
    && [...el.children].every((c) => /^(none|contents|inline.*|ruby.*)$/.test(getComputedStyle(c).display));
  const range = document.createRange(), out = [], seen = new Map(), keyOf = new Map(), told = new Map();
  const TOLD = ['transform', 'translate', 'scale', 'rotate', 'left', 'top', 'right', 'bottom', 'margin-left', 'margin-top'];
  const moved = (e) => { const m = e.computedStyleMap(); return TOLD.map((k) => String(m.get(k))).join(' '); };
  const chain = (e) => { // what e and its ancestors were told: their transforms and offsets, as computed (percentages kept)
    if (!e || e === document.documentElement) return '';
    let c = told.get(e);
    if (c === undefined) told.set(e, (c = `${chain(e.parentElement)}/${moved(e)}`));
    return c;
  };
  for (const el of document.querySelectorAll('[id],[data-track]')) {
    if (el === document.documentElement || el === document.body) continue;
    const tag = el.tagName.toLowerCase();
    let key = el.id ? `${tag}#${el.id}` : el.dataset.track ? `${tag}[data-track=${el.dataset.track}]` : `${tag}[data-track]`;
    const n = (seen.get(key) ?? 0) + 1; // counted before any skip, so a duplicate keeps its key on every frame
    seen.set(key, n);
    if (n > 1) key += `~${n}`;
    if (el.closest(SKIP)) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    if (textual(el) && !paints(el, cs)) {
      range.selectNodeContents(el);
      const c = range.getBoundingClientRect();
      const l = Math.max(x0, c.left), t = Math.max(y0, c.top), rr = Math.min(x1, c.right), b = Math.min(y1, c.bottom);
      if (c.width > 0 && c.height > 0 && rr > l && b > t) [x0, y0, x1, y1] = [l, t, rr, b];
    }
    const l = Math.max(0, x0), t = Math.max(0, y0), rr = Math.min(W, x1), b = Math.min(H, y1);
    if (rr - l < 0 || b - t < 0 || (rr === l && b === t) || (rr - l) * (b - t) >= 0.9 * W * H) continue;
    if (cs.visibility !== 'visible') continue;
    let o = 1;
    for (let a = el; a && o >= 0.05; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
    if (o < 0.05) continue;
    let parent = null, place = null, kids = null, self = null;
    for (let a = el.parentElement; a && parent === null; a = a.parentElement) parent = keyOf.get(a) ?? null;
    keyOf.set(el, key);
    if (el.firstElementChild) {
      const m = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
      place = m ? [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => v.toFixed(3)).join(',') : `${r.left.toFixed(2)},${r.top.toFixed(2)},${cs.transform}`;
      let n = 0, h = 0;
      el.querySelectorAll('*').forEach((d, k) => {
        const c = getComputedStyle(d);
        if (c.display !== 'none' && c.visibility === 'visible' && parseFloat(c.opacity) > 0 && d.getClientRects().length) { n++; h = (h + (k + 1) * 2654435761) % 4294967296; }
      });
      kids = `${n}:${h}`;
      const sm = el.computedStyleMap();
      self = `${chain(el)} ${sm.get('width')} ${sm.get('height')}`;
    }
    const flags = (el.closest('[data-curve="mechanical"]') ? 1 : 0) | (el.closest('[data-layer="texture"],[data-layer="ground"]') ? 2 : 0);
    out.push([key, l, t, rr, b, el.closest('[data-blur]')?.getAttribute('data-blur') ?? null, flags, parent, place, kids, self]);
  }
  return out;
}

const SPEED_LIMITS = 'Boxes only: each element is measured by the fastest corner of its own box, or, for a text element that '
  + 'paints nothing itself (no background unless clipped to the text, no border or shadow; text and inline children only), of the part of its box its text '
  + 'fills, clipped to the frame. A rotation reads as its box changing: a bar swinging about one end reads its tip speed, a '
  + 'square spinning about its centre reads between 0 and its corners\' speed. A child moves on its own only with its own id or '
  + 'data-track; canvas and WebGL content, clip-path and mask reveals, and filters are invisible. A box covering >= 90% of the '
  + 'frame is skipped only while it does. An element that appears is measured from its next frame; one that jumps while '
  + 'visible (a cut, a reposition, a typed character) reads as one fast frame. The value at frame f is the move from frame f-1 to f.';

// Each element's move between two frames (fastest box corner, and centre) and the fastest, with its blur device. A
// container whose drawn children changed while it sat still, or grew around its old box or shrank inside it, told the
// same (a centred title recentring as letters appear), only grew (S4 c): listed in grew, never a move.
const within = (p, q) => p[1] >= q[1] - 0.5 && p[2] >= q[2] - 0.5 && p[3] <= q[3] + 0.5 && p[4] <= q[4] + 0.5; // box p inside box q
function frameSpeed(prev, cur) {
  let px = 0, element = null, dev = null;
  const moves = [], grew = [];
  for (const [key, b] of cur) {
    const a = prev.get(key);
    if (!a) continue; // entered, or became measurable, on this frame
    const dl = b[1] - a[1], dt = b[2] - a[2], dr = b[3] - a[3], db = b[4] - a[4];
    const d = Math.max(Math.hypot(dl, dt), Math.hypot(dr, dt), Math.hypot(dl, db), Math.hypot(dr, db));
    if (b[8] !== null && b[9] !== a[9] && (b[8] === a[8] || (b[10] === a[10] && (within(a, b) || within(b, a))))) { if (d > 0) grew.push([key, d]); continue; }
    moves.push([key, d, Math.hypot((dl + dr) / 2, (dt + db) / 2)]);
    if (d > px) { px = d; element = key; dev = b[5]; }
  }
  return { px, element, dev, moves, grew };
}

// The frames where a steps span (S4 d) starts a new drawing: a move on one is a stepped key, not a move.
function stepKeys(cfg) {
  const keys = new Set();
  for (const sp of Array.isArray(cfg.timeline.steps) ? cfg.timeline.steps : []) {
    const every = Number.isInteger(sp?.every) ? sp.every : sp?.rate > 0 ? Math.ceil(cfg.fps / sp.rate - 1e-9) : 0;
    if (every < 2 || !Number.isFinite(sp.start) || !Number.isFinite(sp.end)) continue;
    for (let f = Math.round(sp.start * cfg.fps), e = Math.round(sp.end * cfg.fps); f < e; f += every) keys.add(f);
  }
  return keys;
}

// Constant-speed stretches of one element (S4 a) from its [frame, px/f] moves. A flat window in a run over LINEAR.minPx
// (at least LINEAR.minS, slowest within LINEAR.spread of fastest; never merged, or an ease would chain into one) counts
// when it is at least LINEAR.share of its move: it and the frames beside it above LINEAR.move of its top, up to the
// next level stretch. Level: thirds' means within LINEAR.level, or a level piece (within LINEAR.piece, thirds within
// LINEAR.even, cut at LINEAR.step jumps two deep), so each piece of a piecewise-linear move is its own move, while an
// ease's flat top is never most of its move. Monotonic queues and prefix sums: O(n), because a flat window stays flat
// when it shrinks (two pointers suffice) and piece is 3x even, so an ease is level only at its top.
function linearRuns(series, fps) {
  const need = Math.ceil(LINEAR.minS * fps), out = [], sum = new Float64Array(series.length + 1), even = new Uint8Array(series.length);
  series.forEach(([, px], k) => { sum[k + 1] = sum[k] + px; });
  const level = (a, z, top, tol) => { // series[a..z]'s thirds' mean speeds within tol * top of each other
    const n = z - a + 1, t = Math.max(1, Math.floor(n / 3)), m0 = a + Math.floor((n - t) / 2), mean = (x, y) => (sum[y + 1] - sum[x]) / (y - x + 1);
    const first = mean(a, a + t - 1), last = mean(z - t + 1, z), mid = mean(m0, m0 + t - 1);
    return Math.abs(first - last) <= tol * top && Math.abs(mid - (first + last) / 2) <= tol * top;
  };
  for (let p = 0; p < series.length;) { // the level pieces: even[k] = 1
    let q = p, lo = series[p][1], hi = lo;
    while (q + 1 < series.length && series[q + 1][0] === series[q][0] + 1
      && Math.min(lo, series[q + 1][1]) >= (1 - LINEAR.piece) * Math.max(hi, series[q + 1][1])) { q++; lo = Math.min(lo, series[q][1]); hi = Math.max(hi, series[q][1]); }
    for (const parts = [[p, q, 0]]; parts.length;) { // a part that is not level is cut at each step of LINEAR.step of its spread
      const [a, z, depth] = parts.pop();
      if (z - a + 1 < need) continue;
      let top = 0, bot = Infinity;
      for (let k = a; k <= z; k++) { top = Math.max(top, series[k][1]); bot = Math.min(bot, series[k][1]); }
      if (level(a, z, top, LINEAR.even)) { even.fill(1, a, z + 1); continue; }
      if (depth === 2) continue;
      let from = a;
      for (let k = a + 1; k <= z; k++) if (Math.abs(series[k][1] - series[k - 1][1]) >= LINEAR.step * (top - bot)) { parts.push([from, k - 1, depth + 1]); from = k; }
      if (from > a) parts.push([from, z, depth + 1]);
    }
    p = q + 1;
  }
  for (let i = 0; i < series.length;) {
    if (!(series[i][1] > LINEAR.minPx)) { i++; continue; }
    let j = i;
    while (j + 1 < series.length && series[j + 1][0] === series[j][0] + 1 && series[j + 1][1] > LINEAR.minPx) j++;
    if (j - i + 1 >= need) out.push(...flatMoves(series, i, j, need, level, even));
    i = j + 1;
  }
  return out.map(([a, z]) => ({ start: (series[a][0] - 1) / fps, end: series[z][0] / fps, px: +series[z][1].toFixed(1) }));
}
// The constant-speed moves among the flat windows of one run series[i..j] (linearRuns), as [first, last] indices.
// level(a, z, top, tol) and even[k] (frame k is in a level piece) come from linearRuns.
function flatMoves(series, i, j, need, level, even) {
  const v = (k) => series[k][1], hi = [], lo = [], found = [];
  let a = i, h = 0, l = 0, open = null; // h, l: the queues' heads; open: the window ending at the frame before
  for (let z = i; z <= j; z++) {
    while (hi.length > h && v(hi.at(-1)) <= v(z)) hi.pop();
    while (lo.length > l && v(lo.at(-1)) >= v(z)) lo.pop();
    hi.push(z); lo.push(z);
    while (v(lo[l]) < (1 - LINEAR.spread) * v(hi[h])) { a++; if (hi[h] < a) h++; if (lo[l] < a) l++; }
    // [a, z] is maximal when the next end has a later earliest start (or there is none).
    if (open && open[0] !== a && open[1] - open[0] + 1 >= need) found.push(open);
    open = [a, z, v(hi[h])];
  }
  if (open[1] - open[0] + 1 >= need) found.push(open);
  // Taken longest first, each keeping the frames no earlier window holds (two pieces of a piecewise-linear move can
  // share their key's frame). Maximal windows never nest, so nxt/prv (union-find, path halving) find each window's free
  // ends and each frame is taken once: O(n log n) with the sort. A window kept in part is level if its maximal one is.
  const n = j - i + 1, owner = new Int32Array(n).fill(-1), taken = [], nxt = new Int32Array(n + 2), prv = new Int32Array(n + 2);
  for (let p = 0; p < n + 2; p++) nxt[p] = prv[p] = p; // slot p is frame i + p - 1
  const free = (f, p) => { while (f[p] !== p) { f[p] = f[f[p]]; p = f[p]; } return p; };
  for (const [a1, z1, top1] of found.sort((x, y) => y[1] - y[0] - (x[1] - x[0]) || x[0] - y[0])) {
    const a0 = free(nxt, a1 - i + 1) + i - 1, z0 = free(prv, z1 - i + 1) + i - 1;
    if (z0 - a0 + 1 < need) continue;
    let top = 0;
    for (let k = a0; k <= z0; k++) { top = Math.max(top, v(k)); owner[k - i] = taken.length; nxt[k - i + 1] = k - i + 2; prv[k - i + 1] = k - i; }
    taken.push([a0, z0, top, level(a1, z1, top1, LINEAR.level)]);
  }
  return taken.filter(([a0, z0, top]) => {
    const cap = Math.floor((z0 - a0 + 1) / LINEAR.share);
    const held = (x) => even[x] || (x >= i && x <= j && owner[x - i] >= 0 && taken[owner[x - i]][3]); // in a level stretch
    const ramp = (x) => v(x) <= top && v(x) > LINEAR.move * top && !held(x);
    let s = a0, e = z0;
    while (e - s + 1 <= cap && s > 0 && series[s - 1][0] === series[s][0] - 1 && ramp(s - 1)) s--;
    while (e - s + 1 <= cap && e + 1 < series.length && series[e + 1][0] === series[e][0] + 1 && ramp(e + 1)) e++;
    return e - s + 1 <= cap;
  }).map(([a0, z0]) => [a0, z0]).sort((x, y) => x[0] - y[0]);
}

// Runs of frames at >= BLUR_PX, each with S subframes (a multiple of 4, samples <= 3 px apart; over_cap past the --fps
// cap). A lone fast frame between still ones is a jump (a cut, a typed character): never blurred, no S. A run breaks
// where its leader's blur device starts or stops covering it, so a segment is either covered or to blur.
function speedSegments(frames, fps) {
  const maxS = maxSubframes(fps), segments = [], fast = (x) => !x.key && x.px >= BLUR_PX;
  const covers = (x) => (x.device && x.device !== 'shutter' ? x.device : null);
  for (let i = 0; i < frames.length; i++) {
    if (!fast(frames[i])) continue;
    let j = i;
    while (j + 1 < frames.length && fast(frames[j + 1]) && !covers(frames[j + 1]) === !covers(frames[i])) j++;
    const run = frames.slice(i, j + 1), top = run.reduce((a, b) => (b.px > a.px ? b : a));
    const first = run[0].frame, last = run.at(-1).frame;
    const seg = { first, last, start: run[0].t, end: run.at(-1).t, peak: top.px, peak_frame: top.frame, element: top.element,
      ...(top.device ? { device: top.device } : {}), ...(covers(top) ? { covered: covers(top) } : {}) };
    if (first === last && i > 0 && j + 1 < frames.length && frames[i - 1].px < 10 && frames[j + 1].px < 10) seg.jump = true;
    else {
      const S = Math.max(4, 4 * Math.ceil(top.px / 12));
      Object.assign(seg, { subframes: S, over_cap: S > maxS });
      seg.flags = `--fps ${fmtT(fps * Math.min(S, maxS))} --range ${((first - 1) / fps).toFixed(4)}-${((last + 1) / fps).toFixed(4)} --frames-dir sub-${first}-${last}`;
    }
    segments.push(seg);
    i = j;
  }
  return segments;
}

// One line per element for its one-frame jumps (typing gives one per character), instead of one row each.
function jumpLines(jumps) {
  const by = new Map();
  for (const g of jumps) by.set(g.element, [...(by.get(g.element) ?? []), g]);
  return [...by].map(([el, gs]) => {
    const px = gs.map((g) => g.peak), lo = Math.min(...px), hi = Math.max(...px);
    const at = gs.length === 1 ? `frame ${gs[0].first} (${fmtT(gs[0].start)} s)` : `frames ${gs[0].first}-${gs.at(-1).first} (${fmtT(gs[0].start)}-${fmtT(gs.at(-1).start)} s)`;
    return `  ${el}: ${plural(gs.length, 'one-frame jump')}, ${at}, ${lo === hi ? lo : `${lo}-${hi}`} px`;
  });
}

// --speed (C11): the fastest tracked element per frame (delivery px) and the segments to motion-blur, with the S4 WARNs
// (constant speed, crisp moves, the card's peak guard). Texture and ground layers and one-frame jumps are not moves.
async function runSpeed(cfg, s) {
  const { fps, W, H } = cfg, from = Math.max(0, cfg.f0 - 1); // one frame before the range gives its first frame a speed
  const maxS = maxSubframes(fps), capPx = 3 * maxS, keys = stepKeys(cfg), k30 = fps / 30;
  const frames = [], tracked = new Set(), peaks = new Map(), series = new Map(), grown = new Map(), stepped = [], els = new Map(), last = new Map();
  // Each element's peak and fastest centre move, leaving out one-frame jumps (a cut, a reposition): a move x is judged
  // once the next (b) is known, from the one before (a).
  const judge = (k, a, x, b) => {
    if (x[1] >= BLUR_PX && a?.[0] === x[0] - 1 && b?.[0] === x[0] + 1 && a[1] < 10 && b[1] < 10) return;
    if (x[1] > (peaks.get(k)?.px ?? 0)) peaks.set(k, { px: x[1], frame: x[0] });
    if (x[2] > els.get(k).dc) Object.assign(els.get(k), { dc: x[2], at: x[0] });
  };
  const meter = progressMeter(cfg.f1 - from, 'speed');
  let prev = null;
  try {
    for (let f = from; f < cfg.f1; f++) {
      await seekTo(s, cfg, f / fps);
      const cur = new Map((await s.page.evaluate(pageBoxes, { W, H })).map((b) => [b[0], b]));
      for (const [k, b] of cur) { tracked.add(k); Object.assign(els.get(k) ?? els.set(k, { dc: 0, at: 0 }).get(k), { dev: b[5], flags: b[6], parent: b[7] }); }
      if (prev) {
        const m = frameSpeed(prev, cur), key = keys.has(f), t = +(f / fps).toFixed(4);
        for (const [k, d] of m.grew) if (d > (grown.get(k) ?? 0)) grown.set(k, d);
        if (key && m.px >= 10) stepped.push({ frame: f, t, px: +m.px.toFixed(1), element: m.element });
        for (const [k, d, dc] of key ? [] : m.moves) {
          if (els.get(k).flags & 2) continue;
          const [a, x] = last.get(k) ?? [], move = [f, d, dc];
          if (x) judge(k, a, x, move);
          last.set(k, [x, move]);
          if (!(els.get(k).flags & 1)) (series.get(k) ?? series.set(k, []).get(k)).push([f, d]);
        }
        frames.push({ frame: f, t, px: +m.px.toFixed(1), element: m.element, ...(m.dev ? { device: m.dev } : {}), ...(key ? { key: true } : {}) });
      }
      prev = cur;
      meter.tick();
    }
  } finally { meter.stop(); }
  await s.close();
  for (const [k, [a, x]] of last) judge(k, a, x, null); // each element's last move: nothing after it
  const segments = speedSegments(frames, fps), jumps = segments.filter((g) => g.jump);
  const moves = segments.filter((g) => !g.jump), blurs = moves.filter((g) => !g.covered);
  const elements = [...peaks].map(([element, p]) => ({ element, peak: +p.px.toFixed(1), frame: p.frame })).sort((a, b) => b.peak - a.peak);
  const grew = [...grown].filter(([, d]) => d >= BLUR_PX).map(([element, d]) => ({ element, peak: +d.toFixed(1) })).sort((a, b) => b.peak - a.peak);
  // S4 a: constant-speed stretches, each once (a tracked parent making the same move covers its children).
  const runs = [...series].flatMap(([element, ser]) => linearRuns(ser, fps).map((x) => ({ element, ...x })));
  const linear = runs.filter((x) => !runs.some((y) => y.element === els.get(x.element).parent && y.start < x.end && x.start < y.end));
  const warnings = linear.map((x) => `constant-speed move ${fmtT(x.start)}-${fmtT(x.end)} s on ${x.element}: ease it, or mark it data-curve="mechanical"`);
  // S4 e: the card's speed guard, and crisp translations past what sharp motion carries.
  const guard = cfg.look?.guards?.peak_pxf_30fps;
  for (const e of elements) {
    if (guard > 0 && e.peak * k30 > guard) warnings.push(`${e.element} peaks at ${+(e.peak * k30).toFixed(1)} px/f at 30 fps (frame ${e.frame}), over the card's ${guard} (guards.peak_pxf_30fps): slow it`);
  }
  if (cfg.look?.clock !== 'stepped') {
    for (const [k, e] of els) {
      if (!(e.flags & 2) && (e.dev === 'crisp' || e.dev === 'none') && e.dc * k30 > SHARP_PX_30) {
        warnings.push(`crisp move on ${k}: ${+(e.dc * k30).toFixed(1)} px/f at 30 fps (frame ${e.at}) is over ${SHARP_PX_30} px/f, more than sharp motion carries: lengthen the move, or give it a blur device`);
      }
    }
  }
  warnings.forEach((x) => warn(x));
  const file = path.join(path.dirname(cfg.out), 'speed.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, page: cfg.pagePath ?? cfg.url, width: W, height: H, fps, duration: cfg.duration,
    range: cfg.range && { start: cfg.range[0], end: cfg.range[1] }, blur_px: BLUR_PX, max_subframes: maxS, cap_px: capPx, limits: SPEED_LIMITS,
    tracked: [...tracked], elements, segments, constant: linear, grew, stepped_keys: stepped, warnings, frames }, null, 2) + '\n');
  // The bands count moving frames: a jump's frame is listed with its element below instead, a stepped key apart.
  const jumped = new Set(jumps.map((g) => g.first)), counted = frames.filter((x) => !jumped.has(x.frame) && !x.key);
  const bands = [[0, 10], [10, BLUR_PX], [BLUR_PX, capPx], [capPx, Infinity]].map(([lo, hi]) => counted.filter((x) => x.px >= lo && x.px < hi).length);
  log(`speed: ${frames.length} frames (${frames[0]?.frame ?? '-'}-${frames.at(-1)?.frame ?? '-'}) at ${W}x${H}, ${fmtT(fps)} fps; ${plural(tracked.size, 'element')} tracked`);
  log(`speed: ${bands[0]} under 10 px/f, ${bands[1]} at 10-${BLUR_PX} (judder band), ${bands[2]} at ${BLUR_PX}-${capPx} (blur, C11), ${bands[3]} over ${capPx}`
    + ` (past subframe blur: --fps <= ${MAX_FPS} allows S <= ${maxS} at ${fmtT(fps)} fps)${jumps.length ? `; ${plural(jumps.length, 'one-frame jump')} not counted` : ''}`);
  if (elements.length) log(`speed: fastest: ${elements.slice(0, 5).map((e) => `${e.element} ${e.peak} (f${e.frame})`).join(', ')}`);
  if (grew.length) log(`speed: ${plural(grew.length, 'container')} skipped where the box only grew as children appeared (no move): ${grew.map((g) => `${g.element} up to ${g.peak} px/f`).join(', ')}`);
  if (!moves.length) console.log(`speed: no move at or over ${BLUR_PX} px/f: no motion blur needed (C11)`);
  else {
    const rows = moves.map((g) => [`${g.first}-${g.last}`, `${fmtT(g.start)}-${fmtT(g.end)}`, String(g.peak), String(g.peak_frame), g.element,
      g.covered ? '-' : String(Math.min(g.subframes, maxS)), g.covered
        ? `covered by ${g.covered}${g.covered === 'crisp' || g.covered === 'none' ? ' (the card keeps it sharp)' : ' (drawn in the page)'}: --motion-blur leaves it`
        : g.over_cap ? `over ${capPx} px/f (needs S ${g.subframes}): --motion-blur caps S at ${maxS} and warns; blur it directionally (lib/look.js in-page blur) or slow the move`
          : `--motion-blur averages ${g.subframes / 2 + 1} subframes per frame`]);
    const head = ['FRAMES', 'TIMES (s)', 'PEAK px/f', 'AT', 'ELEMENT', 'S', 'BLUR (render with --motion-blur)'];
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('  ');
    console.log([line(head), ...rows.map(line)].join('\n'));
    for (const g of blurs) { // frame, px/f, and the element whenever it changes; the by-hand subframe flags
      const run = frames.filter((x) => x.frame >= g.first && x.frame <= g.last);
      console.log(`  ${g.first}-${g.last}: ${run.map((x, i) => `${x.frame} ${x.px}${i && run[i - 1].element === x.element ? '' : ` ${x.element}`}`).join(', ')}`
        + `; by hand: ${g.flags}`);
    }
  }
  if (jumps.length) console.log(['one-frame jumps between still frames (a cut, a reposition, a typed character): never blurred; if one is a move, slow it',
    ...jumpLines(jumps)].join('\n'));
  if (stepped.length) console.log(`stepped keys (a new drawing on a steps span's grid): ${plural(stepped.length, 'frame')}, `
    + `${stepped.slice(0, 8).map((x) => `${x.frame} ${x.px}`).join(', ')}${stepped.length > 8 ? ` +${stepped.length - 8} more` : ''}: drawn that way, no blur advice`);
  log(`speed: limits: ${SPEED_LIMITS}`);
  log(`speed: ${plural(blurs.length, 'segment')} at >= ${BLUR_PX} px/f to blur, ${blurs.filter((g) => g.over_cap).length} over ${capPx}`
    + `${moves.length > blurs.length ? `, ${moves.length - blurs.length} covered by the page's own device` : ''}`
    + `${jumps.length ? `, ${plural(jumps.length, 'one-frame jump')}` : ''}${stepped.length ? `, ${plural(stepped.length, 'stepped key')}` : ''} -> ${file}`);
}

// ---------------------------------------------------------------- --motion-blur (C11)
// Before a render or --frames-dir, in a session of its own (the render keeps a plain capture history): each fast
// frame's S/2+1 subframes over a centred 180-degree window, averaged by tmix and swapped in by the render (blurred()).
// As in --speed, covered segments, grown containers and stepped keys are never averaged.
async function prepareMotionBlur(cfg, mode) {
  const { fps, W, H } = cfg, maxS = maxSubframes(fps), capPx = 3 * maxS;
  if (maxS < 4) throw new UsageError(`--motion-blur needs 4 subframes per frame, so at most ${MAX_FPS / 4} fps (got ${fmtT(fps)})`);
  const t0 = performance.now();
  const s = await openSessionReady(cfg, mode);
  // A line every HEARTBEAT_MS naming the step under way (S1, S2), so a stall shows as the same step repeating. ffmpeg runs
  // asynchronously (averageFrames), so the timer fires during an average too.
  let doing = 'measuring speeds';
  const beat = setInterval(() => log(`  motion blur: ${doing} (${Math.round((performance.now() - t0) / 1000)} s so far)`), HEARTBEAT_MS);
  beat.unref();
  try {
    const boxes = new Map(), speeds = new Map(), grown = new Map(), keys = stepKeys(cfg);
    const boxesAt = async (f) => {
      if (!boxes.has(f)) { await seekTo(s, cfg, f / fps); boxes.set(f, new Map((await s.page.evaluate(pageBoxes, { W, H })).map((b) => [b[0], b]))); }
      return boxes.get(f);
    };
    const speedAt = async (f) => {
      doing = `measuring speeds, frame ${f}`;
      if (!speeds.has(f)) {
        const m = frameSpeed(await boxesAt(f - 1), await boxesAt(f));
        for (const [k, d] of m.grew) if (d > (grown.get(k) ?? 0)) grown.set(k, d);
        speeds.set(f, { frame: f, t: +(f / fps).toFixed(4), px: +m.px.toFixed(1), element: m.element, ...(m.dev ? { device: m.dev } : {}), ...(keys.has(f) ? { key: true } : {}) });
      }
      return speeds.get(f);
    };
    // The range's frames, then outward while the edge frame is still fast: a segment crossing the range's edge gets the
    // S and the jump test it has in the full film.
    let lo = Math.max(1, cfg.f0), hi = Math.max(lo, cfg.f1);
    for (let f = lo; f < hi; f++) await speedAt(f);
    while (hi > lo && lo > 1 && (await speedAt(lo)).px >= BLUR_PX) await speedAt(--lo);
    while (hi > lo && hi < cfg.N && (await speedAt(hi - 1)).px >= BLUR_PX) await speedAt(hi++);
    const frames = [];
    for (let f = lo; f < hi; f++) frames.push(speeds.get(f));
    const tMeasure = (performance.now() - t0) / 1000;
    // A scene boundary inside a frame's window would average two scenes (never blur across a cut).
    const bounds = [...new Set((Array.isArray(cfg.timeline.scenes) ? cfg.timeline.scenes : []).flatMap((sc) => [sc?.start, sc?.end]))]
      .filter((b) => Number.isFinite(b) && b > 0 && b < cfg.duration);
    const plan = [], sharp = [], jumps = [];
    let covered = 0;
    for (const g of speedSegments(frames, fps)) {
      if (g.last < cfg.f0 || g.first >= cfg.f1) continue;
      if (g.jump) { jumps.push(g); continue; }
      if (g.covered) {
        covered += Math.min(g.last, cfg.f1 - 1) - Math.max(g.first, cfg.f0) + 1;
        log(`motion blur: frames ${g.first}-${g.last} (${fmtT(g.start)}-${fmtT(g.end)} s), ${g.element} at up to ${g.peak} px/f: covered by ${g.covered} (data-blur): not averaged`);
        continue;
      }
      const S = Math.min(g.subframes, maxS);
      if (g.over_cap) warn(`motion blur: frames ${g.first}-${g.last}, ${g.element} at ${g.peak} px/f, are over the ${capPx} px/f that S = ${maxS} can sample at `
        + `${fmtT(fps)} fps: blurred at S = ${maxS}, so the streak may break into copies; blur ${g.element} directionally (lib/look.js in-page blur) or slow the move`);
      log(`motion blur: frames ${g.first}-${g.last} (${fmtT(g.start)}-${fmtT(g.end)} s), ${g.element} at up to ${g.peak} px/f: S = ${S}, ${S / 2 + 1} subframes per frame`);
      for (let f = Math.max(g.first, cfg.f0); f <= Math.min(g.last, cfg.f1 - 1); f++) {
        const b = bounds.find((x) => (f - 0.25) / fps < x - 1e-9 && x <= (f + 0.25) / fps + 1e-9);
        if (b === undefined) plan.push({ f, S, px: speeds.get(f).px }); else sharp.push({ f, px: speeds.get(f).px });
        if (b !== undefined) log(`motion blur: frame ${f} stays sharp: its window would cross the scene boundary at ${fmtT(b)} s`);
      }
    }
    if (jumps.length) log(['motion blur: one-frame jumps stay sharp (a cut, a reposition, a typed character):', ...jumpLines(jumps)].join('\n'));
    const grew = [...grown].filter(([, d]) => d >= BLUR_PX).sort((a, b) => b[1] - a[1]);
    if (grew.length) log(`motion blur: ${plural(grew.length, 'container')} skipped where the box only grew as children appeared (no move): ${grew.map(([k, d]) => `${k} up to ${+d.toFixed(1)} px/f`).join(', ')}`);
    const stepped = frames.filter((x) => x.key && x.px >= BLUR_PX && x.frame >= cfg.f0 && x.frame < cfg.f1);
    if (stepped.length) log(`motion blur: ${plural(stepped.length, 'stepped key')} ${stepped.length === 1 ? 'stays' : 'stay'} sharp (a new drawing on a steps span's grid): frames ${stepped.map((x) => x.frame).join(', ')}`);
    const files = new Map(), failed = [], shot = { format: 'png', scale: cfg.scale };
    const t1 = performance.now();
    let subframes = 0, dir = null;
    if (plan.length) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-mjs-blur-')); live.tmp.add(dir); }
    for (const [i, { f, S }] of plan.entries()) {
      const bufs = [];
      for (let j = 0; j <= S / 2; j++) {
        doing = `${i}/${plan.length} frames done; frame ${f}: capturing subframe ${j + 1} of ${S / 2 + 1}`;
        await seekTo(s, cfg, (f * S + j - S / 4) / (fps * S));
        bufs.push(await capture(s, cfg, shot));
      }
      subframes += bufs.length;
      // A stalled or failed average gets one more try; after a second failure the frame stays sharp and the render goes on.
      let error = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        doing = `${i}/${plan.length} frames done; frame ${f}: averaging ${bufs.length} subframes${attempt > 1 ? ', second try' : ''}`;
        try {
          const file = path.join(dir, `blur-${f}.png`);
          fs.writeFileSync(file, await averageFrames(bufs, cfg.cli.alpha));
          files.set(f, file);
          error = null;
          break;
        } catch (e) {
          error = e;
          if (attempt === 1) log(`motion blur: frame ${f}: ${e.message}; trying once more`);
        }
      }
      if (!error) continue;
      // Circuit breaker: an ffmpeg that failed twice fails again, so later frames skip subframes and stay sharp.
      failed.push(...plan.slice(i));
      const rest = plan.length - i - 1;
      warn(`motion blur: frame ${f} (${fmtT(f / fps)} s) stays sharp: ${error.message}, on both tries`
        + `${rest ? `; so do the ${plural(rest, 'blur frame')} after it, without calling ffmpeg again` : ''}: ${plural(rest + 1, 'frame')} kept sharp`);
      break;
    }
    // The fast frames that stay sharp, for the closing summary (jumps are not moves and are listed apart above).
    const sharpFast = [...sharp, ...failed].map(({ f, px }) => ({ t: f / fps, px })).sort((a, b) => a.t - b.t);
    return { files, frames: files.size, failed: failed.length, subframes, sharp: sharp.length + jumps.length, covered, sharpFast, measured: frames.length,
      tMeasure, tCapture: (performance.now() - t1) / 1000, seconds: (performance.now() - t0) / 1000 };
  } finally { clearInterval(beat); await s.close(); }
}

// tmix's exact mean of the S/2+1 frames; under --alpha premultiplied in 16 bits, so a streak over transparency keeps
// its colour. The mean is the last frame tmix outputs, hence frame K-1; -frames:v 1 neither ends the call nor avoids
// the hang. FFmpeg 8.1 still deadlocks at times at the end of a call, so it is killed past its limit; a spawn, not
// spawnSync, keeps the heartbeat running meanwhile.
async function averageFrames(bufs, alpha) {
  const K = bufs.length;
  const input = alpha || bufs.some((b) => b[25] !== bufs[0][25]) ? bufs.map(toRGBA) : bufs; // one IHDR colour type
  const pick = `tmix=frames=${K},select='eq(n\\,${K - 1})'`;
  const vf = alpha ? `format=gbrap16le,premultiply=inplace=1,${pick},unpremultiply=inplace=1,format=rgba` : `${pick},format=${input[0][25] === 6 ? 'rgba' : 'rgb24'}`;
  const px = input[0].readUInt32BE(16) * input[0].readUInt32BE(20); // IHDR width x height: the captured size
  const ms = BLUR_LIMIT_MS ?? Math.round(Math.min(AVERAGE_LIMIT.max, Math.max(AVERAGE_LIMIT.min, K * px * AVERAGE_LIMIT.msPerPx)));
  const proc = spawn('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(K), '-i', '-', '-vf', vf,
    '-fps_mode', 'passthrough', '-f', 'image2pipe', '-c:v', 'png', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  live.procs.add(proc);
  const out = [], err = [];
  proc.stdout.on('data', (d) => out.push(d));
  proc.stderr.on('data', (d) => err.push(d));
  proc.stdin.on('error', () => {}); // EPIPE surfaces through the exit code below
  const exited = new Promise((res) => {
    proc.on('error', (e) => { err.push(Buffer.from(String(e))); res({ code: -1 }); });
    proc.on('close', (code, signal) => res({ code, signal }));
  });
  let late = false;
  // Destroy the pipes too: if ffmpeg on PATH is a wrapper that does not exec, its child keeps them open after the kill
  // and 'close' would never fire.
  const timer = setTimeout(() => { late = true; proc.kill('SIGKILL'); proc.stdout.destroy(); proc.stderr.destroy(); }, ms);
  proc.stdin.end(Buffer.concat(input));
  const r = await exited;
  clearTimeout(timer);
  live.procs.delete(proc);
  if (late) throw new Error(`ffmpeg did not finish averaging ${K} subframes in ${fmtT(ms / 1000)} s and was stopped`);
  const png = Buffer.concat(out);
  if (r.code !== 0 || !png.length) throw new Error(`ffmpeg could not average ${K} subframes: ${Buffer.concat(err).toString().trim() || `exit ${r.code ?? r.signal}`}`);
  return png;
}

// --motion-blur: the average prepared for frame f, if any, replaces the render's own (sharp) capture of f.
const blurred = (cfg, f, buf) => (cfg.blur?.files.has(f) ? fs.readFileSync(cfg.blur.files.get(f)) : buf);

// The closing summary (S1): the cost, then each fast frame left sharp (a failed average, the frames after it, a scene
// boundary) by time and px/f, with what to do about them.
function blurCost(cfg, sec) {
  const b = cfg.blur;
  const left = [b.sharp && `${plural(b.sharp, 'fast frame')} left sharp`, b.covered && `${plural(b.covered, 'fast frame')} covered by the page's own blur devices`].filter(Boolean);
  const cost = !b.frames && !b.failed
    ? `motion blur: nothing to blur${left.length ? ` (${left.join(', ')})` : ''}; measuring ${b.measured} frames added ${b.seconds.toFixed(1)} s`
    : `motion blur: ${plural(b.frames, 'frame')} blurred from ${b.subframes} subframes${left.map((x) => `, ${x}`).join('')}`
      + `${b.failed ? `, ${plural(b.failed, 'frame')} kept sharp after ffmpeg failed twice (WARN above)` : ''}; it added `
      + `${b.seconds.toFixed(1)} s to this ${sec.toFixed(1)} s render (+${Math.round((100 * b.seconds) / sec)}%: measuring ${b.measured} frames ${b.tMeasure.toFixed(1)} s, `
      + `subframes ${b.tCapture.toFixed(1)} s)`;
  if (!b.sharpFast.length) return cost;
  return `${cost}\nmotion blur: sharp fast frames (time, px/f): ${b.sharpFast.map((x) => `${fmtT(x.t)} s ${x.px}`).join(', ')}\n`
    + `motion blur: sharp is acceptable up to about ${SHARP_PX_30} px/f at 30 fps; above that, lengthen the move; keep the easing; re-time any cue tied to its speed peak.`;
}

async function doctor(cli) {
  let ok = true;
  const row = (k, v) => console.log(`${k.padEnd(16)} ${v}`);
  const major = Number(process.versions.node.split('.')[0]);
  row('node', `${process.version}${major >= 20 ? '' : '  (NEEDS >= 20)'}`); if (major < 20) ok = false;
  const npm = npmKind(); // only installs use it
  row('npm', !npm ? 'not found (needed only to install playwright-core)'
    : npm.bun ? `Bun ${npm.version}: no npm --cache, and npm init runs bun init; install with BUN_INSTALL_CACHE_DIR (references/troubleshooting.md)` : npm.version);
  const pw = loadPlaywright(null);
  if (pw.missing) { row('playwright-core', 'MISSING'); console.log(playwrightHint(pw, npm)); ok = false; }
  else row('playwright-core', `${pw.version}  ${pw.resolved}`);
  let b = null;
  try { b = findBrowser(cli.browser, pw.work); } catch (e) { console.log(e.message); }
  if (!b) { row('browser', 'MISSING'); console.log(browserHint(pw.missing ? null : pw)); ok = false; }
  else {
    let v = {};
    try { v = runSync('browser --version', b.path, ['--version'], { encoding: 'utf8' }, PROBE_MS); } catch (e) { v.stdout = `version unknown (${e.message})`; }
    row('browser', `${(v.stdout || '').trim() || 'version unknown'}  (${b.source})`);
    row('', b.path);
    if (cli['chrome-arg']) row('chrome args', cli['chrome-arg'].join(' '));
    if (!pw.missing) {
      try {
        const browser = await pw.mod.chromium.launch({ executablePath: b.path, headless: true, args: chromeArgs(cli) });
        live.browsers.add(browser);
        row('launch', `ok (${browser.version()})`);
        // The GL backend in use: SwiftShader (software, the headless default) or the GPU (--use-angle=metal).
        const page = await browser.newPage();
        row('webgl', await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl');
          const info = gl?.getExtension('WEBGL_debug_renderer_info');
          return gl ? gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'unavailable';
        }));
        live.browsers.delete(browser); await browser.close();
      } catch (e) { row('launch', `FAILED: ${e.message.split('\n')[0]}`); ok = false; }
    }
  }
  const version = (bin) => { try { return ffmpegVersion(bin) ?? 'MISSING'; } catch (e) { return `FAILED: ${e.message}`; } };
  const fv = version('ffmpeg'), pv = version('ffprobe'), bad = (v) => v === 'MISSING' || v.startsWith('FAILED');
  row('ffmpeg', fv); row('ffprobe', pv);
  if (bad(fv) || bad(pv)) ok = false;
  if (!bad(fv)) {
    let enc = '';
    try { enc = runSync('ffmpeg -encoders', 'ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }, PROBE_MS).stdout || ''; }
    catch (e) { row('  encoders', `FAILED: ${e.message}`); }
    for (const e of ['libx264', 'ffv1', 'png']) { const has = new RegExp(`\\s${e}\\s`).test(enc); row(`  encoder ${e}`, has ? 'yes' : 'MISSING'); if (!has) ok = false; }
    for (const [e, use] of [['prores_ks', '.mov'], ['libvpx-vp9', '.webm']]) row(`  encoder ${e}`, `${new RegExp(`\\s${e}\\s`).test(enc) ? 'yes' : 'missing'} (only for --alpha ${use})`);
  }
  console.log(ok ? 'doctor: ready' : 'doctor: NOT ready (fix the lines marked above)');
  return ok ? 0 : 1;
}

async function openSessionReady(cfg, mode) {
  const s = await openSession(cfg, mode, { width: cfg.W, height: cfg.H });
  await prepare(s);
  return s;
}

// ---------------------------------------------------------------- main
async function main() {
  const cli = parseArgs(process.argv.slice(2));
  validate(cli);
  if (cli.help) { console.log(HELP); return 0; }
  if (badEnv.length) throw new UsageError(badEnv.join('; '));
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error(`Node ${process.version} is too old: render.mjs needs Node >= 20`);
  if (cli.doctor) return doctor(cli);
  const mode = cli.lint ? 'lint' : cli.speed ? 'speed' : cli['timeline-only'] ? 'timeline' : cli.stills ? 'stills' : cli['frames-dir'] ? 'frames'
    : cli['check-determinism'] !== undefined ? 'determinism' : 'render';
  const flag = { lint: '--lint', speed: '--speed', timeline: '--timeline-only', stills: '--stills', determinism: '--check-determinism' }[mode];
  const draws = ['render', 'stills', 'frames', 'determinism'].includes(mode); // modes that write pixels, through ffmpeg
  if (draws) requireFfmpeg();
  const cfg = await resolveConfig(cli);
  log(`page ${cfg.pagePath ?? cfg.url}; browser ${cfg.browser.path} (${cfg.browser.source}); playwright-core ${cfg.pw.version}`
    + `${cli['chrome-arg'] ? `; chrome args ${cli['chrome-arg'].join(' ')}` : ''}`);
  // Probe: read window.__video, then make sure the viewport matches the film's size before readiness.
  const vp0 = { width: cli.width ?? 1920, height: cli.height ?? 1080 };
  const s = await openSession(cfg, mode === 'determinism' ? 'render' : mode, vp0); // the page sees a render: that is what is checked
  const c = s.contract;
  const want = { width: cli.width ?? (Number.isInteger(c.width) && c.width > 0 ? c.width : 1920), height: cli.height ?? (Number.isInteger(c.height) && c.height > 0 ? c.height : 1080) };
  if (want.width !== vp0.width || want.height !== vp0.height) {
    await s.page.setViewportSize(want);
    await loadPage(s, cfg);
  }
  const readiness = await prepare(s);
  if (s.contract.hasVideo) await readTimeline(s);
  if (cli.alpha && draws) await requireTransparentPage(s);
  let animInfo = null;
  if (!s.contract.hasSeek) {
    animInfo = await s.page.evaluate(() => {
      let end = 0, infinite = false;
      const list = document.getAnimations();
      for (const a of list) { const ct = a.effect?.getComputedTiming(); if (!ct) continue; if (!Number.isFinite(ct.endTime)) infinite = true; else end = Math.max(end, ct.endTime); }
      return { end: end / 1000, infinite, count: list.length };
    });
  }
  finishConfig(cfg, s.contract, animInfo);
  const pix = mode === 'render' || mode === 'determinism' ? videoFormat(cfg).pix : '';
  if (pix.includes('420') && (cfg.outW % 2 || cfg.outH % 2)) throw new UsageError(`${cfg.outW}x${cfg.outH} has an odd side: ${pix} needs even width and height`);
  if (cli.workers > 1 && flag && mode !== 'determinism') warn(`--workers is ignored for ${flag}`);
  if (cli.alpha && (mode === 'lint' || mode === 'speed')) warn(`--alpha is ignored for ${flag}`);
  if (cli['motion-blur'] && flag) warn(`--motion-blur is ignored for ${flag}${mode === 'stills' ? ': stills stay sharp (see blurred frames in a render or --frames-dir)' : ''}`);
  const readinessFindings = reportReadiness(readiness, { lint: mode === 'lint' });
  // The page facts the timeline carries (S6 layers, S8 holds); --timeline-only measures in the probe's own session.
  if (['render', 'frames', 'timeline'].includes(mode)) {
    const m = mode === 'timeline' ? s : await openSessionReady(cfg, mode);
    try { await measurePage(cfg, m); } finally { if (m !== s) await m.close(); }
  }
  if (cli['motion-blur'] && !flag) cfg.blur = await prepareMotionBlur(cfg, mode);
  let code = 0, remux = '';
  if (mode === 'lint') code = (await runLint(cfg, s, readinessFindings)) > 0 ? 1 : 0;
  else if (mode === 'speed') await runSpeed(cfg, s);
  else if (mode === 'timeline') {
    await s.close();
    remux = remuxCheck(cfg);
    if (remux === null) return 1;
    cfg.layers.pass = existingContentPass(cfg);
  } else if (mode === 'stills') await renderStills(cfg, s);
  else if (mode === 'frames') await renderFrames(cfg, s);
  else if (mode === 'determinism') code = await checkDeterminism(cfg, s);
  else await renderVideo(cfg, s);
  if (mode === 'render' || mode === 'frames') await contentPass(cfg);
  // Only the modes that make a picture, or pair a timeline with one, write it: --stills, --lint, and --speed leave
  // <out>.timeline.json describing the render it was written with, even after a visual edit.
  if (mode === 'render' || mode === 'frames' || mode === 'timeline') exportTimeline(cfg);
  if (remux) log(remux);
  return code;
}

// --timeline-only pairs the new timeline with the existing render at --out. A different frame count, size or rate means
// the picture changed (a remux would drift): returns null, leaving <out>.timeline.json; else the line to print.
function remuxCheck(cfg) {
  if (!fs.existsSync(cfg.out)) return `no render at ${cfg.out} yet: render with the same --out (and --range, --draft) to pair it with this timeline`;
  if (!ffmpegVersion('ffprobe')) { warn(`ffprobe not found: ${cfg.out} not compared with the page`); return ''; }
  let p;
  try { p = probeVideo(cfg.out, path.extname(cfg.out).toLowerCase() === '.webm'); } catch (e) { warn(`${e.message.split('\n')[0]}: not compared with the page`); return ''; }
  const frames = Number(p.nb_frames ?? p.nb_read_packets), [num, den = 1] = String(p.r_frame_rate).split('/').map(Number), rate = num / den;
  const total = cfg.f1 - cfg.f0;
  if (frames !== total || p.width !== cfg.outW || p.height !== cfg.outH || !(Math.abs(rate - cfg.fps) < 1e-6)) {
    warn(`${cfg.out} has ${frames} frames at ${p.width}x${p.height}, ${fmtT(rate)} fps, but the page now gives ${total} at ${cfg.outW}x${cfg.outH}, `
      + `${fmtT(cfg.fps)} fps: the picture changed, so re-render (drop --timeline-only) instead of remuxing; ${cfg.timelinePath} is unchanged`);
    return null;
  }
  return `${cfg.out} has the same ${total} frames, size, and rate (pixels are not compared: re-render if anything visual changed). Remux it: `
    + `python3 -B ${path.join(SCRIPT_DIR, 'mix.py')} ${cfg.timelinePath} --video ${cfg.out} --mux FINAL.mp4 --out MIX.wav, with your --kit and --stem`;
}

main().then(async (code) => { await cleanup(); process.exitCode = code; }, async (e) => {
  await cleanup();
  if (e instanceof UsageError) { log(`render.mjs: ${e.message}`); process.exitCode = 2; }
  else { log(`render.mjs: FAILED: ${e.message}`); process.exitCode = 1; }
});
