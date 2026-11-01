#!/usr/bin/env python3
"""Load a 3D web page in headless Chromium and report what is wrong with it.

Usage:
  python3 check_page.py PAGE.html [--out DIR] [--webgpu auto|on|off] [--browser PATH] [--timeout SEC]
                        [--keys SPEC] [--drag] [--phone] [--size WxH] [--renderer auto|llvmpipe|swiftshader|native]
                        [--no-hooks] [--final]

What it does:
  * serves the page's folder on http://127.0.0.1 and opens the page in Chromium. It finds the browser itself:
    --browser, then Playwright's own lookup, then the Playwright caches ($PLAYWRIGHT_BROWSERS_PATH,
    $HOME/.cache/ms-playwright, /root/.cache/ms-playwright, ~/Library/Caches/ms-playwright), then chromium /
    google-chrome on PATH, and only then the stripped headless shell (reported, since it can break WebGPU canvases).
  * picks the renderer: on Linux Mesa's GL (llvmpipe) when libEGL_mesa is installed, else SwiftShader; elsewhere the
    machine's own GPU. Reports what this browser offers (`renderer`: the WebGL renderer string, the WebGPU adapter, the
    browser mode) apart from what the page really used (`page_api`: the context each canvas drew with, whether it asked
    for a WebGPU adapter and drew WebGPU frames, whether it read the GPU's name).
  * WebGPU: --webgpu auto (default) expects WebGPU when the page source uses it; on = the page must draw with WebGPU;
    off = hide navigator.gpu so the page's WebGL fallback runs. A page that uses WebGPU always gets
    --enable-unsafe-webgpu --enable-unsafe-swiftshader (on top of the renderer's flags), and `webgpu.adapter` in the
    report is the adapter this browser gave, or null: an environment limit, not a page defect; the WebGPU path is then
    a check not run and the other checks judge what the page drew instead (its WebGL fallback, if it has one).
    An expected WebGPU path that did not run, a scene with no WebGL or WebGPU context, and (on a software renderer) a
    page that picks a reduced tier are checks not run. When this browser lacks the API the page draws with and no
    fallback drew the canvas, or its WebGPU broke, picture verdicts become warnings: environment, not the page.
  * records console messages at every level, page errors, failed requests, WGSL compile messages with their source
    line, and WebGPU validation errors (from an `uncapturederror` listener, so the page's own error scopes still get
    their errors; errors a page catches in its own scope are not seen here).
  * watches the page with no input, then, if a start control is visible, something covers the scene or nothing
    moves, clicks the start control (or the canvas centre) like a user would. Measures on canvas-only screenshots
    (every other element hidden): blank canvas, motion (the share of pixels that changed), black share per region; and
    on the normal view: which element sits on top of the canvas at its centre and quadrant centres, and how much of the
    canvas page elements cover.
  * idle motion is not required. A canvas that stays still with no input but moves after that click, or changes with
    an input (--drag, --keys, or one drag the checker tries itself when nothing else moved), is a warning ("still
    until the player acts"; `motion.moves_after_start_only`, `motion.responded_to`, `start.before_click`), not a
    problem. Only a canvas that neither moves nor reacts is a problem.
  * --drag drags across the canvas; --keys holds keys. Each action is judged on its own against an equally long
    stretch with no input just before it; a reaction that cannot be told apart from the scene's own motion is a check
    not run, not a pass.
  * --phone runs a phone-portrait viewport with touch instead of the desktop one.
  * stops at a total deadline (--timeout, default 90 s, 180 s on SwiftShader) and always writes the JSON report, also
    after a load timeout.
  * --final is the delivery run on the exact bytes, desktop (or --size) and phone portrait in one call: a fresh browser
    context per view with nothing injected into the page, no canvas isolation and no clicks; it reports console
    messages, page errors, failed requests and plain screenshots (view_final_desktop*.png, view_final_phone*.png).
    The pixel, motion, cover and input checks belong to the instrumented runs.

Output: OUT/report.json (the full report), OUT/console.txt, OUT/view_*.png (what a user sees), OUT/canvas_*.png
(canvas only); `files` in the report lists every screenshot and each shot names its own. Default OUT:
<tmp>/check_page/<page name>. stdout is a short summary that ends with `RESULT exit=N ok=true|false ...`: problems,
warnings, checks_not_run, renderer (webgl_mode, webgpu_mode and adapter, whether the page drew with WebGPU), the
browser executable and its launch flags, input verdicts and every screenshot path. Run it without a pipe, e.g.
`python3 check_page.py PAGE --out DIR; echo exit=$?`, and read the whole summary.
Exit code: 0 = no problem found and every check ran; 1 = problems found; 2 = no problem found but some checks did
not run (`checks_not_run`): those are unknown, not passed.

Needs Python Playwright (it re-runs itself under another python3 on PATH that has it). Pillow is optional: without
it PNGs are decoded with the standard library (same numbers, a little slower).
"""
import argparse, asyncio, functools, glob, http.server, io, json, os, re, shutil, subprocess, sys, tempfile, threading, time, zlib

# A page uses WebGPU when its source asks for it; Chromium prints WGSL and GPU validation failures as warnings.
WEBGPU_RE = re.compile(r"navigator\.gpu|requestAdapter|(?<!is)WebGPURenderer|three[/.]webgpu")
GPU_ERROR_RE = re.compile(r"\[Invalid [A-Za-z]+|Error while parsing WGSL|WGSL reader failure|GPUValidationError|GL_INVALID_[A-Z_]+|"
                          r"WebGL: INVALID_|is not compatible")
