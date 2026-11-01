// lib/film.js: the film's helpers (spec S29). Each entrance, exit, move, hold, cue and seam is written once, where it
// happens, and the timeline takes its times from it: retime a move and the hold after it and its cue follow. Curves,
// durations and the blur device default to the look's (lib/look.js reads film/style.js). Call apply(t) first in
// render(t): it sets every helper-driven element from t alone, so any t renders in any order.
// Adapted in part from video-shotcraft (Apache-2.0, © Wei Yihao); rewritten.
import { clamp, lerp, EASE, SPRING, spring, settleTime, cubicBezier } from './time.js';
import { S, FPS, frame, clock, T, blurFor, deviceOf, extraFilter, applyLook, sizeOf } from './look.js';
export { S, FPS, frame, clock, T };

const r6 = (x) => +x.toFixed(6);
const f3 = (x) => +x.toFixed(3);
const frameUp = (t) => Math.ceil(t * FPS - 1e-6) / FPS; // the first frame at or after t
// When a pose reached at t first shows: t on a smooth span; on a stepped span the first drawing at or after t (a drawing
// shows the pose of its first frame), so a landing's cue, hold and event sit on the drawing that shows the landing.
const smoothAt = (t) => Math.abs(T(t + 1e-6) - t - 1e-6) < 1e-9;
const shown = (t) => {
  if (smoothAt(t)) return t;
  let f = Math.ceil(t * FPS - 1e-6);
  while (T(f / FPS) < t - 1e-9) f++;
  return f / FPS;
};
// When a move that starts at t first shows: t on a smooth span; on a stepped span the first drawing after t (the
// drawing at t still shows the start pose).
const firstShown = (t) => {
  if (smoothAt(t)) return t;
  let f = Math.floor(t * FPS + 1e-6) + 1;
  while (T(f / FPS) <= t + 1e-9) f++;
  return f / FPS;
};
const when = (x, key = 'land') => { // a time, or when a helper lands
  const t = typeof x === 'number' ? x : x?.[key] ?? x?.end;
  if (!Number.isFinite(t)) throw new Error(`a time is seconds or a helper (enter, exit, move, hold), got ${typeof x === 'object' && x ? 'an object with no time' : String(x)}`);
  return t;
};
// dur is optional, so an options object in its place means it was left out: enter(el, t0, {from}). Else it is seconds.
function durOpts(name, dur, o) {
  if (dur !== null && typeof dur === 'object') return [undefined, { ...dur, ...o }];
  if (dur != null && !(Number.isFinite(dur) && dur >= 0)) throw new Error(`${name}(): dur is seconds (a number), got ${typeof dur === 'string' ? `'${dur}'` : String(dur)}`);
  return [dur ?? undefined, o ?? {}];
}
const tracks = [], rigs = new Map(), byId = new Map(), effects = [], seams = [], flashes = [];

