(() => {
if (globalThis.__nbContentReady) return;
globalThis.__nbContentReady = true;
try { dbgInit("content"); } catch {}
const dlog = globalThis.dlog || function () {};
const INPUTS = [
  "#prompt-textarea",
  "textarea#chat-input",
  "div.ProseMirror[contenteditable=true]",
  "div.ql-editor[contenteditable=true]",
  "rich-textarea div[contenteditable=true]",
  ".chat-input-editor",
  "div[data-lexical-editor=true]",
  "textarea[placeholder*='Ask' i]",
  "textarea[placeholder*='Message' i]",
  "textarea[placeholder*='DeepSeek' i]",
  "textarea",
  "div[contenteditable=true]",
  "div[role=textbox]"
];
const SEND_BTNS = [
  "button[data-testid='send-button']",
  "button[data-testid='fruitjuice-send-button']",
  "button[aria-label*='Send' i]",
  "button[aria-label*='Submit' i]",
  "button[aria-label*='Grok' i]",
  "button.send-button",
  ".send-button-container",
  ".send-icon",
  "svg[name='Send']",
  "div[role='button'][class*='send' i]",
  "div[role='button']:has(svg)",
  "div.ds-icon-button",
  "button[type='submit']",
  "button:has(svg path[d*='M'])"
];
const LOGIN_HINTS = ["Log in", "Sign in", "Continue with Google"];
function findInput() {
  for (const s of INPUTS) {
    const els = [...document.querySelectorAll(s)];
    for (const el of els) {
      if ((el.offsetParent || el.getClientRects().length > 0 || (el.offsetWidth || 0) > 0) && !el.disabled && !el.readOnly) return el;
    }
  }
  return null;
}
function findSend() {
  for (const s of SEND_BTNS) {
    try {
      const el = document.querySelector(s);
      if (el && (el.offsetParent || el.getClientRects().length > 0 || (el.offsetWidth || 0) > 0) && !el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
    } catch {}
  }
  return null;
}
function lastText() { return (document.body.innerText || "").slice(-4000); }

let __sbDirty = true;
(function installDirtyObserver() {
  try {
    if (!document.body) { setTimeout(installDirtyObserver, 400); return; }
    new MutationObserver(() => { __sbDirty = true; }).observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch {}
})();
function lastTurnEl() {
  const sels = [
    'div[data-message-author-role="assistant"]',
    '[data-message-author-role="assistant"]',
    '.font-claude-message',
    'message-content',
    'model-response',
    'div.ds-markdown',
    '.markdown',
    'div.prose',
    'article'
  ];
  for (const s of sels) {
    try {
      const els = [...document.querySelectorAll(s)].filter((e) => (e.innerText || "").trim().length > 5);
      if (els.length) return els[els.length - 1];
    } catch {}
  }
  const pres = [...document.querySelectorAll("pre")].filter((e) => (e.innerText || "").length > 50);
  if (pres.length) return pres[pres.length - 1].closest("article,div") || pres[pres.length - 1];
  return null;
}
function mediaIn(el) {
  const out = [];
  try { [...el.querySelectorAll("img,video")].forEach((m) => {
    const tag = m.tagName.toLowerCase();
    const box = (() => { try { return m.getBoundingClientRect(); } catch { return { width: 0 }; } })();
    const w = Math.max(m.naturalWidth || 0, m.videoWidth || 0, box.width || 0);
    if (!(w > 90)) return;
    if (tag === "video") {
      const src = (m.currentSrc || m.src || (m.querySelector("source") || {}).src || "");
      if (src && /^(https?:|blob:|data:)/.test(src)) out.push({ video: true, src: String(src).slice(0, 300000), poster: String(m.poster || "").slice(0, 300000), alt: String(m.title || m.getAttribute("aria-label") || "video").slice(0, 80) });
      return;
    }
    let src = m.currentSrc || m.src || "";
    if (!src || /^(about|javascript):/.test(src)) return;
    if (m.closest('button,[role="button"],nav,aside,header')) return;
    const nw = m.naturalWidth || 0, nh = m.naturalHeight || 0;
    try {
      if (nw >= 80 && nh >= 80 && nw * nh <= 4000000) {
        const c = document.createElement("canvas");
        c.width = nw > 1024 ? 1024 : nw; c.height = nw > 1024 ? Math.round((1024 * nh) / nw) : nh;
        c.getContext("2d").drawImage(m, 0, 0, c.width, c.height);
        const du = c.toDataURL("image/jpeg", 0.8);
        if (du.length > 1500) src = du;
      }
    } catch {}
    src = String(src);
    if (!/^(https?:|blob:|data:image\/)/.test(src)) return;
    out.push({ alt: (m.alt || "image").slice(0, 80), src, w: nw || Math.round(box.width || 0), h: nh || Math.round(box.height || 0) });
  }); } catch {}
  return out.slice(0, 6);
}
let __tmCache = { key: "", media: [] };
function turnMedia() {
  const el = lastTurnEl();
  if (!el) return [];
  // Repeated SB_POLL/SB_READ cycles ask for the same media repeatedly; the
  // canvas encode per image is the expensive part, so cache by a cheap
  // structural signature of the turn (element count + image sources).
  let key = "";
  try {
    const ims = el.querySelectorAll("img,video");
    key = ims.length + "|" + ((ims[0] && (ims[0].currentSrc || ims[0].src)) || "") + "|" + ((ims[ims.length - 1] && (ims[ims.length - 1].currentSrc || ims[ims.length - 1].src)) || "") + "|" + el.innerHTML.length;
  } catch { key = "_" + Date.now(); }
  if (key === __tmCache.key) return __tmCache.media;
  const media = mediaIn(el);
  __tmCache = { key, media };
  return media;
}
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? (el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype) : null;
  const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
  if (desc && desc.set) desc.set.call(el, value);
  else if ("value" in el) el.value = value;
  else el.textContent = value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  try {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
  } catch {}
}
async function insertPrompt(el, prompt) {
  el.focus();
  if (el.isContentEditable) {
    try {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {}
    const lines = String(prompt).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) { try { document.execCommand("insertLineBreak"); } catch {} }
      try { document.execCommand("insertText", false, lines[i]); } catch {}
    }
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: prompt }));
    } catch {}
    if (!el.innerText?.trim()) {
      el.textContent = prompt;
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    return true;
  }
  try {
    document.execCommand("selectAll", false, null);
    if (document.execCommand("insertText", false, prompt)) {
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      return true;
    }
  } catch {}
  try {
    const dt = new DataTransfer(); dt.setData("text/plain", String(prompt));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    if (el.value === prompt || el.textContent === String(prompt)) {
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      return true;
    }
  } catch {}
  setNativeValue(el, prompt);
  return true;
}
let attSeen = 0;
  function attachmentSeen() {
    const base = findInput();
    if (!base) return 0;
    let cur = base;
    for (let i = 0; i < 4 && cur; i++) {
      const hit = cur.querySelectorAll ? cur.querySelectorAll('img,[data-testid*="attachment"],[class*="attachment"],[class*="upload"]').length : 0;
      if (hit) return hit;
      cur = cur.parentElement ? cur.parentElement : null;
    }
    return 0;
  }
  async function pasteImages(dataurls) {
    const files = [];
    for (const du of (dataurls || []).slice(0, 5)) {
      try {
        const blob = await (await fetch(du)).blob();
        if (blob.type && blob.type !== "image/png" && blob.type !== "image/jpeg" && blob.type !== "image/webp") continue;
        files.push(new File([blob], "paste." + String(blob.type || "image/png").split("/")[1].replace("jpeg", "jpg"), { type: blob.type || "image/png" }));
      } catch {}
    }
    if (!files.length) return false;
    const el = findInput();
    if (!el) return false;
    el.focus();
    let n = 0;
    const before = attachmentSeen();
    for (const f of files) {
      try {
        const dt = new DataTransfer(); dt.items.add(f);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
        n++;
        let settled = attachmentSeen() > before;
        for (let w = 0; w < 12 && !settled; w++) { await new Promise((r) => setTimeout(r, 250)); settled = attachmentSeen() > before; }
        if (!settled) dlog("warn", "pasteImages:nochip", f.name);
        await new Promise((r) => setTimeout(r, 300));
      } catch {}
    }
    dlog("info", "pasteImages", "count=" + n + " chips=" + (attachmentSeen() - before));
    return n > 0;
  }
  function ytCaptionTracksUrls() {
    const urls = [];
    try {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        const txt = s.textContent || "";
        if (!txt.includes("timedtext")) continue;
        const re = /(https?:(?:\\\/\\\/|\/\/)[^"'\s]+timedtext[^"'\s]*)/g;
        let m;
        while ((m = re.exec(txt)) !== null) {
          let u = m[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
          u = u.replace(/[\\"']+$/, "");
          if (u.includes("/api/timedtext") && !urls.includes(u)) {
            urls.push(u);
          }
        }
      }
    } catch {}
    return urls;
  }
  function ytTimedtextUrls() {
    const out = ytCaptionTracksUrls();
    try { performance.getEntriesByType("resource").filter((e) => String(e.name || "").includes("/api/timedtext")).forEach((e) => { const n = String(e.name); if (!out.includes(n)) out.push(n); }); } catch {}
    try {
      const html = document.documentElement.outerHTML || "";
      const ix = html.indexOf("https://www.youtube.com/api/timedtext");
      if (ix >= 0) { const seg = html.slice(ix, ix + 1200); const end = seg.search(/["'\\\s]/); const cand = seg.slice(0, end > 0 ? end : 1200); if (cand.includes("?") && !out.includes(cand)) out.push(cand); }
    } catch {}
    return out;
  }
  function ytPot() {
    try {
      for (const e of performance.getEntriesByType("resource")) { const m = /[?&]pot=([^&"]+)/.exec(String(e.name || "")); if (m) return decodeURIComponent(m[1]); }
      const html = document.documentElement.outerHTML || "";
      const m = /[?&]pot=([^&"\\]+)/.exec(html);
      if (m) return decodeURIComponent(m[1]);
      const cfg = window.ytcfg && window.ytcfg.get && window.ytcfg.get("WEB_PLAYER_CONTEXT_CONFIGS");
      for (const k of Object.keys(cfg || {})) { try { const s = JSON.stringify(cfg[k]); const mp = /[?&]pot=([^&"\\]+)/.exec(s); if (mp) return mp[1]; } catch {} }
    } catch {}
    return "";
  }
  function parseTranscriptRaw(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    if (str.startsWith("{") || str.startsWith("[")) {
      try {
        const data = JSON.parse(str);
        if (data && Array.isArray(data.events)) {
          const items = [];
          for (const ev of data.events) {
            if (!ev || !Array.isArray(ev.segs)) continue;
            const text = ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
            if (!text || text === "\n") continue;
            const t = (ev.tStartMs || 0) / 1000;
            const d = (ev.dDurationMs || 0) / 1000;
            items.push({ t, d, text });
          }
          if (items.length) return items;
        }
      } catch {}
    }
    try {
      const doc = new DOMParser().parseFromString(str, "application/xml");
      const textNodes = [...doc.querySelectorAll("text")];
      if (textNodes.length) {
        const items = textNodes.map((n) => ({
          t: parseFloat(n.getAttribute("start") || "0"),
          d: parseFloat(n.getAttribute("dur") || "0"),
          text: String(n.textContent || "").replace(/&(#?\d+|[a-z]+);/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        })).filter((x) => x.text);
        if (items.length) return items;
      }
      const pNodes = [...doc.querySelectorAll("p")];
      if (pNodes.length) {
        const items = pNodes.map((n) => ({
          t: parseFloat(n.getAttribute("t") || "0") / 1000,
          d: parseFloat(n.getAttribute("d") || "0") / 1000,
          text: String(n.textContent || "").replace(/&(#?\d+|[a-z]+);/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        })).filter((x) => x.text);
        if (items.length) return items;
      }
    } catch {}
    return null;
  }
  function itemsToChunks(items) {
    if (!items || !items.length) return null;
    const chunks = [];
    let cur = { t: items[0].t, text: [] }, st = items[0].t;
    items.forEach((it) => {
      cur.text.push(it.text);
      if (it.t - st > 60 || cur.text.join(" ").length > 1200) {
        chunks.push({ t: st, text: cur.text.join(" ").slice(0, 1500) });
        cur = { t: it.t, text: [] };
        st = it.t;
      }
    });
    if (cur.text.length) chunks.push({ t: st, text: cur.text.join(" ").slice(0, 1500) });
    return chunks.slice(0, 400);
  }
  async function ytTranscript() {
    let urls = ytTimedtextUrls();
    let pot = ytPot();
    // Sort English / preferred first
    urls.sort((a, b) => {
      const aEn = /[?&]lang=en/i.test(a) ? 1 : 0;
      const bEn = /[?&]lang=en/i.test(b) ? 1 : 0;
      return bEn - aEn;
    });

    for (let round = 0; round < 2; round++) {
      if (!urls.length) {
        const btn = document.querySelector("button.ytp-subtitles-button,[aria-label*=Subtitle],[aria-label*=CC]");
        if (btn) { try { btn.click(); await new Promise((r) => setTimeout(r, 600)); btn.click(); await new Promise((r) => setTimeout(r, 800)); } catch {} }
        urls = ytTimedtextUrls();
        pot = pot || ytPot();
        urls.sort((a, b) => {
          const aEn = /[?&]lang=en/i.test(a) ? 1 : 0;
          const bEn = /[?&]lang=en/i.test(b) ? 1 : 0;
          return bEn - aEn;
        });
      }
      for (const u of urls) {
        try {
          const baseJu = u.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const potPart = pot && !baseJu.includes("pot=") ? (baseJu.includes("?") ? "&" : "?") + "pot=" + encodeURIComponent(pot) : "";
          const ju = baseJu + potPart + (baseJu.includes("c=WEB") ? "" : "&c=WEB");
          let res = await fetch(ju, { credentials: "omit" });
          if (!res.ok && !ju.includes("fmt=")) {
            res = await fetch(ju + "&fmt=json3", { credentials: "omit" });
          }
          if (!res.ok) continue;
          const raw = await res.text();
          const items = parseTranscriptRaw(raw);
          const chunks = itemsToChunks(items);
          if (chunks && chunks.length) {
            dlog("info", "yt:done", "chunks=" + chunks.length);
            const vid = new URLSearchParams(location.search).get("v") || location.pathname.split("/").pop() || "";
            const cleanTitle = (document.title || "").replace(/ - YouTube$/i, "").trim();
            return {
              ok: true,
              videoId: vid,
              title: cleanTitle.slice(0, 150),
              chunks,
              text: chunks.map((c) => "[" + new Date(c.t * 1000).toISOString().slice(11, 19) + "] " + c.text).join("\n").slice(0, 40000)
            };
          }
        } catch (e) { dlog("warn", "yt:fetch", String(e).slice(0, 120)); }
      }
    }

    // Try reading native transcript panel if rendered
    try {
      const segs = [...document.querySelectorAll("ytd-transcript-segment-renderer, ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer")];
      if (segs.length) {
        const lines = segs.map((s) => {
          const time = s.querySelector(".segment-timestamp, #timestamp")?.textContent?.trim() || "";
          const txt = s.querySelector(".segment-text, #text, yt-formatted-string")?.textContent?.replace(/\n/g, " ").trim() || "";
          return time ? `[${time}] ${txt}` : txt;
        }).filter((l) => l.length > 2);
        if (lines.length) {
          const vid = new URLSearchParams(location.search).get("v") || location.pathname.split("/").pop() || "";
          const cleanTitle = (document.title || "").replace(/ - YouTube$/i, "").trim();
          return {
            ok: true,
            videoId: vid,
            title: cleanTitle.slice(0, 150),
            text: lines.join("\n").slice(0, 40000),
            chunks: null
          };
        }
      }
    } catch {}

    // Graceful fallback: Extract video title, channel, chapter timestamps and description
    try {
      const vid = new URLSearchParams(location.search).get("v") || location.pathname.split("/").pop() || "";
      const title = (document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, h1")?.textContent || document.title || "").replace(/ - YouTube$/i, "").trim();
      const channel = (document.querySelector("#channel-name a, ytd-channel-name a, #owner-sub-count")?.textContent || "").replace(/\s+/g, " ").trim();

      const moreBtn = document.querySelector("#expand.ytd-text-inline-expander, tp-yt-paper-button#expand");
      if (moreBtn) { try { moreBtn.click(); } catch {} }

      const desc = (document.querySelector("#description-inline-expander, #description yt-formatted-string, #description")?.innerText || "").trim();

      const chapters = [];
      const chapNodes = [...document.querySelectorAll("ytd-macro-markers-list-item-renderer, ytd-chapter-renderer")];
      chapNodes.forEach((ch) => {
        const time = ch.querySelector("#time, .macro-markers")?.textContent?.trim() || "";
        const cTitle = ch.querySelector("#details #title, h4")?.textContent?.trim() || "";
        if (time && cTitle) chapters.push(`[${time}] ${cTitle}`);
      });

      if (title || desc) {
        const chapSection = chapters.length ? `\n\nVideo Chapters:\n${chapters.join("\n")}` : "";
        const fallbackText = `[Note: Direct closed captions/transcripts are not available for this video. Summary based on video metadata, chapters, and description]\n\nTitle: ${title}\nChannel: ${channel}${chapSection}\n\nDescription:\n${desc.slice(0, 12000)}`;
        dlog("info", "yt:fallback", "title=" + title.slice(0, 40) + " desc=" + desc.length);
        return {
          ok: true,
          fallback: true,
          videoId: vid,
          title: title.slice(0, 150),
          channel,
          text: fallbackText,
          chunks: null
        };
      }
    } catch (e) {
      dlog("warn", "yt:fallback_err", String(e).slice(0, 100));
    }

    dlog("warn", "yt:empty", (urls.length ? "tt-urls=" + urls.length : "no-tt") + " pot=" + (pot ? "1" : "0"));
    return { ok: false, error: "no-transcript" };
  }
  function isGenerating() {
  const sels = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="stop streaming" i]',
    'button[aria-label*="stop generating" i]',
    'button[aria-label*="stop response" i]',
    'button[aria-label*="stop answering" i]',
    'button.stop-generating-button',
    'button[class*="stop-button"]',
    'div[data-is-streaming="true"]',
    '.result-streaming'
  ];
  for (const s of sels) {
    try {
      const el = document.querySelector(s);
      if (el && (el.offsetParent !== null || (el.offsetWidth || 0) > 0 || (el.offsetHeight || 0) > 0 || el.getClientRects().length > 0)) {
        return true;
      }
    } catch {}
  }
  return false;
}
function assistantTurnElements() {
  const sels = [
    'div[data-message-author-role="assistant"]',
    '[data-message-author-role="assistant"]',
    'div.font-claude-message',
    'div[class*="font-claude"]',
    'div.standard-markdown',
    'model-response',
    'message-content',
    'div.model-response-text',
    'div.response-container-content',
    'div[class*="response-content"]',
    'div.ds-markdown',
    'div[class*="ds-markdown"]',
    'div.ds-message',
    'div[class*="chat-message-content"]',
    'div[class*="segment-content"]',
    'div.prose',
    'div[class*="default prose"]',
    'article[data-testid^="conversation-turn"]',
    'article'
  ];
  for (const s of sels) {
    try {
      const els = [...document.querySelectorAll(s)].filter((e) => {
        if (e.closest('textarea, [contenteditable], form, nav, aside, [class*="sidebar" i], [class*="history" i]')) return false;
        const txt = (e.innerText || e.textContent || "").trim();
        return txt.length > 5;
      });
      if (els.length > 0) return els;
    } catch {}
  }
  return [];
}
function dismissModals() {
  try {
    // A bare "Accept"/"Agree" inside an unrelated dialog is not ours to click,
    // so the label must be a known consent label AND the surrounding surface
    // must actually be talking about cookies/consent/privacy.
    const CONSENT_LABEL = /^(accept( all)?( cookies)?|accept all cookies|allow all|i agree|agree|got it|ok|okay|continue)$/i;
    const CONSENT_CTX = /(cookie|consent|privacy|terms|gdpr|tracking|personal data)/i;
    for (const b of document.querySelectorAll('button, [role="button"], a[role="button"]')) {
      const txt = (b.innerText || b.textContent || "").trim();
      if (!txt || txt.length > 60) continue;
      if (!CONSENT_LABEL.test(txt)) continue;
      const box = b.closest('dialog, [role="dialog"], [class*="consent" i], [class*="cookie" i], [class*="gdpr" i], [id*="fc-button" i]');
      if (!box) continue;
      if (!CONSENT_CTX.test(txt) && !CONSENT_CTX.test(box.textContent || "")) continue;
      try { b.click(); } catch {}
    }
  } catch {}
}
function assistantTurn() {
  const els = assistantTurnElements();
  if (els.length > 0) {
    const last = els[els.length - 1];
    return (last.innerText || last.textContent || "").trim();
  }
  return null;
}
function trimTrailingUI(t) {
  const UI = /^(think|deepsearch|copy|⤢ reader|retry\??|regenerate( response)?|share|like|dislike|stop|summarize in \d+ bullets|explain this more simply|what are the key risks\?|give concrete examples|what should i do next\?)$/i;
  const lines = String(t || "").split("\n");
  let cut = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    const L = lines[i].trim();
    if (!L) { cut = i; continue; }
    if (UI.test(L)) { cut = i; continue; }
    break;
  }
  return lines.slice(0, cut).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
function answerText(fallback, prompt) {
  const at = assistantTurn();
  let t = at || fallback || "";
  if (!at && prompt) {
    const p = String(prompt).trim();
    const head = p.slice(0, 150);
    const ix = t.indexOf(head);
    if (ix >= 0 && ix < 300) {
      t = t.slice(ix + head.length).replace(/^\s+/, "");
    }
  }
  return trimTrailingUI(t);
}
let sendInFlight = 0;
function loginRequired() {
  if (/^\/auth\//.test(location.pathname)) return true;
  if (findInput()) return false;
  const headerBtn = [...document.querySelectorAll("header a, header button")].some((b) => /^(Log in|Sign in)$/i.test((b.innerText || "").trim()));
  const hasLoginLink = !!document.querySelector('a[href*="/auth/login"]');
  return headerBtn || hasLoginLink;
}
async function sendAndWait(prompt, images, timeoutMs = 90000) {
  dismissModals();
  if (loginRequired()) return { ok: false, error: "login_required" };
  let genWait = 0;
  while (isGenerating() && genWait++ < 40) await new Promise((r) => setTimeout(r, 250));
  dismissModals();
  if (images && images.length) {
    try { await pasteImages(images); await new Promise((r) => setTimeout(r, 800)); if (attachmentSeen() === 0) { await pasteImages(images); await new Promise((r) => setTimeout(r, 800)); } } catch {}
  }
  let el = null;
  for (let w = 0; w < 60 && !el; w++) { dismissModals(); el = findInput(); if (!el) await new Promise((r) => setTimeout(r, 200)); }
  if (!el) return { ok: false, error: "no-input" };
  el.focus();
  el.scrollIntoView({ block: "center" });

  const beforeAssistantCount = assistantTurnElements().length;
  const beforeTurn = assistantTurn() || "";
  const beforeBody = lastText();

  let inserted = false;
  try { inserted = await insertPrompt(el, prompt); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  if (images && attachmentSeen() === 0) dlog("warn", "send:images-absent", "chips=0");

  // Wait up to 2000ms for send button to appear and be enabled
  let btn = findSend();
  for (let w = 0; w < 12 && !btn; w++) {
    await new Promise((r) => setTimeout(r, 150));
    btn = findSend();
  }

  // Dispatch Enter key event
  try {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  } catch {}

  // Directly click the send button if found
  if (btn) {
    try { btn.click(); } catch {}
  }

  let genStarted = false;
  for (let w = 0; w < 15; w++) {
    const curTurn = assistantTurn() || "";
    const curCount = assistantTurnElements().length;
    const bodyChanged = lastText() !== beforeBody && !lastText().endsWith(prompt.slice(-30));
    if (isGenerating() || curCount > beforeAssistantCount || curTurn !== beforeTurn || bodyChanged) {
      genStarted = true;
      break;
    }
    const retryBtn = findSend();
    if (retryBtn) {
      try { retryBtn.click(); } catch {}
      if (w >= 2) {
        try {
          const rect = retryBtn.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) {
            chrome.runtime.sendMessage({
              type: "SB_CDP_CLICK",
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            }).catch(() => {});
          }
        } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  let last = assistantTurn() || lastText();
  let stableTicks = 0;
  const t0 = Date.now();
  const upDl = images && images.length ? Date.now() + 6000 : 0;
  let scanned = 0;

  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 450));
    scanned++;
    // Heavy DOM scans (full-body innerText + selector sweeps) only run while
    // the page is mutating or we haven't yet confirmed generation started;
    // a forced scan every 11 ticks (~5s) covers shadow-DOM content that
    // MutationObserver on the light tree cannot see.
    if (!__sbDirty && !genStarted && scanned % 11 !== 0) continue;
    __sbDirty = false;
    const curAssistant = assistantTurn() || "";
    const curBody = lastText();
    const cur = curAssistant || curBody;

    if (/rate limit|too many requests|try again later|account limit|usage limit|quota|capacity limit|high demand|temporarily reached|reached.*rate limit|rate limit exceeded|upgraded to (a )?(paid|plus) plan/i.test(cur.slice(-700))) {
      return { ok: false, error: "rate_limited", text: cur.slice(0, 8000) };
    }
    if (upDl > Date.now() && /upload.*(failed|error)|error uploading|couldn.t upload/i.test(lastText().slice(-1200))) {
      dlog("warn", "send:upfail", "");
      return { ok: false, error: "upload_failed" };
    }

    const generating = isGenerating();
    const hasGrowth = cur.length > (beforeTurn.length || 0) + 15 || (curBody.length > beforeBody.length + 15);

    if (generating) {
      genStarted = true;
      stableTicks = 0;
      last = cur;
      continue;
    }

    if (genStarted || hasGrowth) {
      if (cur === last && cur.length > 15) {
        stableTicks++;
        // If stable for 4 ticks (~1.8s) without generating indicator -> complete!
        // Prevents premature completion on slow/reasoning models that pause between tokens
        if (stableTicks >= 4) {
          const ans = answerText(cur, prompt);
          if (ans && ans.length > 5) {
            const media = turnMedia().slice(0, 5);
            return { ok: true, text: ans, images: media.filter((im) => !im.video), videos: media.filter((im) => im.video) };
          }
        }
      } else {
        stableTicks = 0;
        last = cur;
      }
    }
  }

  // Timeout reached: check if we captured an answer
  const finalAns = answerText(assistantTurn() || lastText(), prompt);
  if (finalAns && finalAns.length > 15 && finalAns !== beforeTurn) {
    const media = turnMedia().slice(0, 5);
    return { ok: true, text: finalAns, images: media.filter((im) => !im.video), videos: media.filter((im) => im.video), partial: true };
  }

  return { ok: false, error: "no-response" };
}
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m.type === "SB_YTTRAN") {
      if (!(/^(www\.)?(youtube\.com|youtube-nocookie\.com|m\.youtube\.com)$/.test(location.hostname) || location.hostname === "youtu.be")) { send({ ok: false, error: "not-youtube" }); return true; }
    ytTranscript().then((r) => send(r));
    return true;
  }
  if (m.type === "SB_SEND") {
    const t0 = Date.now();
    const waitLimit = typeof m.timeoutMs === "number" ? m.timeoutMs : 180000;
    if (sendInFlight && Date.now() - sendInFlight < waitLimit + 30000) { send({ ok: false, error: "provider-busy" }); return true; }
    sendInFlight = Date.now();
    sendAndWait(String(m.prompt ?? ""), Array.isArray(m.images) ? m.images : null, waitLimit).then((r) => {
      sendInFlight = 0;
      dlog(r && r.ok ? "info" : "warn", "SB_SEND:done", "ok=" + !!(r && r.ok) + " ms=" + (Date.now() - t0) + (r && r.error ? " err=" + r.error : "") + (r && r.partial ? " partial" : ""));
      send(r);
    }).catch((e) => { sendInFlight = 0; send({ ok: false, error: String(e).slice(0, 160) }); });
    return true;
  }
  if (m.type === "SB_READ") {
    if (loginRequired()) { send({ ok: false, error: "login_required" }); return true; }
    if (!__sbDirty && window.__nbReadCache && Date.now() - window.__nbReadCache.ts < 5000) { send(window.__nbReadCache.res); return true; }
    __sbDirty = false;
    const rdMedia = turnMedia();
    const ans = assistantTurn() || lastText().slice(-4000);
    const res = { ok: true, title: document.title, url: location.href, text: ans, selection: String(window.getSelection()?.toString() || "").slice(0, 1500), images: rdMedia.filter((x) => !x.video).slice(0, 3), videos: rdMedia.filter((x) => x.video).slice(0, 2) };
    window.__nbReadCache = { res, ts: Date.now() };
    send(res);
    return true;
  }
function compressContext(text, targetLen = 6000) {
  if (!text || text.length <= targetLen) return text;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 20);
  const scored = paragraphs.map((p) => {
    let score = 0;
    if (/```[\s\S]*?```/.test(p)) score += 5;
    if (/\|.*?\|.*?\|/.test(p)) score += 4;
    if (/^[#*>-]/.test(p.trim())) score += 3;
    if (/\b\d+(\.\d+)?(%|px|ms|gb|mb|usd|\$|€|₹)?\b/i.test(p)) score += 2;
    if (p.length > 80 && p.length < 500) score += 1;
    if (/cookie|privacy policy|terms of service|copyright|all rights reserved|subscribe|newsletter/i.test(p)) score -= 10;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  let acc = "";
  for (const item of scored) {
    if (acc.length + item.p.length > targetLen) continue;
    acc += item.p + "\n\n";
  }
  return acc.trim() || text.slice(0, targetLen);
}

  if (m.type === "SB_COMPRESS") {
    const raw = String(m.text || "");
    const compressed = compressContext(raw, m.targetLen || 6000);
    send({ ok: true, text: compressed, originalLen: raw.length, compressedLen: compressed.length });
    return true;
  }
  if (m.type === "SB_PAGE") {
    (async () => {
      try {
        let el = null;
        for (const sel of ["article", "main", "[role=main]", "div[id*=content]", "div[class*=content]"]) {
          const els = [...document.querySelectorAll(sel)].filter((e) => (e.innerText || "").length > 500);
          if (els.length) { el = els.reduce((a, b) => ((a.innerText || "").length >= (b.innerText || "").length ? a : b)); break; }
        }
        const heads = [...document.querySelectorAll("h1,h2")].slice(0, 8).map((h) => (h.innerText || "").trim()).filter(Boolean).slice(0, 6).join(" / ");
        const meta = String((document.querySelector('meta[name=description], meta[property="og:description"], meta[property="og:title"]') || {}).content || "").slice(0, 400);
        const rawMain = ((el || document.body).innerText || "").replace(/\n{3,}/g, "\n\n").trim();
        const main = m.compress ? compressContext(rawMain, 8000) : rawMain.slice(0, 15000);
        send({ ok: true, url: location.href, title: document.title, heads, meta, text: main, sel: String(window.getSelection()?.toString() || "").slice(0, 1500), chars: main.length, rawChars: rawMain.length });
      } catch (e) { send({ ok: false, error: String(e).slice(0, 200) }); }
    })();
    return true;
  }
  if (m.type === "SB_SNAPSHOT") {
    const els = [...document.querySelectorAll("textarea,button,div[contenteditable=true]")].slice(0, 50).map((e, i) => `@e${i} ${e.tagName} ${(e.innerText || "").slice(0, 80)}`);
    send({ ok: true, url: location.href, tree: els.join("\n") });
    return true;
  }
  if (m.type === "SB_TOOL") {
    const op = m.op, a = m.args || {};
    try {
      if (op === "snapshot") {
        const els = [...document.querySelectorAll("a,button,input,textarea,select,div[contenteditable=true],[role=button]")].slice(0, 80).map((e, i) => `@e${i} ${e.tagName} ${(e.innerText || e.value || "").slice(0, 60)}`);
        send({ ok: true, url: location.href, title: document.title, tree: els.join("\n") });
      } else if (op === "click") {
        const el = document.querySelector(a.selector || "");
        if (!el) send({ ok: false, error: "not-found" });
        else { el.click(); send({ ok: true }); }
      } else if (op === "fill") {
        const el = document.querySelector(a.selector || "");
        if (!el) send({ ok: false, error: "not-found" });
        else { insertPrompt(el, a.value || "").catch(() => setNativeValue(el, a.value || "")).then(() => send({ ok: true })).catch(() => { setNativeValue(el, a.value || ""); send({ ok: true }); }); }
      } else if (op === "extract_links") {
        const links = Array.from(document.querySelectorAll("div#search a")).map((x) => { try { return x.href; } catch { return ""; } }).filter((h) => h && h.startsWith("http") && !h.includes("google.") && !h.includes("webcache")).slice(0, 8);
        send({ ok: true, value: links.join("\n") });
      } else send({ ok: false, error: "unknown-op" });
    } catch (e) { send({ ok: false, error: String(e).slice(0, 200) }); }
    return true;
  }
  if (m.type === "SB_FETCH") {
    (async () => {
      try {
        const host = location.hostname;
        for (let w = 0; w < 24; w++) { if (document.querySelectorAll("a[href]").length > 5) break; await new Promise((r) => setTimeout(r, 250)); }
        let stable = 0, prev = -1;
        for (let w = 0; w < 12 && stable < 2; w++) {
          try { const sc = document.querySelector("nav, aside") || document.scrollingElement; sc.scrollTop += 1200; } catch {}
          window.scrollTo(0, 900 * w);
          await new Promise((r) => setTimeout(r, 700));
          const n = document.querySelectorAll('a[href^="/c/"], a[href*="/c/"], a[href*="/chat/"], a[href*="/app/"], a[href*="/conversation"], a[href*="/share/"]').length;
          if (n === prev) stable++;
          else { stable = 0; prev = n; }
        }
        const out = new Map();
        const push = (t, u) => { t = (t || "").trim().replace(/\s+/g, " ").slice(0, 80); try { u = new URL(u, location.origin).href; } catch {} if (t && u && !out.has(u) && t.length > 2 && !/^(New chat|Search|Explore|Settings|Help|Upgrade|Login|Sign)/i.test(t)) out.set(u, t); };
        document.querySelectorAll('a[href^="/c/"], a[href*="/c/"], a[href*="/chat/"], a[href*="/conversation"], a[href*="/app/"], a[href*="/share/"]').forEach((a) => push(a.innerText || a.title, a.href));
        const raw = [...document.querySelectorAll("nav a, aside a")].slice(0, 5).map((a) => ((a.innerText || "").trim().slice(0, 40) + " → " + (a.href || "").slice(0, 60)));
        const allLinks = document.querySelectorAll("a[href]").length;
        const loggedIn = !/Log in|Sign in/i.test((document.body.innerText || "").slice(0, 2000)) || !!document.querySelector("textarea, div[contenteditable=true]");
        const items = [...out.entries()].map(([url, title]) => ({ title, url })).slice(0, 100);
        dlog(items.length ? "info" : "warn", "SB_FETCH:done", host + " items=" + items.length + " links=" + allLinks + " loggedIn=" + loggedIn);
        send({ ok: true, items, debug: { host, links: allLinks, loggedIn, title: document.title, raw } });
      } catch (e) { send({ ok: false, error: String(e).slice(0, 160) }); }
    })();
    return true;
  }
  if (m.type === "SB_AI") {
    try {
      const heads = [...document.querySelectorAll("h1,h2,h3")];
      const aiHead = heads.find((h) => /AI Overview|AI Mode/i.test(h.innerText || ""));
      let ai = "";
      if (aiHead) {
        let el = aiHead.closest("div");
        for (let i = 0; i < 4 && el && ai.length < 2000; i++) { ai = (el.innerText || "").slice(0, 2000); el = el.parentElement; }
      }
      const results = [...document.querySelectorAll("div#search a h3")].slice(0, 5).map((h) => "• " + h.innerText.slice(0, 120)).join("\n");
      send({ ok: true, ai: ai.slice(0, 2000), results, title: document.title, hasAI: !!aiHead });
    } catch (e) { send({ ok: false, error: String(e).slice(0, 160) }); }
    return true;
  }
  if (m.type === "SB_THREAD") {
    (async () => {
      try {
        const FAMS = [
          'section[data-turn]',
          '[data-message-author-role]',
          'li[data-message-role]',
          'div[data-testid="user-message"]',
          'div.font-claude-message',
          'user-query, model-response',
          'article[data-testid^="conversation-turn"]',
          '[data-testid^="conversation-turn"]',
          '[data-message-id]',
          '[class*="turn-message"]',
          'article'
        ];
        let fam = -1;
        for (let w = 0; w < 30; w++) {
          for (let f = 0; f < FAMS.length; f++) {
            if (document.querySelectorAll(FAMS[f]).length > 0) { fam = f; break; }
          }
          if (fam >= 0) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        const SEL = fam >= 0 ? FAMS[fam] : null;
        let scrollEl = null;
        if (SEL) {
          const el0 = document.querySelector(SEL);
          scrollEl = el0 && (el0.closest('[class*="scroll"], main, div[class*="overflow"]') || null);
        }
        let stable = 0, prev = -1;
        for (let i = 0; i < 12 && stable < 2; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
          await new Promise((r) => setTimeout(r, 400));
          const n = SEL ? document.querySelectorAll(SEL).length : 0;
          if (n === prev) stable++; else { stable = 0; prev = n; }
        }
        const all = SEL ? [...document.querySelectorAll(SEL)] : [];
        const leaf = all.filter((el) => !all.some((e2) => e2 !== el && el.contains(e2)));
        const seen = new Set();
        const turns = [];
        leaf.slice(0, 200).forEach((el) => {
          const roleAttr = String(el.getAttribute("data-turn") || el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role") || el.getAttribute("data-testid") || "").toLowerCase();
          const tag = (el.tagName || "").toLowerCase();
          const cls = (typeof el.className === "string" ? el.className : "").toLowerCase();
          const who = (roleAttr.includes("user") || tag === "user-query" || cls.includes("user-message")) ? "me" : "ai";
          const t = (el.textContent || "").trim();
          if (t.length <= 5) return;
          const key = t.slice(0, 120) + "|" + t.length;
          if (seen.has(key)) return;
          seen.add(key);
          const tMedia = mediaIn(el).slice(0, 3);
          turns.push({ role: who, text: t.slice(0, 8000), images: tMedia.filter((x) => !x.video), videos: tMedia.filter((x) => x.video) });
        });
        if (!turns.length) {
          const probe = "fam=" + fam + " fams=[" + FAMS.map((s) => document.querySelectorAll(s).length).join(",") + "] bodyLen=" + ((document.body.innerText || "").length) + " login=" + loginRequired() + " title=" + (document.title || "").slice(0, 60) + " tail=" + lastText().slice(-180);
          dlog("warn", "SB_THREAD:probe", probe);
          const dig = ((document.querySelector("main") || document.body).innerText || "").trim();
          if (dig.length > 80) {
            dlog("warn", "SB_THREAD:digest", "len=" + dig.length + " " + location.href);
            send({ ok: true, thread: [{ role: "ai", text: dig.slice(0, 20000) }], url: location.href, title: document.title, found: all.length, digest: true });
            return;
          }
        }
        if (!turns.length) dlog("warn", "SB_THREAD:empty", "found=" + all.length + " " + location.href);
        else dlog("info", "SB_THREAD:done", "found=" + all.length + " turns=" + turns.length + " " + location.href);
        send({ ok: true, thread: turns.slice(0, 100), url: location.href, title: document.title, found: all.length });
      } catch (e) { send({ ok: false, error: String(e).slice(0, 160) }); }
    })();
    return true;
  }
});

  // Antigravity-grade Two-Way Webpage Event Bridge
  try {
    document.documentElement.setAttribute("data-navibridge-tab-id", location.hostname);
    // SECURITY: this channel receives messages from untrusted webpage JS.
    // Allowlist trusted origins and read-only ops only; strip cross-tab tabId;
    // never let payload override the message type.
    const RELAY_TYPES = new Set(["SB_PAGE", "SB_READ"]);
    // Exact host match only — a wildcard would let any subdomain (or a
    // lookalike) borrow the extension's page-read capability.
    const RELAY_HOST_RE = /^(?:www\.)?(chatgpt\.com|gemini\.google\.com|claude\.ai|grok\.com|kimi\.ai|kimi\.moonshot\.cn|kimi\.com|chat\.deepseek\.com|perplexity\.ai|localhost)$/i;
    window.addEventListener("message", (ev) => {
      if (ev.source !== window || !ev.data || ev.data.source !== "navibridge-client") return;
      const { id, type, payload } = ev.data;
      const t = String(type || "");
      if (!RELAY_TYPES.has(t)) return;
      if (!RELAY_HOST_RE.test(location.hostname)) return;
      if (payload && (typeof payload !== "object" || Array.isArray(payload))) return;
      chrome.runtime.sendMessage({ ...Object(payload || {}), type: t, tabId: undefined }, (res) => {
        // Same-origin only: a wildcard target would hand the response to
        // whatever origin the page navigated to in the meantime.
        window.postMessage({
          source: "navibridge-extension",
          id,
          response: res || { ok: false, error: "no-response" }
        }, location.origin);
      });
    });
  } catch {}
})();
