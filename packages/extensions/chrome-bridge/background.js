try { importScripts("debug-shared.js"); } catch {}
try { dbgInit("background"); } catch {}
const WS_URL = "ws://127.0.0.1:10086/ws";
const URLS = { chatgpt: "https://chatgpt.com/", gemini: "https://gemini.google.com/app", claude: "https://claude.ai/new", grok: "https://grok.com/", kimi: "https://www.kimi.ai/?chat_enter_method=new_chat", deepseek: "https://chat.deepseek.com/", perplexity: "https://www.perplexity.ai/", ChatGPT: "https://chatgpt.com/", Gemini: "https://gemini.google.com/app", Claude: "https://claude.ai/new", Grok: "https://grok.com/", Kimi: "https://www.kimi.ai/?chat_enter_method=new_chat", DeepSeek: "https://chat.deepseek.com/", Perplexity: "https://www.perplexity.ai/" };
let ws = null, want = false, timer = null, connecting = false, heartbeat = null;
async function shouldLink() { try { const s = await chrome.storage.local.get("sb_agent"); return s.sb_agent !== false; } catch { return true; } }
function waitComplete(tabId, ms = 15000) {
  return new Promise((resolve) => {
    let done = false;
    let listener = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(tl);
      try { if (listener) chrome.tabs.onUpdated.removeListener(listener); } catch {}
      resolve();
    };
    const tl = setTimeout(finish, ms);
    try {
      chrome.tabs.onUpdated.addListener(listener = (id, info) => {
        if (id === tabId && info.status === "complete") finish();
      });
    } catch { finish(); }
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === "complete") finish(); }).catch(finish);
  });
}
async function tabOriginPattern(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    if (t && t.url) return new URL(t.url).origin + "/*";
  } catch {}
  return null;
}
async function hasHostAccess(originPattern) {
  if (!originPattern || !chrome.permissions || !chrome.permissions.contains) return false;
  try { return await chrome.permissions.contains({ origins: [originPattern] }); } catch { return false; }
}
async function ensureContent(tabId) {
  for (let i = 0; i < 2; i++) {
    try { const r = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }); if (r) return { ok: true }; } catch {}
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ["debug-shared.js", "content.js"] }); } catch {}
    for (let w = 0; w < 7; w++) {
      await new Promise((res) => setTimeout(res, 120));
      try { const r = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }); if (r) return { ok: true }; } catch {}
    }
  }
  // The content script is only declared for the AI provider hosts. On any
  // other site we need the optional "<all_urls>" grant, which the user
  // enables from the sidebar ("Allow reading any page").
  const origin = await tabOriginPattern(tabId);
  const granted = origin ? await hasHostAccess(origin) : false;
  return {
    ok: false,
    error: "no-content-script",
    origin: origin || undefined,
    needsPermission: !!origin && !granted
  };
}

// NOTE: MV3 lifecycle — an active WebSocket with inbound traffic keeps the service
// worker alive (Chrome 116+). The daemon pings every 15s; connect() also sends an
// outbound heartbeat so the socket stays active even if the daemon stops pinging.
// A no-op offscreen "sentinel" was removed: offscreen docs do NOT keep SWs alive.

// Native CDP Hardware Input via chrome.debugger (Kimi method: isTrusted = true)
async function cdpAttach(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    const s = String(e).toLowerCase();
    if (s.includes("already attached") || s.includes("another debugger")) {
      return;
    }
    try {
      await chrome.debugger.detach({ tabId });
      await chrome.debugger.attach({ tabId }, "1.3");
      return;
    } catch {}
    throw e;
  }
}

async function cdpDetach(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
}
const cdDefTimers = {};
function deferCdDetach(tabId, delay) {
  try { if (cdDefTimers[tabId]) clearTimeout(cdDefTimers[tabId]); } catch {}
  cdDefTimers[tabId] = setTimeout(() => { try { cdpDetach(tabId); } catch {} delete cdDefTimers[tabId]; }, delay);
}

async function cdpClick(tabId, x, y) {
  await cdpAttach(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1
    });
    await new Promise((r) => setTimeout(r, 60));
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1
    });
    return { ok: true };
  } finally {
    deferCdDetach(tabId, 10000);
  }
}

async function cdpType(tabId, text) {
  await cdpAttach(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
    return { ok: true };
  } finally {
    deferCdDetach(tabId, 10000);
  }
}

async function cdpScreenshot(tabId) {
  await cdpAttach(tabId);
  try {
    const res = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", { format: "jpeg", quality: 80 });
    return { ok: true, dataUrl: "data:image/jpeg;base64," + res.data };
  } finally {
    deferCdDetach(tabId, 10000);
  }
}

// Semantic Accessibility Tree extraction via Accessibility.getFullAXTree (The Kimi Method)
async function cdpAXTree(tabId) {
  await cdpAttach(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable");
    const res = await chrome.debugger.sendCommand({ tabId }, "Accessibility.getFullAXTree");
    const rawNodes = (res && res.nodes) || [];
    const distilled = rawNodes
      .filter((n) => !n.ignored && (n.name?.value || n.role?.value === "textbox" || n.role?.value === "button"))
      .slice(0, 300)
      .map((n) => ({
        id: n.nodeId,
        role: n.role?.value || "unknown",
        name: n.name?.value || "",
        value: n.value?.value || undefined
      }));
    return { ok: true, count: distilled.length, nodes: distilled };
  } finally {
    deferCdDetach(tabId, 10000);
  }
}

// Native selector-based click via DOM.getBoxModel (Kimi method)
async function cdpClickSelector(tabId, selector) {
  await cdpAttach(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
    const { root } = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const { nodeId } = await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) return { ok: false, error: "element-not-found" };
    const { model } = await chrome.debugger.sendCommand({ tabId }, "DOM.getBoxModel", { nodeId });
    const [x1, y1, x2, y2, x3, y3] = model.content;
    const x = (x1 + x2) / 2;
    const y = (y1 + y3) / 2;
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await new Promise((r) => setTimeout(r, 60));
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    return { ok: true, x, y };
  } finally {
    deferCdDetach(tabId, 10000);
  }
}

async function requestApproval(name, args) {
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 30000);
      chrome.runtime.sendMessage({
        type: "SB_ACTION_CHECKPOINT",
        message: `NaviBridge Agent requests to execute sensitive tool: "${name}"`,
        action: { tool: name, args }
      }, (resp) => {
        clearTimeout(timer);
        resolve(!!resp?.approved);
      });
    });
  } catch {
    return false;
  }
}

// Gate agent actions behind the user-facing checkpoint (sb_tool_gate setting can disable)
async function gated(name, args) {
  try {
    const s = await chrome.storage.local.get({ sb_tool_gate: true });
    if (s.sb_tool_gate === false) return true;
  } catch {}
  return await requestApproval(name, args);
}