# A browser whose WebGPU broke (seen with the headless shell and on some GPU boxes) logs this and presents black frames:
# an environment fault, not the page's. Only this line marks it; the invalid swap-chain textures it leaves behind are
# its symptoms, but the same CreateView message without it is a page bug.
ENV_LOST_RE = re.compile(r"A valid external Instance reference no longer exists")
ENV_SYMPTOM_RE = re.compile(r"\[Invalid Texture[^\]]*\][\s\S]{0,200}CreateView")
PICTURE_PREFIXES = ('blank:', 'motion:', 'covered:', 'black:', 'input:', 'canvas:')
# Source signs that a page picks its quality from the GPU it finds (software renderers get the low tier). Not
# failIfMajorPerformanceCaveat: three.js passes it (false) on every WebGL page; the hooks record a page that sets it.
ADAPT_SRC_RE = re.compile(r"swiftshader|llvmpipe|softpipe|isFallbackAdapter|UNMASKED_RENDERER|WEBGL_debug_renderer_info", re.I)
THREE_D_CONTEXTS = ('webgl', 'webgl2', 'webgpu')
BASE_ARGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"]
SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-vulkan=swiftshader", "--enable-features=Vulkan"]
LLVMPIPE_ARGS = ["--use-gl=angle", "--use-angle=gl-egl", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--enable-unsafe-swiftshader"]
# The minimal set that gave a WebGPU adapter (SwiftShader's) in the eval image, no Vulkan flags needed: added for every
# page that uses WebGPU, whatever the renderer, on top of the eval's own flags above.
WEBGPU_ARGS = ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader"]
MESA_DIRS = ("/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/lib64", "/usr/lib")

DESKTOP, PHONE = (1366, 768), (393, 852)
IDLE_AT = (3.0, 4.0, 9.0)   # seconds after the load event: first look, short motion pair, long motion pair
LATE_AT = 20.0              # one more look when the canvas is still blank and the page draws slowly
BLANK_STD = 6.0             # grey-level standard deviation below which a canvas counts as one flat colour
LEVELS = 24                 # a pixel "changed" when its grey level moved by more than this
MOTION_FRAC = 0.001         # share of changed pixels that counts as visible motion or a reaction
SLOW_FPS = 2.0              # below this page frame rate a "no motion" result is inconclusive
COVER_FRAC = 0.6            # share of the canvas hidden by page elements after the start click that is a problem
BLACK_LEVEL = 3             # grey level counted as black in the region check
BLACK_REGION = 0.97         # a 3x3 region this black, in both idle looks, while the canvas is not blank
BLACK_MOST = 6              # this many black regions out of 9 is a problem; fewer is a warning
MAX_PIXELS = 400_000        # analysis frames are subsampled to about this many pixels
EVAL_CAP = 10.0             # seconds one in-page call may take (30 on a software renderer)
START_RE = r"\b(start|play|begin|enter|launch|explore|continue|resume|tap|click|ready)\b|▶|►"
NOT_START_RE = r"\b(how to|help|controls|settings|options|credits|about|restart|reset|share|download|fullscreen|full screen|sound|music|audio|mute|video)\b"

HOOKS_JS = r"""
(() => {
  const S = { errors: [], gpu: [], lost: [], frames: 0, lastT: -1, adapter: undefined, contexts: [], identity: {},
              wgpu: { devices: 0, configured: 0, frames: 0 } };
  Object.defineProperty(window, '__checkPage', { value: S, enumerable: false });
  const push = (a, x) => { if (a.length < 200) a.push(x); };
  // which context each canvas really drew with (what the page used, not what the browser offers); the size is the
  // canvas size when the context was created (the drawn size is canvas.buffer in the report)
  const kinds = new WeakMap();
  S.ctxType = c => kinds.get(c) || null;
  const wrapGetContext = (P, offscreen) => {
    const g = P && P.getContext;
    if (!g) return;
    P.getContext = function (type, attrs) {
      const c = g.apply(this, arguments);
      if (c && !kinds.has(this)) {
        const t = type === 'experimental-webgl' ? 'webgl' : String(type);
        kinds.set(this, t);
        push(S.contexts, { type: t, offscreen, id: this.id || '', size_at_creation: [this.width, this.height] });
      }
      if (attrs && attrs.failIfMajorPerformanceCaveat) S.identity['getContext failIfMajorPerformanceCaveat'] = 1;
      return c;
    };
  };
  wrapGetContext(HTMLCanvasElement.prototype, false);
  if (typeof OffscreenCanvas !== 'undefined') wrapGetContext(OffscreenCanvas.prototype, true);
  const tco = HTMLCanvasElement.prototype.transferControlToOffscreen;
  if (tco) HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    kinds.set(this, 'offscreen');
    push(S.contexts, { type: 'offscreen', offscreen: true, id: this.id || '', size_at_creation: [this.width, this.height] });
    return tco.apply(this, arguments);
  };
  // the page asking which GPU it runs on: the usual way a page picks a low tier on a software renderer
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const gp = C.prototype.getParameter;
    C.prototype.getParameter = function (p) {
      if (p === 0x9245 || p === 0x9246) S.identity['WebGL ' + (p === 0x9246 ? 'UNMASKED_RENDERER' : 'UNMASKED_VENDOR')] = 1;
      return gp.apply(this, arguments);
    };
  }
  addEventListener('error', e => push(S.errors, 'uncaught error: ' + (e.message || e.type) +
    (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '')));
  addEventListener('unhandledrejection', e => { const r = e.reason;
    push(S.errors, 'unhandled rejection: ' + String(r && (r.stack || r.message) || r).slice(0, 600)); });
  const raf = window.requestAnimationFrame;
  // counts frames in which the page's own callbacks ran (one per distinct frame timestamp)
  window.requestAnimationFrame = function (cb) {
    return raf.call(window, function (t) { if (t !== S.lastT) { S.lastT = t; S.frames++; } return cb.apply(this, arguments); });
  };
  if (typeof GPUDevice === 'undefined') return;
  const info = {};  // the adapter-info getters as they were, so this script's own reads are not counted as the page's
  const AI = typeof GPUAdapterInfo !== 'undefined' ? GPUAdapterInfo.prototype : null;
  for (const k of ['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']) {
    const d = AI && Object.getOwnPropertyDescriptor(AI, k);
    if (!d || !d.get) continue;
    info[k] = d.get;
    Object.defineProperty(AI, k, { configurable: true, enumerable: d.enumerable,
                                   get() { S.identity['GPUAdapterInfo.' + k] = 1; return d.get.call(this); } });
  }
  const read = (i, k) => (i && info[k] ? info[k].call(i) : undefined);
  if (typeof GPUCanvasContext !== 'undefined') {
    const C = GPUCanvasContext.prototype, cfg = C.configure, gct = C.getCurrentTexture;
    C.configure = function () { S.wgpu.configured++; return cfg.apply(this, arguments); };
    C.getCurrentTexture = function () { S.wgpu.frames++; return gct.apply(this, arguments); };
  }
  const D = GPUDevice.prototype, csm = D.createShaderModule;
  D.createShaderModule = function (desc) {
    const m = csm.apply(this, arguments);
    try {
      m.getCompilationInfo().then(info => {
        const src = String(desc && desc.code || '').split('\n');
        for (const x of info.messages) if (x.type === 'error' || x.type === 'warning')
          push(S.gpu, { kind: 'wgsl-' + x.type, label: (desc && desc.label) || '', line: x.lineNum, col: x.linePos,
                        msg: x.message, src: (src[x.lineNum - 1] || '').trim().slice(0, 240) });
      }, () => {});
    } catch (e) {}
    return m;
  };
  for (const fn of ['createRenderPipelineAsync', 'createComputePipelineAsync']) {
    const o = D[fn];
    if (o) D[fn] = function () {
      return o.apply(this, arguments).catch(e => { push(S.gpu, { kind: fn, msg: String(e && e.message || e).slice(0, 1200) }); throw e; });
    };
  }
  const rd = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = function () {
    return rd.apply(this, arguments).then(d => {
      S.wgpu.devices++;
      d.addEventListener('uncapturederror', e => push(S.gpu, { kind: 'uncaptured', msg: String(e.error && e.error.message || e.error).slice(0, 1200) }));
      d.lost.then(i => S.lost.push({ reason: i.reason, msg: String(i.message || '').slice(0, 300) }));
      return d;
    });
  };
  const ra = GPU.prototype.requestAdapter;
  GPU.prototype.requestAdapter = function () {
    return ra.apply(this, arguments).then(a => {
      const i = a && a.info;
      S.adapter = a ? { vendor: read(i, 'vendor'), architecture: read(i, 'architecture'), description: read(i, 'description'),
                        fallback: !!read(i, 'isFallbackAdapter') } : null;
      return a;
    });
  };
})();
"""

NO_WEBGPU_JS = "(() => { try { delete Navigator.prototype.gpu; } catch (e) {} })();"

PROBE_JS = r"""async () => {
  const o = {};
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (gl) {
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      o.webgl = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      o.webgl_version = gl.getParameter(gl.VERSION);
    } else o.webgl = null;
  } catch (e) { o.webgl = null; o.webgl_error = String(e); }
  if (!navigator.gpu) { o.webgpu = null; o.webgpu_why = 'navigator.gpu is missing'; return o; }
  try {
    const a = await Promise.race([navigator.gpu.requestAdapter(), new Promise(r => setTimeout(() => r('timeout'), 8000))]);
    if (a === 'timeout') { o.webgpu = null; o.webgpu_why = 'requestAdapter did not answer in 8 s'; }
    else if (!a) { o.webgpu = null; o.webgpu_why = 'requestAdapter returned null'; }
    else { const i = a.info || {}; o.webgpu = { vendor: i.vendor, architecture: i.architecture, description: i.description,
                                                fallback: !!i.isFallbackAdapter }; }
  } catch (e) { o.webgpu = null; o.webgpu_why = String(e); }
  return o;
}"""

STATE_JS = """() => { const S = window.__checkPage; const d = document.documentElement;
  return { hooks: !!S, frames: S ? S.frames : null, errors: S ? S.errors.slice(0, 50) : [], gpu: S ? S.gpu.slice(0, 120) : [],
           lost: S ? S.lost : [], adapter: S ? (S.adapter === undefined ? 'not requested' : S.adapter) : 'no hooks', scroll_width: d.scrollWidth, inner_width: innerWidth,
           canvases: document.querySelectorAll('canvas').length, contexts: S ? S.contexts.slice(0, 20) : [],
           identity: S ? Object.keys(S.identity) : [], wgpu: S ? S.wgpu : null }; }"""

# The canvas to measure: the largest visible one, preferring a canvas that drew with WebGL or WebGPU (when the hooks know)
# over a bigger 2D overlay, unless that 3D canvas is small next to it (a minimap).
MAIN_CANVAS_JS = """() => {
  const S = window.__checkPage, kind = c => (S && S.ctxType ? S.ctxType(c) : 'unknown');
  const all = document.querySelectorAll('canvas'), seen = [];
  for (const c of all) {
    c.removeAttribute('data-check-page-main');
    const r = c.getBoundingClientRect(), s = getComputedStyle(c);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue;
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
    const a = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (a > 0) seen.push({ c, x0, y0, x1, y1, r, a, k: kind(c) });
  }
  if (!seen.length) return { count: all.length };
  let best = seen.reduce((m, o) => (o.a > m.a ? o : m));
  const d3 = seen.filter(o => ['webgl', 'webgl2', 'webgpu', 'offscreen'].includes(o.k));
  if (d3.length && !d3.includes(best)) {
    const top3 = d3.reduce((m, o) => (o.a > m.a ? o : m));
    if (top3.a >= 0.25 * best.a) best = top3;
  }
  best.c.setAttribute('data-check-page-main', '');
  const x = Math.ceil(best.x0), y = Math.ceil(best.y0);
  return { count: all.length, x, y, w: Math.floor(best.x1) - x, h: Math.floor(best.y1) - y,
           buffer: [best.c.width, best.c.height], css: [Math.round(best.r.width), Math.round(best.r.height)],
           top: Math.round(best.r.top), viewport_share: +(best.a / (innerWidth * innerHeight)).toFixed(3),
           id: best.c.id || '', context: best.k };
}"""

ISOLATE_JS = """(on) => {
  let s = document.getElementById('__check_page_isolate');
  if (on && !s) {
    s = document.createElement('style'); s.id = '__check_page_isolate';
    s.textContent = '*{visibility:hidden !important;transition:none !important}[data-check-page-main]{visibility:visible !important}';
    document.documentElement.appendChild(s);
  } else if (!on && s) s.remove();
}"""

OVERLAY_JS = """(pts) => {
  const main = document.querySelector('[data-check-page-main]');
  const desc = e => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id;
    if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.');
    return s; };
  const alpha = c => { if (!c || c === 'transparent') return 0; const m = c.match(/rgba?\\(([^)]*)\\)/); if (!m) return 1;
    const p = m[1].split(/[\\s,\\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  return pts.map(([at, x, y]) => {
    const e = document.elementFromPoint(x, y);
    if (!e) return { at, hit: 'nothing' };
    if (e === main) return { at, hit: 'canvas' };
    if (e.tagName === 'CANVAS') return { at, hit: 'other canvas', el: desc(e), paints: null };
    let paints = null;
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      if (main && n.contains(main)) break;
      const s = getComputedStyle(n);
      if (parseFloat(s.opacity) < 0.05) { paints = null; break; }
      if (alpha(s.backgroundColor) >= 0.5 || s.backgroundImage !== 'none' || /^(img|video|iframe|svg)$/i.test(n.tagName)) { paints = desc(n); break; }
    }
    const text = (e.innerText || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    return { at, hit: 'element', el: desc(e), paints, text };
  });
}"""

START_JS = """([startRe, notRe]) => {
  const re = new RegExp(startRe, 'i'), not = new RegExp(notRe, 'i');
  const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '');
  for (const e of document.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit], [onclick]')) {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) continue;
    const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length > 60 || !re.test(t) || not.test(t)) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
    if (top && (top === e || e.contains(top))) return { x, y, text: t.slice(0, 40), el: desc(e) };
  }
  return null;
}"""

OWN_FILES = ("report.json", "console.txt", "view_*.png", "canvas_*.png")


class DeadlineHit(Exception):
    pass


def first_line(e):
    t = str(e).strip()
    return (t.splitlines()[0] if t else type(e).__name__)[:300]


class Budget:
    def __init__(self, total):
        self.t0 = time.monotonic()
        self.total = total
        self.end = self.t0 + total

    def left(self):
        return self.end - time.monotonic()

    def elapsed(self):
        return round(time.monotonic() - self.t0, 1)


async def bounded(coro, budget, cap=None, reserve=4.0):
    """Await coro within the remaining budget (minus a reserve for closing and writing the report)."""
    t = budget.left() - reserve
    if cap is not None:
        t = min(t, cap)
    if t <= 0.2:
        coro.close()
        raise DeadlineHit()
    try:
        return await asyncio.wait_for(coro, t)
    except asyncio.TimeoutError:
        if budget.left() - reserve <= 0.5:
            raise DeadlineHit()
        raise


async def sleep_until(t_abs, budget, reserve=4.0):
    d = t_abs - time.monotonic()
    if d > 0:
        if budget.left() - reserve < d:
            raise DeadlineHit()
        await asyncio.sleep(d)


# --- PNG decoding -------------------------------------------------------------------------------------------------

def _swar_add(x, y, lo, hi):
    """Bytewise (x + y) mod 256 of two rows packed into big integers."""
    return ((x & lo) + (y & lo)) ^ ((x ^ y) & hi)


def _png_rows_stdlib(data):
    """Yield (width, height, bytes per pixel) then each unfiltered row of an 8-bit non-interlaced PNG."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    pos, idat, ihdr = 8, [], None
    while pos + 8 <= len(data):
        n = int.from_bytes(data[pos:pos + 4], 'big')
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b'IHDR':
            ihdr = body
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
    if ihdr is None:
        raise ValueError('PNG without IHDR')
    w, h = int.from_bytes(ihdr[0:4], 'big'), int.from_bytes(ihdr[4:8], 'big')
    depth, ctype, interlace = ihdr[8], ihdr[9], ihdr[12]
    if depth != 8 or interlace != 0 or ctype not in (0, 2, 4, 6):
        raise ValueError(f'unsupported PNG (bit depth {depth}, colour type {ctype}, interlace {interlace})')
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(b''.join(idat))
    stride = w * bpp
    lo, hi = int.from_bytes(b'\x7f' * stride, 'big'), int.from_bytes(b'\x80' * stride, 'big')
    yield w, h, bpp
    prev, i = bytes(stride), 0
    for _ in range(h):
        f, cur = raw[i], raw[i + 1:i + 1 + stride]
        i += 1 + stride
        if f == 0:
            line = bytes(cur)
        elif f == 2:
            line = _swar_add(int.from_bytes(cur, 'big'), int.from_bytes(prev, 'big'), lo, hi).to_bytes(stride, 'big')
        elif f == 1:  # running sum with a stride of one pixel, in log2(width) whole-row steps
            x, s = int.from_bytes(cur, 'big'), 8 * bpp
            while s < 8 * stride:
                x = _swar_add(x, x >> s, lo, hi)
                s *= 2
            line = x.to_bytes(stride, 'big')
        elif f in (3, 4):
            line = bytearray(cur)
            for k in range(stride):
                a = line[k - bpp] if k >= bpp else 0
                b = prev[k]
                if f == 3:
                    line[k] = (line[k] + ((a + b) >> 1)) & 255
                else:
                    c = prev[k - bpp] if k >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    line[k] = (line[k] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            line = bytes(line)
        else:
            raise ValueError(f'bad PNG filter type {f}')
        prev = line
        yield line


def grey_frame(data, crop=None, step=1):
    """Decode a PNG to a grey frame {w, h, g (bytes)}, optionally cropped (x, y, w, h in image pixels) and subsampled
    by `step`. Grey uses Pillow's 'L' weights, so the Pillow and stdlib paths give identical frames."""
    if DECODER == 'pillow':
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert('L')
        w, h, flat = im.width, im.height, im.tobytes()
        rows = (flat[y * w:(y + 1) * w] for y in range(h))
        bpp = 1
    else:
        it = _png_rows_stdlib(data)
        w, h, bpp = next(it)
        rows = it
    x0, y0, cw, ch = crop if crop else (0, 0, w, h)
    x0, y0 = max(0, min(x0, w)), max(0, min(y0, h))
    cw, ch = max(0, min(cw, w - x0)), max(0, min(ch, h - y0))
    out = bytearray()
    for y, line in enumerate(rows):
        if y < y0 or y >= y0 + ch or (y - y0) % step:
            continue
        seg = line[x0 * bpp:(x0 + cw) * bpp]
        if bpp <= 2:  # grey, or grey + alpha
            out += seg[0::bpp * step]
        else:
            sb = bpp * step
            out += bytes((r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16 for r, g, b in zip(seg[0::sb], seg[1::sb], seg[2::sb]))
    fw = len(range(0, cw, step))
    return {'w': fw, 'h': (len(out) // fw) if fw else 0, 'g': bytes(out)}


def frame_stats(f):
    g = f['g']
    n = len(g)
    if not n:
        return {'mean': None, 'std': None}
    s = sum(g)
    sq = sum(map(int.__mul__, g, g))
    mean = s / n
    return {'mean': round(mean, 1), 'std': round(max(0.0, sq / n - mean * mean) ** 0.5, 1)}


def changed_frac(a, b):
    if not a or not b or a['w'] != b['w'] or a['h'] != b['h'] or not a['g']:
        return None
    n = sum(1 for x, y in zip(a['g'], b['g']) if x - y > LEVELS or y - x > LEVELS)
    return round(n / len(a['g']), 4)


def cover_frac(user, c1, c2):
    """Share of steady canvas pixels (unchanged between two canvas-only frames) that differ in the normal view:
    the part of the canvas that page elements paint over."""
    if not (user and c1 and c2) or not (user['w'] == c1['w'] == c2['w']) or not (len(user['g']) == len(c1['g']) == len(c2['g'])):
        return None
    steady = covered = 0
    for u, a, b in zip(user['g'], c1['g'], c2['g']):
        if -LEVELS <= a - b <= LEVELS:
            steady += 1
            if u - a > LEVELS or a - u > LEVELS:
                covered += 1
    return round(covered / steady, 3) if steady else None


def white_share(f):
    g = f['g']
    return round((len(g) - len(g.translate(None, bytes(range(250, 256))))) / len(g), 3) if g else None


def region_black(f, n=3):
    """Share of black pixels in each cell of an n x n grid, row by row."""
    w, h, g = f['w'], f['h'], f['g']
    black = bytes(range(BLACK_LEVEL + 1))
    out = []
    for ry in range(n):
        for rx in range(n):
            x0, x1, y0, y1 = rx * w // n, (rx + 1) * w // n, ry * h // n, (ry + 1) * h // n
            tot = cnt = 0
            for y in range(y0, y1):
                row = g[y * w + x0:y * w + x1]
                cnt += len(row) - len(row.translate(None, black))
                tot += len(row)
            out.append(round(cnt / tot, 3) if tot else 0.0)
    return out


# --- browser discovery ----------------------------------------------------------------------------------------------

def cache_dirs():
    ds = []
    env = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if env and env != '0':
        ds.append(env)
    ds += [os.path.expanduser('~/.cache/ms-playwright'), '/root/.cache/ms-playwright', os.path.expanduser('~/Library/Caches/ms-playwright')]
    if os.environ.get('LOCALAPPDATA'):
        ds.append(os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright'))
    seen, out = set(), []
    for d in ds:
        try:
            r = os.path.realpath(d)
            if r not in seen and os.path.isdir(d):
                seen.add(r)
                out.append(d)
        except OSError:
            pass
    return out


def _rev(path):
    m = re.search(r'-(\d+)$', os.path.basename(path.rstrip('/')))
    return int(m.group(1)) if m else 0


def cache_browsers():
    """(full Chromium builds, headless shells) found in the Playwright caches, newest build first."""
    full, shells = [], []
    for d in cache_dirs():
        for sub in sorted(glob.glob(os.path.join(d, 'chromium-*')), key=_rev, reverse=True):
            for pat in ('chrome-*/chrome', 'chrome-*/*.app/Contents/MacOS/*', 'chrome-*/chrome.exe'):
                full += [p for p in sorted(glob.glob(os.path.join(sub, pat))) if os.access(p, os.X_OK)]
        for sub in sorted(glob.glob(os.path.join(d, 'chromium_headless_shell-*')), key=_rev, reverse=True):
            for pat in ('*/chrome-headless-shell', '*/headless_shell', '*/chrome-headless-shell.exe'):
                shells += [p for p in sorted(glob.glob(os.path.join(sub, pat))) if os.access(p, os.X_OK)]
    return full, shells


def path_browsers():
    out = [shutil.which(n) for n in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome')]
    if sys.platform == 'darwin':
        out.append('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    return [p for p in out if p and os.path.isfile(p) and os.access(p, os.X_OK)]


NO_BROWSER = ('no browser on this machine; static checks only: do not install one (browser-harness.md sections 1 and 8), '
              'and say in the handoff that the page was not run and how to open it')


def browser_on_machine():
    """The first Chromium or Chrome binary already on this machine (Playwright caches, then PATH), or None."""
    full, shells = cache_browsers()
    found = full + path_browsers() + shells
    return found[0] if found else None


def is_shell(path):
    return bool(path) and ('headless_shell' in path or 'headless-shell' in path)


def detect_renderer():
    if sys.platform.startswith('linux'):
        if any(os.path.exists(os.path.join(d, 'libEGL_mesa.so.0')) for d in MESA_DIRS):
            return 'llvmpipe'
        return 'swiftshader'
    return 'native'


def renderer_args(renderer):
    return BASE_ARGS + {'llvmpipe': LLVMPIPE_ARGS, 'swiftshader': SWIFTSHADER_ARGS}.get(renderer, [])


def launch_args(renderer, webgpu, extra=()):
    """Chromium flags: the eval's own for this renderer, plus the WebGPU adapter set when the page uses WebGPU."""
    args = renderer_args(renderer)
    if webgpu:
        args += [x for x in WEBGPU_ARGS if x not in args]
    return args + list(extra)


async def launch(p, a, renderer, budget, R, webgpu=False):
    """Launch the first Chromium that starts: full builds first, the headless shell last."""
    args = launch_args(renderer, webgpu, a.chromium_arg)
    cands = []
    if a.browser:
        cands.append(('--browser', a.browser))
    else:
        cands.append(('playwright default (full Chromium)', None))
        try:
            default_path = p.chromium.executable_path
        except Exception:  # noqa: BLE001
            default_path = None
        full, shells = cache_browsers()
        cands += [('playwright cache', x) for x in full if x != default_path]
        cands += [('PATH', x) for x in path_browsers()]
        cands.append(('playwright default headless shell', 'SHELL'))
        cands += [('playwright cache headless shell', x) for x in shells]
    attempts = R['browser']['attempts']
    for source, path in cands:
        shell = path == 'SHELL' or is_shell(path)
        kw = {'headless': True, 'args': (args if shell else ['--headless=new'] + args)}
        if path is None:
            kw['channel'] = 'chromium'
        elif path != 'SHELL':
            kw['executable_path'] = path
        try:
            browser = await bounded(p.chromium.launch(timeout=60000, **kw), budget, cap=60)
        except DeadlineHit:
            raise
        except Exception as e:  # noqa: BLE001
            attempts.append({'source': source, 'path': path if path not in (None, 'SHELL') else None, 'error': first_line(e)})
            continue
        R['browser'].update(source=source, path=kw.get('executable_path') or (default_path if path is None else 'playwright headless shell'),
                            version=browser.version, args=kw['args'],
                            mode='headless shell' if shell else 'full Chromium, new headless')
        return browser
    return None


# --- local server ---------------------------------------------------------------------------------------------------

def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):  # keep the browser's automatic favicon request out of the report
            if self.path.split('?')[0] == '/favicon.ico':
                self.send_response(204)
                self.end_headers()
                return
            super().do_GET()

    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# --- report ---------------------------------------------------------------------------------------------------------

def norm_key(msg):
    m = msg.split('\n')[0]
    m = re.sub(r'^(console (error|warning)|page error|uncaught error|webgpu|wgsl|error|warning)[: ]+', '', m, flags=re.I)
    m = re.sub(r'Error while parsing WGSL: :\d+:\d+ error: ', '', m)
    m = re.sub(r'\d+', '#', m)
    return m.strip().lower()[:110]


def _cut(text, n):
    t = ' '.join(str(text).split())
    return t if len(t) <= n else t[:n - 3] + '...'


def _listed(title, items, n, width):
    out = [f'{title} ({len(items)}):' if items else f'{title}: none']
    out += [f'  - {_cut(x, width)}' for x in items[:n]]
    if len(items) > n:
        out.append(f'  ... {len(items) - n} more in report.json')
    return out


def summary_lines(R):
    """The short stdout block: everything needed to act on the run, ending with the RESULT line, so `| tail` keeps the
    verdict and the problems. The full report is report.json."""
    b, rn = R.get('browser') or {}, R.get('renderer') or {}
    out = [f"check_page summary: {R.get('page')} ({R.get('mode')} run; full report {os.path.join(R.get('out') or '.', 'report.json')})"]
    if b.get('path'):
        out.append(f"browser: {b.get('path')} ({b.get('source')}; {b.get('mode')}; {b.get('version')})")
        out.append('launch args: ' + ' '.join(b.get('args') or []))
    else:
        out.append(f"browser: none launched ({len(b.get('attempts') or [])} attempt(s) in report.json browser.attempts)")
    ad = rn.get('webgpu_adapter')
    ad_s = (f"{ad.get('vendor') or '?'}/{ad.get('architecture') or '?'}" + (' fallback' if ad.get('fallback') else '')) if isinstance(ad, dict) \
        else f"null ({rn.get('webgpu_why') or 'not probed'})"
    api = R.get('page_api') or {}
    if api.get('known'):
        frames = (api.get('webgpu') or {}).get('frames_presented') or 0
        used = f"yes, {frames} WebGPU frames drawn" if frames else 'no WebGPU frame drawn'
    else:
        used = f"not recorded ({_cut(api.get('why'), 60)})" if api.get('why') else 'not recorded'
    out.append(f"renderer: webgl_mode={rn.get('webgl_mode')} webgl={_cut(rn.get('webgl'), 70)!r}; webgpu_mode={rn.get('webgpu_mode')}"
               f" webgpu_adapter={ad_s}; page uses WebGPU: {'yes' if rn.get('webgpu_page') else 'no'} ({rn.get('webgpu_reason')});"
               f" page drew with WebGPU: {used}")
    fv = R.get('final_views') or []
    if fv:
        out.append('final views: ' + '; '.join(f"{v['view']} {v['width']}x{v['height']} ("
                                               + (f"loaded in {v['load'].get('seconds')} s" if (v.get('load') or {}).get('ok') else 'did not finish loading')
                                               + f", {len(v.get('files') or [])} screenshots)" for v in fv))
    if (R.get('canvas') or {}).get('context'):
        out.append(f"measured canvas: {R['canvas'].get('context')} {R['canvas'].get('w')}x{R['canvas'].get('h')} CSS px,"
                   f" buffer {R['canvas'].get('buffer')}" + (f"; page fps {R.get('page_fps')}" if R.get('page_fps') is not None else ''))
    for x in R.get('inputs') or []:
        out.append(f"input: {x.get('action')} -> {x.get('verdict')} (changed {x.get('changed')} vs {x.get('idle_changed')} with no input;"
                   f" expected {x.get('expect')})")
    pr = (R.get('motion') or {}).get('probe')
    if pr:
        out.append(f"input (checker's own probe): {pr.get('action')} -> {pr.get('verdict')} (changed {pr.get('changed')} vs {pr.get('idle_changed')})")
    files = R.get('files') or []
    views = [f for f in files if os.path.basename(f).startswith('view_')]
    out.append(f"screenshots, what a user sees ({len(views)}; open them):" if views else 'screenshots: none')
    out += [f'  {f}' for f in views]
    canv = [os.path.basename(f) for f in files if f not in views]
    if canv:
        out.append(f"canvas-only shots (same folder): {' '.join(canv)}")
    out += _listed('warnings', R.get('warnings') or [], 6, 220)
    out += _listed('checks_not_run', [f"{x.get('check')}: {x.get('why')}" for x in R.get('checks_not_run') or []], 8, 300)
    out += _listed('problems', R.get('problems') or [], 12, 260)
    out.append(f"RESULT exit={R.get('exit_code')} ok={'true' if R.get('ok') else 'false'} problems={len(R.get('problems') or [])}"
               f" checks_not_run={len(R.get('checks_not_run') or [])} warnings={len(R.get('warnings') or [])}"
               f" elapsed={R.get('elapsed_s')}s report={os.path.join(R.get('out') or '.', 'report.json')}")
    return out


def save_png(R, out_dir, name, png):
    """Write one screenshot into OUT and list it in the report's `files`; returns the file name."""
    path = os.path.join(out_dir, name)
    with open(path, 'wb') as fh:
        fh.write(png)
    if path not in R['files']:
        R['files'].append(path)
    return name


def webgpu_mode(info, flag):
    """What WebGPU this browser offers, beside webgl_mode: swiftshader (the software adapter), native (a GPU adapter),
    none (no adapter) or off (--webgpu off hides navigator.gpu)."""
    if flag == 'off':
        return 'off'
    ad = info.get('webgpu')
    if not isinstance(ad, dict):
        return 'none'
    return 'swiftshader' if ad.get('fallback') or 'swiftshader' in f"{ad.get('vendor')} {ad.get('architecture')}".lower() else 'native'


def write_report(R, out_dir, final=True):
    try:
        text = json.dumps(R, indent=1, default=str)
    except Exception as e:  # noqa: BLE001
        text = json.dumps({'error': f'report not serialisable: {e}'})
    try:
        with open(os.path.join(out_dir, 'report.json'), 'w') as fh:
            fh.write(text + '\n')
    except OSError:
        pass
    if final:
        try:
            print('\n'.join(summary_lines(R)), flush=True)
        except Exception as e:  # noqa: BLE001  (the summary must never cost the verdict line)
            print(f"RESULT exit={R.get('exit_code')} ok={'true' if R.get('ok') else 'false'} (summary failed: {e}; see report.json)", flush=True)


def not_run(R, check, why):
    if not any(x['check'] == check for x in R['checks_not_run']):
        R['checks_not_run'].append({'check': check, 'why': why})


def env_limited(R, problems, why, also, pictures=True):
    """Move picture verdicts (unless `pictures` is False), and problems `also` matches, to warnings: the environment, not
    the page, decided them."""
    kept = []
    for rank, m in problems:
        if (pictures and m.startswith(PICTURE_PREFIXES)) or also(m):
            R['warnings'].append(f'not judged ({why}): {m}')
        else:
            kept.append((rank, m))
    if not any(m.startswith(('webgpu:', 'wgsl:')) and 'symptoms of the errors above' not in m for _, m in kept):
        kept = [(r, m) for r, m in kept if 'symptoms of the errors above' not in m]
    return kept


def page_api_verdicts(R, ctx, st):
    """What the page really drew with, kept apart from what the browser offers (the probe), and which expected paths
    did not run here."""
    if not st.get('hooks'):
        if ctx.get('hooks_off'):
            R['page_api'] = {'known': False, 'why': f"{ctx['hooks_off']}: the canvas contexts and WebGPU use were not recorded"}
        return
    wg = st.get('wgpu') or {}
    contexts = st.get('contexts') or []
    canvas = R.get('canvas') or {}
    R['page_api'] = api = {'known': True, 'measured_canvas_context': canvas.get('context'), 'contexts': contexts,
                           'webgpu': {'adapter': st.get('adapter'), 'devices': wg.get('devices'), 'configured_canvases': wg.get('configured'),
                                      'frames_presented': wg.get('frames')},
                           'gpu_identity_reads': st.get('identity') or []}
    probe = ctx.get('probe') or {}
    if ctx.get('webgpu_page') and ctx.get('webgpu_mode') != 'off' and probe.get('webgpu'):
        if st.get('adapter') is None:
            not_run(R, 'webgpu', "the page asked for a WebGPU adapter and got none here (environment); its WebGPU path was not checked")
        elif not wg.get('frames'):
            asked = 'never asked for a WebGPU adapter' if st.get('adapter') == 'not requested' else (
                'got a WebGPU adapter' + (' and device' if wg.get('devices') else '') + ' but never drew a frame into a WebGPU canvas')
            not_run(R, 'webgpu-use', f"{ctx.get('webgpu_reason')}, and this browser offers WebGPU, but the page {asked}"
                    f" (the measured canvas draws with {canvas.get('context') or 'no recorded context'}): its WebGPU path did not run. If the"
                    ' page is meant to draw with WebGPU, that is the defect; if WebGPU is only mentioned or an unused fallback, run --webgpu off')
    kinds = {c.get('type') for c in contexts}
    if canvas.get('w') and not kinds & set(THREE_D_CONTEXTS + ('offscreen',)):
        not_run(R, '3d-rendering', f"the measured canvas draws with {canvas.get('context') or 'no recorded context'} and the page created no"
                ' WebGL or WebGPU context: nothing shows the scene is rendered in 3D (a 2D canvas can fake it)')
    if ctx.get('software'):
        why = [f'reads {x}' for x in api['gpu_identity_reads']]
        if ctx.get('adapt_src'):
            why.append(f"its source checks the renderer ({ctx['adapt_src']!r})")
        buf, css = canvas.get('buffer') or [0, 0], canvas.get('css') or [0, 0]
        if (R.get('viewport') or {}).get('device_scale_factor') == 1 and css[0] >= 200 and buf[0] < 0.85 * css[0]:
            why.append(f'it draws its canvas at {buf[0]}x{buf[1]} for {css[0]}x{css[1]} CSS pixels')
        if why:
            not_run(R, 'full-quality tier', 'this browser renders in software and the page ' + '; '.join(why) + ': what ran here may be its'
                    ' reduced tier, and its full-quality tier was not tested. To test it, copy the page to /tmp, force the high tier in the'
                    ' copy (the variable or branch that picks the tier) and run check_page.py on the copy; ship the page without that switch.'
                    ' A low resolution that is the intended look needs no copy: say so in the handoff')


def finalize(R, cons, ctx):
    """Turn the collected measurements into problems, warnings and checks_not_run."""
    problems, warnings, symptoms = [], R['warnings'], 0
    st = ctx.get('state') or {}
    gpu = st.get('gpu') or []
    wgsl_errors = [g for g in gpu if g.get('kind') == 'wgsl-error']
    follow_on = re.compile(r'is invalid due to a previous error')
    for g in gpu:
        if g.get('kind') != 'wgsl-error' and (follow_on.search(g['msg']) or (wgsl_errors and 'Error while parsing WGSL' in g['msg'])):
            symptoms += 1 if follow_on.search(g['msg']) else 0
            continue  # a consequence of an earlier error, or the compile error already reported with its source line
        if g.get('kind') == 'wgsl-error':
            loc = f" (shader {g['label']!r}" if g.get('label') else ' ('
            loc += f"line {g.get('line')}:{g.get('col')})"
            problems.append((0, f"wgsl: {g['msg'].splitlines()[0]}{loc}" + (f"  <- {g['src']}" if g.get('src') else '')))
        elif g.get('kind') == 'wgsl-warning':
            R['console_warnings'].append(f"WGSL warning: {g['msg'].splitlines()[0]}")
        else:
            rank = 1 if 'While calling [Device].Create' in g['msg'] or g['kind'].endswith('Async') else 2
            problems.append((rank, f"webgpu: {' '.join(g['msg'].split())[:400]}"))
    for e in R['page_errors']:
        problems.append((1, f"page error: {e}"))
    if not R['page_errors']:  # the in-page listeners repeat what Playwright's pageerror already reported
        for e in st.get('errors') or []:
            problems.append((1, e))
    for c in cons:
        t = c['text']
        if c['type'] == 'error' or (c['type'] == 'warning' and GPU_ERROR_RE.search(t)):
            if wgsl_errors and 'Error while parsing WGSL' in t:
                continue  # already reported with its source line
            if follow_on.search(t):
                symptoms += 1
                continue
            if re.search(r'pointer ?lock', t, re.I):
                warnings.append(f"pointer lock message after the checker's click (headless): {t[:200]}")
                continue
            problems.append((2, f"console {c['type']}: {' '.join(t.split())[:400]}"))
    for fr in R['failed_requests']:
        problems.append((3, f"request failed: {fr['url']} ({fr['why']})"))
    if symptoms:
        problems.append((2, f"webgpu: {symptoms} more messages say an object 'is invalid due to a previous error': symptoms of the errors above"))
    problems += [(4, x) for x in ctx.get('visual', [])]
    lost_env = next((t for t in [c['text'] for c in cons] + [g['msg'] for g in gpu] + [x.get('msg', '') for x in st.get('lost') or []]
                     if ENV_LOST_RE.search(t)), None)
    if lost_env:  # this browser's WebGPU broke: what the canvas shows says nothing about the page; other root errors stay
        n0 = len(problems)
        problems = env_limited(R, problems, "this browser's WebGPU broke", lambda m: m.startswith('webgpu:') and bool(ENV_SYMPTOM_RE.search(m)))
        not_run(R, 'webgpu-environment', f"this browser's WebGPU broke ({' '.join(lost_env.split())[:120]}): the canvas was not checked;"
                f" {n0 - len(problems)} picture verdict(s) and symptom(s) moved to warnings, other errors kept (use a full Chromium build or --browser)")
    missing = ctx.get('api_missing')
    if missing:  # the API the page draws with does not exist in this browser: its picture is not the page's fault
        rx = re.compile(r'webgpu|adapter|navigator\.gpu|requestDevice|\bGPU' if missing == 'WebGPU' else r'webgl|context', re.I)
        # ...unless the page then drew the measured canvas with its WebGL fallback: that picture is the fallback's to answer for
        fallback = missing == 'WebGPU' and (R.get('canvas') or {}).get('context') in ('webgl', 'webgl2')
        problems = env_limited(R, problems, f'{missing} is unavailable in this browser', lambda m: bool(rx.search(m)), pictures=not fallback)
        if fallback:
            problems = [(r, m + ' (on the WebGL fallback; no WebGPU adapter here)' if m.startswith(PICTURE_PREFIXES) else m) for r, m in problems]
        if missing == 'WebGPU' and isinstance(R.get('webgpu'), dict):
            R['webgpu']['fallback_checked'] = fallback
            if st.get('hooks'):
                R['webgpu']['page_adapter'] = st.get('adapter')
    page_api_verdicts(R, ctx, st)
    # dedupe repeated messages, keep the order of root causes first
    seen, uniq = {}, []
    for rank, msg in sorted(problems, key=lambda x: x[0]):
        k = norm_key(msg)
        if k in seen:
            seen[k][1] += 1
        else:
            seen[k] = [msg, 1]
            uniq.append(k)
    R['problems'] = [seen[k][0] + (f'  (x{seen[k][1]})' if seen[k][1] > 1 else '') for k in uniq][:40]
    R['ok'] = not R['problems'] and not R['checks_not_run']
    R['exit_code'] = 1 if R['problems'] else 2 if R['checks_not_run'] else 0
    R['elapsed_s'] = ctx['budget'].elapsed()


# --- the check ------------------------------------------------------------------------------------------------------

async def run(a, R, budget, out_dir):
    global EVAL_CAP
    from playwright.async_api import async_playwright

    page_path = os.path.abspath(a.page)
    try:
        src = open(page_path, encoding='utf-8', errors='replace').read()
    except OSError as e:
        return {'budget': budget, 'visual': [f'cannot read the page: {e}'], 'state': None}, []
    if a.webgpu == 'auto':
        m = WEBGPU_RE.search(src)
        webgpu_page = bool(m)
        R['renderer']['webgpu_page'] = webgpu_page
        R['renderer']['webgpu_reason'] = f"page source contains {m.group(0)!r}" if m else 'no WebGPU use found in the page source'
    else:
        webgpu_page = a.webgpu == 'on'
        R['renderer']['webgpu_page'] = webgpu_page
        R['renderer']['webgpu_reason'] = f'--webgpu {a.webgpu}' + (' (navigator.gpu hidden: the WebGL fallback runs)' if a.webgpu == 'off' else '')
    renderer = detect_renderer() if a.renderer == 'auto' else a.renderer
    R['renderer']['webgl_mode'] = renderer
    phone = a.phone
    vw, vh = a.size or (PHONE if phone else DESKTOP)
    dpr = 2 if phone else 1
    # (name, size, device scale, touch): one view for an instrumented run, desktop and phone for --final
    views = ([('desktop', a.size or DESKTOP, 1, False), ('phone', PHONE, 2, True)] if a.final
             else [('phone' if phone else 'desktop', (vw, vh), dpr, phone)])
    R['viewport'] = {'width': views[0][1][0], 'height': views[0][1][1], 'device_scale_factor': views[0][2], 'phone': views[0][3]}
    httpd = serve(os.path.dirname(page_path))
    origin = f'http://127.0.0.1:{httpd.server_address[1]}/'
    url = origin + os.path.basename(page_path)
    R['url'] = url
    cons, pending, local_files, hosts = [], {}, set(), set()
    m = ADAPT_SRC_RE.search(src)
    ctx = {'budget': budget, 'visual': [], 'state': None, 'webgpu_page': webgpu_page, 'webgpu_mode': a.webgpu,
           'webgpu_reason': R['renderer']['webgpu_reason'], 'hooks_off': '--final' if a.final else '--no-hooks' if a.no_hooks else None, 'adapt_src': m.group(0) if m else None}
    fps = None
    try:
        async with async_playwright() as p:
            browser = await launch(p, a, renderer, budget, R, webgpu=webgpu_page)
            if browser is None:
                not_run(R, 'everything', 'no Chromium could be launched (see browser.attempts); pass one with --browser PATH'
                        + ('' if a.browser or browser_on_machine() else '; ' + NO_BROWSER))
                return ctx
            if R['browser']['mode'] == 'headless shell':
                R['warnings'].append('ran in the stripped headless shell: it can fail to present WebGPU canvases (looks like a device loss); a full Chromium build is better')
            async def new_context(size, scale, touch):
                c = await bounded(browser.new_context(viewport={'width': size[0], 'height': size[1]}, device_scale_factor=scale,
                                                      is_mobile=touch, has_touch=touch), budget, cap=30)
                if a.webgpu == 'off':
                    await c.add_init_script(NO_WEBGPU_JS)
                return c
            try:
                bctx = None if a.final else await new_context(*views[0][1:])
                # renderer probe in its own page (its own context for --final) so the checked page is untouched
                pctx = await bounded(browser.new_context(), budget, cap=30) if a.final else bctx
                probe = await bounded(pctx.new_page(), budget, cap=20)
                await probe.route('https://check-page.localhost/**', lambda r: r.fulfill(body='<!doctype html><title>probe</title>', content_type='text/html'))
                await bounded(probe.goto('https://check-page.localhost/probe'), budget, cap=20)
                info = await bounded(probe.evaluate(PROBE_JS), budget, cap=20)
                await probe.close()
                if a.final:
                    await bounded(pctx.close(), budget, cap=10)
                R['renderer'].update(offers='what this browser offers (a blank probe page); what the page used is page_api',
                                     webgl=info.get('webgl'), webgl_version=info.get('webgl_version'),
                                     webgpu_mode=webgpu_mode(info, a.webgpu), webgpu_adapter=info.get('webgpu'))
                if info.get('webgpu_why'):
                    R['renderer']['webgpu_why'] = info['webgpu_why']
                rs = f"{info.get('webgl') or ''} {json.dumps(info.get('webgpu') or {})}"
                ctx['probe'] = info
                if re.search(r'swiftshader|llvmpipe|softpipe', rs, re.I) or (info.get('webgpu') or {}).get('fallback'):
                    EVAL_CAP = 30.0
                    ctx['software'] = True
                    R['warnings'].append('software renderer: expect a few frames per second; a page that picks a quality tier from the GPU or its frame rate shows its low tier here')
                if not info.get('webgl'):
                    not_run(R, 'webgl', 'this browser could not create a WebGL context (environment); WebGL rendering was not checked')
                if webgpu_page:
                    R['webgpu'] = {'page_uses_webgpu': True, 'launch_flags': [x for x in WEBGPU_ARGS if x in R['browser'].get('args', [])],
                                   'adapter': info.get('webgpu')}
                if webgpu_page and not info.get('webgpu'):
                    R['webgpu'].update(adapter_why=info.get('webgpu_why'), environment_limit=True)
                    not_run(R, 'webgpu', f"this browser has no WebGPU adapter even with {' '.join(R['webgpu']['launch_flags'])}"
                            f" ({info.get('webgpu_why')}): an environment limit, not a page defect. The page's WebGPU path was not"
                            " checked; the other checks ran on what the page drew instead (its fallback, if it has one)")
                    ctx['api_missing'] = 'WebGPU'
                elif not webgpu_page and not info.get('webgl'):
                    ctx['api_missing'] = 'WebGL'

                clock = {'t_nav': time.monotonic(), 'view': ''}

                def on_console(m):
                    try:
                        loc = m.location or {}
                    except Exception:  # noqa: BLE001
                        loc = {}
                    cons.append({'type': m.type, 'text': m.text[:2000], 't': round(time.monotonic() - clock['t_nav'], 2), 'view': clock['view'],
                                 'at': f"{str(loc.get('url', '')).split('/')[-1]}:{loc.get('lineNumber', '')}" if loc.get('url') else ''})

                def on_request(r):
                    pending[r] = r.url
                    u = r.url
                    if u.startswith(origin):
                        path = '/' + u[len(origin):].split('?')[0]
                        if path != '/' + os.path.basename(page_path):
                            local_files.add(path)
                    elif u.startswith(('http://', 'https://')):
                        hosts.add(u.split('/')[2])

                def on_done(r):
                    pending.pop(r, None)

                def on_failed(r):
                    pending.pop(r, None)
                    why = (r.failure or 'failed')[:120]
                    if r.url.startswith(('data:', 'blob:')):
                        return
                    if 'ERR_ABORTED' in why:  # cancelled by the page or the browser, not a missing file
                        R['warnings'].append(f'request cancelled: {r.url[:200]} ({why})')
                    else:
                        R['failed_requests'].append({'url': r.url[:300], 'why': why})

                def on_response(resp):
                    if resp.status >= 400:
                        R['failed_requests'].append({'url': resp.url[:300], 'why': f'HTTP {resp.status}'})

                for vi, (vname, vsize, vscale, vtouch) in enumerate(views):
                    if a.final:  # each view gets its own fresh context
                        bctx = await new_context(vsize, vscale, vtouch)
                    page = await bounded(bctx.new_page(), budget, cap=20)
                    page.set_default_timeout(5000)
                    if not (a.no_hooks or a.final):
                        await page.add_init_script(HOOKS_JS)
                    clock.update(t_nav=time.monotonic(), view=vname if a.final else '')
                    page.on('console', on_console)
                    page.on('pageerror', lambda e: R['page_errors'].append(' '.join(str(e).split())[:600]))
                    page.on('dialog', lambda d: (R['warnings'].append(f'the page opened a {d.type} dialog: {d.message[:120]}'), asyncio.ensure_future(d.dismiss())))
                    page.on('request', on_request)
                    page.on('requestfinished', on_done)
                    page.on('requestfailed', on_failed)
                    page.on('response', on_response)

                    # load: commit first, then the load event, each bounded, so a blocked CDN still leaves a report; a
                    # slow load keeps time for the looks of this view and for the views still to come
                    load = {'ok': False}
                    if vi == 0:
                        R['load'] = load
                    keep = 12.0 if a.final else min(25.0, 0.4 * budget.total)
                    cap = lambda: min(31.0, max(2.0, budget.left() / (len(views) - vi) - keep))
                    try:
                        await bounded(page.goto(url, wait_until='commit', timeout=30000), budget, cap=cap())
                        await bounded(page.wait_for_load_state('load', timeout=30000), budget, cap=cap())
                        load.update(ok=True, seconds=round(time.monotonic() - clock['t_nav'], 1))
                    except DeadlineHit:
                        raise
                    except Exception as e:  # noqa: BLE001
                        load.update(ok=False, seconds=round(time.monotonic() - clock['t_nav'], 1), error=first_line(e),
                                    pending_requests=sorted(set(pending.values()))[:10])
                        ctx['visual'].append(f"load{f' ({vname})' if a.final else ''}: the page did not finish loading within {load['seconds']} s"
                                             + (f"; still waiting for {', '.join(load['pending_requests'][:3])}" if load['pending_requests'] else ''))
                    t_load = time.monotonic()
                    try:
                        if a.final:
                            R.setdefault('final_views', []).append({'view': vname, 'width': vsize[0], 'height': vsize[1], 'device_scale_factor': vscale,
                                                                    'touch': vtouch, 'load': load, 'files': []})
                            try:
                                await final_views(page, R, budget, out_dir, t_load, vname)
                            finally:
                                try:
                                    await asyncio.wait_for(bctx.close(), 10)
                                except Exception:  # noqa: BLE001
                                    pass
                        else:
                            fps = await check_views(page, a, R, ctx, budget, out_dir, t_load, phone, dpr)
                    except asyncio.TimeoutError:
                        not_run(R, 'page responsiveness', f"the page stopped answering the checker for {EVAL_CAP:g}+ s (a busy main thread: very slow frames"
                                " on this renderer?); the checks after that point did not run")
            except DeadlineHit:
                not_run(R, 'deadline', f'the total deadline (--timeout {a.timeout:g} s) ran out; checks after that point did not run')
            finally:
                try:
                    if 'page' in locals() and not a.final:
                        ctx['state'] = await asyncio.wait_for(page.evaluate(STATE_JS), max(2.0, min(EVAL_CAP, budget.left() + 5)))
                except Exception:  # noqa: BLE001
                    pass
                try:
                    await asyncio.wait_for(browser.close(), 10)
                except Exception:  # noqa: BLE001
                    pass
    finally:
        httpd.shutdown()
    st = ctx.get('state') or {}
    if st.get('hooks'):
        R['renderer']['page_adapter'] = st.get('adapter')
        if webgpu_page and a.webgpu != 'off' and st.get('adapter') is None:
            ctx['api_missing'] = 'WebGPU'
    for lost in st.get('lost') or []:
        if lost.get('reason') != 'destroyed':
            not_run(R, 'webgpu-device', f"the WebGPU device was lost ({lost.get('reason')}: {lost.get('msg')}); rendering after that is unknown")
    if fps is not None:
        R['page_fps'] = fps
    if st:
        R['canvases'] = st.get('canvases')
        if st.get('scroll_width', 0) > st.get('inner_width', 0) + 1:
            ctx['visual'].append(f"layout: the page is wider than the viewport ({st['scroll_width']} px > {st['inner_width']} px): horizontal scrolling")
    R['external_hosts'] = sorted(hosts)
    if local_files:
        R['warnings'].append('the page loads files next to it (' + ', '.join(sorted(local_files)[:5]) + '); opened directly from disk (file://), fetch-based loads of those fail')
    R['console_warnings'] = R['console_warnings'] + [f"{c['text'][:300]}" for c in cons if c['type'] == 'warning' and not GPU_ERROR_RE.search(c['text'])][:30]
    try:
        with open(os.path.join(out_dir, 'console.txt'), 'w') as fh:
            for c in cons[:5000]:
                fh.write((f"[{c['view']}] " if c.get('view') else '') + f"[{c['t']:7.2f}s] {c['type']}: {c['text']}"
                         + (f"  ({c['at']})" if c['at'] else '') + '\n')
            for e in R['page_errors']:
                fh.write(f'PAGEERROR: {e}\n')
    except OSError:
        pass
    return ctx, cons


async def final_views(page, R, budget, out_dir, t_load, view):
    """--final: plain screenshots of what a user sees with no input, in one view; nothing runs in the page."""
    for i, at in enumerate((IDLE_AT[0], IDLE_AT[2]), 1):
        await sleep_until(t_load + at, budget)
        png = await bounded(page.screenshot(timeout=30000), budget, cap=31)
        name = save_png(R, out_dir, f'view_final_{view}{i}.png', png)
        R['shots'][f'final_{view}{i}'] = {'at_s': round(time.monotonic() - t_load, 1), 'view': view, 'file': name}
        R['final_views'][-1]['files'].append(os.path.join(out_dir, name))


async def check_views(page, a, R, ctx, budget, out_dir, t_load, phone, dpr):
    """Idle looks, start click, drag and keys. Returns the page frame rate seen while idle (None without hooks)."""
    vis = ctx['visual']
    frames = {}
    shots = R['shots']

    async def canvas_rect():
        r = await bounded(page.evaluate(MAIN_CANVAS_JS), budget, cap=EVAL_CAP)
        R['canvas'] = r
        if not r.get('w') or not r.get('h') or r['w'] < 8 or r['h'] < 8:
            return None
        return r

    def step_for(r):
        n = r['w'] * r['h'] * dpr * dpr
        return max(1, int((n / MAX_PIXELS) ** 0.5 + 0.999))

    async def canvas_only(r, name, save=True, raw=False):
        clip = {'x': r['x'], 'y': r['y'], 'width': r['w'], 'height': r['h']}
        await bounded(page.evaluate(ISOLATE_JS, True), budget, cap=EVAL_CAP)
        try:
            png = await bounded(page.screenshot(clip=clip, timeout=30000), budget, cap=31)
        finally:
            try:
                await bounded(page.evaluate(ISOLATE_JS, False), budget, cap=EVAL_CAP, reserve=1)
            except Exception:  # noqa: BLE001
                pass
        if save:
            save_png(R, out_dir, f'canvas_{name}.png', png)
        return png if raw else grey_frame(png, step=step_for(r))

    async def user_view(r, name):
        png = await bounded(page.screenshot(timeout=30000), budget, cap=31)
        save_png(R, out_dir, f'view_{name}.png', png)
        if r is None:
            return None
        return grey_frame(png, crop=(r['x'] * dpr, r['y'] * dpr, r['w'] * dpr, r['h'] * dpr), step=step_for(r))

    async def overlay(r):
        pts = [('centre', r['x'] + r['w'] / 2, r['y'] + r['h'] / 2)]
        for name, fx, fy in (('top-left', .25, .25), ('top-right', .75, .25), ('bottom-left', .25, .75), ('bottom-right', .75, .75)):
            pts.append((name, r['x'] + r['w'] * fx, r['y'] + r['h'] * fy))
        return await bounded(page.evaluate(OVERLAY_JS, pts), budget, cap=EVAL_CAP)

    async def frame_count():
        try:
            return await bounded(page.evaluate('() => window.__checkPage ? window.__checkPage.frames : null'), budget, cap=EVAL_CAP)
        except DeadlineHit:
            raise
        except Exception:  # noqa: BLE001
            return None

    async def full_look(r, name):
        """Canvas-only frame, the normal view, and a second canvas-only frame: blank, cover and overlay at one moment."""
        c1 = await canvas_only(r, name)
        u = await user_view(r, name)
        c2 = await canvas_only(r, name + 'b', save=False)
        ov = await overlay(r)
        look = {'at_s': round(time.monotonic() - t_load, 1), 'file': f'view_{name}.png', 'canvas_file': f'canvas_{name}.png',
                **frame_stats(c1), 'clipped_white': white_share(c1), 'cover': cover_frac(u, c1, c2), 'black_regions': region_black(c1),
                'overlay': ov}
        shots[name] = look
        return c1, look

    def painted_hits(ov):
        return [o for o in ov if o.get('hit') == 'element' and o.get('paints')]

    # --- idle: no input
    await sleep_until(t_load + IDLE_AT[0], budget)
    r = await canvas_rect()
    if r is None:
        await user_view(None, 'idle1')
        shots['idle1'] = {'at_s': round(time.monotonic() - t_load, 1), 'file': 'view_idle1.png'}
        cnt = (R.get('canvas') or {}).get('count', 0)
        vis.append('canvas: no visible <canvas> on the page' if not cnt else f'canvas: {cnt} canvas element(s) but none visible in the viewport')
        not_run(R, 'pixels', 'no visible canvas, so blank, motion, cover and black-region checks did not run')
        return None
    f0 = await frame_count()
    t_f0 = time.monotonic()
    c_a, look1 = await full_look(r, 'idle1')
    frames['idle1'] = c_a
    await sleep_until(t_load + IDLE_AT[1], budget)
    frames['idle2'] = await canvas_only(r, 'idle2')
    shots['idle2'] = {'at_s': round(time.monotonic() - t_load, 1), 'canvas_file': 'canvas_idle2.png'}
    await sleep_until(t_load + IDLE_AT[2], budget)
    r = await canvas_rect() or r
    c_c, look3 = await full_look(r, 'idle3')
    frames['idle3'] = c_c
    f1 = await frame_count()
    fps = round((f1 - f0) / (time.monotonic() - t_f0), 1) if f0 is not None and f1 is not None else None
    if r.get('top', 0) > R['viewport']['height'] * 0.5:
        R['warnings'].append(f"the canvas starts {r['top']} px down the page: most of the first screen is not the scene")
    if phone and r.get('viewport_share', 1) < 0.3:
        R['warnings'].append(f"the scene fills only {int(r['viewport_share'] * 100)}% of the phone screen")
    motion = {'short': changed_frac(frames['idle1'], frames['idle2']), 'long': changed_frac(frames['idle2'], frames['idle3']),
              'whole': changed_frac(frames['idle1'], frames['idle3']), 'page_fps': fps}
    R['motion'] = {'idle': motion, 'moves_after_start_only': False}
    blank_now = look3['std'] is not None and look3['std'] < BLANK_STD
    if blank_now and (fps is None or fps < SLOW_FPS) and budget.left() > 30:
        await sleep_until(t_load + LATE_AT, budget)
        r = await canvas_rect() or r
        c_l, look_l = await full_look(r, 'late')
        frames['late'] = c_l
        blank_now = look_l['std'] is not None and look_l['std'] < BLANK_STD
    moved_idle = any((v or 0) >= MOTION_FRAC for k, v in motion.items() if k != 'page_fps')

    # --- start: click a start control, or the canvas centre when something covers it or nothing moves
    centre = look3['overlay'][0] if look3.get('overlay') else {}
    covered = centre.get('hit') == 'element' and bool(centre.get('paints')) or (look3.get('cover') or 0) >= 0.35
    start = await bounded(page.evaluate(START_JS, [START_RE, NOT_START_RE]), budget, cap=EVAL_CAP)
    started = None
    if start or covered or not moved_idle:
        x, y = (start['x'], start['y']) if start else (r['x'] + r['w'] / 2, r['y'] + r['h'] / 2)
        if phone:
            await bounded(page.touchscreen.tap(x, y), budget, cap=10)
        else:
            await bounded(page.mouse.click(x, y), budget, cap=10)
        started = (f"clicked {start['el']} {start['text']!r}" if start else 'clicked the canvas centre') + (' (tap)' if phone else '')
        R['start'] = {'action': started, 'why': 'start control visible' if start else 'canvas covered' if covered else 'no idle motion'}
        await asyncio.sleep(min(1.5, max(0.0, budget.left() - 6)))
        r = await canvas_rect() or r
        c_s, look_s = await full_look(r, 'start')
        frames['start'] = c_s
        await asyncio.sleep(min(1.5, max(0.0, budget.left() - 6)))
        frames['start2'] = await canvas_only(r, 'start2')
        shots['start2'] = {'at_s': round(time.monotonic() - t_load, 1), 'canvas_file': 'canvas_start2.png'}
        R['motion']['after_start'] = changed_frac(frames['start'], frames['start2'])
        final_look = look_s
        # what the idle looks showed before the click, so motion or a picture that needs the click does not read as idle
        R['start']['before_click'] = {'moved': moved_idle, 'blank': blank_now, 'covered': covered}
        waited = []
        if blank_now and look_s['std'] is not None and look_s['std'] >= BLANK_STD:
            waited.append('showed one flat colour')
        if not moved_idle and (R['motion']['after_start'] or 0) >= MOTION_FRAC:
            # below SLOW_FPS a still idle canvas is inconclusive, so whether the motion needed the click is unknown
            R['motion']['moves_after_start_only'] = True if fps is None or fps >= SLOW_FPS else None
            if R['motion']['moves_after_start_only']:
                waited.append('stayed still')
        if waited:
            R['warnings'].append(f"still until the player acts: with no input the canvas {' and '.join(waited)} until the checker {started}."
                                 " Fine for a game, viewer or start screen that waits for the user; a scene meant to run by itself does not wait")
    else:
        final_look = look3

    # --- verdicts on the looks
    if blank_now and (not started or (shots['start']['std'] or 0) < BLANK_STD):
        vis.append(f"blank: the canvas shows one flat colour (grey mean {final_look['mean']}, std {final_look['std']}): nothing is drawn, or it draws black/white")
    # still: no change with no input and none after the click (judged after the inputs below: it may react to them)
    still = not blank_now and not (moved_idle or (R['motion'].get('after_start') or 0) >= MOTION_FRAC)
    hits = painted_hits(final_look.get('overlay') or [])
    if hits and hits[0]['at'] == 'centre' and len(hits) >= 2:
        h = hits[0]
        vis.append(f"covered: {h['paints']} ({h.get('text') or 'no text'!r}) sits over the canvas at the centre and {len(hits) - 1} of 4 quadrant points"
                   + (f" after the checker {started}" if started else ' with no start control to click'))
    elif (final_look.get('cover') or 0) >= COVER_FRAC and not blank_now:
        vis.append(f"covered: page elements paint over {int(final_look['cover'] * 100)}% of the canvas" + (f" after the checker {started}" if started else ''))
    elif centre.get('hit') == 'element' and not centre.get('paints') and not started:
        R['warnings'].append(f"{centre['el']} catches pointer events over the canvas centre; drags there may not reach the canvas")
    if not blank_now and 'idle1' in shots and 'idle3' in shots:
        b1, b3 = shots['idle1']['black_regions'], shots['idle3']['black_regions']
        dead = [i for i in range(9) if b1[i] >= BLACK_REGION and b3[i] >= BLACK_REGION]
        names = ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right']
        where = ', '.join(names[i] for i in dead)
        if len(dead) >= BLACK_MOST and len(dead) < 9:
            vis.append(f"black: {len(dead)} of 9 regions of the canvas ({where}) stayed pure black in both idle looks and only the rest draws"
                       ' anything (a pass writing NaN or zero, a camera facing away, or a small subject on black?)')
        elif dead:  # a dark sky, night or black studio backdrop is often intended
            R['warnings'].append(f"the {where} region(s) of the canvas stayed pure black in both idle looks: intended (night, space, black"
                                 ' backdrop) or a broken pass, an unlit material or missing geometry?')

    # --- inputs the caller asked for. Each action is judged on its own: the canvas change it caused against the change
    # over an equally long stretch with no input just before it. Frames are decoded after the timed part, so the decoder's
    # speed does not stretch one interval more than the other; the settle time after an input follows the page's frame rate.
    settle = 1.0 if not fps else min(3.0, max(0.3, 2.0 / fps))

    async def act(dur, name, key):
        """Do one action (key None = drag across the canvas) and return (its change, the no-input change, record fields)."""
        t0 = time.monotonic()
        pre = await canvas_only(r, 'pre', save=False, raw=True)
        await asyncio.sleep(min(dur, max(0.0, budget.left() - 6)))
        before = await canvas_only(r, 'before', save=False, raw=True)
        t1 = time.monotonic()
        if key is None:
            x0, y0 = r['x'] + r['w'] * 0.35, r['y'] + r['h'] * 0.5
            x1, y1 = r['x'] + r['w'] * 0.7, r['y'] + r['h'] * 0.56
            if phone:
                await touch_drag(page, x0, y0, x1, y1, budget)
            else:
                await bounded(page.mouse.move(x0, y0), budget, cap=10)
                await bounded(page.mouse.down(), budget, cap=10)
                await bounded(page.mouse.move(x1, y1, steps=16), budget, cap=10)
                await bounded(page.mouse.up(), budget, cap=10)
        else:
            keys = key[0].split('+')
            for k in keys:
                await bounded(page.keyboard.down(k), budget, cap=10)
            await asyncio.sleep(min(key[1] / 1000, max(0.0, budget.left() - 6)))
            for k in reversed(keys):
                await bounded(page.keyboard.up(k), budget, cap=10)
        await asyncio.sleep(min(settle, max(0.0, budget.left() - 6)))
        after = await canvas_only(r, name, raw=True)
        t2 = time.monotonic()
        await user_view(r, name)
        pre, before, after = (grey_frame(x, step=step_for(r)) for x in (pre, before, after))
        return changed_frac(before, after), changed_frac(pre, before), {'idle_s': round(t1 - t0, 2), 'input_s': round(t2 - t1, 2),
                                                                         'file': f'view_{name}.png', 'canvas_file': f'canvas_{name}.png'}

    if a.drag or a.keys:
        R['inputs'] = []
        actions = []
        if a.drag:
            actions.append(('drag across the canvas', 'change', 0.3 + settle, 'drag', None))
        for i, (combo, ms, expect) in enumerate(parse_keys(a.keys or '')):
            actions.append((f'hold {combo} {ms} ms', expect, ms / 1000 + settle, f'key{i + 1}', (combo, ms)))
        for action, expect, dur, name, key in actions:
            change, idle_change, extra = await act(dur, name, key)
            rec = input_verdict(action, change, idle_change, vis, R, expect, slow_fps=fps if fps is not None and fps < SLOW_FPS else None)
            rec.update(extra)
            R['inputs'].append(rec)

    # --- a canvas that stayed still with no input and after the click: does it react to the user? Idle motion is not
    # required (a viewer or a game may wait for the player), so a still canvas that reacts is a warning; only one that
    # neither moves nor reacts is a problem. With no requested drag and no reaction yet, the checker tries one drag itself.
    if still:
        slow = fps is not None and 0 < fps < SLOW_FPS
        reacts = lambda x: x.get('verdict') == 'changed' or ((x.get('changed') or 0) >= MOTION_FRAC and x.get('idle_changed') is not None
                                                              and x['idle_changed'] < MOTION_FRAC)
        tried = list(R.get('inputs') or [])
        if not a.drag and not slow and not any(reacts(x) for x in tried) and budget.left() > 15:
            change, idle_change, extra = await act(0.3 + settle, 'probe_drag', None)
            R['motion']['probe'] = probe = input_verdict("drag across the canvas (the checker's own try)", change, idle_change, None, R, 'any')
            probe.update(extra)
            tried.append(probe)
        reacted = [x['action'] for x in tried if reacts(x)]
        R['motion']['responded_to'] = reacted
        still_s = f"the canvas did not change over {IDLE_AT[2] - IDLE_AT[0]:g} s with no input" + (f" or after the checker {started}" if started else '')
        if reacted:
            R['warnings'].append(f"still until the player acts: {still_s}, but it changed with: {'; '.join(reacted)}. Fine for a viewer or a"
                                 " game that waits for the user; idle motion is not required, add it only where the subject calls for it")
        elif slow:
            not_run(R, 'motion', f'the canvas did not change, but the page drew only {fps} frames per second here, too slow to tell')
        elif not tried:
            not_run(R, 'motion', f'{still_s}, and no time was left to try a drag: whether it reacts to input is unknown (run --drag or --keys)')
        else:
            vis.append(f"motion: {still_s} or with {'; '.join(x['action'] for x in tried)}: nothing moves and nothing reacts"
                       + (', and the page ran no requestAnimationFrame frame loop' if fps == 0 else f' (page frame loop {fps} fps)' if fps is not None else '')
                       + '. Idle motion is not required; if the scene should react to keys, run --keys to show it')
    return fps


def input_verdict(action, change, idle_change, vis, R, expect='change', slow_fps=None):
    """Judge one requested action against its expectation: change (default), same (no visible reaction) or any (just do
    it). A result that cannot tell the reaction apart from the scene's own motion is a check not run, never a pass; so is
    "no visible change" when the page draws too few frames per second to tell."""
    if change is None or idle_change is None:
        verdict = 'unknown'
    elif change < MOTION_FRAC:
        verdict = 'no visible change'
    elif change <= idle_change * 1.5 + 0.005:
        verdict = 'unclear: the scene changes about as much on its own'
    else:
        verdict = 'changed'
    rec = {'action': action, 'expect': expect, 'changed': change, 'idle_changed': idle_change, 'verdict': verdict}
    if expect == 'any':
        return rec
    if verdict == 'unknown':
        not_run(R, f'input: {action}', 'the canvas frames needed to measure it are missing; whether the page reacted is unknown')
    elif expect == 'change':
        if verdict == 'no visible change' and slow_fps is not None:
            not_run(R, f'input: {action}', f'the canvas did not change, but the page drew only {slow_fps} frames per second here, too slow to tell')
        elif verdict == 'no visible change' and vis is not None:
            vis.append(f'input: {action} did not change the canvas')
        elif verdict.startswith('unclear'):
            not_run(R, f'input: {action}', f'the canvas changed {change} with the input and {idle_change} with none over the same time:'
                    ' the reaction cannot be told apart from the scene\'s own motion; check it another way (pause the motion in a /tmp'
                    ' copy, or an input with a bigger effect)')
    elif verdict == 'changed' and vis is not None:  # expect == 'same'
        vis.append(f'input: {action} changed the canvas ({change} vs {idle_change} with no input); expected no visible change')
    return rec


async def touch_drag(page, x0, y0, x1, y1, budget):
    cdp = await bounded(page.context.new_cdp_session(page), budget, cap=10)
    pt = lambda x, y: [{'x': x, 'y': y, 'id': 1}]
    await bounded(cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt(x0, y0)}), budget, cap=10)
    for i in range(1, 17):
        await bounded(cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pt(x0 + (x1 - x0) * i / 16, y0 + (y1 - y0) * i / 16)}), budget, cap=10)
        await asyncio.sleep(0.02)
    await bounded(cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}), budget, cap=10)


