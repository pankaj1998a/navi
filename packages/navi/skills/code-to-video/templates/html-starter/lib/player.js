// lib/player.js: implements window.__video for render.mjs. Opened in a normal browser (served over
// http), it also fits the stage to the window and adds a play/pause/scrub bar with a frame readout.
// Under render.mjs (window.__videoRender is set) the bar never mounts and the stage stays 1:1.

export function mountFilm({ width, height, fps, duration, timeline = {}, fonts = [], render, stage = document.getElementById('stage') }) {
  // T3: everything the film shows is loaded before frame 0. List every @font-face weight/style used
  // (CSS font shorthand, e.g. '700 120px "Inter"'). System fonts need no entry: drafts only (lib/README.md), never a
  // wordmark (D7).
  const ready = (async () => {
    for (const f of fonts) {
      const faces = await document.fonts.load(f);
      if (!faces.length) throw new Error(`fonts: no @font-face matches ${f} (typo, or a system font that needs no entry)`);
    }
    await document.fonts.ready;
    const imgs = [...document.images].filter((img) => img.getAttribute('src') || img.srcset); // seek may fill the rest
    await Promise.all(imgs.map((img) => img.decode().catch(() => { throw new Error(`image failed to decode: ${img.src}`); })));
    render(0);
    return { fonts: fonts.length, images: document.images.length };
  })();

  let current = 0;
  const seek = (t) => { current = t; render(t); }; // pure: any t, any order
  window.__video = { width, height, fps, duration, ready, seek, timeline };

  if (window.__videoRender) return window.__video;
  ready.then(() => mountPreview({ width, height, fps, duration, timeline, stage, seek, now: () => current }),
    (e) => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;margin:0;padding:12px;background:#400;color:#fff;font:14px monospace">ready failed: ${e.message}</pre>`); });
  return window.__video;
}

// Preview only: wall-clock playback is fine here because render.mjs never runs this code.
function mountPreview({ width, height, fps, duration, timeline, stage, seek, now }) {
  const total = Math.round(duration * fps);
  const bar = document.createElement('div');
  bar.innerHTML = `<button type="button" aria-label="play">Play</button><input type="range" min="0" max="${total - 1}" step="1" value="0"><output></output>`;
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:44px;display:flex;gap:12px;align-items:center;padding:0 12px;'
    + 'background:#1b1b1b;color:#ddd;font:13px/1 ui-monospace,Menlo,Consolas,monospace;z-index:2147483647';
  const [btn, range, out] = bar.children;
  btn.style.cssText = 'width:64px;height:28px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;font:inherit;cursor:pointer';
  range.style.cssText = 'flex:1';
  out.style.cssText = 'min-width:300px;white-space:pre';
  document.body.appendChild(bar);

  const fit = () => {
    const k = Math.min(innerWidth / width, (innerHeight - 44) / height);
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `translate(${(innerWidth - width * k) / 2}px, ${(innerHeight - 44 - height * k) / 2}px) scale(${k})`;
  };
  fit();
  addEventListener('resize', fit);

  const sceneAt = (t) => (timeline.scenes || []).find((s) => t >= s.start && t < s.end);
  const show = (f) => {
    f = Math.max(0, Math.min(total - 1, f));
    seek(f / fps);
    range.value = String(f);
    const s = sceneAt(f / fps);
    out.value = `f ${String(f).padStart(String(total).length, '0')}/${total}  ${(f / fps).toFixed(3)} s  ${s ? s.label || s.id : ''}`;
  };
  let playing = false, t0 = 0, clock0 = 0;
  const loop = (clock) => {
    if (!playing) return;
    const t = (t0 + (clock - clock0) / 1000) % duration;
    show(Math.floor(t * fps));
    requestAnimationFrame(loop);
  };
  const toggle = () => {
    playing = !playing;
    btn.textContent = playing ? 'Pause' : 'Play';
    if (playing) { t0 = Number(range.value) / fps; clock0 = performance.now(); requestAnimationFrame(loop); }
  };
  // Blur controls after pointer use so Space and the arrows always reach the handler below exactly once.
  btn.addEventListener('click', () => { toggle(); btn.blur(); });
  range.addEventListener('input', () => { if (playing) toggle(); show(Number(range.value)); });
  range.addEventListener('change', () => range.blur());
  addEventListener('keydown', (e) => {
    if (e.target === range || e.target === btn) return; // a focused native control handles its own keys
    const f = Math.round(now() * fps);
    if (e.key === ' ') { e.preventDefault(); toggle(); return; }
    const step = { ArrowLeft: e.shiftKey ? -fps : -1, ArrowRight: e.shiftKey ? fps : 1 }[e.key];
    if (step !== undefined || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (playing) toggle();
      show(e.key === 'Home' ? 0 : e.key === 'End' ? total - 1 : f + step);
    }
  });
  show(0);
}
