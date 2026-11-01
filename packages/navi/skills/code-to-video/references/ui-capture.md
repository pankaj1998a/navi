# The product's real UI

Adapted in part from motion-studio (MIT, © 2026 Jay Firke): the UI-demo grammar; rewritten.

## Capture

- Show the real product, captured, never a replica. Before capture, fake, freeze or redact personal and customer data,
  keys, internal URLs, notifications and clocks; fill it with realistic data, one consistent example across beats.
- Capture at about 3× the scale shown and never upscale: 14 px UI text shown at 40 px needs 2.9×. A native app that
  stops at 2×: raise its own zoom first.
- Save this as `capture.mjs` in the work folder and run `node capture.mjs URL OUT.png [SELECTOR]` there, with `CHROME`
  set to the browser `render.mjs --doctor` names.

```js
import { createRequire } from 'node:module';
const load = (d) => createRequire(`${d}/noop.js`)('playwright-core');
let pw; try { pw = load(process.cwd()); } catch { pw = load(`${process.cwd()}/.c2v`); }
const [url, out, sel] = process.argv.slice(2);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
await page.clock.setFixedTime(new Date('2026-03-14T10:24:00'));
await page.goto(url, { waitUntil: 'networkidle' });
await (sel ? page.locator(sel) : page).screenshot({ path: out, animations: 'disabled', caret: 'hide' });
await browser.close();
```

## Frame it like a camera

- Show the whole window only to orient, then push to the few lines or the one control that carry the beat, at 40 px
  or more on screen.
- Code: about 60 characters a line, 3–12 lines with 1–3 in focus, ligatures off (`font-variant-ligatures: none`).
  Terminals: real commands, trimmed real output.
- Lift a key card out (1.3–2×, a deeper shadow, the page dimmed) rather than adding boxes and arrows.

## Every change has a cause

- A press, a typed key or a spoken request comes first; the UI answers in that frame or the next. A camera move over
  an unchanged screen is not a change.
- The cursor stays 3–6% of frame height at every camera scale: an arrow to pick, a hand to press, labelled when
  several actors act. It flies a short curve and settles before a press; it never wanders.
- Click feedback, strongest first: the target changes state at once; a consequence leaves the button; the press
  shows. At most one ripple per film.
- AI tools: open on the prompt typed with a real caret, show the Enter, a short wait, status chips, and the result
  as an object.