// Unified Kimi & Antigravity Tool Registry Execution Engine
async function executeTool(name, args = {}) {
  let tabId = args.tabId ? Number(args.tabId) : null;
  if (!tabId) {
    try {
      const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (act && act.id) tabId = act.id;
    } catch {}
  }

  switch (name) {
    case "ask": {
      const provider = args.provider || "chatgpt";
      const prompt = String(args.prompt || "");
      if (!prompt.trim()) return { ok: false, error: "empty-prompt" };
      return await askHidden(provider, prompt.slice(0, 20000), args.images, args.timeoutMs);
    }
    case "click":
    case "mouse_click": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      if (!await gated("click", { tabId, selector: args.selector, x: args.x, y: args.y })) return { ok: false, error: "action_rejected_by_user" };
      if (args.selector) return await cdpClickSelector(tabId, args.selector);
      if (Number.isFinite(args.x) && Number.isFinite(args.y)) return await cdpClick(tabId, args.x, args.y);
      return { ok: false, error: "missing-coordinates-or-selector" };
    }
    case "fill":
    case "key_type": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      const text = String(args.text ?? args.value ?? "");
      if (!await gated("fill", { tabId, selector: args.selector, text })) return { ok: false, error: "action_rejected_by_user" };
      if (args.selector) {
        await cdpClickSelector(tabId, args.selector);
        await new Promise((r) => setTimeout(r, 100));
      }
      return await cdpType(tabId, text);
    }
    case "snapshot": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      return await cdpAXTree(tabId);
    }
    case "screenshot": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      if (!await gated("screenshot", { tabId })) return { ok: false, error: "action_rejected_by_user" };
      return await cdpScreenshot(tabId);
    }
    case "read_page": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      const injected = await ensureContent(tabId);
      if (injected && injected.needsPermission) {
        return { ok: false, error: "host-permission-required", origin: injected.origin, hint: "Enable 'Allow reading any page' in the NaviBridge sidebar preferences" };
      }
      let t = null;
      try { t = await chrome.tabs.get(tabId); } catch {}
      if (t && t.url && /youtube\.com|youtu\.be/.test(t.url)) {
        const yt = await chrome.tabs.sendMessage(tabId, { type: "SB_YTTRAN" }).catch(() => null);
        if (yt && yt.ok) return yt;
      }
      const pg = await chrome.tabs.sendMessage(tabId, { type: "SB_PAGE" }).catch(() => null);
      if (pg && pg.ok && pg.text && pg.text.length > 50) return pg;
      return await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }).catch((e) => ({ ok: false, error: String(e) }));
    }
    case "navigate": {
      const url = String(args.url || "");
      if (!url.startsWith("http")) return { ok: false, error: "bad-url" };
      // The approval prompt must show the payload that will actually run —
      // truncating it here would let the user approve one thing and execute
      // another. The sidepanel scrolls long values for display.
      if (!await gated("navigate", { tabId, url, newTab: !!args.newTab })) return { ok: false, error: "action_rejected_by_user" };
      if (tabId && !args.newTab) {
        const t = await chrome.tabs.update(tabId, { url });
        await waitComplete(t.id, 15000);
        return { ok: true, tabId: t.id, url: t.url };
      } else {
        const t = await chrome.tabs.create({ url, active: args.active !== false });
        await waitComplete(t.id, 15000);
        return { ok: true, tabId: t.id, url: t.url };
      }
    }
    case "evaluate": {
      if (!tabId) return { ok: false, error: "no-active-tab" };
      const expr = String(args.expression || args.script || "");
      if (!expr) return { ok: false, error: "empty-expression" };
      // Show the user the expression that will actually be evaluated.
      const approved = await gated("evaluate", { tabId, expression: expr });
      if (!approved) return { ok: false, error: "action_rejected_by_user" };
      await cdpAttach(tabId);
      try {
        const res = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: expr, returnByValue: true });
        return { ok: true, result: res?.result?.value };
      } finally {
        deferCdDetach(tabId, 10000);
      }
    }
    case "list_tabs": {
      try {
        const tabs = await chrome.tabs.query({});
        return { ok: true, tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active, pinned: t.pinned })) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
    case "read_answer":
    case "poll": {
      const provider = args.provider || "chatgpt";
      return await pollHidden(provider);
    }
    default:
      return { ok: false, error: "unsupported-tool: " + name };
  }
}

if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener((source, reason) => {
    dlog("info", "debugger:detached", (source.tabId || "?") + " reason=" + reason);
  });
}

