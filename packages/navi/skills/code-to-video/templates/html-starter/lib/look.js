// lib/look.js: the chosen look as page mechanics (spec S29). film/style.js, written by `new.py look`, sets
// window.__style: the card's JSON merged with the register and format, plus the registers.json numbers the helpers
// need (the page cannot read the skill folder). This module applies it: the frame size, the stage recipe class, the
// drawing clock and the `steps` it generates, seeded textures marked data-layer="texture", ground layers marked
// data-layer="ground", line boil, and in-page directional blur and smear from analytic velocity, tagged data-blur.
// Every value is a pure function of t and fixed seeds: nothing reads a clock, so two renders are byte-identical.
import { mulberry32 } from './time.js';
export { held, beatFrame } from './time.js';

// No look yet: refuse before anything draws, so a render names the missing step instead of a stray error.
if (!window.__style) {
  const msg = 'no look chosen: run new.py look (it writes film/style.js)';
  if (!window.__videoRender) document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;margin:0;padding:12px;background:#400;color:#fff;font:14px monospace">${msg}</pre>`);
  throw new Error(msg);
}
export const S = window.__style;
const R = window.__videoRender ?? {};
const root = document.documentElement, stageEl = document.getElementById('stage');
const start = (key, fallback) => { const v = S.start?.[key]; return Array.isArray(v) ? (v[0] + v[v.length - 1]) / 2 : v ?? fallback; };

// The frame: render.mjs's --width/--height/--fps, else the look's, else 1920x1080 at 30 fps. The page is authored for
// a 1080 px short side (styles.css; .portrait when taller than wide); a larger frame draws it K times larger.
const OUT_W = R.width ?? S.frame?.width ?? 1920, OUT_H = R.height ?? S.frame?.height ?? 1080, K = Math.min(OUT_W, OUT_H) / 1080;
export const frame = { width: OUT_W, height: OUT_H, K, W: OUT_W / K, H: OUT_H / K, portrait: OUT_H > OUT_W };
export const FPS = R.fps ?? S.motion?.clock?.fps ?? 30;
root.classList.toggle('portrait', frame.portrait);
root.style.setProperty('--w', `${frame.W}px`);
root.style.setProperty('--h', `${frame.H}px`);
if (stageEl && K !== 1) {
  Object.assign(stageEl.style, { transform: `scale(${K})`, transformOrigin: '0 0' });
  document.body.style.height = `${OUT_H}px`; // body's overflow: hidden clips at its own box
}
// The stage recipe (styles.css .stage-<value>): lit, flat, medium-paper, medium-cutpaper, medium-pixel, medium-print,
// emissive, footage, transparent. Recipes use --ground, --ink and --accent; none prescribes a palette.
if (S.stage) { root.dataset.stage = S.stage; stageEl?.classList.add(`stage-${S.stage}`); }

const r6 = (x) => +x.toFixed(6);
const hash = (a, b = 0) => { let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; return h >>> 0; };

