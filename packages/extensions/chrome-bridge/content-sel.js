(() => {
if (globalThis.__nbSelReady) return;
globalThis.__nbSelReady = true;
if (window.top !== window) return;

const log = (lvl, where, msg) => { if (typeof globalThis.dlog === "function") globalThis.dlog(lvl, where, msg); };

const ACTIONS = [
  ["✨", "Ask", "ask"],
  ["💡", "Explain", "explain"],
  ["📝", "Summarize", "summarize"],
  ["🌐", "Translate", "translate"],
  ["✍️", "Rewrite", "rewrite"],
  ["🔍", "Grammar", "grammar"]
];

let pop = null;
let popX = 0;
let popY = 0;
let initialScrollY = 0;
let waitId = null;
let pending = null;

function selText() {
  try { return String(window.getSelection?.().toString() || ""); } catch { return ""; }
}

function selValid() {
  const t = selText();
  if (t.length < 2 || t.length > 8000) return false;
  if (!t.trim()) return false;
  const n = window.getSelection?.().anchorNode;
  const el = n && (n.nodeType === 3 ? n.parentElement : n.nodeType === 1 ? n : null);
  if (!el || el.nodeType !== 1) return false;
  const host = el.closest?.("textarea,input,select,[contenteditable],[role=textbox]");
  if (host) return false;
  if (!(el.closest?.("body") || document.body.contains(el))) return false;
  return true;
}

function selRect() {
  try {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (r && (r.width || r.height)) return r;
    const st = s.getRangeAt(0).startContainer;
    const ee = st.nodeType === 3 ? st.parentElement : st;
    if (ee && ee.getBoundingClientRect) return ee.getBoundingClientRect();
  } catch {}
  return null;
}

function ensureStyles() {
  if (document.getElementById("nb-sel-style")) return;
  const st = document.createElement("style");
  st.id = "nb-sel-style";
  st.textContent = `
    .nb-selpop {
      position: fixed;
      z-index: 2147483647;
      background: rgba(16, 22, 32, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(139, 124, 255, 0.45);
      border-radius: 12px;
      padding: 6px;
      display: flex;
      gap: 5px;
      align-items: center;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 0 16px rgba(139, 124, 255, 0.22);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      font-size: 12px;
      color: #e6edf3;
      user-select: none;
      animation: nbPopFadeIn 0.15s ease-out;
    }
    @keyframes nbPopFadeIn {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes nbSelSpin {
      to { transform: rotate(360deg); }
    }
    .nb-selpop-card {
      flex-direction: column;
      align-items: stretch;
      padding: 10px 12px;
      min-width: 300px;
      max-width: 460px;
      user-select: text;
    }
    .nb-sel-btn {
      all: unset;
      cursor: pointer;
      padding: 5px 9px;
      border-radius: 8px;
      background: rgba(139, 124, 255, 0.12);
      border: 1px solid rgba(139, 124, 255, 0.25);
      color: #e6edf3;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.14s ease;
    }
    .nb-sel-btn:hover {
      background: rgba(139, 124, 255, 0.28);
      border-color: rgba(139, 124, 255, 0.5);
      color: #ffffff;
      transform: translateY(-1px);
    }
    .nb-sel-btn.primary {
      background: linear-gradient(135deg, rgba(139,124,255,0.4), rgba(62,230,196,0.3));
      border-color: rgba(139,124,255,0.6);
      color: #ffffff;
      font-weight: 600;
    }
    .nb-sel-btn.close {
      background: transparent;
      border-color: transparent;
      color: #8b98a9;
      padding: 4px 6px;
    }
    .nb-sel-btn.close:hover {
      background: rgba(255, 107, 107, 0.2);
      color: #ff9d9d;
    }
  `;
  try { (document.head || document.documentElement).appendChild(st); } catch {}
}

function chip(label, title, fn, isPrimary = false) {
  const b = document.createElement("button");
  b.className = "nb-sel-btn" + (isPrimary ? " primary" : "");
  b.textContent = label;
  b.title = title;
  if (fn) b.onclick = (e) => { e.stopPropagation(); fn(b); };
  return b;
}

function removePop() {
  if (pop) { try { pop.remove(); } catch {} pop = null; }
  waitId = null;
  pending = null;
}

function positionPop(anchor) {
  if (!pop) return;
  const r = pop.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const m = 10;
  let x;
  let y;
  if (anchor) {
    x = anchor.left + anchor.width / 2 - r.width / 2;
    y = anchor.top - r.height - 12;
    if (y < m) y = anchor.bottom + 12;
  } else {
    x = popX - r.width / 2;
    y = popY - r.height - 14;
  }
  x = Math.min(Math.max(m, x), Math.max(m, vw - r.width - m));
  y = Math.min(Math.max(m, y), Math.max(m, vh - r.height - m));
  pop.style.left = Math.round(x) + "px";
  pop.style.top = Math.round(y) + "px";
}

function showPop() {
  if (!selValid()) return;
  if (pop && pop.dataset.t === "result") return;
  ensureStyles();
  const prev = document.querySelector(".nb-selpop");
  if (prev && prev !== pop) { try { prev.remove(); } catch {} }
  const anchor = selRect();
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "nb-selpop";
    pop.addEventListener("mousedown", (e) => e.stopPropagation());
    pop.addEventListener("mouseup", (e) => e.stopPropagation());
    pop.addEventListener("click", (e) => e.stopPropagation());
  }
  initialScrollY = window.scrollY;
  while (pop.firstChild) pop.firstChild.remove();
  pop.className = "nb-selpop";
  ACTIONS.forEach(([icon, tip, act]) => pop.appendChild(chip(icon + " " + tip, tip, () => runAction(act, icon))));
  const cl = chip("✕", "Close", () => removePop());
  cl.className += " close";
  pop.appendChild(cl);
  if (!pop.isConnected) (document.body || document.documentElement).appendChild(pop);
  pop.dataset.t = "menu";
  positionPop(anchor);
  log("debug", "selpop", "show");
}

function runAction(action, icon) {
  const text = selText().slice(0, 6000);
  if (!text.trim()) return;
  ensureStyles();
  const reqId = "sel-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  waitId = reqId;
  pending = { reqId, action, text, title: (document.title || "").slice(0, 120), url: location.href };
  if (pop) {
    pop.className = "nb-selpop nb-selpop-card";
    pop.dataset.t = "loading";
    while (pop.firstChild) pop.firstChild.remove();
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:6px";
    const tag = document.createElement("span");
    tag.textContent = icon + " " + action.toUpperCase() + " • NaviBridge AI";
    tag.style.cssText = "color:#c8cdf5;font-weight:600;font-size:11px;letter-spacing:0.04em;flex:1";
    const sp = document.createElement("span");
    sp.textContent = "⏳";
    sp.style.cssText = "animation:nbSelSpin 1.2s linear infinite;display:inline-block;font-size:12px";
    head.appendChild(tag);
    head.appendChild(sp);
    const body = document.createElement("div");
    body.style.cssText = "font-size:12px;color:#8b98a9;padding:6px 0";
    body.textContent = "Analyzing selection with AI model...";
    pop.appendChild(head);
    pop.appendChild(body);
    positionPop(null);
  }
  try {
    chrome.runtime.sendMessage({ type: "SB_SELACT", reqId, action, text, title: (document.title || "").slice(0, 120), url: location.href }, () => void chrome.runtime.lastError);
  } catch (e) {
    showErr(String(e).slice(0, 200));
  }
  log("info", "SB_SELACT:send", action + " id=" + reqId + " len=" + text.length);
}

function showResult(text) {
  if (!pop) return;
  ensureStyles();
  pop.className = "nb-selpop nb-selpop-card";
  pop.dataset.t = "result";
  while (pop.firstChild) pop.firstChild.remove();

  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px";
  const tag = document.createElement("span");
  tag.textContent = "✨ NaviBridge AI Answer";
  tag.style.cssText = "color:#3ee6c4;font-weight:700;font-size:11px;letter-spacing:0.04em;flex:1";
  const cl = chip("✕", "Close", () => removePop());
  cl.className += " close";
  head.appendChild(tag);
  head.appendChild(cl);

  const area = document.createElement("div");
  area.style.cssText = "max-height:260px;overflow-y:auto;white-space:pre-wrap;color:#e7eef6;font-size:12.5px;line-height:1.6;padding:2px 4px 6px;word-break:break-word";
  area.textContent = String(text || "");

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);align-items:center";
  const cp = chip("📋 Copy", "Copy response to clipboard", async (b) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      b.textContent = "✓ Copied";
      setTimeout(() => { b.textContent = "📋 Copy"; }, 1400);
    } catch {}
  }, true);

  const cont = chip("⧉ Continue in Sidebar", "Open and continue chat in NaviBridge sidebar", () => {
    try {
      chrome.runtime.sendMessage({ type: "SB_SELACT_SIDE", text: String(text || ""), provider: null }, () => void chrome.runtime.lastError);
    } catch {}
    removePop();
  });

  row.appendChild(cp);
  row.appendChild(cont);
  pop.appendChild(head);
  pop.appendChild(area);
  pop.appendChild(row);
  positionPop(null);
}