EXPECTS = ('change', 'same', 'any')


def parse_keys(spec):
    """KEY[:MS][=change|same|any], comma-separated -> [(key, ms, expect)]."""
    out = []
    for item in [s.strip() for s in spec.split(',') if s.strip()]:
        body, eq, expect = item.rpartition('=') if '=' in item[1:] else (item, '', 'change')
        key, _, ms = body.partition(':')
        if expect not in EXPECTS or not key or (ms and not ms.isdigit()):
            raise ValueError(f'bad --keys item {item!r}: use KEY[:MS][=change|same|any]')
        out.append((key, int(ms) if ms else 500, expect))
    return out


def parse_size(s):
    m = re.fullmatch(r'(\d{3,4})x(\d{3,4})', s or '')
    if not m:
        raise argparse.ArgumentTypeError('use WxH, for example 1440x900')
    return int(m.group(1)), int(m.group(2))


DECODER = None


def pick_decoder(force_stdlib=False):
    if not force_stdlib:
        try:
            import PIL.Image  # noqa: F401
            return 'pillow'
        except Exception:  # noqa: BLE001
            pass
    try:  # the stdlib decoder must work on a real PNG before the pixel checks rely on it
        png = (b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', (2).to_bytes(4, 'big') + (1).to_bytes(4, 'big') + bytes([8, 2, 0, 0, 0]))
               + _chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\x00\x00\xff')) + _chunk(b'IEND', b''))
        globals()['DECODER'] = 'stdlib'
        f = grey_frame(png)
        return 'stdlib' if f['w'] == 2 and len(f['g']) == 2 else None
    except Exception:  # noqa: BLE001
        return None


def _chunk(kind, body):
    return len(body).to_bytes(4, 'big') + kind + body + zlib.crc32(kind + body).to_bytes(4, 'big')


def find_playwright_python(argv):
    """Re-run this script under another python3 that has Playwright when this one does not."""
    if os.environ.get('CHECK_PAGE_REEXEC') == '1':
        return
    me = os.path.realpath(sys.executable)
    for py in (shutil.which('python3'), '/usr/bin/python3', '/usr/local/bin/python3', shutil.which('python')):
        if not py or not os.path.exists(py) or os.path.realpath(py) == me:
            continue
        try:
            ok = subprocess.run([py, '-c', 'import playwright.async_api'], capture_output=True, timeout=30).returncode == 0
        except Exception:  # noqa: BLE001
            ok = False
        if ok:
            os.environ['CHECK_PAGE_REEXEC'] = '1'
            os.execv(py, [py, os.path.abspath(__file__)] + argv)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split('\n\n', 1)[1])
    ap.add_argument('page')
    ap.add_argument('--out', help='folder for report.json and screenshots (default <tmp>/check_page/<page name>)')
    ap.add_argument('--webgpu', choices=('auto', 'on', 'off'), default='auto',
                    help='auto: expect WebGPU when the page source uses it; on: the page must draw with WebGPU; off: hide navigator.gpu'
                    ' (the WebGL fallback runs). With auto or on, a WebGPU page launches with ' + ' '.join(WEBGPU_ARGS))
    ap.add_argument('--browser', help='path to a Chromium or Chrome executable')
    ap.add_argument('--timeout', type=float, help='total deadline in seconds (default 90, or 180 when only SwiftShader is available)')
    ap.add_argument('--keys', metavar='SPEC', help='keys to hold after the start, comma-separated KEY[:MS][=EXPECT], e.g. "KeyW:1500,Space=same,ArrowLeft:600,Shift+KeyW:800" '
                    '(Playwright key names, default 500 ms; EXPECT: change = the canvas must react (default), same = it must not, any = just press it)')
    ap.add_argument('--drag', action='store_true', help='drag across the canvas (touch drag with --phone)')
    ap.add_argument('--phone', action='store_true', help=f'phone portrait {PHONE[0]}x{PHONE[1]} with touch instead of desktop {DESKTOP[0]}x{DESKTOP[1]}'
                    ' (--final always checks both)')
    ap.add_argument('--size', type=parse_size, help='viewport WxH instead of the default size')
    ap.add_argument('--renderer', choices=('auto', 'llvmpipe', 'swiftshader', 'native'), default='auto',
                    help='auto: Mesa llvmpipe when installed (Linux), else SwiftShader (Linux), else the machine GPU')
    ap.add_argument('--no-hooks', action='store_true', help='no in-page instrumentation (console, errors, requests and pixels are still checked)')
    ap.add_argument('--final', action='store_true', help='delivery run on the exact bytes, desktop (or --size) and phone portrait in one call: a fresh'
                    ' browser context per view, nothing injected into the page, no canvas isolation, no clicks; reports console messages, page'
                    ' errors, failed requests and plain screenshots (view_final_desktop*.png, view_final_phone*.png)')
    ap.add_argument('--stdlib-png', action='store_true', help=argparse.SUPPRESS)  # test switch: decode PNGs without Pillow
    ap.add_argument('--chromium-arg', action='append', default=[], help=argparse.SUPPRESS)  # test switch: extra Chromium flag
    a = ap.parse_args()
    try:
        parse_keys(a.keys or '')
    except ValueError as e:
        ap.error(str(e))
    if a.final and (a.drag or a.keys or a.webgpu == 'off'):
        ap.error('--final injects nothing and gives no input: run --drag, --keys and --webgpu off as instrumented runs')
    if a.final:
        run_mode = 'final'
    else:
        run_mode = 'instrumented without hooks' if a.no_hooks else 'instrumented'
    out_dir = os.path.abspath(a.out or os.path.join(tempfile.gettempdir(), 'check_page', os.path.splitext(os.path.basename(a.page))[0]))
    os.makedirs(out_dir, exist_ok=True)
    for pat in OWN_FILES:
        for f in glob.glob(os.path.join(out_dir, pat)):
            try:
                os.remove(f)
            except OSError:
                pass
    if a.timeout is None:
        a.timeout = 180.0 if (detect_renderer() if a.renderer == 'auto' else a.renderer) == 'swiftshader' else 90.0
    budget = Budget(max(20.0, a.timeout))
    R = {'page': os.path.abspath(a.page), 'ok': False, 'exit_code': 2, 'problems': [], 'checks_not_run': [], 'warnings': [],
         'browser': {'attempts': []}, 'renderer': {}, 'png_decoder': None, 'load': None, 'canvas': None, 'shots': {}, 'files': [],
         'motion': None, 'page_errors': [], 'failed_requests': [], 'console_warnings': [], 'out': out_dir, 'deadline_s': budget.total,
         'mode': run_mode}
    if a.final:
        R['not_checked'] = 'pixels, motion, cover, black regions, inputs and page API use: those belong to the instrumented runs'
    global DECODER
    DECODER = pick_decoder(force_stdlib=a.stdlib_png)
    R['png_decoder'] = DECODER
    if DECODER is None:
        not_run(R, 'pixels', 'no PNG decoder works here (no Pillow and the standard-library decoder failed): blank, motion, cover and black-region checks did not run')

    def watchdog():
        not_run(R, 'watchdog', f'the checker was stopped {a.timeout + 30:g} s after start; the report is partial')
        R['exit_code'] = 1 if R.get('problems') else 2
        write_report(R, out_dir)
        os._exit(R['exit_code'])
    timer = threading.Timer(budget.total + 30, watchdog)
    timer.daemon = True
    timer.start()

    try:
        import playwright.async_api  # noqa: F401
    except ImportError:
        find_playwright_python(sys.argv[1:])
        found = a.browser or browser_on_machine()
        if found:
            not_run(R, 'everything', f'Python Playwright is missing here, but a browser is ({found}): add only the Python '
                    'package, only into /tmp (pip install --target /tmp/w3d-pw playwright, then PYTHONPATH=/tmp/w3d-pw); '
                    f'never run `playwright install`. This python: {sys.executable}')
        else:
            not_run(R, 'everything', NO_BROWSER)
        R['elapsed_s'] = budget.elapsed()
        write_report(R, out_dir)
        sys.exit(2)
    if not os.path.isfile(a.page):
        R['problems'] = [f'no such file: {a.page}']
        R['exit_code'] = 1
        write_report(R, out_dir)
        sys.exit(1)
    res = None
    try:
        res = asyncio.run(run(a, R, budget, out_dir))
    except DeadlineHit:
        not_run(R, 'deadline', f'the total deadline (--timeout {a.timeout:g} s) ran out')
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        not_run(R, 'checker', f'the checker failed: {type(e).__name__}: {str(e)[:300]}')
    ctx, cons = (res if isinstance(res, tuple) else (res or {'budget': budget}, []))
    if 'visual' not in ctx:
        ctx.update(visual=[], state=None)
    ctx['budget'] = budget
    finalize(R, cons, ctx)
    timer.cancel()
    write_report(R, out_dir)
    sys.exit(R['exit_code'])


if __name__ == '__main__':
    main()
