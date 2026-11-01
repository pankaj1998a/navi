# WebGPU and WGSL: choose the path, initialise safely, avoid the traps, find the root error

Read this before writing a WebGPU page or any WGSL, and again when a run reports a WGSL or validation message.
The browser's compiler is the truth: everything here helps you get to a clean run in fewer rounds, and section 7
tells you how to see the real error when the console only shows symptoms.

## 1. Choose the rendering path

| Brief says | Use |
|---|---|
| nothing about the API | three.js `WebGLRenderer`. Mature, fastest to get right, runs on software GL. |
| "WebGPU", "TSL", "compute", node materials, but no hand-written WGSL demanded | three.js `WebGPURenderer` with TSL. It falls back to WebGL2 by itself when no adapter exists. |
| "genuine WebGPU + WGSL", "write the shaders in WGSL", "no libraries" | Raw WebGPU with hand-written WGSL, plus a real fallback (a WebGL2 path, or a designed 2D or static view that says what is missing). |

Pin one exact three.js version and write code for that version only; addon files, renamed classes and removed
constants differ between releases. Any failed CDN request (a 404 on a build or addon file) is a page bug: fix the
path, never ship it.

**WebGL import map** (r160):

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
```

**WebGPURenderer import map** (r180 ships both `three.webgpu.js` and `three.tsl.js`):

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.webgpu.js",
  "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.webgpu.js",
  "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.tsl.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"
} }
</script>
```

- Map `"three"` to the WebGPU build too, so addons that import `'three'` do not load a second copy.
- r160 has no WebGPU build at all. Older WebGPU releases such as r170 have `three.webgpu.js` but no `three.tsl.js`
  (there `three/tsl` maps to `three.webgpu.js`). If you pin anything other than r180, check the console for 404s.
- Initialise with `await renderer.init()` before manual render or compute calls, or drive the loop with
  `renderer.setAnimationLoop`, which waits for init.
