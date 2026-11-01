# Troubleshooting: setup, hangs, sandboxes, renders

## Setup

`new.py init` exits 1 with one line per missing tool and its install command: pass them to the user and stop. Never
install system packages or use sudo. From the work folder, `node <skill>/scripts/render.mjs --doctor` re-checks the
render side and ends `doctor: ready`:

| Row | Means |
|---|---|
| `npm` | Bun 1.x answers as npm and gets its own install line |
| `playwright-core` | MISSING prints the install line for this folder; a line naming `<skill>` is a bug |
| `browser` | `--browser`, else `$CHROME`, else the newest Playwright shell or Chromium, `.c2v/browsers` included, else system Chrome |
| `launch` | FAILED inside an agent sandbox: below |
| `webgl` | SwiftShader (software GL) or ANGLE Metal (GPU) |

## A command is silent

render.mjs prints progress at least every 10 s, and the Python scripts stop a stuck child themselves (exit 3), so two
silent minutes mean a hang. Check CPU first: `ps -o pid,ppid,pcpu,etime,command -p <PID>`, and its children with
`pgrep -P <PID>`; a child at 0% CPU for minutes is stuck. Save the PID of every long background command
(`… & echo $! > render.pid`), stop it by that PID (`kill $(cat render.pid)`), then any leftover child by its PID.
Never `pkill` or `killall` by name. On a slow host or a long film, `C2V_CHILD_TIMEOUT=<seconds>` replaces every
child's limit: set it above the one the error printed.

## Motion blur

A blur average that fails twice leaves its frame sharp with a WARN; later blur frames then stay sharp, and the
closing summary lists each sharp fast frame with its speed and the fix: lengthen the move, keep its easing, re-time
its cue. Never make a hero move linear to dodge blur. The card's directional and smear devices are drawn in the
page and need no ffmpeg.

## Sandboxed, offline and read-only hosts

- **macOS agent sandboxes** kill Chromium at start-up (`launch FAILED … browser has been closed`, or
  `Permission denied (1100)` in the browser log): add `--chrome-arg --single-process` to every render.mjs call,
  `--doctor` included. `listen EPERM … 127.0.0.1`: the sandbox forbids render.mjs's local page server; ask the user to
  allow local binding, or to run outside the sandbox.
- **Offline:** only setup needs the network (`new.py init --offline` checks and installs nothing); fonts are vendored
  and the sound kit is synthesized.
- **Read-only skill folder:** work only in `video-work/<slug>/`; new.py refuses a work folder inside `<skill>`, and
  Python runs with `-B`.

## A sound-only edit

Copy the reviewed render and its content pass to the next version, rewrite only its timeline, then mix and mux:

```sh
cp renders/v2.mp4 renders/v3.mp4
[ -f renders/v2.content.mkv ] && cp renders/v2.content.mkv renders/v3.content.mkv
node <skill>/scripts/render.mjs film/index.html --timeline-only --out renders/v3.mp4
python3 -B <skill>/scripts/mix.py renders/v3.timeline.json --kit sound/kit --out sound/mix.wav --stem sound/sfx-stem.wav --video renders/v3.mp4 --mux renders/v3-final.mp4
```

`--timeline-only` exits 1 when the frame count, size or rate changed, and never compares pixels: re-render after any
visual edit. The remux is a new version with its own pack.

## Render problems

| Symptom | Fix |
|---|---|
| an element stuck at its start or end | no CSS transitions: set every property from `t` |
| motion missing, or different each render | no clock, loop, timer or `Math.random()`: derive from `t`, seed randomness |
| scaled text goes soft | no `will-change` on elements whose scale animates |
| text pops in mid-film | load every face and weight in `ready` |
| slow drift or hairlines crawl | animate `transform`, not `left` or `top`; `--scale 2` for that shot |
| two renders differ | `render.mjs film/index.html --check-determinism 0-5` counts differing frames; pin one browser and one GL backend |
| WebGL at about a frame a second | on macOS `--chrome-arg --use-angle=metal`; one backend per project |
| page cropped at another size | size the stage from `window.__videoRender` |

## 4K

Render with `--width 3840 --height 2160`: lib/look.js scales `#stage` by `frame.K` (2 here) to draw the 1080p
layout. Give canvases K× backing stores and images K× pixels. Not `--chrome-arg --force-device-scale-factor=2`:
canvases stretch and `--timeline-only` refuses the render.