// ---------------------------------------------------------------- curves
// The time.js tokens (EASE), its springs (SPRING) and the style curves cards name. A spring plays its whole motion, to
// rest, retimed into its duration: the given dur, else the look's like any curve (S26's entrance range when the card
// gives none); a card's measured pop keeps its own timing. The card's motion.curves names the default for
// translations; motion.overshoot sets the pops.
const bounce = (p) => { // falls, then rebounds to 30% and 9% of the drop (each rebound's peak height)
  const total = 1 + 2 * Math.sqrt(0.3) + 2 * Math.sqrt(0.09), u = p * total;
  if (u <= 1) return u * u;
  const c1 = 1 + Math.sqrt(0.3);
  if (u <= 1 + 2 * Math.sqrt(0.3)) return 1 - (0.3 - (u - c1) ** 2);
  return 1 - Math.max(0, 0.09 - (u - (total - Math.sqrt(0.09))) ** 2);
};
const pen = (p, r = 0.12) => { // constant speed with ramps over the first and last 12% of the time
  const v = 1 / (1 - r);
  return p < r ? (v * p * p) / (2 * r) : p > 1 - r ? 1 - (v * (1 - p) ** 2) / (2 * r) : v * (p - r / 2);
};
const CURVES = { ...EASE, gravity: (p) => p * p, bounce, 'beat-snap': cubicBezier(0.4, 0, 0.3, 1), pen, 'key-pose': (p) => clamp(p) };
const SPRINGS = { ...SPRING, jelly: { zeta: 0.3, omega0: 10 } };
const firstName = (text = '') => [...Object.keys(CURVES), ...Object.keys(SPRINGS)]
  .map((n) => [n, text.search(new RegExp(`(^|[^\\w-])${n}($|[^\\w-])`))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0];
const CARD_CURVE = firstName(S.motion?.curves);
// A card may state a pop as measured, start.pop_overshoot_pct at start.pop_peak_s: the damped spring that peaks that far
// past its mark at that time (zeta from the overshoot, omega0 from the peak).
const measuredPop = (pct, tp) => { const l = Math.log(pct / 100), zeta = -l / Math.hypot(Math.PI, l); return { zeta, omega0: Math.PI / tp / Math.sqrt(1 - zeta * zeta) }; };
const MEASURED_POP = S.start?.pop_overshoot_pct > 0 && S.start?.pop_peak_s > 0 ? measuredPop(S.start.pop_overshoot_pct, S.start.pop_peak_s) : null;
const POP = MEASURED_POP
  ?? { pop: SPRING.pop, small: SPRING.settle, spring: SPRING.settle, jelly: SPRINGS.jelly }[S.motion?.overshoot?.kind]
  ?? (S.motion?.overshoot?.kind === 'drawn-key' ? 'key-pose' : 'entrance');
function curveOf(spec, dur, fallback = () => 1) { // -> { fn(p), dur }; fallback: the duration when none is given
  if (typeof spec === 'function') return { fn: spec, dur: dur ?? fallback() };
  const sp = typeof spec === 'object' ? spec : SPRINGS[spec];
  if (sp) { const s = settleTime(sp, 1e-4); return { fn: (p) => spring(p * s, sp), dur: dur ?? (sp === MEASURED_POP ? s : fallback()) }; }
  if (!CURVES[spec]) throw new Error(`unknown curve '${spec}': one of ${[...Object.keys(CURVES), ...Object.keys(SPRINGS)].join(', ')}`);
  return { fn: CURVES[spec], dur: dur ?? fallback() };
}
export const curve = (name, dur = 1) => curveOf(name, dur).fn;
const defaultCurve = (kind) => ({ translation: CARD_CURVE ?? 'camera', camera: 'camera', pop: POP, impact: 'slam' })[kind] ?? 'camera';
function entranceDur() { // the card's start.entrance_s, else the register's entrance range (registers.json, via style.js)
  const v = S.start?.entrance_s ?? S.numbers?.entrance_default_s, d = Array.isArray(v) ? (v[0] + v[v.length - 1]) / 2 : v;
  if (!(d > 0)) throw new Error('no default duration: pass dur (film/style.js names no entrance range: rerun new.py look)');
  return d;
}
// The card's motion.arrival as an entrance: where it comes from (offset px, scale, blur px) and on which curve.
function arrival(text = S.motion?.arrival ?? '') {
  const has = (w) => new RegExp(`(^|[^\\w-])${w}($|[^\\w-])`).test(text);
  if (has('from-blur')) return [{ b: 16 }, 'soft'];
  if (has('from-zero') || has('unfold')) return [{ s: 0 }, POP];
  if (has('from-oversize')) return [{ s: 1.3 }, 'entrance'];
  if (has('drop')) return [{ y: -frame.H / 4 }, 'gravity'];
  if (has('off-frame')) return [{ y: (frame.H * 3) / 5 }, 'entrance'];
  if (has('drawn-on') || has('at-size')) return [{}, 'soft'];
  return [{ y: 24, b: 4 }, 'entrance']; // no arrival named: a short rise with a defocus, on one progress value
}

// ---------------------------------------------------------------- tracks
const pose = (v = {}) => (Array.isArray(v) ? { x: v[0] ?? 0, y: v[1] ?? 0, s: v[2] ?? 1, r: 0 }
  : { x: v.x ?? 0, y: v.y ?? 0, s: v.s ?? v.scale ?? 1, r: v.r ?? v.rotate ?? 0, b: v.b ?? v.blur ?? 0 });
// The stylesheet transform's linear part (its turns, scales and skews) and its inverse, as CSS. apply() puts the helpers'
// scale, rotation and smear between inverse and linear part, after the stylesheet's transform, so they act about the
// element's own centre in frame space however the stylesheet centres, turns or flips it. null: none, or not invertible.
function linearOf(tf, px) {
  try {
    const m = new DOMMatrix();
    if (tf?.[Symbol.iterator]) { for (const c of tf) if (!(c instanceof CSSTranslate)) m.multiplySelf(c.toMatrix()); }
    else if (px && px !== 'none') m.multiplySelf(new DOMMatrix(px));
    m.m41 = m.m42 = m.m43 = 0;
    return m.isIdentity ? null : { matrix: m.toString(), inverse: m.inverse().toString() };
  } catch { return null; }
}
function rig(el) {
  if (!(el instanceof Element)) throw new Error(`expected an element, got ${el}`);
  let r = rigs.get(el);
  if (!r) {
    // The stylesheet's own transform, opacity and filter compose with the helpers'. The transform is kept as specified
    // (Typed OM): translate(-50%, -50%) stays relative to a box the web font has not sized yet. getComputedStyle's
    // pixel matrix is the fallback for preview browsers without Typed OM. The filter look.boil() puts inline on an
    // element with none (an id c2v-...) is the look's, not the element's: apply() lists the look's filters once itself.
    const inline = el.style.filter, boiled = inline.includes('#c2v-');
    if (boiled) el.style.filter = '';
    const cs = getComputedStyle(el), tf = el.computedStyleMap?.().get('transform');
    r = { el, tracks: [], base: { transform: tf ? String(tf) : cs.transform, opacity: parseFloat(cs.opacity), filter: cs.filter },
      lin: linearOf(tf, cs.transform) };
    if (boiled) el.style.filter = inline;
    if (el instanceof SVGElement && !el.hasAttribute('transform')) Object.assign(el.style, { transformBox: 'fill-box', transformOrigin: 'center' });
    rigs.set(el, r);
  }
  return r;
}
function track(type, el, t0, dur, at, ease, { kind = 'translation', signature = false, id } = {}) {
  let name = id ?? `${el.id || el.dataset.track || el.tagName.toLowerCase()}-${type}`;
  for (let n = 2; byId.has(name); n++) name = `${id ?? `${el.id || el.dataset.track || el.tagName.toLowerCase()}-${type}`}-${n}`;
  const k = { id: name, type, el, t0, dur, end: t0 + dur, kind, device: deviceOf(kind), signature, at, ease };
  analyse(k);
  const rest = at(k.end + 1);
  k.at = (t) => (t >= k.land ? rest : at(t)); // landed means at rest: a hold that starts there is still to the pixel
  const r = rig(el);
  r.tracks.push(k);
  r.tracks.sort((a, b) => a.t0 - b.t0);
  tracks.push(k);
  byId.set(name, k);
  el.dataset.blur ??= k.device;
  return k;
}
// land: where the move comes to rest (under half a delivery pixel from its end pose, opacity and blur settled); peak:
// its fastest instant, or null when its speed never rises 10% above the median (a constant-speed move has no peak).
// contact (impacts): the first instant the move comes within that half pixel of its mark or passes it, such as a
// bounce's first touch or a spring's first crossing.
function analyse(k) {
  const { w, h } = sizeOf(k.el), half = Math.max(w, h) / 2, deg = (Math.PI / 180) * half, thr = 0.5 / frame.K;
  const end = k.at(k.end + 1), dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) + Math.abs(p.s - q.s) * half + Math.abs(p.r - q.r) * deg;
  const landed = (p) => dist(p, end) < thr && Math.abs(p.o - end.o) < 0.01 && Math.abs(p.b - end.b) < 0.25;
  const step = 1 / (FPS * 8);
  k.land = k.t0;
  for (let t = k.end; t > k.t0; t -= step) if (!landed(k.at(t))) { k.land = Math.min(k.end, t + step); break; }
  if (k.kind === 'impact') k.contact = contactOf(k, thr / Math.max(thr, dist(k.at(k.t0), end)), step);
  const e = 1e-4, v = [];
  for (let i = 1; i < 240; i++) { const t = k.t0 + (k.dur * i) / 240; v.push([t, dist(k.at(t + e), k.at(t - e)) / (2 * e)]); }
  const top = v.reduce((a, b) => (b[1] > a[1] ? b : a), [k.t0, 0]), med = v.map((x) => x[1]).sort((a, b) => a - b)[v.length >> 1];
  k.peak = top[1] > 0 && top[1] > 1.1 * med ? top[0] : null;
}
// The first instant k's progress comes within tol of 1, sampled every `step`. A bounce touches its mark in a cusp
// narrower than a step, so where the progress rises and then falls between samples, the top in between is searched.
function contactOf(k, tol, step) {
  const e = k.ease, near = (t) => e(t) >= 1 - tol;
  const edge = (a, b) => { for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (near(m)) b = m; else a = m; } return b; };
  const n = Math.ceil(k.dur / step - 1e-9), ts = Array.from({ length: n + 1 }, (_, i) => Math.min(k.end, k.t0 + i * step)), es = ts.map(e);
  for (let i = 1; i <= n; i++) {
    if (es[i] >= 1 - tol) return edge(ts[i - 1], ts[i]);
    if (i >= 2 && es[i] < es[i - 1] && es[i - 1] > es[i - 2]) {
      let a = ts[i - 2], b = ts[i];
      for (let j = 0; j < 80; j++) { const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3; if (e(m1) < e(m2)) a = m1; else b = m2; }
      if (near(a)) return edge(ts[i - 2], a);
    }
  }
  return k.land;
}
const record = (k) => ({ id: k.id, type: k.type, start: r6(k.t0), end: r6(k.end), land: r6(k.land), peak: k.peak === null ? null : r6(k.peak),
  kind: k.kind, blur: k.device, ...(k.signature ? { signature: true } : {}) });