// The drawing clock (card field motion.clock: kind smooth | stepped | snapped, fps, rates {section: drawings per
// second}). stepped and snapped: the first rate covers the film outside the sections the film declares; smooth: only
// declared sections step. A drawing shows for every = ceil(fps / rate) frames, exactly, on a frame grid that starts at
// its span (vqa excuses a repeat only when it fills whole steps of `every`): inside a stepped span everything the
// helpers drive is posed from T(t), the first frame of the current drawing, and steps() declares those spans with that
// `every`. A declared section starts on a frame and lasts whole drawings. snapped keeps time on ones and rounds helper
// positions to `grid` (the art pixel, in page px).
function makeClock({ kind = 'smooth', rates = {} } = {}, fps) {
  const names = Object.keys(rates ?? {}), base = kind === 'smooth' ? null : names[0] ?? null, declared = [];
  const every = (rate) => Math.max(1, Math.ceil(fps / rate - 1e-9));
  // [first frame, end frame, rate, name, snaps time] covering frames [0, until): declared sections, the base between
  const spans = (until) => {
    const out = [];
    let cur = 0;
    for (const s of declared) {
      if (s.fa >= until) break;
      if (s.fa > cur) out.push([cur, s.fa, base ? rates[base] : null, base, kind === 'stepped']);
      out.push([s.fa, Math.min(s.fb, until), s.rate, s.name, true]);
      cur = Math.max(cur, s.fb);
    }
    if (cur < until) out.push([cur, until, base ? rates[base] : null, base, kind === 'stepped']);
    return out;
  };
  const spanAt = (f) => spans(Math.max(f, 0) + 1e5).find(([, b]) => f < b - 1e-6);
  const stepOf = ([, , rate, , snaps]) => (snaps && rate ? every(rate) : 1); // frames per drawing on a span
  return {
    kind, fps, rates, grid: 1,
    section(name, a, b) { // declare a stepped section from a to about b s at the card's rate for `name`
      if (!(name in rates)) throw new Error(`clock.section('${name}'): this look's clock has no rate '${name}' (rates: ${names.join(', ') || 'none'})`);
      const fa = Math.round(a * fps), e = every(rates[name]);
      declared.push({ name, fa, fb: fa + e * Math.max(1, Math.ceil((b * fps - fa) / e - 1e-6)), rate: rates[name] });
      declared.sort((x, y) => x.fa - y.fa);
      return this;
    },
    T(t) { // drawing time: t snapped down to the first frame of its drawing inside a stepped span
      const f = t * fps, sp = spanAt(f), e = stepOf(sp);
      return e > 1 ? (sp[0] + e * Math.floor((f - sp[0]) / e + 1e-6)) / fps : t;
    },
    drawing(t) { // index of the drawing on screen at t, counted from 0 over the film (a frame on a smooth span)
      const f = Math.max(t, 0) * fps;
      let n = 0;
      for (const sp of spans(f + 1)) {
        const [a, b] = sp, e = stepOf(sp);
        if (f < b - 1e-6) return n + Math.floor((f - a) / e + 1e-6);
        n += Math.ceil((b - a) / e - 1e-6);
      }
      return n;
    },
    rand(t, salt = 0) { return mulberry32(hash(this.drawing(t), salt))(); }, // seeded value per drawing, in [0, 1)
    shutter(t) { return (0.25 * stepOf(spanAt(t * fps))) / fps; }, // half a 180-degree shutter, in s
    snap(v) { return kind === 'snapped' ? Math.round(v / this.grid) * this.grid : v; },
    steps(duration) { // the timeline's `steps`: every span with a rate whose drawings show for 2 or more frames
      return spans(Math.round(duration * fps)).filter(([a, b, rate]) => rate && b > a && every(rate) >= 2)
        .map(([a, b, rate, name]) => ({ start: r6(a / fps), end: r6(b / fps), every: every(rate), rate, label: name }));
    },
  };
}
export const clock = makeClock(S.motion?.clock, FPS);
export const T = (t) => clock.T(t);

// ---------------------------------------------------------------- layers that change with t
const updaters = [];
export function applyLook(t) { for (const u of updaters) u(t); }
let defsEl = null, ids = 0;
const defs = () => {
  if (!defsEl) {
    defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defsEl.setAttribute('aria-hidden', 'true');
    defsEl.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    (stageEl ?? document.body).append(defsEl);
  }
  return defsEl;
};
const svgFilter = (prefix, inner, region = 'x="-10%" y="-10%" width="120%" height="120%"') => {
  const id = `c2v-${prefix}-${++ids}`;
  defs().insertAdjacentHTML('beforeend', `<filter id="${id}" ${region} color-interpolation-filters="sRGB">${inner}</filter>`);
  return defs().lastElementChild;
};

// A full-frame layer inside #stage, marked texture: render.mjs hides it from the stillness checks (S6).
function layer(name, { under = false } = {}) {
  const el = document.createElement('div');
  Object.assign(el.dataset, { layer: 'texture', texture: name });
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  if (under) (stageEl ?? document.body).prepend(el); else (stageEl ?? document.body).append(el);
  return el;
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; return c; };

// Static grain at a target RMS in code values: seeded noise drawn once at device resolution, its opacity set from the
// noise it actually drew, so the grain measures `rms` on a flat patch. Large dark gradients band in 8-bit H.264
// without it. Drawn unsmoothed: below a 1080 px short side #stage's scale resamples the canvas, and smoothing would
// average the noise down.
export function grain({ rms = start('grain_rms', 3), seed = 7, under = false } = {}) {
  const el = layer('grain', { under }), c = el.appendChild(canvas(OUT_W, OUT_H)), ctx = c.getContext('2d');
  c.style.imageRendering = 'pixelated';
  const img = ctx.createImageData(OUT_W, OUT_H), rand = mulberry32(seed);
  let sum = 0, sq = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 256);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
    sum += v; sq += v * v;
  }
  ctx.putImageData(img, 0, 0);
  const n = img.data.length / 4, sd = Math.sqrt(sq / n - (sum / n) ** 2);
  el.style.opacity = String(+Math.min(1, rms / sd).toFixed(5));
  return el;
}