const bug = (where, error, context) => { try { logBug(where, error, context); } catch {} };
let logChain = Promise.resolve();
const ownTabs = {};
const ownTabsMeta = {};
function touchOwnTab(key, user) {
  const meta = ownTabsMeta[key] || {};
  if (user !== undefined) meta.user = user;
  meta.ts = Date.now();
  ownTabsMeta[key] = meta;
  saveOwnTabs();
}
function saveOwnTabs() { try { chrome.storage.session.set({ sb_own_tabs: ownTabs, sb_own_tabs_meta: ownTabsMeta }).catch(() => {}); } catch {} }
(async () => { try { const s = await chrome.storage.session.get(["sb_own_tabs", "sb_own_tabs_meta"]); Object.assign(ownTabs, s.sb_own_tabs || {}); Object.assign(ownTabsMeta, s.sb_own_tabs_meta || {}); if (Object.keys(ownTabs).length) dlog("info", "ownTabs:restore", Object.keys(ownTabs).join(",")); } catch {} })();
async function reapTabs() {
  for (const key of Object.keys(ownTabs)) {
    const meta = ownTabsMeta[key] || {};
    if (meta.user) continue;
    if (Date.now() - (meta.ts || 0) < 15 * 60 * 1000) continue;
    if (key.startsWith("ask:") && askBusy[key.slice(4)]) continue;
    const tid = ownTabs[key];
    // Never close a tab the user is currently looking at — reap it later.
    let active = false;
    try { const t = await chrome.tabs.get(tid); active = !!(t && t.active); } catch {}
    if (active) { touchOwnTab(key); continue; }
    try { await chrome.tabs.remove(tid); dlog("info", "ownTab:reap", key + " id=" + tid); } catch {}
    delete ownTabs[key]; delete ownTabsMeta[key]; saveOwnTabs();
  }
}
chrome.alarms.create("sb_reap", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "sb_reap") reapTabs(); });
const HOST_ALIASES = [
  ["kimi.ai", "kimi.com", "kimi.moonshot.cn"],
  ["chatgpt.com", "chat.openai.com", "openai.com"],
  ["claude.ai", "anthropic.com"],
  ["deepseek.com", "chat.deepseek.com"],
  ["perplexity.ai", "perplexity.com"]
];
function hostEq(h, base) { return h === base || h.endsWith("." + base); }
function matchHost(h1, h2) {
  if (!h1 || !h2) return false;
  if (hostEq(h1, h2) || hostEq(h2, h1)) return true;
  for (const group of HOST_ALIASES) {
    if (group.some((x) => hostEq(h1, x)) && group.some((x) => hostEq(h2, x))) return true;
  }
  return false;
}
async function getOwnTab(key, url, opts = {}) {
  if (!String(url).startsWith("http")) throw new Error("bad-url");
  const host = new URL(url).hostname;
  const baseHost = host.replace(/^www\./, "");
  const id = ownTabs[key];
  if (id != null) {
    const meta = ownTabsMeta[key] || {};
    try {
      const t = await chrome.tabs.get(id);
      if (t && t.url) {
        const curHost = new URL(t.url).hostname;
        if (hostEq(curHost, baseHost) || hostEq(curHost.replace(/^www\./, ""), baseHost)) {
          dlog("debug", "ownTab:reuse", key + " id=" + id);
          touchOwnTab(key);
          return id;
        } else if (!meta.user && matchHost(curHost, host)) {
          // Extension-owned tab on an alias host (like kimi.com instead of kimi.ai); redirect it, never user tabs
          dlog("info", "ownTab:redirectAlias", key + " id=" + id + " -> " + url);
          touchOwnTab(key);
          await chrome.tabs.update(id, { url });
          await waitComplete(id, 12000);
          return id;
        }
      }
    } catch {}
  }
  // Check if user already has an open tab for this provider to reuse session & login!
  try {
    const tabs = await chrome.tabs.query({});
    let bestTab = tabs.find((t) => {
      try { return hostEq(new URL(t.url).hostname.replace(/^www\./, ""), baseHost); } catch { return false; }
    });
    if (!bestTab) {
      bestTab = tabs.find((t) => {
        try { return matchHost(new URL(t.url).hostname.replace(/^www\./, ""), host); } catch { return false; }
      });
    }
    if (bestTab) {
      ownTabs[key] = bestTab.id;
      touchOwnTab(key, true);
      saveOwnTabs();
      dlog("info", "ownTab:foundUserTab", key + " id=" + bestTab.id + " " + bestTab.url);
      return bestTab.id;
    }
  } catch {}

  // If no existing tab, create a pinned tab in the active window so Chrome never freezes it
  let t = null;
  try {
    const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (act && act.windowId) {
      t = await chrome.tabs.create({ windowId: act.windowId, url, active: false, pinned: true });
    }
  } catch {}
  if (!t) {
    t = await chrome.tabs.create({ url, active: false, pinned: true });
  }
  try { chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {}); } catch {}
  ownTabs[key] = t.id;
  touchOwnTab(key, false);
  saveOwnTabs();
  dlog("info", "ownTab:create", key + " id=" + t.id + " " + url);
  await waitComplete(t.id, opts.wait || 25000);
  return t.id;
}
async function navigateOwn(key, url, opts = {}) {
  const id = await getOwnTab(key, url, opts);
  let navigated = false;
  try {
    const t = await chrome.tabs.get(id);
    if (t && t.url !== url) { navigated = true; dlog("info", "ownTab:navigate", key + " " + url); await chrome.tabs.update(id, { url, active: false }); await waitComplete(id, opts.wait || 25000); }
  } catch (e) { dlog("warn", "ownTab:navfail", String(e).slice(0, 120)); }
  return { id, navigated };
}
const askBusy = {};
async function askHidden(provider, prompt, images, timeoutMs = 185000) {
  const key = String(provider || "chatgpt").toLowerCase();
  const url = URLS[provider] || URLS[key];
  if (!url) return { ok: false, error: "unknown-provider: " + provider };
  const t0 = Date.now();
  // The holder of the flag can keep it for timeoutMs + 5000; waiting less
  // than that would report a spurious "provider-busy".
  const busyDeadline = Math.max(timeoutMs + 10000, 30000);
  while (askBusy[key]) {
    if (Date.now() - t0 > busyDeadline) return { ok: false, error: "provider-busy" };
    await new Promise((r) => setTimeout(r, 400));
  }
  askBusy[key] = true;
  try {
    const tabId = await getOwnTab("ask:" + key, url, { pinned: true });
    try { chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {}); } catch {}
    await ensureContent(tabId);
    dlog("info", "ask:send", key + " chars=" + String(prompt || "").length + (images ? " imgs=" + images.length : "") + " tab=" + tabId);
    let r = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "SB_SEND", prompt, timeoutMs, images: Array.isArray(images) ? images.slice(0, 5) : undefined }),
      new Promise((_u, rej) => setTimeout(() => rej(new Error("gen-timeout")), timeoutMs + 5000)),
    ]).catch((e) => ({ ok: false, error: String(e?.message || e).slice(0, 160) }));
    
    // Fallback: if sendMessage timed out or returned empty, read directly from tab to catch completed answers
    if (!r?.ok || !r?.text) {
      try {
        await new Promise((res) => setTimeout(res, 800));
        const fb = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" });
        if (fb?.ok && fb.text && fb.text.trim().length > 20) {
          r = { ok: true, text: fb.text.trim(), partial: true };
        }
      } catch {}
    }

    // Auto-retry once on transient connection loss or missing content script
    if (!r?.ok && (r?.error?.includes("Could not establish connection") || r?.error?.includes("Receiving end does not exist"))) {
      dlog("warn", "ask:retry_inject", key + " retrying content script injection");
      try {
        await ensureContent(tabId);
        await new Promise((res) => setTimeout(res, 600));
        const retryRes = await chrome.tabs.sendMessage(tabId, { type: "SB_SEND", prompt, timeoutMs: Math.min(timeoutMs, 60000), images: Array.isArray(images) ? images.slice(0, 5) : undefined });
        if (retryRes && retryRes.ok) r = retryRes;
      } catch {}
    }
    
    dlog(r && r.ok ? "info" : "warn", "ask:result", key + " ok=" + !!(r && r.ok) + (r && r.ok ? " chars=" + String(r.text || "").length + (r.partial ? " partial" : "") : " err=" + ((r && r.error) || "?")));
    return r || { ok: false, error: "no-response" };
  } catch (e) {
    dlog("warn", "ask:fail", key + " " + String(e).slice(0, 160));
    return { ok: false, error: String(e).slice(0, 160) };
  } finally {
    askBusy[key] = false;
  }
}
async function pollHidden(provider) {
  const key = String(provider || "chatgpt").toLowerCase();
  const id = ownTabs["ask:" + key];
  if (!id) return { ok: false };
  touchOwnTab("ask:" + key);
  try { return await chrome.tabs.sendMessage(id, { type: "SB_READ" }); } catch { return { ok: false }; }
}
let syncing = false;
async function autoSyncTick() {
  if (syncing) return;
  syncing = true;
  try {
    const cfg = ((await chrome.storage.local.get("sb_autosync")).sb_autosync);
    if (cfg === false) return;
    for (const key of Object.keys(ownTabs)) {
      if (!key.startsWith("ask:")) continue;
      const p = key.slice(4);
      let res;
      try { res = await chrome.tabs.sendMessage(ownTabs[key], { type: "SB_READ" }); } catch { continue; }
      const ai = String((res && (res.text ?? res.ai)) || "").trim();
      const imgs = ((res && res.images) || []).slice(0, 3);
      if (ai.length < 10 && !imgs.length) continue;
      const sig = ai + "|" + (imgs[0] ? String(imgs[0].src).slice(0, 100) : "");
      const st = ((await chrome.storage.local.get("sb_sync_state")).sb_sync_state) || {};
      if (st[p] && st[p].sig === sig) continue;
      st[p] = { text: ai, sig, ts: Date.now() };
      await chrome.storage.local.set({ sb_sync_state: st });
      const sId = await mirrorSync(p, ai, imgs);
      try { chrome.runtime.sendMessage({ type: "SB_SYNC", provider: p, text: ai.slice(0, 400), images: imgs, sId }).catch(() => {}); } catch {}
      dlog("info", "autosync:new", p + " chars=" + ai.length);
    }
  } catch (e) { dlog("warn", "autosync:err", String(e).slice(0, 140)); }
  finally { syncing = false; }
}
async function mirrorSync(provider, text, images) {
  try {
    const sessions = ((await chrome.storage.local.get("sb_sessions")).sb_sessions) || [];
    let idx = -1;
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if ((s.provider || "").toLowerCase() === provider && !s.url) { idx = i; break; }
    }
    if (idx < 0) {
      sessions.unshift({ id: "live" + Date.now(), title: "Live — " + provider, provider, createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
      idx = 0;
    }
    const s = sessions[idx];
    s.messages = s.messages || [];
    const last = s.messages[s.messages.length - 1];
    if (last && last.who === "ai" && last.text === text && !images?.length) return s.id;
    s.messages.push({ who: "ai", text: String(text).slice(0, 8000), images: (images || []).slice(0, 3), ts: Date.now() });
    s.updatedAt = Date.now();
    await chrome.storage.local.set({ sb_sessions: sessions.slice(0, 150) });
    try {
      const u = ((await chrome.storage.session.get("sb_unread")).sb_unread) || {};
      u[provider] = (u[provider] || 0) + 1;
      await chrome.storage.session.set({ sb_unread: u });
      updateBadge(u);
    } catch {}
    return s.id;
  } catch { return null; }
}
function updateBadge(u) {
  try { const n = Object.values(u || {}).reduce((a, b) => a + (b || 0), 0); chrome.action.setBadgeText({ text: n > 0 ? String(Math.min(n, 99)) : "" }); } catch {}
}
chrome.alarms.create("sb_autosync", { periodInMinutes: 1 });
chrome.alarms.create("sb_monitors", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === "sb_autosync") autoSyncTick();
  if (a && a.name === "sb_monitors") monitorTick();
  shouldLink().then((on) => { if (on && (!ws || ws.readyState !== 1)) connect(); }).catch(() => {});
});
function monitorSig(kind, raw, priceVal, stockState) { return kind === "price" ? (priceVal || "") : kind === "stock" ? (stockState || "") : String(raw || "").slice(-120); }
function firstPrice(raw) {
  const m = /[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?/.exec(String(raw || "").slice(0, 4000));
  return m ? m[0] : "";
}
let monBusy = false;
async function checkMonitor(m) {
  try {
    if (!m || !m.url || !/^https?:\/\//.test(m.url)) return null;
    if (!m.enabled) return null;
    if (m.lastTs && Date.now() - m.lastTs < (Number(m.intervalMin || 5) - 1) * 60000) return null;
    const nav = await navigateOwn("mon:" + m.id, m.url, { wait: 20000 });
    await ensureContent(nav.id);
    await new Promise((r) => setTimeout(r, 400));
    const res = await chrome.tabs.sendMessage(nav.id, { type: "SB_READ" }).catch(() => null);
    if (!res || !res.ok) { dlog("warn", "monitor:read", m.id); return null; }
    const raw = String(res.text || "");
    const priceVal = firstPrice(raw);
    const stockState = /out of stock|sold out/i.test(raw) ? "oos" : (/in stock|add to (cart|bag)/i.test(raw) ? "in" : "unknown");
    const sig = monitorSig(m.kind, raw, priceVal, stockState);
    dlog("info", "monitor:check", m.id + " kind=" + m.kind + " sig=" + String(sig).slice(0, 40));
    if (m.lastVal != null && String(m.lastVal) !== String(sig)) {
      try { chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title: "NaviBridge monitor: " + (m.title || m.url.slice(0, 40)), message: (m.kind || "change") + " " + String(m.lastVal).slice(0, 60) + " → " + String(sig).slice(0, 120) }); } catch (e) { dlog("warn", "monitor:notify", String(e).slice(0, 100)); }
      try { chrome.runtime.sendMessage({ type: "SB_SYNC", provider: "monitor", text: "🔔 Monitor " + (m.title || m.url.slice(0, 50)) + ": " + String(m.lastVal).slice(0, 60) + " → " + String(sig).slice(0, 120) }).catch(() => {}); } catch {}
    }
    return { id: m.id, lastVal: String(sig), lastTs: Date.now() };
  } catch (e) { dlog("warn", "monitor:err", m.id + " " + String(e).slice(0, 120)); return null; }
}
async function monitorTick() {
  if (monBusy) return;
  monBusy = true;
  try {
    const ms = ((await chrome.storage.local.get("sb_monitors")).sb_monitors) || [];
    const results = await Promise.all(ms.map((m) => checkMonitor(m)));
    const updates = results.filter(Boolean);
    if (updates.length) {
      const fresh = ((await chrome.storage.local.get("sb_monitors")).sb_monitors) || [];
      const freshList = Array.isArray(fresh) ? fresh : [];
      for (const u of updates) {
        const fi = freshList.findIndex((x) => x && x.id === u.id);
        if (fi >= 0) freshList[fi] = { ...freshList[fi], lastVal: u.lastVal, lastTs: u.lastTs };
      }
      await chrome.storage.local.set({ sb_monitors: freshList });
    }
  } catch (e) { dlog("warn", "monitorTick", String(e).slice(0, 140)); }
  finally { monBusy = false; }
}
function parseQueries(txt) {
  try { const m = /\[[\s\S]*\]/.exec(String(txt || "")); const arr = JSON.parse(m ? m[0] : "[]"); const out = (arr || []).filter((x) => typeof x === "string" && x.trim().length > 2).slice(0, 4); if (out.length) return out; } catch {}
  return [];
}
async function researchOne(i, q) {
  try {
    const nav = await getOwnTab("res:" + i, "https://www.google.com/search?q=" + encodeURIComponent(q), { wait: 12000 });
    await ensureContent(nav);
    await new Promise((r) => setTimeout(r, 1500));
    const res = await chrome.tabs.sendMessage(nav, { type: "SB_AI" });
    let urls = [];
    try { const tool = await chrome.tabs.sendMessage(nav, { type: "SB_TOOL", op: "extract_links" }); urls = String((tool?.value || "")).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6); } catch {}
    if (!res || !res.ok) return { queries: [q], ai: "", urls };
    return { queries: [q], ai: String(res.ai || "").slice(0, 1500), urls };
  } catch (e) { return { queries: [q], ai: "", urls: [] }; }
}
async function deepResearch(prompt) {
  const dlog2 = (a, b) => dlog("info", "research:" + a, b);
  let answer = "", sources = [], partial = false;
  const dres = await askHidden("ChatGPT", "Break this research question into 3-4 diverse web search queries. Reply ONLY with a JSON array of strings, no other text:\n\n" + String(prompt).slice(0, 400)).catch(() => null);
  let queries = dres?.ok ? parseQueries(dres.text) : [];
  if (!queries.length) queries = [String(prompt).slice(0, 120)];
  dlog2("queries", queries.join(" | "));
  const aiBlocks = [];
  let urlList = [];
  const searchResults = await Promise.all(queries.map((q, i) => researchOne(i, q).catch(() => ({ queries: [q], ai: "", urls: [] }))));
  searchResults.forEach((r) => { if (r.ai) aiBlocks.push("> " + r.queries[0] + ":: " + r.ai); urlList.push(...(r.urls || [])); });
  const seen = new Set();
  const pages = urlList.filter((u) => { try { const h = new URL(u).hostname; if (/google|youtube/.test(h)) return false; if (seen.has(u)) return false; seen.add(u); return true; } catch { return false; } }).slice(0, 6);
  for (let i = 0; i < pages.length; i++) {
    try {
      const nav = await getOwnTab("resweb:" + i, pages[i], { wait: 15000 });
      await ensureContent(nav);
      await new Promise((r) => setTimeout(r, 1500));
      const pr = await chrome.tabs.sendMessage(nav, { type: "SB_PAGE" });
      if (pr && pr.ok) sources.push({ url: pages[i], title: String(pr.title || "").slice(0, 120), text: String(pr.text || "").slice(0, 3000) });
      else { partial = true; dlog2("page-fail", pages[i]); }
    } catch (e) { partial = true; dlog2("page-err", String(e).slice(0, 100)); }
  }
  const blocks = sources.map((s, i) => `[${i + 1}] ${s.title} ${s.url}\n${s.text}`);
  const synth = await askHidden("ChatGPT", "Write a cited research synthesis (markdown; lead with TL;DR; 3-8 key findings; contradictions; gaps; cite as [n]; end with a numbered source list):\n\nQUESTION: " + String(prompt).slice(0, 600) + "\n\nSEARCH ENGINE AI ANSWERS:\n" + aiBlocks.join("\n\n").slice(0, 6000) + "\n\nPAGE EXTRACTS (numbered):\n" + blocks.join("\n\n").slice(-24000)).catch(() => null);
  answer = synth?.ok ? String(synth.text || "").slice(0, 8000) : "";
  return { ok: true, answer, sources: sources.map((s) => ({ url: s.url, title: s.title })), queries, partial: partial || !answer };
}
chrome.runtime.onInstalled.addListener(async () => {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch {}
  try { await chrome.contextMenus.removeAll(); chrome.contextMenus.create({ id: "sb-ask", title: 'Ask NaviBridge "%s"', contexts: ["selection"] }); } catch {}
});
chrome.action.onClicked.addListener(async (tab) => { try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {} });
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "sb-open") return;
  try { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await chrome.sidePanel.open({ tabId: t && t.id }); } catch {}
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "sb-ask") {
    try { await chrome.storage.session.set({ sb_pending: String(info.selectionText || "").slice(0, 1500) }); } catch {}
    try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
  }
});
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m && m.type && m.type !== "SB_POLL") dlog("debug", "msg", m.type + (m.provider ? " provider=" + m.provider : ""));
  if (m.type === "SB_KEEPALIVE") {
    send({ ok: true, ts: Date.now() });
    return false;
  }
  if (m.type === "SB_CDP_CLICK") {
    (async () => {
      try {
        const targetTabId = m.tabId || (_s && _s.tab && _s.tab.id);
        if (!targetTabId) { send({ ok: false, error: "no-tab-id" }); return; }
        const res = await cdpClick(targetTabId, m.x, m.y);
        send(res);
      } catch (e) {
        send({ ok: false, error: String(e).slice(0, 150) });
      }
    })();
    return true;
  }
  if (m.type === "SB_CDP_TYPE") {
    (async () => {
      try {
        const targetTabId = m.tabId || (_s && _s.tab && _s.tab.id);
        if (!targetTabId) { send({ ok: false, error: "no-tab-id" }); return; }
        const res = await cdpType(targetTabId, m.text);
        send(res);
      } catch (e) {
        send({ ok: false, error: String(e).slice(0, 150) });
      }
    })();
    return true;
  }
  if (m.type === "SB_CDP_SCREENSHOT") {
    (async () => {
      try {
        const targetTabId = m.tabId || (_s && _s.tab && _s.tab.id);
        if (!targetTabId) { send({ ok: false, error: "no-tab-id" }); return; }
        const res = await cdpScreenshot(targetTabId);
        send(res);
      } catch (e) {
        send({ ok: false, error: String(e).slice(0, 150) });
      }
    })();
    return true;
  }
  if (m.type === "SB_LOG") {
    logChain = logChain.then(async () => {
      try {
        const cur = ((await chrome.storage.local.get("sb_buglog")).sb_buglog) || [];
        const have = new Set(cur.map((e) => e && e.id));
        const add = (m.entries || []).filter((e) => e && e.id && !have.has(e.id));
        if (add.length) await chrome.storage.local.set({ sb_buglog: cur.concat(add).slice(-400) });
      } catch {}
    });
    logChain.then(() => { if (logChain) logChain = Promise.resolve(); }).catch(() => {});
    send({ ok: true });
    return true;
  }
  if (m.type === "SB_ASK")   { askHidden(m.provider || "chatgpt", String(m.prompt || ""), m.images, m.timeoutMs ? Number(m.timeoutMs) : undefined).then((r) => send(r)).catch((e) => send({ ok: false, error: String(e).slice(0, 200) })); return true; }
  if (m.type === "SB_POLL") { pollHidden(m.provider || "chatgpt").then((r) => send(r)); return true; }
  if (m.type === "SB_ASK_ALL") {
    const providers = (m.providers || []).slice(0, 4);
    const jobs = providers.map((p) => askHidden(p, String(m.prompt || ""), m.images).then((r) => ({ p, r })).catch((e) => ({ p, r: { ok: false, error: String(e).slice(0, 160) } })));
    Promise.all(jobs).then((all) => {
      const out = {};
      all.forEach((x) => { out[x.p] = x.r; });
      send({ ok: true, all: out });
    });
    return true;
  }
  if (m.type === "SB_POWER") {
    (async () => {
      const providers = (m.providers || ["ChatGPT", "Gemini", "Claude", "Grok", "Kimi", "DeepSeek", "Perplexity"]).slice(0, 7);
      const prompt = String(m.prompt || "");
      const jobs = providers.map((p) => {
        const t0 = Date.now();
        return askHidden(p, prompt, m.images).then((r) => {
          const resWithMeta = { ...r, durationMs: Date.now() - t0 };
          try { chrome.runtime.sendMessage({ type: "SB_POWER_PART", provider: p, result: resWithMeta }).catch(() => {}); } catch {}
          return { p, r: resWithMeta };
        }).catch((e) => {
          const errRes = { ok: false, error: String(e).slice(0, 160), durationMs: Date.now() - t0 };
          try { chrome.runtime.sendMessage({ type: "SB_POWER_PART", provider: p, result: errRes }).catch(() => {}); } catch {}
          return { p, r: errRes };
        });
      });
      const all = await Promise.all(jobs);
      const out = {};
      all.forEach((x) => { out[x.p] = x.r; });
      send({ ok: true, all: out });
    })().catch((e) => { bug("SB_POWER", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_PAGE" || m.type === "SB_READ") {
    (async () => {
      let tabId = m.tabId;
      // A content script that relays a page request has no business reading a
      // different tab: fall back to the sender's own tab, not the focused one.
      if (!tabId && _s && _s.tab && _s.tab.id) tabId = _s.tab.id;
      if (!tabId) { try { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tabId = t && t.id; } catch {} }
      if (!tabId) { send({ ok: false, error: "no-tab" }); return; }
      const injected = await ensureContent(tabId);
      if (injected && injected.needsPermission) {
        send({ ok: false, error: "host-permission-required", origin: injected.origin, hint: "Enable 'Allow reading any page' in the NaviBridge sidebar preferences" });
        return;
      }
      send(await chrome.tabs.sendMessage(tabId, { type: m.type }));
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_VIDCTX") {
    (async () => {
      const url = String(m.url || "");
      if (!/^https?:\/\//i.test(url)) { send({ ok: false, error: "bad-url" }); return; }
      let host = "video";
      try { host = new URL(url).hostname; } catch {}
      const tabId = await getOwnTab("vid:" + host, url, { wait: 20000 });
      await ensureContent(tabId);
      await new Promise((r) => setTimeout(r, 2500));
      const res = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }).catch(() => null);
      send({ ok: !!res?.ok, title: res?.title || "", text: String((res && res.text) || "").slice(0, 4000) });
    })().catch((e) => { bug("SB_VIDCTX", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_DIAG") {
    (async () => {
      const key = String(m.provider || "chatgpt").toLowerCase();
      const urls = { ...URLS, claude: "https://claude.ai/chats" }; // canonical URLS; diagnostics prefer the /chats listing
      const url = urls[key] || urls.chatgpt;
      const host = new URL(url).hostname;
      const out = { host, wantUrl: url, ownTab: ownTabs["ask:" + key] ?? null };
      try {
        const tabs = await chrome.tabs.query({ url: `*://${host}/*` });
        out.userTabs = tabs.map((t) => ({ id: t.id, url: t.url, status: t.status, active: t.active }));
        const tabId = await getOwnTab("ask:" + key, url, { pinned: true, wait: 20000 });
        out.tabId = tabId;
        try { const t = await chrome.tabs.get(tabId); out.tabStatus = t.status; out.tabUrl = t.url; } catch (e) { out.tabGet = String(e).slice(0, 100); }
        try { const pong = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }); out.pingOk = !!pong?.ok; out.pingErr = pong?.error || null; }
        catch (e) {
          out.pingOk = false; out.pingErr = String(e).slice(0, 160);
          try { await chrome.scripting.executeScript({ target: { tabId }, files: ["debug-shared.js", "content.js"] }); out.injected = true; await new Promise((r) => setTimeout(r, 1500)); const p2 = await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }); out.pingOk = !!p2?.ok; out.retryErr = p2?.error || null; }
          catch (e2) { out.injectErr = String(e2).slice(0, 200); }
        }
        send({ ok: true, diag: out });
      } catch (e) { bug("SB_DIAG", e, key); send({ ok: false, error: String(e).slice(0, 200), diag: out }); }
    })();
    return true;
  }
  if (m.type === "SB_OWNTAB") {
    (async () => {
      const key = String(m.key || "");
      if (!key.startsWith("fetch:")) { send({ ok: false, error: "bad-key" }); return; }
      const nav = await navigateOwn(key, String(m.url || ""), { pinned: true });
      send({ ok: true, tabId: nav.id });
    })().catch((e) => { bug("SB_OWNTAB", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_TOOL") {
    (async () => {
      const op = m.op, a = m.args || {};
      if (op === "navigate") {
        const u = String(a.url || "");
        if (!/^https?:\/\//i.test(u)) { send({ ok: false, error: "bad-url" }); return; }
        const tab = await chrome.tabs.create({ url: u, active: false });
        send({ ok: true, tabId: tab.id });
      } else if (op === "list_tabs") {
        const tabs = await chrome.tabs.query({});
        send({ ok: true, tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })) });
      } else if (op === "screenshot") {
        const shot = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 60 });
        send({ ok: true, dataUrl: shot });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) { send({ ok: false, error: "no-active-tab" }); return; }
        await ensureContent(tab.id);
        send(await chrome.tabs.sendMessage(tab.id, { type: "SB_TOOL", op, args: a }));
      }
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_DEBATE") {
    (async () => {
      const providers = (m.providers || ["ChatGPT", "Gemini", "Claude"]).slice(0, 4);
      const rounds = Math.min(Number(m.rounds || 2), 3);
      let msg = String(m.prompt || "");
      const thread = [{ who: "user", text: msg }];
      for (let r = 0; r < rounds; r++) {
        for (const p of providers) {
          try { chrome.runtime.sendMessage({ type: "SB_DEBATE_PROGRESS", text: `Round ${r + 1}/${rounds}: ${p} is debating...` }).catch(() => {}); } catch {}
          const ctx = thread.filter((t) => !String(t.text || "").startsWith("ERROR")).slice(-3).map((t) => t.text.slice(0, 500)).join(" | ").slice(0, 1200);
          const res = await askHidden(p, msg + "\n[Debate context: " + ctx + "]").catch((e) => ({ ok: false, error: String(e).slice(0, 120) }));
          const text = res?.ok ? res.text : "ERROR " + (res?.error || "");
          thread.push({ who: p, text });
          if (res?.ok && text.length > 10) msg = text.slice(0, 700);
        }
      }
      send({ ok: true, thread });
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_SEARCH") {
    (async () => {
      const q = encodeURIComponent(String(m.prompt || ""));
      const tab = await chrome.tabs.create({ url: "https://www.google.com/search?q=" + q, active: false, pinned: true });
      await waitComplete(tab.id, 12000);
      await ensureContent(tab.id);
      await new Promise((r) => setTimeout(r, 3000));
      send(await chrome.tabs.sendMessage(tab.id, { type: "SB_AI" }));
      try { await chrome.tabs.remove(tab.id); dlog("info", "search:close", "id=" + tab.id); } catch {}
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_COUNCIL") {
    (async () => {
      const providers = (m.providers || ["ChatGPT", "Gemini", "Claude"]).slice(0, 3);
      const q = String(m.prompt || "");
      const cut = (s, n) => String(s || "").slice(0, n);
      try { chrome.runtime.sendMessage({ type: "SB_COUNCIL_PROGRESS", text: "Generating proposals from " + providers.join(", ") + "..." }).catch(() => {}); } catch {}
      const prop = await Promise.all(providers.map((p) => askHidden(p, q).then((r) => ({ p, t: r?.ok ? r.text : "ERROR " + (r?.error || "") })).catch((e) => ({ p, t: "ERROR " + String(e).slice(0, 120) }))));
      const working = prop.filter((x) => !String(x.t || "").startsWith("ERROR"));
      if (!working.length) {
        send({ ok: false, error: "All selected providers failed to generate proposals", council: { proposals: prop, critiques: [], revisions: [], verdict: "" } });
        return;
      }
      const activeProviders = working.map((x) => x.p);
      const brief = working.map((x) => `【${x.p}】${cut(x.t, 500)}`).join("\n").slice(0, 1800);
      try { chrome.runtime.sendMessage({ type: "SB_COUNCIL_PROGRESS", text: "Critiquing draft proposals..." }).catch(() => {}); } catch {}
      const crit = await Promise.all(activeProviders.map((p) => askHidden(p, `Critique in 3 bullets each:\nQ: ${cut(q, 300)}\n${brief}`).then((r) => ({ p, t: r?.ok ? r.text : "ERROR" })).catch(() => ({ p, t: "ERROR" }))));
      const critWorking = crit.filter((x) => !String(x.t || "").startsWith("ERROR"));
      const critBrief = (critWorking.length ? critWorking : crit).map((x) => `【${x.p}】${cut(x.t, 400)}`).join("\n").slice(0, 1500);
      try { chrome.runtime.sendMessage({ type: "SB_COUNCIL_PROGRESS", text: "Synthesizing revised drafts..." }).catch(() => {}); } catch {}
      const rev = await Promise.all(working.map((x) => askHidden(x.p, `Revise given critiques:\nQ: ${cut(q, 300)}\nDraft: ${cut(x.t, 600)}\nCritiques:\n${critBrief}`).then((r) => ({ p: x.p, t: r?.ok ? r.text : x.t })).catch(() => ({ p: x.p, t: x.t }))));
      const revWorking = rev.filter((x) => !String(x.t || "").startsWith("ERROR"));
      const revBrief = (revWorking.length ? revWorking : working).map((x) => `【${x.p}】${cut(x.t, 600)}`).join("\n").slice(0, 2200);
      const judgeProvider = revWorking[0]?.p || working[0]?.p || activeProviders[0] || providers[0];
      try { chrome.runtime.sendMessage({ type: "SB_COUNCIL_PROGRESS", text: "Evaluating final verdict via " + judgeProvider + "..." }).catch(() => {}); } catch {}
      const judge = await askHidden(judgeProvider, `Pick best (name + reason + full text):\nQ: ${cut(q, 300)}\n${revBrief}`).then((r) => (r?.ok ? r.text : "")).catch(() => "");
      send({ ok: true, council: { proposals: prop, critiques: crit, revisions: rev, verdict: judge } });
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_THREAD") {
    (async () => {
      const url = String(m.url || "");
      if (!url.startsWith("http")) { send({ ok: false, error: "bad-url" }); return; }
      const host = new URL(url).hostname;
      const nav = await navigateOwn("thread:" + host, url, { wait: 25000 });
      await ensureContent(nav.id);
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? (nav.navigated ? 1000 : 300) : 1400));
        try {
          const res = await chrome.tabs.sendMessage(nav.id, { type: "SB_THREAD" });
          if (res?.ok && res.thread?.length) {
            try {
              const cc = ((await chrome.storage.local.get("sb_thread_cache")).sb_thread_cache) || {};
              cc[url] = { thread: res.thread, title: res.title, ts: Date.now() };
              const ks = Object.keys(cc);
              if (ks.length > 40) { ks.sort((x, y) => (cc[x].ts || 0) - (cc[y].ts || 0)); ks.slice(0, ks.length - 40).forEach((k) => delete cc[k]); }
              await chrome.storage.local.set({ sb_thread_cache: cc });
            } catch {}
            dlog("info", "SB_THREAD:ok", "turns=" + res.thread.length + " " + url); send(res); return;
          }
          if (i === 3) { bug("SB_THREAD:empty", "turns=" + (res?.found ?? 0), url); send(res || { ok: false, error: "empty-thread" }); return; }
        } catch (e) {
          if (i === 3) { bug("SB_THREAD:send", e, url); send({ ok: false, error: "thread-failed: " + String(e).slice(0, 140) }); return; }
        }
      }
    })().catch((e) => { bug("SB_THREAD:outer", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_YTTRAN") {
    (async () => {
      const url = String(m.url || "");
      if (!/^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/i.test(url)) { send({ ok: false, error: "bad-url" }); return; }
      let targetTabId = m.tabId ? Number(m.tabId) : null;
      if (targetTabId) {
        try {
          const tab = await chrome.tabs.get(targetTabId);
          if (!tab || !tab.url || !/youtube\.com|youtu\.be/i.test(tab.url)) {
            targetTabId = null;
          }
        } catch {
          targetTabId = null;
        }
      }
      if (!targetTabId) {
        try {
          const [act] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (act && act.url && /youtube\.com|youtu\.be/i.test(act.url)) {
            targetTabId = act.id;
          }
        } catch {}
      }
      if (!targetTabId) {
        try {
          const allTabs = await chrome.tabs.query({});
          let vid = "";
          try {
            const u = new URL(url);
            vid = new URLSearchParams(u.search).get("v") || (u.hostname === "youtu.be" ? u.pathname.split("/")[1] : "");
          } catch {}
          const match = allTabs.find((t) => t.url && (t.url === url || (vid && t.url.includes(vid))));
          if (match) targetTabId = match.id;
        } catch {}
      }
      if (!targetTabId) {
        let key = "yt";
        try {
          const u = new URL(url);
          const v = new URLSearchParams(u.search).get("v");
          const pm = /\/(shorts|live|embed)\/([^/?]+)/.exec(u.pathname);
          const vid = v || (u.hostname === "youtu.be" ? u.pathname.split("/")[1] : null) || (pm && pm[2]) || u.hostname;
          key = "yt:" + String(vid).slice(0, 40);
        } catch {}
        targetTabId = await getOwnTab(key, url, { wait: 15000 });
      }
      await ensureContent(targetTabId);
      const res = await chrome.tabs.sendMessage(targetTabId, { type: "SB_YTTRAN" }).catch((e) => ({ ok: false, error: String(e).slice(0, 100) }));
      send(res || { ok: false, error: "no-response" });
    })().catch((e) => { bug("SB_YTTRAN", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_RESEARCH") {
    (async () => {
      const prompt = String(m.prompt || "").trim();
      if (prompt.length < 4) { send({ ok: false, error: "empty-prompt" }); return; }
      send(await deepResearch(prompt));
    })().catch((e) => { bug("SB_RESEARCH", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_SELACT") {
    (async () => {
      const text = String(m.text || "").slice(0, 6000);
      const action = String(m.action || "ask").toLowerCase();
      const reqId = String(m.reqId || "");
      const tabId = _s && _s.tab ? _s.tab.id : (m.tabId || null);
      const prompts = {
        ask: text,
        translate: "Translate to English (or to the target language if explicitly stated). Reply with ONLY the high-accuracy translation, without commentary:\n\n" + text,
        explain: "Explain this clearly, accurately, and concisely with key context:\n\n" + text,
        summarize: "Provide a sharp executive summary of this text in 3-5 high-impact bullet points:\n\n" + text,
        rewrite: "Rewrite the following text to improve clarity, vocabulary, tone, and professional flow while strictly preserving the original meaning:\n\n" + text,
        grammar: "Proofread and correct all grammar, spelling, punctuation, and phrasing errors in the following text. Return the polished version first, followed by a brief bullet list of changes made:\n\n" + text,
        code: "Explain or review this code snippet. Point out bugs, edge cases, time/space complexity, and provide an optimized version if needed:\n\n" + text
      };
      const activeModel = m.provider || ((await chrome.storage.local.get("sb_model"))?.sb_model) || "ChatGPT";
      const r = await askHidden(activeModel, prompts[action] || text).catch((e) => ({ ok: false, error: String(e).slice(0, 160) }));
      try {
        if (tabId) await chrome.tabs.sendMessage(tabId, { type: "SB_SELACT_RESULT", reqId, ok: !!r?.ok, text: r?.ok ? String(r.text || "").slice(0, 8000) : "", error: r?.error || "" });
      } catch (e) { dlog("warn", "selact:result", String(e).slice(0, 100)); }
      try { send({ ok: true, async: true, via: "SB_SELACT_RESULT" }); } catch {}
    })().catch(() => { try { send({ ok: false, error: "selact-failed" }); } catch {} });
    return true;
  }
  if (m.type === "SB_SELACT_SIDE") {
    (async () => {
      try { await chrome.storage.session.set({ sb_pending: String(m.text || "").slice(0, 1500) }); } catch {}
      try { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t && t.id) await chrome.sidePanel.open({ tabId: t.id }); } catch {}
    })();
    return true;
  }
  if (m.type === "SB_MON_LIST" || m.type === "SB_MON_ADD" || m.type === "SB_MON_SET" || m.type === "SB_MON_DEL") {
    (async () => {
      const ms = ((await chrome.storage.local.get("sb_monitors")).sb_monitors) || [];
      const kinds = ["change", "price", "stock", "drop"];
      if (m.type === "SB_MON_ADD") {
        const url = String(m.url || "").trim();
        if (!/^https?:\/\//i.test(url)) { send({ ok: false, error: "bad-url" }); return; }
        ms.push({ id: "mon-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), url: url.slice(0, 500), kind: kinds.includes(m.kind) ? m.kind : "change", enabled: true, intervalMin: Math.max(1, Number(m.intervalMin || 5)), title: String(m.title || "").slice(0, 120), lastVal: null, lastTs: 0 });
        if (ms.length > 20) ms.splice(0, ms.length - 20);
        await chrome.storage.local.set({ sb_monitors: ms });
      } else if (m.type === "SB_MON_SET") {
        const idx = ms.findIndex((x) => x && x.id === m.id);
        if (idx < 0) { send({ ok: false, error: "not-found" }); return; }
        const p = m.patch || {};
        if ("enabled" in p) ms[idx].enabled = !!p.enabled;
        if (typeof p.kind === "string" && kinds.includes(p.kind)) ms[idx].kind = p.kind;
        if (p.intervalMin != null) ms[idx].intervalMin = Math.max(1, Number(p.intervalMin || 5));
        if ("enabled" in p || "kind" in p) { ms[idx].lastVal = null; ms[idx].lastTs = 0; }
        await chrome.storage.local.set({ sb_monitors: ms });
      } else if (m.type === "SB_MON_DEL") {
        const out = ms.filter((x) => x && x.id !== m.id);
        await chrome.storage.local.set({ sb_monitors: out });
        send({ ok: true, monitors: out });
        return;
      }
      send({ ok: true, monitors: ms });
    })().catch((e) => { bug("SB_MON", e); send({ ok: false, error: String(e).slice(0, 200) }); });
    return true;
  }
  if (m.type === "SB_TABCTX") {
    (async () => {
      const ids = (m.tabIds || []).slice(0, 3);
      const out = [];
      for (const tid of ids) {
        try {
          const t = await chrome.tabs.get(tid);
          await ensureContent(t.id);
          let r = await chrome.tabs.sendMessage(t.id, { type: "SB_PAGE" }).catch(() => null);
          if (!r || !r.ok) r = await chrome.tabs.sendMessage(t.id, { type: "SB_READ" }).catch(() => null);
          if (r && r.ok) out.push({ id: tid, title: String(r.title || t.title || "").slice(0, 100), url: r.url || t.url || "", text: String(r.text || "").slice(0, 3500) });
          dlog("info", "tabctx", tid + " ok=" + !!(r && r.ok));
        } catch {}
      }
      send({ ok: out.length > 0, tabs: out, text: out.map((x) => `[Tab: ${x.title}] ${x.url}\n${x.text}`).join("\n\n") });
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_SNIPCROP") {
    (async () => {
      let tabId = m.tabId;
      if (!tabId) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tabId = t && t.id; }
      if (!tabId) { send({ ok: false, error: "no-tab" }); return; }
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content-snip.js"] }); } catch {}
      await chrome.tabs.sendMessage(tabId, { type: "SB_SNIP_START" });
      send({ ok: true, tabId });
    })().catch((e) => send({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (m.type === "SB_SNIP_RECT") {
    (async () => {
      const rect = m.rect || {};
      const dpr = rect.dpr || 1;
      const rw = rect.w ?? rect.width, rh = rect.h ?? rect.height;
      const tabId = _s && _s.tab ? _s.tab.id : null;
      const winId = _s && _s.tab ? _s.tab.windowId : undefined;
      if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw * dpr < 8 || rh * dpr < 8) { dlog("warn", "snip:rect:bad", JSON.stringify(rect).slice(0, 120)); send({ ok: false, error: "bad-rect" }); return; }
      try {
        const shot = await chrome.tabs.captureVisibleTab(winId != null ? winId : undefined, { format: "png" });
        const blob = await (await fetch(shot)).blob();
        const bmp = await createImageBitmap(blob);
        const sx = Math.max(0, Math.round(rect.x * dpr)), sy = Math.max(0, Math.round(rect.y * dpr));
        const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rw * dpr))), sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rh * dpr)));
        const cv = new OffscreenCanvas(sw, sh);
        cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const ob = await cv.convertToBlob({ type: "image/png" });
        const fr = new FileReader();
        const dataUrl = await new Promise((rs, rj) => { fr.onload = () => rs(fr.result); fr.onerror = rj; fr.readAsDataURL(ob); });
        try { chrome.runtime.sendMessage({ type: "SB_SNIP_READY", dataUrl }).catch(() => {}); } catch {}
        if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: "SB_SNIP_DONE" }); } catch {} }
        dlog("info", "snip:done", sw + "x" + sh + " dpr=" + dpr);
      } catch (e) { dlog("warn", "snip:rect", String(e).slice(0, 140)); }
    })();
    return false;
  }
  if (m.type === "SB_BRIDGE_RECONNECT") {
    clearTimeout(timer);
    try { ws?.close(); } catch {}
    ws = null;
    connect();
    send({ ok: true });
    return true;
  }
});
function setBridgeStatus(state, msg) {
  const status = { state, msg, ts: Date.now() };
  try { chrome.storage.local.set({ sb_bridge_status: status }).catch(() => {}); } catch {}
  try { chrome.runtime.sendMessage({ type: "SB_BRIDGE_STATUS", status }).catch(() => {}); } catch {}
}
async function bridgeUp() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 2000);
    const res = await fetch("http://127.0.0.1:10086/status", { signal: c.signal });
    clearTimeout(t);
    if (res.ok) {
      try {
        const data = await res.json();
        if (data && data.token) {
          await chrome.storage.local.set({ sb_bridge_token: data.token }).catch(() => {});
        }
      } catch {}
      return true;
    }
    return false;
  } catch { return false; }
}
function connect() {
  shouldLink().then(async (on) => {
    if (!on) {
      setBridgeStatus("disabled", "Link CLI is unchecked");
      return;
    }
    if (connecting || (ws && ws.readyState <= 1)) return; // prevent reconnect storms / parallel sockets
    connecting = true;
    setBridgeStatus("connecting", "Probing local bridge :10086...");
    if (!(await bridgeUp())) {
      setBridgeStatus("disconnected", "Bridge not running on :10086 (run: npm run bridge)");
      connecting = false;
      clearTimeout(timer); timer = setTimeout(connect, 15000);
      return;
    }
    want = true;
    try {
      ws = new WebSocket(WS_URL);
      ws.onerror = () => { setBridgeStatus("disconnected", "WebSocket connection error"); };
      ws.onopen = async () => {
        dlog("info", "bridge:open", WS_URL);
        let token = "";
        try { const s = await chrome.storage.local.get("sb_bridge_token"); token = s.sb_bridge_token || ""; } catch {}
        try {
          ws.send(JSON.stringify({
            type: "hello",
            payload: { extensionVersion: chrome.runtime.getManifest().version, token: token }
          }));
        } catch {}
        // Outbound heartbeat: keeps the WebSocket (and thus the MV3 service worker) active
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); } catch {} }, 20000);
      };
      ws.onmessage = async (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "hello_ack") {
          if (m.token) {
            chrome.storage.local.set({ sb_bridge_token: m.token }).catch(() => {});
          }
          setBridgeStatus("connected", "Connected to local CLI bridge");
          return;
        }
        if (m.type === "error" && m.error === "bad-token") {
          // Clear stale token and retry with auto-negotiated token
          await chrome.storage.local.remove("sb_bridge_token").catch(() => {});
          setBridgeStatus("bad_token", "Bridge token mismatch — re-negotiating with daemon...");
          clearTimeout(timer);
          timer = setTimeout(connect, 3000);
          return;
        }
        if (m.type === "pong") return;
        if (m.type === "ping") { try { ws.send(JSON.stringify({ type: "pong" })); } catch {} return; }
        if (m.type === "tool_call") {
          const { requestId, payload } = m;
          const done = (data) => { try { ws.send(JSON.stringify({ type: "tool_result", responseToRequestId: requestId, payload: { data } })); } catch {} };
          const fail = (error) => { try { ws.send(JSON.stringify({ type: "tool_result", responseToRequestId: requestId, payload: { error } })); } catch {} };
          try {
            const toolName = payload?.name || "ask";
            const args = payload?.args || payload || {};
            const res = await executeTool(toolName, args);
            if (res && res.ok === false) fail(res.error || "tool-failed");
            else done(res);
          } catch (e) { fail(String(e).slice(0, 300)); }
        }
      };
      ws.onclose = (ev) => {
        ws = null; connecting = false;
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        if (ev && ev.code === 4409) {
          dlog("warn", "ws:refused", "daemon already driven by another browser");
          setBridgeStatus("refused", "Daemon in use by another browser window (code 4409)");
          clearTimeout(timer);
          timer = setTimeout(connect, 60000);
          return;
        }
        if (want) {
          setBridgeStatus("disconnected", "Bridge connection closed");
          clearTimeout(timer);
          timer = setTimeout(connect, 10000);
        } else {
          setBridgeStatus("disabled", "Link CLI is unchecked");
        }
      };
    } catch { setBridgeStatus("disconnected", "Connection failed"); clearTimeout(timer); timer = setTimeout(connect, 10000); connecting = false; }
  });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && "sb_agent" in ch) {
    if (ch.sb_agent.newValue) connect();
    else { want = false; clearTimeout(timer); try { ws?.close(); } catch {} ws = null; }
  }
});
chrome.storage.session.get("sb_own_tabs").then((s) => { if (s.sb_own_tabs) Object.assign(ownTabs, s.sb_own_tabs); }).catch(() => {});
shouldLink().then((on) => { if (on) connect(); });

