# Other renderers: three.js and Blender in a film, Manim, Lottie, ffmpeg only

Manim's commands come from its docs; everything else here ran.

| Renderer | Choose it for | Timeline JSON |
|---|---|---|
| three.js inside the HTML film | a 3D hero, a product turn, a globe | the page's, as for any HTML film |
| a Blender render composited into the film | modelled, lit 3D the browser cannot draw | the page's |
| Manim Community (Python, MIT) | math, geometry, LaTeX, algorithm explainers | the scene writes it |
| Lottie through lottie-web (MIT) | a designer's After Effects (Bodymovin) animation | the page's |
| ffmpeg only | assembling supplied clips, stills and a logo | written by hand |

A timeline written outside the HTML path carries what the checks read: register, format, style, `names`, `text`, one
event marked `signature: true`, and each hold's kind (read, chart, logo or breath) with its words.

## Who owns what

- A rendered video or GIF made from code, including 3D drawn in the browser: this skill.
- Modelling, lighting or rendering in Blender, or "a video of my .blend": the blender skill. When the film also needs
  titles, sound or an edit, blender renders a PNG sequence with alpha at the film's fps and size, and this skill
  composites it (below).
- An interactive 3D page, viewer or browser game: the web3d skill.

## three.js inside the film

- Vendor `build/three.module.js` and `build/three.core.js` from the `three` package into film/ and import the module
  by a relative path: render.mjs serves only the page's folder, and nothing may load from a CDN at render time.
- Build the scene once and call `renderer.render(scene, camera)` inside `seek(t)`, nowhere else. Create the renderer
  with `preserveDrawingBuffer: true` and `setPixelRatio(1)`; drive glTF clips with `mixer.setTime(t)`; seed every random
  value; never use `setAnimationLoop`, `Clock` or `requestAnimationFrame`.
- Mark the canvas `data-layer="content"` so the checks measure it. A canvas over half the frame that only turns counts
  as alive, not as moving: add changes of scale, framing and cut.
- `--speed` and `--lint` cannot see inside a canvas: put read text in HTML over it, and judge canvas motion on frames.
- Software WebGL (the default) is deterministic and fine for light scenes; heavy ones: troubleshooting.md.

## A Blender render in the film

Ask blender for a PNG sequence with alpha at the film's size and fps (`FPS` in film.js; `$FPS` below), numbered
from 1, in film/blender/. Load the frames by index in the page, keeping them in the render and its content pass:

```js
const img = document.querySelector('#blender'); // an <img> inside the stage
const FIRST = 1, START = 2.0, COUNT = 120; // film time START shows frame FIRST
function seekBlender(t) { // + 1e-6: t × FPS can land just under a whole number
  const k = Math.min(COUNT - 1, Math.max(0, Math.floor((t - START) * FPS + 1e-6)));
  img.style.visibility = t < START ? 'hidden' : 'visible';
  img.src = `blender/${String(FIRST + k).padStart(4, '0')}.png`;
  return img.decode();
}
```

Return its promise from `seek(t)`. An ffmpeg overlay after the render suits only a film whose render wrote no
`content_pass` (no ambient layers), since the content pass cannot see a later overlay:

```sh
ffmpeg -i renders/v3.mp4 -framerate $FPS -start_number 1 -i film/blender/%04d.png -filter_complex "[1:v]setpts=PTS+2.0/TB[b];[0:v][b]overlay=0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[v]" -map "[v]" -c:v libx264 -preset slow -crf 18 -movflags +faststart renders/v3-comp.mp4
```

`setpts` starts it 2.0 s in; its last frame holds. Mix, mux and pack `v3-comp.mp4`.

## Manim Community (documented, not run)

- Iterate with `manim -ql scene.py Film` (480p, 15 fps), `-s` for the last frame, `-n 3,5` for animations 3 to 5;
  final: `manim -qh scene.py Film --fps 30` (`-r 1080,1920` for 9:16). Add `--disable_caching` if a render looks
  stale.
- Determinism: `--seed 1`; nothing reads the clock. `MathTex` needs LaTeX.
- `Text` falls back silently when Pango cannot find a family: register vendored files at the top of `construct()`
  (`with register_font("fonts/inter-700.ttf"): …`) and delete `media/texts/` after changing a face.
- Keep Manim silent and mix from the timeline: build it in the scene from `self.time` after each `play()` and
  `wait()`, with the keys above plus `width`, `height`, `fps` and `duration`, and write
  `renders/<scene>.timeline.json` from a full render, never an `-n` range.

## Lottie

Inside the HTML page, with lottie-web vendored into film/: `lottie.loadAnimation({container, renderer: "svg", loop:
false, autoplay: false, animationData})`; resolve `ready` after its `DOMLoaded` event; in `seek(t)` call
`anim.goToAndStop((t - start) * anim.frameRate, true)`. Frames count from the file's in-point, and seeks outside it
hold the first or last frame (lottie-web 5.13). Never call `play()`.

## ffmpeg only

```sh
ENC="scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
ffmpeg -v error -y -loop 1 -framerate 30 -t 2 -i card.png -vf "${ENC}" -c:v libx264 -preset slow -crf 18 card2.mp4
ffmpeg -v error -y -i a.mp4 -i b.mp4 -filter_complex "[0:v]fps=30,settb=AVTB,format=yuv420p[a];[1:v]fps=30,settb=AVTB,format=yuv420p[b];[a][b]xfade=transition=fade:duration=0.5:offset=3.5,${ENC}[v]" -map "[v]" -c:v libx264 -preset slow -crf 18 -movflags +faststart joined.mp4
```

- In zsh keep the braces in `${ENC}`: `$ENC[v]` is an array subscript.
- `xfade` needs one size, rate, pixel format and timebase, hence the per-input `fps=30,settb=AVTB,format=yuv420p`; its
  offset is the earlier clips' length minus the fades so far.
- Trim with `-ss A -to B` before `-i`, re-encoding. Keep picture and sound apart and mux the mix once: joined AAC clips
  drifted 32 ms.
- Write the timeline by hand: scenes from the edit list, an event at each cut or dissolve midpoint, holds with their
  kind.