// signature(move): marks the film's one signature move, the same as passing { signature: true }.
export const signature = (k) => Object.assign(k, { signature: true });

// Entrance: from `from` ({x, y} offset px, s scale, b blur px; default from the card's motion.arrival) to the element's
// own place, opacity done by 70% of the progress, all on one progress value. Hidden before t0.
export function enter(el, t0, dur, o) {
  [dur, o] = durOpts('enter', dur, o);
  const { from, curve: c, ...opts } = o;
  t0 = when(t0);
  const [defFrom, defCurve] = arrival(), F = pose(from ?? defFrom), cv = curveOf(c ?? defCurve, dur, entranceDur);
  const ease = (t) => (t < t0 ? 0 : t >= t0 + cv.dur ? 1 : cv.fn(clamp((t - t0) / cv.dur)));
  const at = (t) => {
    if (t < t0) return { ...F, o: 0 };
    const e = ease(t);
    return { x: F.x * (1 - e), y: F.y * (1 - e), s: lerp(F.s, 1, e), r: F.r * (1 - e), o: clamp(e / 0.7), b: Math.max(0, F.b * (1 - e)) };
  };
  return track('enter', el, t0, cv.dur, at, ease, { kind: F.s !== 1 ? 'pop' : 'translation', ...opts });
}
// Exit: to `to` (default the mirror of the look's arrival), opacity gone by 70% of the progress; 70% of the entrance's
// time unless given dur. Hidden after.
export function exit(el, t0, dur, o) {
  [dur, o] = durOpts('exit', dur, o);
  const { to, curve: c = 'exit', ...opts } = o;
  t0 = when(t0, 'end');
  const [defFrom] = arrival(), Z = pose(to ?? (defFrom.s !== undefined ? { s: 0 } : { y: defFrom.y ? -defFrom.y : 0, b: defFrom.b ?? 4 }));
  const cv = curveOf(c, dur, () => 0.7 * entranceDur());
  const ease = (t) => (t <= t0 ? 0 : t >= t0 + cv.dur ? 1 : cv.fn(clamp((t - t0) / cv.dur)));
  const at = (t) => {
    if (t <= t0) return { x: 0, y: 0, s: 1, r: 0, o: 1, b: 0 };
    const e = ease(t);
    return { x: Z.x * e, y: Z.y * e, s: lerp(1, Z.s, e), r: Z.r * e, o: 1 - clamp(e / 0.7), b: Z.b * e };
  };
  return track('exit', el, t0, cv.dur, at, ease, { kind: Z.s !== 1 ? 'pop' : 'translation', ...opts });
}
// Move: from `from` to `to` ([x, y] or {x, y, s, r}, offsets from the element's own place; from null = where its last
// move ended). kind (translation, pop, camera, impact) picks the card's blur device and default curve; one move per film
// carries signature: true. An impact move adds a hit event on its first contact frame.
export function move(el, from, to, t0, dur, o) {
  [dur, o] = durOpts('move', dur, o);
  const { curve: c, kind = 'translation', ...opts } = o;
  t0 = when(t0);
  const prev = rig(el).tracks.filter((k) => k.type === 'move').at(-1);
  const A = from == null ? prev?.to ?? pose() : pose(from), B = pose(to), cv = curveOf(c ?? defaultCurve(kind), dur, entranceDur);
  const ease = (t) => (t <= t0 ? 0 : t >= t0 + cv.dur ? 1 : cv.fn((t - t0) / cv.dur));
  const at = (t) => {
    const e = ease(t);
    return { x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e), s: lerp(A.s, B.s, e), r: lerp(A.r, B.r, e), o: 1, b: 0 };
  };
  const k = track('move', el, t0, cv.dur, at, ease, { kind, ...opts });
  Object.assign(k, { from: A, to: B });
  return k;
}

