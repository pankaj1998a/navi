const URLS = { ChatGPT: "https://chatgpt.com/", Gemini: "https://gemini.google.com/app", Claude: "https://claude.ai/new", Grok: "https://grok.com/", Kimi: "https://www.kimi.ai/?chat_enter_method=new_chat", DeepSeek: "https://chat.deepseek.com/", Perplexity: "https://www.perplexity.ai/", Google: "https://www.google.com/" };
const AI_HOSTS = ["chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai", "grok.com", "kimi.ai", "kimi.moonshot.cn", "kimi.com", "chat.deepseek.com", "perplexity.ai"];
const $ = (id) => document.getElementById(id);
try { dbgInit("popup"); const ve = $("ver"); if (ve) ve.textContent = chrome.runtime.getManifest().version; } catch {}
let current = "ChatGPT";
const grid = $("providers");
Object.keys(URLS).forEach((name) => {
  const b = document.createElement("button");
  b.className = "chip" + (name === current ? " on" : "");
  b.textContent = name;
  b.onclick = () => { current = name; [...grid.children].forEach((c) => c.classList.remove("on")); b.classList.add("on"); };
  grid.appendChild(b);
});
function renderPopupBridge(status) {
  const dot = $("bdot");
  if (!dot) return;
  const state = typeof status === "string" ? status : (status?.state || "disconnected");
  if (state === "connected") { dot.style.background = "#3ecf8e"; dot.title = "CLI Bridge: Connected (:10086)"; }
  else if (state === "connecting") { dot.style.background = "#e5a50a"; dot.title = "CLI Bridge: Connecting..."; }
  else if (state === "bad_token") { dot.style.background = "#ff6b6b"; dot.title = "CLI Bridge: Token mismatch"; }
  else if (state === "disabled") { dot.style.background = "#475260"; dot.title = "CLI Bridge: Disabled"; }
  else { dot.style.background = "#8b98a9"; dot.title = "CLI Bridge: Disconnected (run: npm run bridge)"; }
}
chrome.storage.local.get(["sb_agent", "sb_bridge_status", "sb_bridge_token"]).then((s) => {
  if ($("agent")) $("agent").checked = !!s.sb_agent;
  if ($("btoken") && s.sb_bridge_token) $("btoken").value = s.sb_bridge_token;
  if (s.sb_bridge_status) renderPopupBridge(s.sb_bridge_status);
}).catch(() => {});
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "SB_BRIDGE_STATUS") renderPopupBridge(m.status);
});
if ($("open-panel")) {
  $("open-panel").onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  };
}
$("agent").onchange = () => {
  chrome.storage.local.set({ sb_agent: $("agent").checked }).catch(() => {});
  chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
};
$("btoken-save").onclick = async () => {
  const t = String($("btoken").value || "").trim();
  if (t && !/^[a-f0-9]{20,128}$/i.test(t)) { $("r").textContent = "ERROR: token looks invalid"; return; }
  await chrome.storage.local.set({ sb_bridge_token: t }).catch(() => {});
  $("r").textContent = t ? "Bridge token saved. Reconnecting..." : "Bridge token cleared.";
  chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
};
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t; }
function isAI(url) { try { const h = new URL(url).hostname; return AI_HOSTS.some((a) => h.includes(a)); } catch { return false; } }
async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["debug-shared.js", "content.js"] });
    await new Promise((r) => setTimeout(r, 800));
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}
function bubble(who, text) {
  const d = document.createElement("div");
  d.className = "msg " + (who === "me" ? "me" : "ai");
  d.textContent = text;
  $("chat").appendChild(d);
  $("chat").scrollTop = 99999;
  $("r").textContent = text;
}
$("go").onclick = async () => {
  const q = $("q").value.trim();
  if (!q) return;
  bubble("me", q);
  $("q").value = "";
  bubble("ai", "sending to " + current + " (hidden tab)...");
  $("st").textContent = "working";
  try {
    dlog("info", "ask:start", current + " chars=" + q.length);
    const res = await chrome.runtime.sendMessage({ type: "SB_ASK", provider: current, prompt: q });
    dlog(res?.ok ? "info" : "warn", "ask:result", current + " ok=" + !!res?.ok + (res?.ok ? "" : " err=" + (res?.error || "")));
    document.querySelector("#chat .ai:last-child")?.remove();
    if (!res?.ok) { bubble("ai", "ERROR " + (res?.error || "no-response")); }
    else bubble("ai", res.text + (res.partial ? "\n[partial]" : ""));
    $("st").textContent = "ready";
  } catch (e) { document.querySelector("#chat .ai:last-child")?.remove(); bubble("ai", "ERROR: " + String(e).slice(0, 200)); $("st").textContent = "error"; }
};
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("go").click(); } });
$("open").onclick = async () => { await chrome.tabs.create({ url: URLS[current] }); };
$("read").onclick = async () => {
  const t = await activeTab();
  const res = await sendToTab(t.id, { type: "SB_READ" }).catch((e) => ({ ok: false, error: String(e).slice(0, 160) }));
  dlog(res?.ok ? "debug" : "warn", "read:result", res?.ok ? "ok" : "err=" + res?.error);
  $("r").textContent = res?.ok ? res.text : "ERROR " + res?.error;
};
$("copy").onclick = async () => { await navigator.clipboard.writeText($("r").textContent || "").catch(() => {}); };
$("dlbugs").onclick = async () => { try { await exportBugLogMD(); dlog("info", "export:md", "popup"); } catch (e) { dlog("error", "export:md", e); } };
