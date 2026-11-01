// lib/time.js: pure timing helpers. Every function maps a time or a progress value to a value;
// nothing reads a clock (SKILL T1). Times are seconds; progress p runs 0..1.
// Adapted in part from video-shotcraft (Apache-2.0, © Wei Yihao); rewritten.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Linear blend of numbers or same-length arrays of numbers.
export const lerp = (a, b, p) => (Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * p) : a + (b - a) * p);

// CSS cubic-bezier(x1, y1, x2, y2) as a function p -> eased p (Newton steps, bisection fallback).
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (s) => ((ax * s + bx) * s + cx) * s;
  const y = (s) => ((ay * s + by) * s + cy) * s;
  const dx = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - p;
      if (Math.abs(err) < 1e-7) return y(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = p;
    while (hi - lo > 1e-7) {
      if (x(s) < p) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

// Curve tokens: a menu of named curves. Pick one set per film.
export const EASE = {
  entrance: cubicBezier(0.16, 1, 0.3, 1),      // arrivals that stop with authority (C4)
  soft: cubicBezier(0.22, 1, 0.36, 1),         // secondary arrivals, text reveals, follow-through
  exit: cubicBezier(0.4, 0, 1, 1),             // leaving: moves from its first frame; 60-75% of the entrance time
  camera: cubicBezier(0.62, 0, 0.16, 1),       // camera moves and repositioning: asymmetric in-out
  slam: cubicBezier(0.32, 0, 0.67, 0),         // accelerate into contact (about t^3), then SPRING.settle
  mechanical: (p) => clamp(p),                 // scan lines, progress bars, marquees: linear
  overshoot: cubicBezier(0.34, 1.45, 0.64, 1), // lands about 6.6% past its mark (C7)
  anticipate: cubicBezier(0.5, -0.32, 0.25, 1),// winds up about 5% first, then goes
  symmetric: cubicBezier(0.65, 0, 0.35, 1),    // A<->B toggles, loops, pendulums
};

// Spring presets: damping ratio zeta and natural frequency omega0 (rad/s).
export const SPRING = {
  settle: { zeta: 0.7, omega0: 13.15 },  // +4.6% overshoot, within 1% after 0.5 s
  pop: { zeta: 0.45, omega0: 14.63 },    // +20.5% overshoot, within 1% after 0.6 s
  glide: { zeta: 1.0, omega0: 11.06 },   // no overshoot, within 1% after 0.6 s
};

// Eased progress of one window: 0 before `start`, 1 after `start + dur`.
export const progress = (t, start, dur, easing = EASE.mechanical) => easing(clamp((t - start) / dur));

// A response that must share an event's frame (same-frame hits): progress() is still 0 on frame T, so
// this starts half a frame early and is already moving on frame T itself (12% of a 0.6 s `soft` move at 30 fps).
// Half a frame, not a whole one: render.mjs --motion-blur averages subframes up to 0.25 frame past frame T - 1, and a
// whole frame's lead ghosted the response into it. Pass the film's rate; the default reads window.__video (set by
// mountFilm), else 30.
export const respond = (t, T, dur, easing = EASE.entrance, fps = globalThis.__video?.fps ?? 30) =>
  progress(t, T - 0.5 / fps, dur, easing);

// Clamped keyframes: interpolate(t, [0, 1, 2.5], [0, 120, 80], EASE.camera). `easing` is one function
// for every segment or an array with one per segment; values may be numbers or arrays of numbers.
export function interpolate(t, times, values, easing = EASE.mechanical) {
  const n = times.length;
  if (t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let i = 1;
  while (t > times[i]) i++;
  const e = Array.isArray(easing) ? easing[i - 1] : easing;
  return lerp(values[i - 1], values[i], e((t - times[i - 1]) / (times[i] - times[i - 1])));
}

// Analytic damped spring from 0 to 1, starting at rest at t = 0 (seconds since the spring started).
// Pass a SPRING preset or { zeta, omega0 }; to retime a spring, scale omega0 (settle time ~ 1/omega0).
export function spring(t, { zeta = 0.7, omega0 = 13.15 } = {}) {
  if (t <= 0) return 0;
  const w = omega0, z = zeta;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const r = Math.sqrt(z * z - 1), r1 = -w * (z - r), r2 = -w * (z + r);
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

// Seconds until spring() stays within `tol` of 1: plan the hold after a spring from this.
export function settleTime(opts = {}, tol = 0.002) {
  const dt = 1 / 240;
  let lastOut = 0;
  for (let t = 0; t < 10; t += dt) if (Math.abs(1 - spring(t, opts)) > tol) lastOut = t;
  return lastOut + dt;
}

// Progress of item i in a staggered group: each item runs `dur` s, `step` s after the previous one
// (C5: words 0.1-0.13 s apart, list items about 0.33 s apart). Starts overlap; nothing waits.
export const stagger = (t, i, { start = 0, step = 0.1, dur = 0.5, easing = EASE.entrance } = {}) =>
  progress(t, start + i * step, dur, easing);

// Follow-through: the same motion `delay` seconds later, e.g. a child 2-4 frames behind its parent.
export const lag = (fn, delay) => (t) => fn(t - delay);

// A drawing clock by hand: t snapped down to the start of its drawing when each drawing shows for `every` frames at
// `fps` (2 = on twos). Pose a stepped element from held(t, ...) instead of t; declare the span in `steps` with the same
// `every` (lib/look.js's clock does both from the card).
export const held = (t, every, fps) => (Math.floor((t * fps) / every + 1e-6) * every) / fps;

// The frame beat k lands on: beat 1 on frame `phase`, then one beat every fps x 60 / bpm frames, rounded to a whole
// frame. A move that lands on a beat ends its progress exactly there:
// progress(t, beatFrame(...) / fps - dur, dur, ...).
export const beatFrame = (k, bpm, phase, fps) => Math.round(phase + ((k - 1) * fps * 60) / bpm);

// Seeded PRNG (mulberry32). Draw values once at setup in a fixed order, never inside seek().
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
