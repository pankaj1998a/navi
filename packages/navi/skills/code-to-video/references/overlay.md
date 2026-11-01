# Transparent overlays: lower thirds, titles, callouts

Adapted in part from the Remotion agent skills (MIT, © Remotion): the two alpha formats; rewritten for ffmpeg.

An overlay is laid over other picture by an editor or a web page. A film watched on its own needs no alpha.

## Set it up

- Init with `--format overlay` unless init printed `format overlay` already: the pack then skips the frozen
  share, the film has no poster, and it has no sound unless the brief asks for it (then deliver the mix as a separate
  WAV). Holds stay capped by what their words need.
- Use lib/look.js's `transparent` stage. `html` and `body` paint nothing: render.mjs exits 2 naming the property
  that does. One page serves both versions, since `window.__videoRender.alpha` is true under `--alpha`:

```html
<script>if (window.__videoRender?.alpha) document.documentElement.classList.add('alpha');</script>
<style>.alpha, .alpha body, .alpha #stage { background: transparent; }
.alpha [data-layer="ground"], .alpha [data-layer="texture"] { display: none; }</style>
```

- The first and last frames are fully transparent: the overlay arrives and leaves.
- Text must read over any footage: give it a plate, a scrim or a soft shadow.
- WebGL: `new THREE.WebGLRenderer({ alpha: true })`, `renderer.setClearColor(0x000000, 0)`, no `scene.background`.

## Render

```sh
node <skill>/scripts/render.mjs film/index.html --alpha --out renders/v1-alpha.mov
node <skill>/scripts/render.mjs film/index.html --alpha --out renders/v1-alpha.webm
```

The `.mov` is ProRes 4444 for editors (Premiere, Resolve, Final Cut); the `.webm` is VP9 with alpha for Chrome and
Firefox. Safari ignores VP9 alpha and needs HEVC with alpha, which is not covered here. Both write
`renders/v1-alpha.timeline.json`. `--alpha --frames-dir DIR` writes RGBA PNGs for a compositing app. Alpha is
straight, not premultiplied, and `--scale` downscales premultiplied, so edge pixels keep their colour.

## Review and check

- Each round, pack the alpha master itself, which the gate checks; the pack measures its layout inside the alpha box:
  `python3 -B <skill>/scripts/vqa.py pack renders/v1-alpha.mov --kind alpha --timeline renders/v1-alpha.timeline.json --out qa/v1`.
- Look at it over a light and a dark plate, and over a still of the target footage when one is supplied: give the
  page a plate that shows only without `--alpha` (`.alpha` hides it) and render `--stills` once light, once dark.
- `python3 -B <skill>/scripts/vqa.py probe renders/v1-alpha.mov --kind alpha` confirms a real alpha channel and prints
  how clear the first, middle and last frames are: the first and last must read 100% clear. To read a WebM yourself,
  put `-c:v libvpx-vp9` before ffmpeg's `-i`: its built-in VP9 decoder drops the alpha.
