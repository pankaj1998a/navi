# Browser harness: find the browser, run the page, read every message, look at it

Read this at gate R. The goal is a repeatable loop: load the exact file in Chromium, capture everything the page
says, drive it with real input, save screenshots, and open them.

## 1. Find a browser before deciding there is none

`scripts/check_page.py` is the runtime check already on hand: it installs nothing, and it looks for a browser
itself: `--browser PATH` if given, then Playwright's own lookup, then `$PLAYWRIGHT_BROWSERS_PATH`,
`$HOME/.cache/ms-playwright`, `/root/.cache/ms-playwright` (the agent's `HOME` may differ from the one Playwright
was installed under), then the usual names on `PATH`. Run it first. Only if it reports that no browser was found,
look by hand:

```bash
python3 -c "import playwright, sys; print('py-playwright', playwright.__file__)"
ls -d ${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent} ~/.cache/ms-playwright /root/.cache/ms-playwright \
      ~/Library/Caches/ms-playwright 2>/dev/null                           # Playwright's browser cache
command -v chromium chromium-browser google-chrome google-chrome-stable
node -e "require('playwright'); console.log('node-playwright')" 2>/dev/null
```

- A failed `command -v chromium` only means nothing of that name is on `PATH`. A `playwright` command on `PATH`
  (often `/usr/local/bin/playwright`) means Playwright is installed, and its Chromium is in the cache. A cache with a
  `chromium-<build>` directory is a usable Chromium: its binary is `chromium-<build>/chrome-linux*/chrome` on Linux
  or the app bundle inside it on macOS. Pass it with `--browser`. Run as root, it needs `--no-sandbox` when you
  start it yourself.
- Do not install a browser. If check_page.py and the look above find none, use section 8 (static checks only) and
  say in the handoff that the page was not run. If a browser is there but Python Playwright is not, add only the
  Python package, and only into `/tmp`: `python3 -m pip install --target /tmp/w3d-pw playwright`, then run
  check_page.py with `PYTHONPATH=/tmp/w3d-pw`. Never run `playwright install`.
- If the user said they will open or check the page themselves, or declined verification, skip all of this and say
  the page was not run.

## 2. The check script

The scripts are in the `scripts/` folder next to SKILL.md (`<skill-dir>` is the path read_skill returned). Run each
command without a pipe (no `| tail`, no `| head`), so the exit code and the end of the output cannot be cut off:

```bash
python3 <skill-dir>/scripts/check_page.py page.html --out /tmp/w3d/r1; echo exit=$?   # desktop, WebGPU auto-detected
python3 <skill-dir>/scripts/check_page.py page.html --phone --out /tmp/w3d/p1; echo exit=$?       # phone portrait
python3 <skill-dir>/scripts/check_page.py page.html --drag --out /tmp/w3d/r2; echo exit=$?        # also drag
python3 <skill-dir>/scripts/check_page.py page.html --keys SPEC --out /tmp/w3d/r3; echo exit=$?   # hold keys
python3 <skill-dir>/scripts/check_page.py page.html --webgpu off --out /tmp/w3d/f1; echo exit=$?  # WebGL fallback
python3 <skill-dir>/scripts/check_page.py page.html --final --out /tmp/w3d/d1; echo exit=$?       # delivery run
```

