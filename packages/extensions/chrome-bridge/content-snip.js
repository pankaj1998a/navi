(() => {
  if (globalThis.__nbSnipReady) return;
  globalThis.__nbSnipReady = true;
  const dlog = (l, w, t) => { try { (globalThis.dlog || (() => {}))("debug", "snip:" + w, t || ""); } catch {} };
  function cleanup() { const z = document.getElementById("nb-snipzone"); const r = document.getElementById("nb-sniprect"); if (z) z.remove(); if (r) r.remove(); }
  function toast(txt) {
    const t = document.createElement("div");
    t.textContent = txt;
    t.style.cssText = "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1d2632;color:#e6edf3;border:1px solid #7c6cff;border-radius:10px;padding:9px 14px;font:12px system-ui";
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }
  function start() {
    if (document.getElementById("nb-snipzone")) return;
    const z = document.createElement("div");
    z.id = "nb-snipzone";
    z.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.25);cursor:crosshair;user-select:none";
    const r = document.createElement("div");
    r.id = "nb-sniprect";
    r.style.cssText = "position:absolute;border:2px solid #7c6cff;background:rgba(124,108,255,.12);pointer-events:none;display:none";
    z.appendChild(r);
    document.documentElement.appendChild(z);
    let sx = 0, sy = 0, down = false;
    z.addEventListener("mousedown", (e) => { down = true; sx = e.clientX; sy = e.clientY; r.style.display = "block"; e.preventDefault(); }, true);
    z.addEventListener("mousemove", (e) => { if (!down) return; const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY); r.style.left = x + "px"; r.style.top = y + "px"; r.style.width = Math.abs(e.clientX - sx) + "px"; r.style.height = Math.abs(e.clientY - sy) + "px"; }, true);
    z.addEventListener("keyup", (e) => { if (e.key === "Escape") cleanup(); }, true);
    z.addEventListener("mouseup", (e) => {
      if (!down) return;
      down = false;
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      if (w > 12 && h > 12) {
        const rect = { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), width: w, height: h, dpr: window.devicePixelRatio || 1, url: location.href, title: (document.title || "").slice(0, 120) };
        cleanup();
        try { chrome.runtime.sendMessage({ type: "SB_SNIP_RECT", rect }); dlog("info", "rect:sent", w + "x" + h + " dpr=" + rect.dpr); } catch {}
      } else cleanup();
    }, true);
  }
  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m && m.type === "SB_SNIP_START") { start(); try { send({ ok: true }); } catch {} return true; }
    if (m && m.type === "SB_SNIP_DONE") { try { toast("📸 Screenshot region attached"); } catch {} return false; }
    return false;
  });
})();