// ---------------------------------------------------------------- holds
const KANA = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u, HAN = /\p{Script=Han}/u, HANGUL = /\p{Script=Hangul}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc]/gu;
// Words of space-separated scripts; Chinese, Japanese, Korean by character. ja: the Han count as Japanese (by default
// when s has kana; a caller counting part of a text passes what the whole text says).
function countText(s, c, { latin = true, cjk = true, ja = KANA.test(s) } = {}) {
  if (cjk) {
    for (const ch of s) {
      if (KANA.test(ch) || (ja && HAN.test(ch))) c.japanese_chars++;
      else if (HAN.test(ch)) c.chinese_chars++;
      else if (HANGUL.test(ch)) c.korean_syllables++;
    }
  }
  if (latin) c.latin_words += (s.replace(CJK, ' ').match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length;
}
const asElements = (x) => (x instanceof Element ? [x] : (() => { try { return [...document.querySelectorAll(x)]; } catch { return []; } })());
// Read text only: never texture text, hidden copies, or text under the read floor (CJK under the CJK floor). Counted as
// one text, however it is split into nodes, as render.mjs measures it: a word set one span per letter is one word, the
// Han of a caption with kana anywhere in it are Japanese, and white space, a <br>, the edge of a box (flex items, lines
// set as blocks), a new line, or a gap on the line of at least an eighth of the text's height (word spans spaced by a
// margin) is a word break; text under a floor is a word break in the text counted against that floor. hold() measures
// when the film is built: a span with no box then (display: none, scaled to 0) shows no gap, and render.mjs measures the
// hold again at its midpoint for the exported timeline.
const INLINE = /^(inline|inline-block|inline-flex|inline-grid|inline-table|contents|ruby.*)$/;
const blockOf = (el) => { let a = el; while (a.parentElement && a !== document.body && INLINE.test(getComputedStyle(a).display)) a = a.parentElement; return a; };
const apart = (a, b) => { // a: the last client rect of a run, b: the first of the next run in its block
  const half = Math.min(a.height, b.height) / 2;
  return b.top >= a.bottom - half || b.bottom <= a.top + half || Math.max(b.left - a.right, a.left - b.right) >= Math.max(a.height, b.height) / 8;
};
const textOrBr = { acceptNode: (n) => (n.nodeType === Node.TEXT_NODE || n.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) };
function readCounts(target) {
  const c = { latin_words: 0, chinese_chars: 0, japanese_chars: 0, korean_syllables: 0 }, els = asElements(target);
  let text = '';
  if (!els.length) { countText(String(target), c); text = String(target); } else {
    const floor = S.numbers?.text_floor_px_1080p ?? {}, range = document.createRange();
    let latin = '', cjk = '';
    const gap = () => { latin += ' '; cjk += ' '; text += ' '; };
    for (const el of els) {
      gap();
      let last = null, run = null; // the block of the last run, and its last client rect (none after a word break)
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, textOrBr);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType !== Node.TEXT_NODE || !/\S/.test(n.data)) { gap(); run = null; continue; }
        const p = n.parentElement;
        if (!p || p.closest('[data-lint="texture"],[data-lint="off"],[data-layer="texture"],[aria-hidden="true"]')) continue;
        range.selectNodeContents(n);
        const rs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        const px = parseFloat(getComputedStyle(p).fontSize), s = n.data, b = blockOf(p);
        if ((last && b !== last) || (run && rs.length && apart(run, rs[0]))) gap();
        last = b;
        if (rs.length) run = rs.at(-1);
        latin += px < (floor.read ?? 0) ? ' ' : s;
        cjk += px < (floor.cjk ?? 0) ? ' ' : s;
        text += s;
      }
    }
    countText(latin, c, { cjk: false });
    countText(cjk, c, { latin: false, ja: KANA.test(text) });
  }
  return { counts: Object.fromEntries(Object.entries(c).filter(([, v]) => v)), text: text.replace(/\s+/g, ' ').trim() };
}
const describe = (x) => (x instanceof Element ? (x.id ? `#${x.id}` : x.tagName.toLowerCase()) : String(x));
let lastT = 0;
function boxAt(target, t) { // the target's frame box [x0, y0, x1, y1] in delivery px at t (seeks, then seeks back)
  if (Array.isArray(target)) return target;
  const els = asElements(target), v = window.__video;
  if (!els.length || !v) return null;
  v.seek(t);
  const rs = els.map((el) => el.getBoundingClientRect());
  v.seek(lastT);
  return [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom))].map(Math.round);
}
// Hold: starts where `after` lands (a helper, or a time) and lasts what it is for (S10): `read` (a selector, an element or
// the words themselves) by the reading speeds in film/style.js, `chart` (a selector; its [data-value] items, or text with
// digits, are the labelled values), `logo: true`. A hold with none of these is a breath and needs `dur`; `dur` on any
// hold replaces its need (vqa then WARNs above twice the need). `alive` declares a hold whose picture keeps moving (true:
// the card's alive kind; or name a kind): vqa counts its still frames as alive-held instead of frozen (S9.4), so it is
// never a default. `box` (selector, element or [x0, y0, x1, y1]) records the read box that must stay still.
export function hold(after, { read, chart, logo, alive, box, dur, purpose } = {}) {
  const N = S.numbers?.holds, start = frameUp(shown(when(after)));
  const kind = read != null ? 'read' : chart != null ? 'chart' : logo ? 'logo' : 'breath';
  if (kind !== 'breath' && !N) throw new Error('hold(): film/style.js has no reading numbers (numbers.holds): rerun new.py look');
  let need = null, extra = {};
  if (kind === 'read') {
    const { counts, text } = readCounts(read), r = N.reading;
    need = Math.max(N.need_s.read_min, (counts.latin_words ?? 0) * r.latin_s_per_word + (counts.chinese_chars ?? 0) / r.chinese_chars_per_s
      + (counts.japanese_chars ?? 0) / r.japanese_chars_per_s + (counts.korean_syllables ?? 0) / r.korean_syllables_per_s);
    extra = { read: describe(read), read_text: text, counts };
  } else if (kind === 'chart') {
    const els = asElements(chart), items = els.flatMap((el) => [...el.querySelectorAll('[data-value]')]);
    const values = items.length || els.reduce((n, el) => n + (el.textContent.match(/\d[\d.,]*/g) ?? []).length, 0);
    need = N.need_s.chart + N.need_s.chart_per_value * values;
    extra = { chart: describe(chart), values };
  } else if (kind === 'logo') need = N.need_s.logo;
  if (need === null && !(dur > 0)) throw new Error('hold(): give it read text, a chart or a logo, or a dur for a breath');
  const h = { start: r6(start), end: r6(frameUp(start + (dur ?? need))), kind, ...(need !== null ? { need: r6(need) } : {}), ...extra };
  h.purpose = purpose ?? (kind === 'breath' ? 'breath' : `${kind}: need ${f3(need)} s`);
  const hk = S.motion?.holds ?? {}, allowed = [hk.alive].flat().filter(Boolean);
  const a = typeof alive === 'string' ? alive : alive === true && hk.kind === 'alive' ? allowed[0] ?? null : null;
  if (alive === true && !a) throw new Error(`hold({alive: true}): this look's holds are ${hk.kind ?? 'still'}; name an alive kind`);
  if (a) h.alive = a;
  const target = box ?? (a && read != null && asElements(read).length ? read : null);
  if (target != null) Object.defineProperty(h, 'read_box', { enumerable: true, get: () => boxAt(target, (h.start + h.end) / 2) });
  return h;
}