function showErr(msg) {
  if (!pop) return;
  ensureStyles();
  pop.className = "nb-selpop nb-selpop-card";
  pop.dataset.t = "result";
  while (pop.firstChild) pop.firstChild.remove();
  const area = document.createElement("div");
  area.style.cssText = "color:#ff8f8f;padding:6px;font-size:12px;line-height:1.5";
  area.textContent = "Notice: " + String(msg || "").slice(0, 200);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;padding-top:6px;align-items:center";
  const sp = chip("⧉ Open Sidebar", "Continue in sidebar", () => {
    try {
      chrome.runtime.sendMessage({ type: "SB_SELACT_SIDE", text: String(pending?.text || ""), provider: null }, () => void chrome.runtime.lastError);
    } catch {}
    removePop();
  });
  const cl = chip("Close", "Close", () => removePop());
  row.appendChild(sp);
  row.appendChild(cl);
  pop.appendChild(area);
  pop.appendChild(row);
  positionPop(null);
}

function outsideHit(e) {
  if (pop && !pop.contains(e.target)) {
    // If clicking outside and not selecting text
    removePop();
  }
}

document.documentElement.addEventListener("mousedown", outsideHit, true);
document.documentElement.addEventListener("keydown", (e) => { if (e.key === "Escape") removePop(); }, true);