- Not available under `WebGPURenderer`: `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and the classic
  `EffectComposer` passes. Use node materials and TSL. Post-processing is node-based: `PostProcessing` with
  `pass(scene, camera)` in r180 (renamed `RenderPipeline` in later releases), bloom from
  `three/addons/tsl/display/BloomNode.js`. Ignore older snippets that import `three/addons/nodes/Nodes.js`.
- `PointsMaterial.size` is ignored under `WebGPURenderer`: points draw one pixel wide. For sized points use
  sprites or instanced quads. On any renderer, points without a `map` draw as hard squares: give them a soft round
  sprite texture and look at a close screenshot.
- Some renderer helpers differ (for example `renderer.capabilities.getMaxAnisotropy()` is a WebGL-renderer API).
  When you change the pinned version, read the console: three.js prints deprecation and removal warnings.

## 2. A safe raw-WebGPU init

Most WebGPU failures arrive asynchronously, not as a thrown exception: a WGSL compile error, a validation error
reported through `uncapturederror`, a lost device. A fallback that starts only from `try { await init() } catch`
never runs for them, and the page ships a blank canvas. Switch on all of them:

```js
let canvas = document.querySelector('canvas');     // `let`, not `const`: toFallback swaps in a fresh canvas
let rafId = 0, gpuDevice = null, switched = false; // keep rafId set to the latest requestAnimationFrame id
function toFallback(why, isError = true) {
  if (switched) return;
  switched = true;
  try {
    (isError ? console.error : console.info)('Switching to the fallback: ' + why);   // log, never swallow
    cancelAnimationFrame(rafId);                   // stop the WebGPU frame loop
    gpuDevice?.destroy();
    // a canvas that already holds a WebGPU context cannot give a 'webgl2' or '2d' context: use a fresh one
    const fresh = document.createElement('canvas');
    fresh.id = canvas.id;
    fresh.className = canvas.className;
    canvas.replaceWith(fresh);
    canvas = fresh;
    startFallback(canvas, why);                    // the WebGL2 path, or a designed view that says what is missing
  } catch (err) {
    console.error('The fallback failed to start:', err);   // a failure here must never be silent
  }
}
async function initGPU() {                         // the WebGPU objects, or null once the fallback has taken over
  if (!navigator.gpu) { toFallback('this browser has no WebGPU', false); return null; }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (switched) return null;
  if (!adapter) { toFallback('no WebGPU adapter', false); return null; }
  const device = gpuDevice = await adapter.requestDevice();
  if (switched) { device.destroy(); return null; }
  device.lost.then(info => { if (info.reason !== 'destroyed') toFallback('GPU device lost: ' + info.message); });
  device.addEventListener('uncapturederror', e => toFallback('WebGPU: ' + e.error.message));
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ label: 'scene', code: WGSL });
  const errs = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
  if (switched) return null;                       // an async error or device loss switched during the await
  if (errs.length) {
    toFallback(errs.map(m => `WGSL ${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    return null;
  }
  return { device, ctx, format, module };
}
initGPU()
  .then(gpu => { if (gpu) startGPU(gpu); })        // pipelines and the frame loop only on a non-null result
  .catch(err => toFallback(String(err)));
```

- Check every shader module this way, including ones created later (post passes, compute), and check `switched`
  after every later `await` in setup before going on.
- Test the switch: break one WGSL line in a copy under `/tmp/w3d/` and confirm the fallback draws and moves.
- Label every shader module, pipeline, buffer and texture (`label: 'jelly'`); validation messages name the label.
- The fallback must really show and log why. Check the CSS: an element with the `hidden` attribute is
  still shown if a stylesheet rule sets `display: flex` on it; use a class toggle or `[hidden]{display:none!important}`.
- Buffer sizes must be finite integers. A plain JS array has no `byteLength`, so `Math.max(16, arr.byteLength)` is
  `NaN` and `createBuffer` throws "Value is not of type 'unsigned long long'" during init. Convert data to a typed
  array first and round sizes up to a multiple of 4 (`Math.ceil(bytes / 4) * 4`).
- Start the render loop immediately after init; do not wait for input.

## 3. WGSL language traps (each one has shipped a blank page)

Write WGSL multi-line with one statement per line: a dense one-liner turns one typo into an unreadable
"expected ';'" at column 190.

| Trap | Wrong | Right |
|---|---|---|
| Reserved word as a name | `let target = ...;` `let ref = ...;` `let patch = ...;` | `tgt`, `refZ`, `patchN`. Full list below. |
| Comma declarations | `let c = cos(a), s = sin(a);` | one `let` per line |
| Missing `;` | `return o}` | `return o; }` (every statement ends with `;`) |
| `let` is immutable | `let sh = ...; sh *= k;` | `var sh = ...;` |
| Name clash | `struct G {...}` and `var<uniform> G: G;` | `struct Globals {...}` and `var<uniform> G: Globals;` |
| No scalar splat in builtins | `smoothstep(0.8, 1.0, c)` with `c: vec3f` | `smoothstep(vec3f(0.8), vec3f(1.0), c)`; same for `clamp`, `step`, `min`, `max` |
| No implicit int/float mixing | `f32 * i32`, `for (var i = 0; ...) { x += i * 0.1; }` | `f32(i) * 0.1`; write float literals as `1.0` where a float is meant |
| Operator mixing needs parentheses | `a ^ b + c`, `a & b \| c`, `x << 1 + y` | `a ^ (b + c)`; parenthesise every mix of bitwise, shift and arithmetic operators |
| No ternary | `c ? a : b` | `select(b, a, c)` (false value first) |
| No `mod` builtin; `%` truncates | `mod(x, y)` | `x - y * floor(x / y)` for a floored modulo |
| `atan` takes one argument | `atan(y, x)` | `atan2(y, x)` |
| Two position inputs | struct field `@builtin(position)` **and** a fragment parameter `@builtin(position)` | read it from the struct; one `@builtin(position)` per stage input |
| Derivatives in non-uniform flow | `textureSample(...)` or `dpdx` inside `if (kind > 2.5) {...}` | sample before the branch, or `textureSampleLevel(t, s, uv, 0.0)` |
| Depth compare in non-uniform flow | `textureSampleCompare` inside a branch or loop | `textureSampleCompareLevel` |
| Depth texture level is an integer | `textureSampleLevel(depthTex, samp, uv, 0.0)` | `..., 0)` (an `i32`/`u32` level), or `textureLoad` |
| Array initialiser syntax | `var<private> W: array<f32, 4>(1.0, 2.0, 3.0, 4.0);` | `var<private> W = array<f32, 4>(1.0, 2.0, 3.0, 4.0);` or a `const` |
| Return type mismatch | `-> @location(0) vec4f { return col; }` with `col: vec3f` | `return vec4f(col, 1.0);` |
| JS constant not in the shader | `if (!LITE) {...}` where `LITE` lives only in JS | an `override LITE: bool = false;` set in the pipeline `constants`, or substitute into the source string |
| Swizzle assignment (older browsers) | `v.xy = p;` | newer Chromium accepts it as the `swizzle_assignment` language feature; for portability rebuild: `v = vec4f(p, v.z, v.w);` |

WGSL reserved words (from the WGSL specification; none may be used as an identifier):

```
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch class
co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval
constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export
extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl
implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut
mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of
operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public
readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm
static static_assert static_cast std subroutine super target template this thread_local throw trait try type
typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with
writeonly yield
```

Ordinary words that have broken real pages: `target`, `ref`, `patch`. Others on the list that look like everyday
variable names: `active`, `filter`, `type`, `set`, `get`, `new`, `self`, `pass`, `common`, `module`, `layout`,
`smooth`, `shared`, `match`, `from`, `use`, `with`, `where`, `final`, `static`. `scripts/wgsl_lint.py page.html`
flags reserved identifiers and several other traps in this table without a browser; it is advisory and can be wrong
either way, so the browser's compile messages decide.

GLSL (three.js `ShaderMaterial` on WebGL) has its own reserved words that collide the same way, for example `active`,
`patch`, `half`, `input`, `output`, `filter`, `sample`, `common`, `partition`, `superp`.

## 4. TSL traps (three.js node materials)

- Names you give TSL variables, functions, struct members or `wgslFn` code reach WGSL unchanged: the reserved-word
  list above applies to them.
- A JS `if` or JS reassignment on node values runs once at build time, not per pixel. Use TSL `If`, `Loop` and
  `select`, and `.toVar()` with `.assign()` / `.addAssign()` for values that change inside them.
- A JS `NaN` or `Infinity` fed into a node (a uniform, a constant, a computed parameter) is printed into the shader
  as `NaN.0`, and the compile fails with "expected ',' for function call". Guard numbers with `Number.isFinite`
  before they reach a node.

## 5. WebGPU API state rules

| Rule | Message or symptom when broken |
|---|---|
| Any buffer you `queue.writeBuffer` needs `GPUBufferUsage.COPY_DST`; one-shot data can use `mappedAtCreation: true` | "usage (BufferUsage::Vertex) doesn't include BufferUsage::CopyDst - While calling [Queue].WriteBuffer" |
| A texture you copy an image or canvas into needs `COPY_DST` and `RENDER_ATTACHMENT` usage | "Destination texture needs to have CopyDst and RenderAttachment usage" |
| `depthBias`, `depthBiasSlopeScale` must be 0 for `point-list`, `line-list` and `line-strip` pipelines | "depthBias must be 0 when using PrimitiveTopology::LineList", then every bind-group and draw error after it |
| Colour attachments together must fit `device.limits.maxColorAttachmentBytesPerSample`; 32 bytes (four `rgba16float` targets) is the portable baseline | "Total color attachment bytes per sample (40) exceeds maximum (32)", then a black canvas |
| `layout: 'auto'` keeps only the bindings the shader uses; binding an unused resource fails | `bind group ... does not match layout` |
| Pipeline `depthStencil.format` and `multisample.count` must match the render pass attachments | pass encoding error each frame |
| Uniform structs follow WGSL alignment: `vec3f` aligns to 16 bytes, struct size rounds to its alignment; prefer `vec4f` and mirror the layout in one `Float32Array` | values shifted or garbage on screen, no error |
| Configure the canvas with `navigator.gpu.getPreferredCanvasFormat()`; pipelines that draw to it must use the same format | invalid pipeline or render pass |
| Recreate size-dependent textures (depth, MSAA, post targets) on resize | errors or stretching after a resize |
| Pipeline-creation errors from `create*PipelineAsync` reject the promise | silent failure unless you catch and log |

## 6. three.js on WebGL: shader and API traps

- `onBeforeCompile` edits break silently when the chunk name you replace does not exist in that version: check the
  console for `THREE.WebGLProgram: Shader Error` and check that the effect is visible.
- GLSL compile errors print the failing line numbers; open the generated line, it is usually a parenthesis, a type
  mismatch (`pow(vec3, float)`) or a reserved word.
- Keep one copy of three.js: never mix a CDN `three.module.js` with addons from another version or with an inlined
  build.
- Line `linewidth` above 1 is ignored on every modern backend (WebGL and WebGPU): lines draw one pixel wide. For
  thick lines use `Line2` / `LineMaterial` from the addons, or tubes.
- Metal and glossy materials get their look from reflections: with no `scene.environment` they show only small
  direct-light highlights and read dark. Add a PMREM environment (`RoomEnvironment` is the quick one).

## 7. Debugging: get the root error, fix it, rerun

1. Read WGSL compile messages first. With `getCompilationInfo()` you get line and column; print that source line.
   `scripts/check_page.py` captures WebGPU messages when the page uses WebGPU (`--webgpu auto`, the default).
2. While developing, wrap pipeline, bind-group, buffer and texture creation in `device.pushErrorScope('validation')`
   / `popErrorScope()`; the first error names the real problem. Messages that say "is invalid due to a previous
   error" are consequences; fix the earliest one and rerun.
3. Keep an `uncapturederror` listener that logs `e.error.message`; Chromium also prints many WebGPU problems as
   console warnings, so capture warnings, not only errors.
4. A WGSL error can depend on the browser build (newer compilers accept features older ones reject, and the reverse
   for reserved words added later). Fix every reserved-word and trap-table hit even when your browser accepted it.
   Stand-in validators (naga, wgpu-py, `scripts/wgsl_lint.py`, a regex or a careful read) are not Chrome's WGSL
   compiler: they help, but only a Chromium run with a WebGPU adapter counts as running the WebGPU path.
5. After the WebGPU path runs clean, run the fallback once (`check_page.py --webgpu off`) and make sure it renders
   and moves too.