// ---------------------------------------------------------------- cues, seams, effects
// Cue: a sound on a helper's 'start', 'land' or 'peak' (its fastest instant), so retiming the move retimes the sound.
// On a stepped span each sits on the drawing that shows it ('start': the first drawing after the move starts).
// 'peak' on a move with no speed peak throws. `anchor` is the sound's own anchor for mix.py (start | peak | end | s).
export function cue(sound, of, at = 'peak', { gain = 0, pan, anchor, id } = {}) {
  const k = typeof of === 'string' ? byId.get(of) : of;
  if (!k || !tracks.includes(k)) throw new Error(`cue('${sound}'): ${typeof of === 'string' ? `no move '${of}'` : 'pass a move, enter or exit'}`);
  if (!['start', 'land', 'peak'].includes(at)) throw new Error(`cue('${sound}', '${k.id}', '${at}'): at is 'start', 'land' or 'peak'`);
  if (at === 'peak' && k.peak === null) throw new Error(`cue('${sound}', '${k.id}', 'peak'): ${k.id} moves at a constant speed, so it has no speed peak: ease it, or cue its 'start' or 'land'`);
  const t = at === 'start' ? firstShown(k.t0) : shown(at === 'land' ? k.land : k.peak);
  return { id: id ?? `${k.id}-${at}`, t: r6(t), sound, gain_db: gain, move: k.id, move_anchor: at, ...(pan !== undefined ? { pan } : {}), ...(anchor !== undefined ? { anchor } : {}) };
}
// Seam: records the device that joins two beats (S18). Without a time it takes the next scene boundary, in order.
export function seam(kind, t) { const s = { kind }; if (t !== undefined) s.t = r6(when(t, 't0')); seams.push(s); return s; }
// Flash: declares a full-frame flash effect over [t0, t0 + dur) (dur one frame unless given) and, unless overlay is
// false, draws it as a colour layer on whole frames. Shake: declares a shake and offsets `el` from a seeded table, one
// value per frame, easing off. Flashes and shakes are the only frame-to-frame variation an effect excuses; at most 3
// flashes in any second.
export function flash(t0, dur, o) {
  [dur, o] = durOpts('flash', dur, o);
  const { peak = 1, color = '#fff', overlay = true } = o;
  t0 = when(t0, 't0');
  const e = { start: r6(t0), end: r6(t0 + (dur ?? 1 / FPS)), kind: 'flash' };
  effects.push(e);
  if (overlay) {
    let el = document.querySelector(`[data-c2v-flash="${color}"]`);
    if (!el) {
      el = Object.assign(document.createElement('div'), { ariaHidden: 'true' });
      el.dataset.c2vFlash = color;
      el.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${color};opacity:0;visibility:hidden`;
      (document.getElementById('stage') ?? document.body).append(el);
    }
    flashes.push({ el, e, peak });
  }
  return e;
}
const seeded = (n, salt) => { let a = (Math.imul(n | 0, 2654435761) ^ salt) >>> 0; a = Math.imul(a ^ (a >>> 15), a | 1); a ^= a + Math.imul(a ^ (a >>> 7), a | 61); return ((a ^ (a >>> 14)) >>> 0) / 4294967296; };
export function shake(el, t0, dur, { amp = S.start?.shake_px ?? 12, seed = 5 } = {}) {
  t0 = when(t0, 't0');
  effects.push({ start: r6(t0), end: r6(t0 + dur), kind: 'shake' });
  const r = rig(el), f0 = Math.round(t0 * FPS), f1 = Math.round((t0 + dur) * FPS);
  r.tracks.push({ type: 'offset', t0, offset: (t) => {
    const f = Math.round(t * FPS);
    if (f < f0 || f >= f1) return [0, 0, 0];
    const k = amp * (1 - (f - f0) / Math.max(1, f1 - f0));
    return [k * (2 * seeded(f, seed) - 1), k * (2 * seeded(f, seed + 1) - 1), 0];
  } });
  return el;
}
// Nudge: a seeded offset per drawing (placement boil for cut-outs), never per output frame.
export function nudge(el, { px = S.start?.nudge_px ?? 1, deg = S.start?.nudge_deg ?? 0.25, seed = 9 } = {}) {
  const r = rig(el), salt = seed + 977 * rigs.size;
  r.tracks.push({ type: 'offset', t0: 0, offset: (t) => {
    const d = clock.drawing(t);
    return [px * (2 * seeded(d, salt) - 1), px * (2 * seeded(d, salt + 1) - 1), deg * (2 * seeded(d, salt + 2) - 1)];
  } });
  return el;
}

// ---------------------------------------------------------------- per frame
// The entrances and exits in effect at drawing time tc: the latest started entrance and every exit started since, so an
// exit that starts before its entrance lands leaves from where the entrance has got to; before any has started, the
// first one's own before (hidden before an entrance, shown before an exit).
function showsAt(r, tc) {
  const shows = r.tracks.filter((k) => k.type === 'enter' || k.type === 'exit'), on = shows.filter((k) => k.t0 <= tc + 1e-9);
  return on.length ? on.slice(Math.max(0, on.findLastIndex((k) => k.type === 'enter'))) : shows.slice(0, 1);
}
const compose = (list, t) => list.reduce((p, k) => {
  const q = k.at(t);
  return { x: p.x + q.x, y: p.y + q.y, s: p.s * q.s, r: p.r + q.r, o: p.o * q.o, b: Math.max(p.b, q.b) };
}, { x: 0, y: 0, s: 1, r: 0, o: 1, b: 0 });
// Sets every helper-driven element at t: position from its latest started move, its entrances and exits in effect on
// top, offsets, the clock's drawing time on stepped spans, grid snapping on a snapped clock, then the blur device from
// the active helper's travel while the shutter is open. The helpers' scale, rotation and smear act about the element's
// own centre, after the stylesheet's transform. The helpers own an element's inline transform, opacity and filter.
export function apply(t) {
  lastT = t;
  const tc = T(t), h = clock.shutter(t);
  for (const r of rigs.values()) {
    const p = { x: 0, y: 0, s: 1, r: 0, o: 1, b: 0 };
    let active = null;
    const moves = r.tracks.filter((k) => k.type === 'move'), shows = showsAt(r, tc);
    if (moves.length) {
      const m = moves.filter((k) => k.t0 <= tc + 1e-9).at(-1) ?? moves[0], q = m.at(tc);
      Object.assign(p, { x: q.x, y: q.y, s: q.s, r: q.r });
      if (tc > m.t0 && tc < m.end) active = m;
    }
    if (shows.length) {
      const q = compose(shows, tc), running = shows.filter((k) => tc > k.t0 && tc < k.end);
      p.x += q.x; p.y += q.y; p.s *= q.s; p.r += q.r; p.o *= q.o; p.b = Math.max(p.b, q.b);
      if (!active && running.length) active = { device: running.at(-1).device, at: (u) => compose(shows, u) };
    }
    for (const k of r.tracks) {
      if (k.type === 'offset') {
        const d = k.offset(t);
        p.x += d[0]; p.y += d[1]; p.r += d[2];
      }
    }
    p.x = clock.snap(p.x);
    p.y = clock.snap(p.y);
    let dx = 0, dy = 0;
    if (active) { const a = active.at(tc - h), b = active.at(tc + h); dx = b.x - a.x; dy = b.y - a.y; }
    const dev = blurFor(r.el, active?.device, dx, dy), o = clamp(r.base.opacity * p.o);
    const turn = [dev.transform, p.s !== 1 ? `scale(${+p.s.toFixed(5)})` : '', p.r ? `rotate(${+p.r.toFixed(4)}deg)` : '']
      .filter(Boolean).join(' ');
    r.el.style.transform = [`translate(${f3(p.x)}px, ${f3(p.y)}px)`, r.base.transform !== 'none' ? r.base.transform : '',
      turn && r.lin ? `${r.lin.inverse} ${turn} ${r.lin.matrix}` : turn].filter(Boolean).join(' ');
    r.el.style.opacity = String(+o.toFixed(4));
    r.el.style.visibility = o <= 0.001 ? 'hidden' : '';
    r.el.style.filter = [p.b > 0.05 ? `blur(${p.b.toFixed(2)}px)` : '', dev.filter, extraFilter(r.el), r.base.filter !== 'none' ? r.base.filter : '']
      .filter(Boolean).join(' ');
  }
  const f = Math.round(t * FPS);
  for (const { el, e, peak } of flashes) {
    const on = f >= Math.round(e.start * FPS) && f < Math.round(e.end * FPS);
    if (on || el.style.visibility !== 'hidden') Object.assign(el.style, { opacity: on ? String(peak) : '0', visibility: on ? 'visible' : 'hidden' });
  }
  applyLook(t);
}

// ---------------------------------------------------------------- the timeline
// film(timeline): completes the film's timeline object: the clock's generated steps over the whole film, the declared
// effects, the seams (untimed ones on the scene boundaries in order), every helper as a move record, the signature
// event (at the signature move's peak, or where it lands when it is fastest at its start) and a hit event on each
// impact move's first contact frame. The film's length is mountFilm's duration, set after film() returns, so the steps
// are generated when the timeline is read.
export function film(tl) {
  const scenes = [...(tl.scenes ?? [])].sort((a, b) => a.start - b.start), ends = [...scenes, ...(tl.holds ?? [])].map((x) => x.end);
  const duration = ends.length ? Math.max(...ends) : 0, bounds = scenes.slice(1).map((s) => s.start);
  const sig = tracks.filter((k) => k.signature), declared = (tl.events ?? []).filter((e) => e.signature);
  if (sig.length + declared.length > 1) throw new Error(`film(): ${sig.length + declared.length} signatures (${[...sig.map((k) => k.id), ...declared.map((e) => e.label ?? e.t)].join(', ')}): mark one`);
  let b = 0;
  const timed = seams.map((s) => {
    if (s.t !== undefined) return s;
    if (b >= bounds.length) throw new Error(`seam('${s.kind}'): no scene boundary left for it: pass its time`);
    return { ...s, t: r6(bounds[b++]) };
  });
  const events = [...(tl.events ?? [])];
  for (const k of sig) {
    const atPeak = k.peak !== null && k.peak > k.t0 + 0.15 * k.dur;
    events.push({ t: r6(shown(atPeak ? k.peak : k.land)), kind: atPeak ? 'transition' : 'land', label: k.id, signature: true });
  }
  for (const k of tracks.filter((x) => x.kind === 'impact')) events.push({ t: r6(frameUp(shown(k.contact))), kind: 'hit', label: k.id });
  const out = { ...tl, events: events.sort((x, y) => x.t - y.t), effects: [...(tl.effects ?? []), ...effects], seams: timed,
    moves: tracks.map(record) };
  const own = tl.steps ?? [];
  return Object.defineProperty(out, 'steps', { enumerable: true,
    get: () => [...own, ...clock.steps(window.__video?.duration ?? duration)] });
}