// Dismiss only on major scrolling (> 120px) to prevent frustrating dismissals on small trackpad touches
window.addEventListener("scroll", () => {
  if (!pop) return;
  if (pop.dataset.t === "result" || pop.dataset.t === "loading") {
    // Keep visible while user is reading result card or waiting
    return;
  }
  if (Math.abs(window.scrollY - initialScrollY) > 120) {
    removePop();
  }
}, true);

document.addEventListener("selectionchange", () => {
  clearTimeout(showPop._ds);
  showPop._ds = setTimeout(() => {
    if (!selValid()) {
      if (pop && pop.dataset.t !== "result" && pop.dataset.t !== "loading") removePop();
      return;
    }
    showPop();
  }, 220);
});

document.addEventListener("mouseup", (e) => {
  if (pop && pop.contains(e.target)) return;
  clearTimeout(showPop._mt);
  showPop._mt = setTimeout(() => {
    if (!selValid()) return;
    showPop();
  }, 220);
});

chrome.runtime.onMessage.addListener((m) => {
  try {
    if (m && m.type === "SB_SELACT_RESULT") {
      const rid = String(m.reqId || "");
      if (waitId && rid === waitId) {
        waitId = null;
        if (m.ok) showResult(m.text != null ? m.text : "");
        else showErr(String(m.error || "Could not retrieve response"));
      }
    }
  } catch {}
});

log("debug", "selpop:boot", "content-sel ready");
})();