It serves the page over localhost itself, picks the renderer (Mesa's GL when it exists, else SwiftShader), enables
WebGPU when the page source uses it (`--webgpu auto|on|off`), and stops at a total deadline (`--timeout SEC`). It
writes a JSON report even when the page never finishes loading. The report gives:
- the renderer string, the WebGPU adapter and the browser mode it ran in;
- console messages at every level, page errors, failed requests and GPU validation errors;
- `page_api`: what the page really used (the context each canvas drew with, whether it drew WebGPU frames), kept
  apart from what the browser offers;
- canvas-only screenshots with blank and motion measures (the share of pixels that changed between shots), what
  element sits on top of the canvas at its centre and quadrants, and the black share per region;
- `checks_not_run`: checks it could not complete, for example `webgpu` (no adapter here, so the WebGPU path was
  not checked), `webgpu-use` (the page was expected to draw with WebGPU and did not), `3d-rendering`, `full-quality
  tier` (the page picked a lower tier on this renderer), `input: <action>` (a reaction it could not tell apart from
  the scene's own motion). These are unknown, not passed.

Exit 0 means no problem and nothing inconclusive; anything else means there is something to fix or to check another
way. Screenshots land in `--out`. Open them: numbers do not replace looking.

`--keys` takes `KEY[:MS][=change|same|any]` per key, so each key is checked on its own (`--help` has examples).

The default runs instrument the page (they watch its frame loop, shader creation and GPU device, and isolate the
canvas for the pixel checks) to find causes. `--final` is the delivery run: a fresh browser context with nothing
injected into the page, no canvas isolation and no clicks, reporting only console messages, page errors, failed
requests and plain screenshots (`view_final*.png`); it makes no pixel, motion or input verdicts. Run it last, after
the cleanup in gate D, at both sizes.

## 3. Renderers and flags

check_page.py picks the flags itself, and its report lists the exact set each run used (`browser.args` in
`report.json`): copy that set into your own scripts so they see what check_page.py saw. The sets it uses:

| Situation | Flags check_page.py adds |
|---|---|
| Every run | `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgl --no-sandbox --disable-dev-shm-usage` |
| Linux with Mesa's EGL (llvmpipe, much faster than SwiftShader for WebGL) | `--use-gl=angle --use-angle=gl-egl --enable-features=Vulkan --use-vulkan=swiftshader --enable-unsafe-swiftshader` |
| Linux without Mesa | `--use-angle=swiftshader --enable-unsafe-swiftshader --use-vulkan=swiftshader --enable-features=Vulkan` |
| A machine with a real GPU | nothing more |
| A page that uses WebGPU, on any machine | `--enable-unsafe-webgpu --enable-unsafe-swiftshader` (the set that gives a SwiftShader adapter without a GPU) |

- Without those two flags Chromium reports no WebGPU adapter on a machine without a GPU. The report's
  `webgpu.adapter` is the adapter this browser gave, or null. If it is null, say so, keep testing the fallback
  (`--webgpu off`), and spend no more than a few minutes trying other flags.
- A stand-in validator (naga, wgpu-py, a regex or a read-through) is not Chrome's WGSL compiler. Only a Chromium run
  with a WebGPU adapter has run the WebGPU path.
- Use the full Chromium build ("new headless"; Playwright `channel='chromium'`) for WebGPU pages. The stripped
  headless shell can create a device but fail to present the canvas, which looks like a device loss.
- Read the renderer line before blaming the page. The people who open the page have a GPU: never lower its default
  quality, shadows, antialiasing or effects to suit this slow renderer. Shadows and heavy post-processing cost a
  lot on a software renderer; measure them, and keep them in the default. If the page picks a lower tier on this
  renderer (`full-quality tier` under `checks_not_run`), force the full tier in a copy under `/tmp/w3d/` and look at
  that copy's screenshots; the delivered file keeps its own default.
- Software rendering is slow: WebGL at a handful of frames a second, heavy WebGPU scenes slower. Wait longer before
  screenshots and do not conclude "frozen" from two frames close together; below about 2 fps a motion verdict is
  uncertain, so check that the frame loop is running instead.

## 4. Your own views and inputs

check_page.py covers the default view and simple input. To look at the subject from every side, drive the page
with a short Playwright script of your own:

```python
import asyncio, sys
from playwright.async_api import async_playwright
# copy browser.args from a check_page.py report.json; this is its Linux set without Mesa (section 3)
FLAGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox',
         '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--use-vulkan=swiftshader', '--enable-features=Vulkan']
async def main(url, out):
    async with async_playwright() as p:
        # full Chromium (new headless); for a cache binary, pass executable_path=... instead of channel, and add
        # '--headless=new' to FLAGS
        b = await p.chromium.launch(channel='chromium', args=FLAGS)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        log = []
        pg.on('console', lambda m: log.append(f'[{m.type}] {m.text}'))       # keep warnings: WGSL errors are warnings
        pg.on('pageerror', lambda e: log.append(f'[pageerror] {e}'))
        pg.on('requestfailed', lambda r: log.append(f'[requestfailed] {r.url}'))
        await pg.goto(url, wait_until='commit', timeout=30000)
        await pg.wait_for_timeout(6000)
        canvas = pg.locator('canvas').first
        box = await canvas.bounding_box()
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        async def drag(dx, dy):                           # orbit by dragging from the centre
            await pg.mouse.move(cx, cy); await pg.mouse.down()
            await pg.mouse.move(cx + dx, cy + dy, steps=12); await pg.mouse.up()
            await pg.wait_for_timeout(1000)
        await canvas.screenshot(path=f'{out}/start.png')
        await drag(box['width'] / 3, 0); await canvas.screenshot(path=f'{out}/side.png')
        await pg.get_by_role('button', name='Explode').click()                 # a feature, through the UI
        await canvas.screenshot(path=f'{out}/explode.png')
        print('\n'.join(log)); await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2]))
```

- Orbit all the way round the subject and look from above (and from below where the camera can go); zoom with
  `pg.mouse.wheel(0, 400)` to each zoom limit.
- Cinematic, scripted or preset-driven pages: wait for each beat the brief names, or reach it through the page's own
  timeline, preset or lighting controls, and take a screenshot at each one.
- Keys: `await pg.keyboard.down('KeyW')`, wait, `keyboard.up('KeyW')`; hold long enough for the measured frame rate.
- Touch: `b.new_context(viewport=..., has_touch=True, is_mobile=True)`, then `pg.touchscreen.tap(x, y)`.
- Buttons and sliders: click by role or text, set range inputs with `fill` or by dispatching `input` events.
- Pointer lock: headless Chromium can report huge bogus `movementX/Y` spikes. Filter implausible deltas in the page,
  and keep drag-to-look for when lock is unavailable.
- Audio: an `AudioContext` starts suspended until a user gesture. Never let the render or game loop wait on it.

## 5. Screenshots of WebGPU canvases

A headless screenshot of a WebGPU canvas can come out blank or stale even when the page renders. Before changing
the page:
1. Check the state: frames advancing, no device errors, `device.lost` not fired.
2. Read the pixels back in a test copy: render the final pass into a texture with `COPY_SRC`,
   `copyTextureToBuffer` with `bytesPerRow` rounded up to 256, map the buffer, swap B and R if the canvas format is
   `bgra8unorm`, and draw the pixels into a 2D canvas before taking the screenshot.
3. Or check composition through the page's WebGL fallback (`check_page.py --webgpu off`), then confirm WebGPU
   separately by its error-free run.
4. Under software WebGPU, frames can queue faster than they render; dropping submits while one is in flight makes
   captures current.

## 6. Testing without shipping test code

- Test every feature through the page's own controls: that is the path a user has. A feature that only works from
  code or the console is missing.
- If you need internal state (a score, a mode) to understand a failure, add a hook in a copy under `/tmp/w3d/` and
  test the copy; the delivered file keeps no `window.__*` hooks and no test-only URL switches unless the brief asks
  for an API.
- Route randomness through a seeded generator so a failing run can be repeated.

## 7. Sizes

Check a desktop window and a phone in portrait with touch; vary the exact sizes between runs (for example a wide
laptop and a narrow phone). In each, the canvas is visible without scrolling, the subject unobstructed, and
`document.documentElement.scrollWidth <= innerWidth`.

## 8. When no browser can be used

1. If `node` exists, extract each inline module script and run `node --check --input-type=module < script.js` on
   it (a plain `.js` file passes module syntax errors silently). Without node, re-read the scripts for duplicate
   declarations and unbalanced brackets.
2. If `node` exists, run the script through initialisation and a few animation frames with a small DOM and canvas
   stub (`document`, `window`, a `requestAnimationFrame` that really invokes the callback, `getContext` returning a
   no-op proxy). This catches runtime exceptions in setup and the first frames.
3. WGSL cannot be validated this way: run `scripts/wgsl_lint.py`, go through the trap table in webgpu-wgsl.md, keep
   shaders multi-line, and prefer the WebGL path if the brief allows it.
4. In the handoff, say the page was not rendered, which checks did run, and how to open it (the file path, or
   `python3 -m http.server` in its folder and the URL).

A served page logs a favicon 404 unless it has `<link rel="icon" href="data:,">`; harmless, but it keeps the console
clean when someone serves the file.