// Length-independent, branch-free secret comparison. A plain !== leaks the
// token byte-by-byte through timing to any local process able to time us.
function secureEquals(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a == null ? "" : a));
  const bb = enc.encode(String(b == null ? "" : b));
  if (!ba.length || !bb.length) return false;
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const x = i < ba.length ? ba[i] : 0;
    const y = i < bb.length ? bb[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

// External connection listener (Harden C4: origin + token validation).
//
// The external surface is OFF by default. `externally_connectable` lets any
// page served from localhost talk to the extension, so leaving it enabled
// hands a long-lived secret to whatever local server happens to be running.
// The user must opt in from the sidebar preferences.
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((m, sender, sendResponse) => {
    const senderUrl = sender?.url || "";
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(senderUrl);
    if (!isLocalhost) {
      dlog("warn", "external:untrusted_origin", senderUrl);
      sendResponse({ ok: false, error: "forbidden_origin" });
      return false;
    }

    (async () => {
      const cfg = await chrome.storage.local.get({ sb_external_api: false });
      if (!cfg.sb_external_api) {
        dlog("warn", "external:disabled", senderUrl);
        sendResponse({ ok: false, error: "external_api_disabled", hint: "Enable 'Allow local web pages to message the extension' in the NaviBridge sidebar preferences" });
        return;
      }
      const s = await chrome.storage.local.get("sb_bridge_token");
      const expectedToken = s.sb_bridge_token;
      if (!expectedToken || !secureEquals(m?.token, expectedToken)) {
        dlog("warn", "external:auth_failed", senderUrl);
        sendResponse({ ok: false, error: "unauthorized" });
        return;
      }

      dlog("info", "external:msg", senderUrl + " type=" + m?.type);
      if (m?.type === "ping") {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
      }
      if (m?.type === "ask") {
        try {
          const res = await askHidden(m.provider || "ChatGPT", m.prompt || "", m.images);
          sendResponse(res);
        } catch (e) {
          sendResponse({ ok: false, error: String(e).slice(0, 200) });
        }
        return;
      }
      if (m?.type === "status") {
        const bs = await chrome.storage.local.get("sb_bridge_status");
        sendResponse({ ok: true, status: bs.sb_bridge_status || {} });
        return;
      }
      sendResponse({ ok: false, error: "unknown_message_type" });
    })();
    return true;
  });
}
