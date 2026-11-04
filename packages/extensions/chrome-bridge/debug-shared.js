// NaviBridge debug logger — loaded in ALL surfaces: background SW, sidepanel, popup, and every content script.
// Every surface calls dbgInit("<scope>") once. All entries land in one capped chronological store
// (chrome.storage.local: sb_buglog) and export as a single .md file via exportBugLogMD().

(() => {
if (globalThis.__nbDbgReady) return;
globalThis.__nbDbgReady = true;
const DBG_KEY = "sb_buglog";
const DBG_CAP = 400;
let __dbgScope = "unknown";
let __dbgBuf = [];
let __dbgTimer = null;
let __dbgFlushing = false;
let __flushFails = 0;

function dbgVersion() { try { return chrome.runtime.getManifest().version; } catch { return "?"; } }

function dbgInit(scope) {
  __dbgScope = String(scope || "unknown");
  captureConsole();
  try {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("error", (e) => dlog("error", "window.onerror", (e.message || "error") + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno));
      window.addEventListener("unhandledrejection", (e) => dlog("error", "unhandledrejection", e.reason));
      window.addEventListener("pagehide", () => { try { if (__dbgTimer && typeof __dbgTimer.unref === "function") __dbgTimer.unref(); clearTimeout(__dbgTimer); __dbgTimer = null; } catch {} flushDbg(); });
    }
    if (typeof self !== "undefined" && self.addEventListener && typeof window === "undefined") {
      self.addEventListener("error", (e) => dlog("error", "sw.onerror", e.message));
      self.addEventListener("unhandledrejection", (e) => dlog("error", "sw.unhandledrejection", e.reason));
    }
  } catch {}
  dlog("debug", "boot", __dbgScope + " v" + dbgVersion());
}

function captureConsole() {
  try {
    if (typeof console === "undefined" || console.__nbDbg) return;
    console.__nbDbg = true;
    ["log", "info", "warn", "error", "debug"].forEach((k) => {
      const orig = console[k] && console[k].bind(console);
      if (!orig) return;
      console[k] = function (...args) {
        // Only error/warn are ever recorded (see dlog's console.* filter):
        // skip the serialization of ordinary log traffic so patched real
        // browser pages and site code don't pay a JSON.stringify tax per call.
        if (k === "error" || k === "warn") {
          try { dlog(k, "console." + k, args.map(safeStr).join(" ")); } catch {}
        }
        orig(...args);
      };
    });
  } catch {}
}

function safeStr(x) {
  try {
    if (x instanceof Error) return (x.message || "Error") + (x.stack ? " " + String(x.stack).slice(0, 220) : "");
    if (typeof x === "string") return x;
    return JSON.stringify(x);
  } catch { return String(x); }
}

function dlog(level, where, msg, context) {
  try {
    const w = String(where || "");
    const lv = String(level || "info").toLowerCase();
    if (w.startsWith("console.") && lv !== "error" && lv !== "warn") return;
    const red = (s) => String(s == null ? "" : s)
      .replace(/(token|apikey|api_key|secret|password|passwd|authorization|bearer)["'\s:=]{0,6}[^\s"',}]{4,}/gi, "$1***")
      .replace(/\b[0-9a-f]{24,}\b/gi, "...")
      .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "...");
    const now = Date.now();
    __dbgBuf.push({
      id: now.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      ts: now,
      iso: new Date(now).toISOString(),
      scope: __dbgScope,
      level: String(level || "info").slice(0, 8),
      where: String(where || "-").slice(0, 140),
      msg: red((msg && msg.stack) || msg).slice(0, 300),
      ctx: red(context).slice(0, 200)
    });
    if (__dbgBuf.length >= 40) { flushDbg(); return; }
    clearTimeout(__dbgTimer);
    __dbgTimer = setTimeout(flushDbg, 350);
    try { if (__dbgTimer && typeof __dbgTimer.unref === "function") __dbgTimer.unref(); } catch {}
  } catch {}
}

async function flushDbg() {
  if (__dbgFlushing || !__dbgBuf.length) return;
  __dbgFlushing = true;
  const batch = __dbgBuf.splice(0, __dbgBuf.length);
  try {
    if (__dbgScope !== "background" && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      await chrome.runtime.sendMessage({ type: "SB_LOG", entries: batch });
    } else {
      let cur = [];
      try { const s = await chrome.storage.local.get(DBG_KEY); cur = (s && s[DBG_KEY]) || []; } catch {}
      const have = new Set(cur.map((e) => e && e.id));
      const add = batch.filter((e) => !have.has(e.id));
      await chrome.storage.local.set({ [DBG_KEY]: cur.concat(add).slice(-DBG_CAP) });
    }
    __flushFails = 0;
  } catch {
    const attempt = (__flushFails || 0) + 1;
    __flushFails = attempt;
    if (attempt <= 3) __dbgBuf.unshift.apply(__dbgBuf, batch.slice(-60));
  }
  __dbgFlushing = false;
}

function logBug(where, error, context) { dlog("error", where, error, context); }

async function exportBugLogMD() {
  try { await flushDbg(); } catch {}
  let s = {};
  try { s = (await chrome.storage.local.get([DBG_KEY, "sb_sessions"])) || {}; } catch {}
  const log = s[DBG_KEY] || [];
  const sessions = s.sb_sessions || [];
  let ownTabs = {};
  try { ownTabs = ((await chrome.storage.session.get("sb_own_tabs")) || {}).sb_own_tabs || {}; } catch {}
  const counts = {};
  const scopes = {};
  log.forEach((b) => {
    const lv = b.level || "error"; counts[lv] = (counts[lv] || 0) + 1;
    const sc = b.scope || "?"; scopes[sc] = (scopes[sc] || 0) + 1;
  });
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "n/a";
  let md = `# NaviBridge Debug Log\n\n_Exported ${new Date().toISOString()}_\n\n## Environment\n\n- Extension: v${dbgVersion()}\n- Entry scopes: ${Object.entries(scopes).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n- Levels: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n- Sessions stored: ${sessions.length}\n- Owned tabs: ${Object.keys(ownTabs).join(", ") || "none"}\n- UA: ${ua}\n- Exported at: ${new Date().toString()}\n\n`;
  const errs = log.filter((b) => (b.level || "error") === "error");
  md += `## Errors (newest first, ${errs.length})\n\n`;
  if (!errs.length) md += "_No errors logged._\n\n";
  [...errs].reverse().forEach((b, i) => {
    const ctx = b.ctx || b.context || "";
    md += `### ${i + 1}. [${b.scope || "?"}] ${b.where || "?"} — ${b.iso || new Date(b.ts || 0).toISOString()}\n\n\`\`\`\n${b.msg || b.error || "unknown"}\n\`\`\`\n\n${ctx ? "Context: " + ctx + "\n\n" : ""}`;
  });
  md += `## Full timeline (newest first, ${log.length})\n\n`;
  if (!log.length) md += "_No entries._\n";
  [...log].reverse().forEach((b) => {
    const t = String(b.iso || new Date(b.ts || 0).toISOString()).slice(11, 23);
    const lv = String(b.level || "error").toUpperCase().padEnd(5);
    const line = String(b.msg || b.error || "").replace(/\s*\n\s*/g, " ⏎ ").replace(/`/g, "'").slice(0, 300);
    md += `- \`${t}\` **${lv}** [${b.scope || "?"}] ${String(b.where || "").replace(/`|\n/g, " ")}: ${line}\n`;
  });
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  const el = document.createElement("a");
  el.href = url;
  el.download = "navibridge-debug-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".md";
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
globalThis.dbgInit = dbgInit;
globalThis.dlog = dlog;
globalThis.flushDbg = flushDbg;
globalThis.logBug = logBug;
globalThis.exportBugLogMD = exportBugLogMD;
globalThis.dbgVersion = dbgVersion;
})();
