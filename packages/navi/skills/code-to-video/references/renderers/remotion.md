# Remotion

Adapted in part from the Remotion agent skills (MIT, © Remotion); rewritten.

Remotion renders React components frame by frame. Its API moves monthly: run `npx remotion versions` and read the
current docs before relying on a detail below. Remotion was not run for this file; the timeline export was.

## When, and the licence

- Choose it when the project already uses it, the user asks, or you need its platform (renders at scale, a `<Player>`
  in a web app); otherwise the HTML path does the job with no licence gate.
- Licence (`LICENSE.md` in the Remotion repository): free for individuals, companies of up to 3 employees, non-profits
  and evaluation; any other company needs a company licence. Rendered videos are not restricted. Tell the user before
  you build a company project on it.

## Invariants

- **Frame-driven only.** Every animated value is a function of `useCurrentFrame()` and `useVideoConfig().fps`. CSS
  transitions and animations, Tailwind `animate-*`, React Three Fiber's `useFrame()` and clock-driven shaders render as
  flicker or freeze. Randomness comes from `random(seed)`, never `Math.random()`.
- **Clamp:** `interpolate(frame, [a, b], [from, to], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing})`;
  it is unclamped by default.
- **Springs.** `spring({frame, fps, config})` steps its physics in seconds of timeline time, with damping ratio
  ζ = damping / (2·√(stiffness·mass)). The default (damping 10, stiffness 100) is ζ 0.5, a 16% overshoot: set it on
  purpose. Any ζ of 1 or more renders as critical damping at ω₀ = √(stiffness/mass) (Remotion's `spring-utils.ts`),
  so damping past critical changes nothing; lower the stiffness to slow it. `Easing.spring(config)` inside
  `interpolate` keeps only the curve's shape, stretched over the span.
- **Local time.** Children of a `<Sequence>` count frames from 0; give each `premountFor={fps}`. `<TransitionSeries>`
  transitions overlap their neighbours: the total is the sequences minus the transitions.
- **Ready before capture.** Wrap async loads in `delayRender()` and `continueRender()` (`cancelRender(err)` on
  failure; each wait times out after 30 s, `--timeout` in ms). Load fonts with `@remotion/fonts` from `public/` through
  `staticFile()` (CJK subsets: cjk.md); `@remotion/google-fonts` needs the network at render time.
- **Media sets durations:** size compositions from probed media in `calculateMetadata`, at the composition's fps.
- **WebGL:** `--gl=angle` and `preserveDrawingBuffer: true`, or frames come out blank; heavy scenes `--concurrency=1`.
- **Studio's rules** (inline `interpolate()`, no constants) serve its visual editor and fight the one timeline module:
  follow them only when a human will edit in Studio.

## Render (documented, not run here)

```sh
npx remotion still Film renders/still-90.png --frame=90 --scale=0.5
npx remotion render Film renders/v1-range.mp4 --frames=90-179 --scale=0.5
npx remotion render Film renders/v1.mp4 --codec=h264 --crf=18 --x264-preset=slow --pixel-format=yuv420p --image-format=png --color-space=bt709 --muted
```

- `--color-space=bt709`: v4's default equals BT.601 and shifts brand colours on HD players. `--image-format=png`:
  intermediate frames are JPEG at quality 80 by default.
- `--muted`: `mix.py` makes the sound, mastered by register as for every renderer.
- Alpha: `--image-format=png --pixel-format=yuva444p10le --codec=prores --prores-profile=4444` (`.mov`) or
  `--image-format=png --pixel-format=yuva420p --codec=vp9` (`.webm`; not vp8), then overlay.md.
- Probe every render: `python3 -B <skill>/scripts/vqa.py probe renders/v1.mp4` (`--kind alpha` for an alpha render,
  `--kind prores` for a ProRes 422 HQ master).

## One timeline, exported for the pack and the gate

Keep `src/timeline.ts` as plain data in seconds, with no imports; compositions import it, and a Node script exports it.
It carries what the checks read: register, format, style, the brief's exact `names` and `text`, one event marked
`signature: true`, and each hold's kind (read, chart, logo or breath) with its words.

```ts
// src/timeline.ts: seconds only, plain data, no imports
export const FPS = 30;
export const TIMELINE = {
  width: 1920, height: 1080, fps: FPS, duration: 8.0, register: "neutral", format: "promo", style: "open",
  names: ["Acme"], text: ["Ship on Friday"],
  scenes: [{ id: "open", start: 0, end: 3.2, label: "Title" }, { id: "demo", start: 3.2, end: 8.0, label: "Demo" }],
  holds: [{ start: 2.2, end: 3.2, kind: "read", read_text: "Ship on Friday" }],
  events: [{ t: 1.2, kind: "hit", label: "title lands", signature: true }, { t: 3.2, kind: "cut", label: "to demo" }],
  cues: [{ id: "title-hit", t: 1.2, sound: "impact", gain_db: -13, anchor: "peak" }],
  music: null,
};
export const f = (s: number): number => Math.round(s * FPS); // every from and durationInFrames goes through f
```

```js
// scripts/export-timeline.mjs: node scripts/export-timeline.mjs renders/v1.mp4 -> renders/v1.timeline.json
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TIMELINE } from "../src/timeline.ts";
const out = (process.argv[2] ?? "renders/out.mp4").replace(/\.[^.\/]+$/, "") + ".timeline.json";
const snap = (t) => Math.round(t * TIMELINE.fps) / TIMELINE.fps;
const tl = { version: 1, ...TIMELINE,
  scenes: TIMELINE.scenes.map((s) => ({ ...s, start: snap(s.start), end: snap(s.end) })),
  events: TIMELINE.events.map((e) => ({ ...e, t: snap(e.t) })) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(tl, null, 2) + "\n");
```

Node 22.18 (or 23.6) and newer imports `.ts` without flags. In compositions, `durationInFrames={f(TIMELINE.duration)}`
and per scene `<Sequence from={f(s.start)} durationInFrames={f(s.end) - f(s.start)} premountFor={FPS}>`: rounding each
boundary, not each length, keeps scenes contiguous.

Render into `video-work/<slug>/renders/` so the pack, the ledger and the gate find each round, then mix, mux and pack:

```sh
python3 -B <skill>/scripts/mix.py renders/v1.timeline.json --kit sound/kit --out sound/mix.wav --stem sound/sfx-stem.wav --video renders/v1.mp4 --mux renders/v1-final.mp4
python3 -B <skill>/scripts/vqa.py pack renders/v1-final.mp4 --timeline renders/v1.timeline.json --sfx-stem sound/sfx-stem.wav --kit sound/kit --out qa/v1
```

Only render.mjs writes a content pass, so here the pack measures the delivered picture, where a drifting background
reads as motion: give the film real changes of scale, framing and cut instead.

## Pitfalls

| Symptom | Fix |
|---|---|
| a visualizer jumps inside a `<Sequence>` | pass the parent's frame down |
| wrong length after an fps change | use `useVideoConfig().fps`, never `* 30` |
| a "5 s" trim came out 10 s | `-ss 5 -to 10 -i in`, re-encoding |
| brand colours shifted | `--color-space=bt709 --image-format=png` |
| a Lambda render differs after an upgrade | redeploy the function and the site together |
| Chromium will not launch inside an agent sandbox | render from a normal shell (troubleshooting.md) |