// Paper: `sheets` seeded sheets of fibre and tooth, one shown per drawing (on the clock, never per output frame), or
// one sheet when the card's texture.changes is never. Multiplied over the ground, under the content.
export function paper({ sheets = S.texture?.changes === 'never' ? 1 : 3, seed = 11, opacity = 1 } = {}) {
  const el = layer('paper', { under: true }), w = Math.ceil(frame.W / 2), h = Math.ceil(frame.H / 2);
  el.style.mixBlendMode = 'multiply';
  el.style.opacity = String(opacity);
  const list = [];
  for (let k = 0; k < sheets; k++) {
    const c = el.appendChild(canvas(w, h)), ctx = c.getContext('2d'), rand = mulberry32(seed + 101 * k);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 900; i++) { // soft tooth: faint blotches
      ctx.fillStyle = `rgba(90,80,60,${(0.012 + 0.02 * rand()).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 3 + 14 * rand(), 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < (w * h) / 2600; i++) { // fibres: short curved strokes
      const x = rand() * w, y = rand() * h, a = rand() * Math.PI, len = 4 + 16 * rand();
      ctx.strokeStyle = `rgba(70,60,45,${(0.05 + 0.08 * rand()).toFixed(3)})`;
      ctx.lineWidth = 0.4 + 0.5 * rand();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 4, y + Math.sin(a) * len * 0.5 + (rand() - 0.5) * 4, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    list.push(c);
  }
  updaters.push((t) => { const k = clock.drawing(t) % list.length; list.forEach((c, i) => { c.style.visibility = i === k ? 'visible' : 'hidden'; }); });
  return el;
}

// Halftone screen: a static dot grid of `cell` page px, multiplied under the content (print and photo cut-outs).
export function halftone({ cell = start('halftone_cell_px', 9), opacity = 0.18, under = true } = {}) {
  const el = layer('halftone', { under });
  Object.assign(el.style, { opacity: String(opacity), mixBlendMode: 'multiply', backgroundSize: `${cell}px ${cell}px`,
    backgroundImage: 'radial-gradient(circle at 50% 50%, #000 0 32%, transparent 34%)' });
  return el;
}

// Ordered dither: the 4x4 Bayer thresholds in [0, 1) for art you dither yourself (pixel art), and a static overlay of
// the pattern at `cell` page px per threshold for gradients that should read as dithered.
export const bayer4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((row) => row.map((v) => (v + 0.5) / 16));
export function dither({ cell = clock.grid, opacity = 0.12 } = {}) {
  const el = layer('dither'), c = canvas(4, 4), ctx = c.getContext('2d');
  bayer4.forEach((row, y) => row.forEach((v, x) => { const g = Math.round(v * 255); ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(x, y, 1, 1); }));
  Object.assign(el.style, { opacity: String(opacity), mixBlendMode: 'soft-light', imageRendering: 'pixelated',
    backgroundImage: `url(${c.toDataURL()})`, backgroundSize: `${4 * cell}px ${4 * cell}px` });
  return el;
}

// Scanlines: one dark line every `period` page px (one per art row on pixel art), static, over everything.
export function scanlines({ period = Math.max(3, 3 * clock.grid), opacity = 0.24 } = {}) {
  const el = layer('scanlines'), dark = Math.max(1, Math.round(period / 3));
  Object.assign(el.style, { opacity: String(opacity),
    backgroundImage: `repeating-linear-gradient(to bottom, #000 0 ${dark}px, transparent ${dark}px ${period}px)` });
  return el;
}

// Temporal noise (tape, film): a seeded tile shifted to a seeded offset every `every` frames. Marked texture, never an
// effect: an effect span would excuse real dropped frames under it.
export function noise({ every = 2, opacity = 0.16, seed = 13, tile = 256 } = {}) {
  const el = layer('noise'), c = canvas(tile, tile), ctx = c.getContext('2d'), img = ctx.createImageData(tile, tile), rand = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.floor(rand() * 256); img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  Object.assign(el.style, { opacity: String(opacity), backgroundImage: `url(${c.toDataURL()})`, backgroundSize: `${tile}px ${tile}px` });
  updaters.push((t) => {
    const k = Math.floor(Math.round(t * FPS) / every), r = mulberry32(hash(k, seed));
    el.style.backgroundPosition = `${Math.floor(r() * tile)}px ${Math.floor(r() * tile)}px`;
  });
  return el;
}

// The card's texture (texture.kind), created once when the look loads; films may restyle or move the layer.
export function texture(kind = S.texture?.kind, opts = {}) {
  const make = { 'static-grain': grain, paper, halftone, dither, scanlines, 'temporal-noise': noise }[kind];
  return make ? make(opts) : null;
}
export const textures = [texture()].filter(Boolean);

// A ground layer: marked ground, so render.mjs hides its motion from the stillness checks (S6). When the card's ground
// drifts (or you pass a period), it moves on a slow ellipse: one turn per `period` s, top speed `pxf` page px per frame
// (the card's ground.period_min_s and ground.drift_max_pxf by default), a pure function of t.
export function ground(el, { period, pxf, seed = 17 } = {}) {
  el.dataset.layer = 'ground';
  const drifts = period !== undefined || S.ground?.motion === 'drift';
  period ??= S.ground?.period_min_s;
  pxf ??= S.ground?.drift_max_pxf;
  if (!drifts || !(period > 0) || !(pxf > 0)) return el;
  const A = (pxf * period * FPS) / (2 * Math.PI), phase = 2 * Math.PI * mulberry32(seed)();
  updaters.push((t) => { const a = (2 * Math.PI * t) / period + phase; el.style.translate = `${(A * Math.sin(a)).toFixed(3)}px ${(0.6 * A * Math.cos(a)).toFixed(3)}px`; });
  return el;
}

// Line boil: a displacement re-seeded once per drawing (on the clock, never per output frame), so held drawings
// stay alive the way redrawn ink does. `scale` is the displacement in page px.
const extra = new WeakMap();
export const extraFilter = (el) => extra.get(el) ?? '';
export function boil(el, { scale = start('boil_scale', 3), freq = 0.03, seed = 3 } = {}) {
  const f = svgFilter('boil', `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}"/>`
    + `<feDisplacementMap in="SourceGraphic" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`);
  const turb = f.firstElementChild;
  extra.set(el, `url(#${f.id})`);
  if (!el.style.filter) el.style.filter = `url(#${f.id})`; // the film helpers fold it into their own filter list
  updaters.push((t) => turb.setAttribute('seed', String(seed + (clock.drawing(t) % 97))));
  return el;
}

// ---------------------------------------------------------------- in-page motion blur
// The device per motion class comes from the card's motion.blur: shutter (render.mjs --motion-blur averages
// subframes), directional and smear (drawn here), crisp, drawn (the film draws its own smears), none. data-blur names
// it on the element, so render.mjs --speed lists covered moves (S4). (dx, dy) is the element's travel while a
// 180-degree shutter is open, in page px: a Gaussian with the same spread as that box blur has sigma = travel / sqrt(12).
const BLUR_CAP_PX = 40, sizes = new WeakMap(), dirs = new WeakMap();
export const deviceOf = (kind = 'translation') => {
  const b = S.motion?.blur ?? {};
  return b[kind] ?? (kind === 'camera' ? b.translation : null) ?? (kind === 'pop' || kind === 'impact' ? 'crisp' : 'shutter');
};
export function sizeOf(el) {
  let s = sizes.get(el);
  if (!s) {
    if (el instanceof SVGGraphicsElement) { const b = el.getBBox(); s = { w: b.width || 1, h: b.height || 1 }; }
    else s = { w: el.offsetWidth || 1, h: el.offsetHeight || 1 };
    if (window.__video) sizes.set(el, s); // measured after load; before it, measure again next time
  }
  return s;
}
// Directional blur along (dx, dy): exact along x or y; a diagonal move blurs as an axis-aligned ellipse.
export function directional(el, dx, dy) {
  const L = Math.hypot(dx, dy), sigma = Math.min(BLUR_CAP_PX, L / Math.sqrt(12));
  if (sigma < 0.25) return '';
  let f = dirs.get(el);
  if (!f) { f = svgFilter('dir', '<feGaussianBlur stdDeviation="0 0"/>', 'filterUnits="objectBoundingBox"'); dirs.set(el, f); }
  const sx = (sigma * Math.abs(dx)) / L, sy = (sigma * Math.abs(dy)) / L, { w, h } = sizeOf(el);
  const mx = (3 * sx + 2) / w, my = (3 * sy + 2) / h;
  Object.entries({ x: -mx, y: -my, width: 1 + 2 * mx, height: 1 + 2 * my }).forEach(([k, v]) => f.setAttribute(k, v.toFixed(5)));
  f.firstElementChild.setAttribute('stdDeviation', `${sx.toFixed(3)} ${sy.toFixed(3)}`);
  return `url(#${f.id})`;
}
// Smear: stretched along the motion by the shutter's travel (area kept), plus half the directional blur.
export function smear(el, dx, dy) {
  const L = Math.hypot(dx, dy);
  if (L < 0.5) return { transform: '', filter: '' };
  const { w, h } = sizeOf(el), a = Math.atan2(dy, dx), len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const k = Math.min(2.5, 1 + L / Math.max(len, 1)), deg = ((a * 180) / Math.PI).toFixed(3);
  return { transform: `rotate(${deg}deg) scale(${k.toFixed(4)}, ${(1 / Math.sqrt(k)).toFixed(4)}) rotate(${-deg}deg)`, filter: directional(el, dx / 2, dy / 2) };
}
// The in-page part of a device for one frame; tags the element with data-blur.
export function blurFor(el, device, dx = 0, dy = 0) {
  if (device) el.dataset.blur = device;
  if (device === 'directional') return { transform: '', filter: directional(el, dx, dy) };
  if (device === 'smear') return smear(el, dx, dy);
  return { transform: '', filter: '' };
}
