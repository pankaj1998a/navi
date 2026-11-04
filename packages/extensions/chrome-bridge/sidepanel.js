const URLS = { ChatGPT: "https://chatgpt.com/", Gemini: "https://gemini.google.com/app", Claude: "https://claude.ai/new", Grok: "https://grok.com/", Kimi: "https://www.kimi.ai/?chat_enter_method=new_chat", DeepSeek: "https://chat.deepseek.com/", Perplexity: "https://www.perplexity.ai/", Google: "https://www.google.com/" };
const $ = (id) => document.getElementById(id);
dbgInit("sidepanel");
try { const mv = chrome.runtime.getManifest().version; const ve = $("ver"); if (ve) ve.textContent = "v" + mv; console.log("[NaviBridge] sidepanel v" + mv + " loaded, typing=" + typeof typing); } catch (e) { console.log("[NaviBridge] sidepanel boot (ver unknown), typing=" + typeof typing); }
try { (async () => { await chrome.storage.session.set({ sb_unread: {} }).catch(() => {}); chrome.action.setBadgeText({ text: "" }); })(); } catch {}
chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === "SB_BRIDGE_STATUS") {
    if (typeof renderBridgeStatus === "function") renderBridgeStatus(m.status);
  }
  if (m && m.type === "SB_POWER_PART") {
    try {
      const p = m.provider, r = m.result;
      const card = document.querySelector(`.power-card[data-p="${p}"]`);
      if (card) {
        const dot = card.querySelector(".power-dot");
        const meta = card.querySelector(".power-card-meta");
        const body = card.querySelector(".power-card-body, .power-body");
        if (dot) {
          dot.classList.remove("pulse");
          dot.style.background = r?.ok ? "var(--ok, #3ecf8e)" : "#ff6b6b";
        }
        if (meta) {
          if (r?.ok) {
            const words = String(r.text || "").split(/\s+/).filter(Boolean).length;
            const sec = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "";
            meta.textContent = `${words} words${sec ? " · " + sec : ""}`;
            meta.style.color = "var(--mut)";
          } else {
            meta.textContent = "failed";
            meta.style.color = "#ff6b6b";
          }
        }
        if (body) {
          body.innerHTML = "";
          body.appendChild(mdLite(r?.ok ? r.text : "ERROR " + (r?.error || "unknown")));
          (r?.images || []).filter((im) => /^(https?:|data:image\/)/.test(im.src || "")).slice(0, 2).forEach((im) => {
            const img = document.createElement("img");
            img.src = im.src; img.alt = im.alt || "image";
            img.style.cssText = "max-width:100%;border-radius:9px;border:1px solid var(--line);margin-top:6px";
            img.loading = "lazy";
            body.appendChild(img);
          });
        }
        const cp = card.querySelector(".power-card-act, button.iconbtn");
        if (cp) {
          cp.onclick = async () => {
            await navigator.clipboard.writeText(r?.ok ? r.text : "ERROR " + (r?.error || "")).catch(() => {});
            cp.textContent = "✓ Copied";
            setTimeout(() => (cp.textContent = "📋 Copy"), 1200);
          };
        }
        if ($("chat")) $("chat").scrollTop = 99999;
      }
    } catch {}
  }
  if (m && m.type === "SB_COUNCIL_PROGRESS" && m.text) {
    const t = $("typing");
    if (t) streamInto(t, "🏛 " + m.text);
    if ($("st")) $("st").textContent = "council...";
  }
  if (m && m.type === "SB_DEBATE_PROGRESS" && m.text) {
    const t = $("typing");
    if (t) streamInto(t, "🗣 " + m.text);
    if ($("st")) $("st").textContent = "debating...";
  }
  if (m && m.type === "SB_SYNC") {
    (async () => {
      try { await chrome.storage.session.set({ sb_unread: {} }).catch(() => {}); chrome.action.setBadgeText({ text: "" }); } catch {}
      try { renderSessions($("ssearch")?.value || ""); } catch {}
      if (m.provider === "monitor") toast(String(m.text || "Monitor update").slice(0, 120));
    })().catch(() => {});
  }
  if (m && m.type === "SB_SNIP_READY" && m.dataUrl) {
    try {
      if (attachImgs.length >= 5) toast("Max 5 images");
      else { attachImgs.push(String(m.dataUrl).slice(0, 400000)); renderAttach(); toast("Screenshot region attached"); }
    } catch (e) { dlog("warn", "snip:ready", String(e).slice(0, 100)); }
  }
});
let current = "ChatGPT";
function applyTheme() {
  chrome.storage.local.get("sb_theme").then((s) => {
    let t = s.sb_theme || "auto";
    if (t === "auto") t = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.body.classList.toggle("light", t === "light");
    const b = $("themebtn");
    if (b) b.textContent = t === "light" ? "☀" : "◐";
  }).catch(() => {});
}
applyTheme();
try { window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme); } catch {}
$("themebtn").onclick = () => { chrome.storage.local.get("sb_theme").then((s) => { const seq = { auto: "light", light: "dark", dark: "auto" }; const t = seq[s.sb_theme || "auto"]; chrome.storage.local.set({ sb_theme: t }).then(applyTheme).catch(() => {}); toast("Theme: " + t); }).catch(() => {}); };
const grid = $("providers");
if (grid) Object.keys(URLS).forEach((name) => {
  const b = document.createElement("button");
  b.className = "chip" + (name === current ? " on" : "");
  b.textContent = name;
  b.onclick = () => { switchProvider(name); if (grid) { [...grid.children].forEach((c) => c.classList.remove("on")); b.classList.add("on"); } };
  grid.appendChild(b);
});
const MODELS = [{ n: "ChatGPT", d: "GPT web" }, { n: "Gemini", d: "Google" }, { n: "Claude", d: "Anthropic" }, { n: "Grok", d: "xAI" }, { n: "Kimi", d: "Moonshot" }, { n: "DeepSeek", d: "DeepSeek" }, { n: "Perplexity", d: "Search" }, { n: "Google", d: "Search page" }];
const PROVIDER_META = { ChatGPT: { c: "#10a37f", l: "G" }, Gemini: { c: "#4285f4", l: "G" }, Claude: { c: "#d97757", l: "C" }, Grok: { c: "#9aa4b2", l: "X" }, Kimi: { c: "#3ee6c4", l: "K" }, DeepSeek: { c: "#5b6cff", l: "D" }, Perplexity: { c: "#20b8cd", l: "P" }, Google: { c: "#ea8600", l: "R" } };

/* ===== Multi-Mode Cockpit State & Methods ===== */
let isMultiActive = false;
let currentMultiMode = "power"; // "power" | "compare" | "debate" | "council"
const MULTI_PROVIDERS = ["ChatGPT", "Claude", "Gemini", "DeepSeek", "Grok", "Kimi", "Perplexity"];
let selectedMultiProviders = ["ChatGPT", "Claude", "Gemini"];

const MULTI_HINTS = {
  power: "⚡ <b>Power Ask:</b> Queries all selected models in parallel and displays streaming response cards.",
  compare: "⚔ <b>Compare:</b> Side-by-side comparison cards to evaluate answers across selected models.",
  debate: "🗣 <b>Debate:</b> Selected models challenge each other with multi-round rebuttals.",
  council: "🏛 <b>Council:</b> Proposer models draft, Critic critiques, Judge synthesizes final verdict."
};

let modeProviders = {
  power: ["ChatGPT", "Claude", "Gemini", "Grok"],
  compare: ["ChatGPT", "Claude", "Gemini"],
  debate: ["ChatGPT", "Claude"],
  council: ["ChatGPT", "Claude", "Gemini"]
};
let debateRounds = 2;

function renderMultiTerminal() {
  const panel = $("multi-terminal");
  const tog = $("multimode-toggle");
  if (!panel) return;
  panel.classList.toggle("open", !!isMultiActive);
  if (tog) {
    tog.style.background = isMultiActive ? "linear-gradient(135deg, rgba(139,124,255,.35), rgba(62,230,196,.2))" : "rgba(139,124,255,.12)";
    tog.style.borderColor = isMultiActive ? "var(--acc)" : "rgba(139,124,255,.4)";
    tog.style.boxShadow = isMultiActive ? "0 0 10px rgba(139,124,255,.3)" : "none";
  }
  if ($("curtitle") && isMultiActive) {
    $("curtitle").textContent = `⚡ Multi: ${currentMultiMode.toUpperCase()}`;
  }

  document.querySelectorAll(".mt-mbtn").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === currentMultiMode);
  });

  const hintEl = $("mt-hint");
  if (hintEl) hintEl.innerHTML = MULTI_HINTS[currentMultiMode] || MULTI_HINTS.power;

  const rWrap = $("mt-rounds-wrap");
  if (rWrap) {
    rWrap.style.display = currentMultiMode === "debate" ? "inline-flex" : "none";
    const rInp = $("mt-rounds-input");
    if (rInp) rInp.value = debateRounds;
  }

  const row = $("mt-prov-row");
  if (row) {
    row.innerHTML = '<span class="mt-label">Models:</span>';
    MULTI_PROVIDERS.forEach((p) => {
      const pm = (typeof PROVIDER_META !== "undefined" && PROVIDER_META[p]) || { c: "#8b7cff", l: p[0] };
      const checked = selectedMultiProviders.includes(p);
      const chip = document.createElement("label");
      chip.className = "mt-pchip" + (checked ? " on" : "");
      chip.innerHTML = `<span class="mt-dot" style="background:${pm.c}"></span><input type="checkbox" value="${p}" ${checked ? "checked" : ""}> ${p}`;
      chip.addEventListener("change", () => {
        const cb = chip.querySelector("input");
        if (cb.checked) {
          if (!selectedMultiProviders.includes(p)) selectedMultiProviders.push(p);
        } else {
          selectedMultiProviders = selectedMultiProviders.filter((x) => x !== p);
        }
        chip.classList.toggle("on", cb.checked);
        modeProviders[currentMultiMode] = selectedMultiProviders.slice();
        chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
      });
      row.appendChild(chip);
    });
  }
}

function getSelectedMultiProviders() {
  if (selectedMultiProviders && selectedMultiProviders.length) return selectedMultiProviders.slice();
  selectedMultiProviders = (modeProviders[currentMultiMode] && modeProviders[currentMultiMode].length) ? modeProviders[currentMultiMode].slice() : ["ChatGPT", "Claude", "Gemini"];
  return selectedMultiProviders.slice();
}

function toggleMultiMode(forceState, targetMode) {
  if (forceState !== undefined) isMultiActive = !!forceState;
  else isMultiActive = !isMultiActive;
  if (targetMode) {
    currentMultiMode = targetMode;
    selectedMultiProviders = (modeProviders[currentMultiMode] && modeProviders[currentMultiMode].length) ? modeProviders[currentMultiMode].slice() : ["ChatGPT", "Claude", "Gemini"];
  }
  chrome.storage.local.set({ sb_multi_active: isMultiActive, sb_multi_mode: currentMultiMode, sb_multi_providers: selectedMultiProviders }).catch(() => {});
  renderMultiTerminal();
  if (isMultiActive) {
    $("q")?.focus();
    toast("Multi-Mode active: " + currentMultiMode.toUpperCase());
  }
}

chrome.storage.local.get(["sb_multi_active", "sb_multi_mode", "sb_multi_providers", "sb_multi_mode_providers", "sb_multi_cfg"]).then((s) => {
  if (s.sb_multi_active !== undefined) isMultiActive = !!s.sb_multi_active;
  if (s.sb_multi_mode) currentMultiMode = s.sb_multi_mode;
  if (s.sb_multi_mode_providers && typeof s.sb_multi_mode_providers === "object") {
    Object.assign(modeProviders, s.sb_multi_mode_providers);
  }
  if (modeProviders[currentMultiMode] && modeProviders[currentMultiMode].length) {
    selectedMultiProviders = modeProviders[currentMultiMode].slice();
  } else if (Array.isArray(s.sb_multi_providers) && s.sb_multi_providers.length) {
    selectedMultiProviders = s.sb_multi_providers;
  }
  if (s.sb_multi_cfg?.rounds) debateRounds = Math.min(Math.max(Number(s.sb_multi_cfg.rounds), 1), 3);
  renderMultiTerminal();
}).catch(() => {});

function buildModels() {
  const drop = $("mdrop"); if (!drop) return; drop.innerHTML = "";
  const multiOpt = document.createElement("button");
  multiOpt.className = "mopt";
  multiOpt.style.cssText = "background:rgba(139,124,255,.16);border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px;border-radius:8px";
  multiOpt.innerHTML = `<b style="color:var(--acc)">⚡ Multi-Mode Cockpit</b><small style="color:#3ee6c4">4 Modes</small>`;
  multiOpt.onclick = () => { drop.classList.remove("open"); toggleMultiMode(true); };
  drop.appendChild(multiOpt);
  MODELS.forEach((m) => {
    const b = document.createElement("button"); b.className = "mopt";
    b.innerHTML = `<b>${m.n}</b><small>${m.d}</small>`;
    b.onclick = () => { drop.classList.remove("open"); switchProvider(m.n); };
    drop.appendChild(b);
  });
}
buildModels();

if ($("multimode-toggle")) $("multimode-toggle").onclick = () => toggleMultiMode();
if ($("mt-close-btn")) $("mt-close-btn").onclick = () => toggleMultiMode(false);
if ($("newmultichat")) {
  $("newmultichat").onclick = async () => {
    const id = "c" + Date.now();
    sessions.unshift({ id, title: "⚡ Multi-Mode (" + currentMultiMode + ")", provider: "Multi", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    sessions = sessions.slice(0, 30);
    activeId = id;
    await persist();
    loadSessionsView();
    toggleMultiMode(true);
    $("q")?.focus();
  };
}
document.querySelectorAll(".mt-mbtn").forEach((b) => {
  b.onclick = () => {
    currentMultiMode = b.dataset.mode;
    selectedMultiProviders = (modeProviders[currentMultiMode] && modeProviders[currentMultiMode].length) ? modeProviders[currentMultiMode].slice() : ["ChatGPT", "Claude", "Gemini"];
    chrome.storage.local.set({ sb_multi_mode: currentMultiMode, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
});
if ($("mt-all-provs")) {
  $("mt-all-provs").onclick = () => {
    selectedMultiProviders = MULTI_PROVIDERS.slice();
    modeProviders[currentMultiMode] = selectedMultiProviders.slice();
    chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
}
if ($("mt-none-provs")) {
  $("mt-none-provs").onclick = () => {
    selectedMultiProviders = [];
    modeProviders[currentMultiMode] = [];
    chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
}
if ($("mt-top3-provs")) {
  $("mt-top3-provs").onclick = () => {
    selectedMultiProviders = ["ChatGPT", "Claude", "Gemini"];
    modeProviders[currentMultiMode] = selectedMultiProviders.slice();
    chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
}
if ($("mt-code-provs")) {
  $("mt-code-provs").onclick = () => {
    selectedMultiProviders = ["DeepSeek", "Claude", "ChatGPT"];
    modeProviders[currentMultiMode] = selectedMultiProviders.slice();
    chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
}
if ($("mt-search-provs")) {
  $("mt-search-provs").onclick = () => {
    selectedMultiProviders = ["Perplexity", "Gemini", "Grok"];
    modeProviders[currentMultiMode] = selectedMultiProviders.slice();
    chrome.storage.local.set({ sb_multi_mode_providers: modeProviders, sb_multi_providers: selectedMultiProviders }).catch(() => {});
    renderMultiTerminal();
  };
}
if ($("mt-rounds-input")) {
  $("mt-rounds-input").onchange = (e) => {
    debateRounds = Math.min(Math.max(Number(e.target.value || 2), 1), 3);
    e.target.value = debateRounds;
    chrome.storage.local.get("sb_multi_cfg").then((s) => {
      const cfg = s.sb_multi_cfg || {};
      cfg.rounds = debateRounds;
      chrome.storage.local.set({ sb_multi_cfg: cfg }).catch(() => {});
    }).catch(() => {});
  };
}
$("modelbtn").onclick = () => $("mdrop").classList.toggle("open");
$("togglerail").onclick = () => { document.body.classList.toggle("closed"); chrome.storage.local.set({ sb_rail: document.body.classList.contains("closed") ? "0" : "1" }).catch(() => {}); };
$("togglerail2").onclick = () => $("togglerail").click();
chrome.storage.local.get(["sb_memory"]).then((s) => { if ($("set-memory")) $("set-memory").value = s.sb_memory || ""; }).catch(() => {});
$("set-memory").onchange = () => chrome.storage.local.set({ sb_memory: $("set-memory").value.slice(0, 1000) }).catch(() => {});
$("settingsbtn").onclick = () => $("settings").classList.add("open");
$("closesettings").onclick = () => $("settings").classList.remove("open");
$("wipedata").onclick = async () => { if (confirm("Delete all local chats?")) { sessions = []; await chrome.storage.local.set({ sb_sessions: [] }).catch(() => {}); loadSessionsView(); $("settings").classList.remove("open"); } };
$("dlbugs").onclick = async () => { await exportBugLogMD(); dlog("info", "export:md", "sidepanel"); toast("Debug log downloaded"); };
chrome.storage.local.get(["sb_agent", "sb_provider", "sb_rail", "sb_attach", "sb_density", "sb_linenos", "sb_tool_gate"]).then((s) => {
  const isAgent = s.sb_agent !== false;
  $("agent").checked = isAgent;
  if (s.sb_agent === undefined) chrome.storage.local.set({ sb_agent: true }).catch(() => {});
  chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
  if (s.sb_provider && URLS[s.sb_provider]) { current = s.sb_provider; $("modelname").textContent = current; if (grid) [...grid.children].forEach((c) => c.classList.toggle("on", c.textContent === current)); }
  if (s.sb_rail === "0") document.body.classList.add("closed");
  if (s.sb_attach === "0" && $("attach")) $("attach").checked = false;
  if ($("set-attach")) $("set-attach").checked = $("attach")?.checked ?? true;
  if (s.sb_density) { document.body.classList.add("compact"); if ($("set-density")) $("set-density").checked = true; }
  if (s.sb_linenos === false) { if ($("set-linenos")) $("set-linenos").checked = false; } else if ($("set-linenos")) { $("set-linenos").checked = true; }
  if ($("set-toolgate")) $("set-toolgate").checked = s.sb_tool_gate !== false;
  if ($("set-external")) $("set-external").checked = s.sb_external_api === true;
}).catch(() => {});
if ($("set-density")) {
  $("set-density").onchange = () => {
    document.body.classList.toggle("compact", $("set-density").checked);
    chrome.storage.local.set({ sb_density: $("set-density").checked }).catch(() => {});
  };
}
if ($("set-linenos")) {
  $("set-linenos").onchange = () => {
    chrome.storage.local.set({ sb_linenos: $("set-linenos").checked }).catch(() => {});
  };
}
if ($("set-toolgate")) {
  $("set-toolgate").onchange = () => {
    chrome.storage.local.set({ sb_tool_gate: $("set-toolgate").checked }).catch(() => {});
    toast($("set-toolgate").checked ? "Approval gate: ON (agent actions need your OK)" : "Approval gate: OFF (tools run immediately)");
  };
}
// Optional "<all_urls>" host grant. The extension only ships content scripts
// for the AI provider hosts; reading/scraping any other site needs this.
if ($("set-anypage")) {
  const reflectAnyPage = () => {
    if (!chrome.permissions || !chrome.permissions.contains) return;
    chrome.permissions.contains({ origins: ["<all_urls>"] })
      .then((granted) => { $("set-anypage").checked = !!granted; })
      .catch(() => {});
  };
  reflectAnyPage();
  $("set-anypage").onchange = async () => {
    const want = $("set-anypage").checked;
    if (!chrome.permissions || !chrome.permissions.request) { $("set-anypage").checked = !want; return; }
    try {
      const granted = want
        ? await chrome.permissions.request({ origins: ["<all_urls>"] })
        : (await chrome.permissions.remove({ origins: ["<all_urls>"] }), false);
      $("set-anypage").checked = !!granted;
      toast(granted
        ? "NaviBridge can now read any page you open."
        : "Restricted to the AI provider sites again.");
    } catch (e) {
      $("set-anypage").checked = !want;
      toast("Permission request failed: " + String(e).slice(0, 60));
    }
  };
  chrome.permissions?.onAdded?.addListener?.(reflectAnyPage);
  chrome.permissions?.onRemoved?.addListener?.(reflectAnyPage);
}
if ($("set-external")) {
  $("set-external").onchange = () => {
    const on = $("set-external").checked;
    chrome.storage.local.set({ sb_external_api: on }).catch(() => {});
    toast(on
      ? "Local web pages may now message the extension (bridge token still required)."
      : "External messaging disabled.");
  };
}
$("set-attach").onchange = () => { $("attach").checked = $("set-attach").checked; chrome.storage.local.set({ sb_attach: $("attach").checked ? "1" : "0" }).catch(() => {}); };
chrome.storage.session.get("sb_pending").then((s) => {
  if (s.sb_pending) { $("q").value = `Explain: "${s.sb_pending}"`; chrome.storage.session.remove("sb_pending").catch(() => {}); }
});
$("agent").onchange = () => {
  chrome.storage.local.set({ sb_agent: $("agent").checked }).catch(() => {});
  chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
};
let sessions = [], activeId = null;
async function loadSessions() {
  const s = await chrome.storage.local.get(["sb_sessions", "sb_active"]).catch(() => ({}));
  sessions = s.sb_sessions || [];
  activeId = s.sb_active || null;
  if (!sessions.length) {
    const old = await chrome.storage.session.get("sb_chat").catch(() => ({}));
    const msgs = (old.sb_chat || []).map((m) => ({ who: m.who, text: m.text, ts: Date.now() }));
    const id = "c" + Date.now();
    sessions = [{ id, title: "First chat", provider: current, createdAt: Date.now(), updatedAt: Date.now(), messages: msgs }];
    activeId = id;
    await chrome.storage.local.set({ sb_sessions: sessions, sb_active: activeId }).catch(() => {});
  }
  if (!sessions.find((x) => x.id === activeId)) activeId = sessions[0]?.id || null;
  renderSessions("");
  const a = sessions.find((x) => x.id === activeId);
  $("chat").innerHTML = "";
  (a?.messages || []).forEach((m) => bubble(m.who, m.text, true, m.ts, m.images, m));
}
function active() { return sessions.find((x) => x.id === activeId); }
// Embedded base64 screenshots dominate the storage payload. Keep the ones
// that are cheap (remote URLs, small data URLs) and drop the rest.
const MAX_STORED_IMAGE_CHARS = 200 * 1024;
function persistableMessage(m) {
  const out = { ...m, text: String(m.text ?? "").slice(0, 6000) };
  if (Array.isArray(out.images)) {
    out.images = out.images.filter((im) => {
      const src = String((im && im.src) || im || "");
      if (!src) return false;
      if (src.startsWith("data:")) return src.length <= MAX_STORED_IMAGE_CHARS;
      return /^(https?:|blob:)/.test(src);
    }).slice(0, 3);
  }
  return out;
}
function persistableSessions(list, stripImages) {
  return list.map((s) => ({
    ...s,
    messages: (s.messages || []).slice(-40).map((m) => {
      const p = persistableMessage(m);
      if (stripImages && Array.isArray(p.images)) p.images = p.images.filter((im) => !String((im && im.src) || "").startsWith("data:"));
      return p;
    })
  }));
}
async function persist() {
  const a = active(); if (a) a.updatedAt = Date.now();
  try {
    await chrome.storage.local.set({ sb_sessions: persistableSessions(sessions.slice(0, 60), false), sb_active: activeId });
  } catch {
    // Quota exceeded: shed history, then embedded images, and tell the user
    // instead of silently discarding their chats.
    try {
      await chrome.storage.local.set({ sb_sessions: persistableSessions(sessions.slice(0, 20), true), sb_active: activeId });
      toast("Storage was full — older chats and embedded images were trimmed.");
    } catch (e) {
      toast("Could not save chats: " + String((e && e.message) || e).slice(0, 80));
    }
  }
}
function saveChat(who, text, images, extra) { const a = active(); if (!a) return null; a.mine = true; if (who === "me" && a.messages.length === 0) a.title = String(text).slice(0, 40); a.messages.push({ who, text: String(text).slice(0, 10000), images: (images || []).slice(0, 5), ...(extra || {}), ts: Date.now() }); a.messages = a.messages.slice(-100); persist().then(renderSessions.bind(null, $("ssearch")?.value || "")); return a.messages[a.messages.length - 1]; }
function groupLabel(ts) { const d = new Date(ts), now = new Date(); const day = (a, b) => a.toDateString() === b.toDateString(); const y = new Date(now); y.setDate(now.getDate() - 1); if (day(d, now)) return "Today"; if (day(d, y)) return "Yesterday"; if (Date.now() - ts < 7 * 864e5) return "Previous 7 days"; return "Older"; }
let multiViewMode = "grid";
try { chrome.storage.local.get("sb_multiview").then((s) => { if (s?.sb_multiview) multiViewMode = s.sb_multiview; }).catch(() => {}); } catch {}

function generateConsensusSummary(parts) {
  const successful = (parts || []).filter((p) => p.ok && p.text && p.text.length > 30);
  if (successful.length < 2) return null;

  const stopWords = new Set(["the", "and", "for", "with", "that", "this", "from", "have", "are", "you", "which", "your", "can", "will", "what", "their", "more", "then", "also"]);
  const wordSets = successful.map((p) => {
    const words = p.text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    return new Set(words.filter((w) => !stopWords.has(w)));
  });

  let totalSim = 0, pairs = 0;
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const intersection = [...wordSets[i]].filter((x) => wordSets[j].has(x)).length;
      const union = new Set([...wordSets[i], ...wordSets[j]]).size;
      totalSim += union ? intersection / union : 0;
      pairs++;
    }
  }
  const avgSim = pairs ? totalSim / pairs : 0;
  // Honest agreement score = measured word-overlap similarity between model outputs (Jaccard)
  const scorePercent = Math.min(100, Math.max(0, Math.round(avgSim * 100)));
  const commonWords = [...wordSets[0]].filter((w) => wordSets.every((s) => s.has(w))).slice(0, 5);

  return {
    score: scorePercent,
    label: scorePercent >= 60 ? "High Consensus" : (scorePercent >= 35 ? "Partial Alignment" : "Diverse Perspectives"),
    modelsCount: successful.length,
    models: successful.map((s) => s.p),
    commonKeywords: commonWords
  };
}

function powerGridEl(parts) {
  const wrap = document.createElement("div");
  wrap.className = "ai-row msg";
  const av = document.createElement("div"); av.className = "av"; av.textContent = "⚡";
  const bub = document.createElement("div"); bub.className = "bub wide"; bub.style.background = "transparent"; bub.style.border = "0"; bub.style.padding = "0";

  const outer = document.createElement("div");
  outer.className = "multi-grid-wrap";

  // Consensus synthesis banner if 2+ models answered
  const consensus = generateConsensusSummary(parts);
  if (consensus) {
    const cBanner = document.createElement("div");
    cBanner.className = "consensus-banner";
    const keywords = (consensus.commonKeywords || []).join(", ");
    cBanner.innerHTML = `
      <div class="consensus-head">
        <span style="display:flex;align-items:center;gap:6px">🏆 <b>Multi-Model Synthesis &amp; Consensus</b></span>
        <span class="consensus-badge">🎯 ${consensus.score}% Agreement · ${escH(consensus.label)}</span>
      </div>
      <div class="consensus-body">
        Evaluated <b>${consensus.modelsCount} models</b> (${escH(consensus.models.map(escH).join(", "))}). ${keywords ? "Shared core terms: <i>" + escH(keywords) + "</i>." : "Models diverged — no strong shared terminology detected."}
      </div>
    `;
    outer.appendChild(cBanner);
  }

  // Top control bar with layout switch
  const topBar = document.createElement("div");
  topBar.className = "power-grid-bar";
  topBar.innerHTML = `<span>Multi-Model Responses (${(parts || []).length} models)</span>`;
  const btnGroup = document.createElement("div");
  btnGroup.className = "power-grid-btns";
  const gridBtn = document.createElement("button");
  gridBtn.className = "view-btn" + (multiViewMode === "grid" ? " on" : "");
  gridBtn.textContent = "⊞ Grid";
  const colBtn = document.createElement("button");
  colBtn.className = "view-btn" + (multiViewMode === "columns" ? " on" : "");
  colBtn.textContent = "▥ Columns";

  btnGroup.append(gridBtn, colBtn);
  topBar.appendChild(btnGroup);
  outer.appendChild(topBar);

  const container = document.createElement("div");
  container.className = "power-cards-container" + (multiViewMode === "columns" ? " columns-view" : "");

  gridBtn.onclick = () => {
    multiViewMode = "grid";
    chrome.storage.local.set({ sb_multiview: "grid" }).catch(() => {});
    gridBtn.classList.add("on"); colBtn.classList.remove("on");
    container.classList.remove("columns-view");
  };
  colBtn.onclick = () => {
    multiViewMode = "columns";
    chrome.storage.local.set({ sb_multiview: "columns" }).catch(() => {});
    colBtn.classList.add("on"); gridBtn.classList.remove("on");
    container.classList.add("columns-view");
  };

  (parts || []).forEach((pt) => {
    const card = document.createElement("div");
    card.className = "power-card";
    card.dataset.p = pt.p;

    const pm = (typeof PROVIDER_META !== "undefined" && PROVIDER_META[pt.p]) || { c: "#8b7cff", l: pt.p[0] };
    const isPending = pt.pending || String(pt.text || "").startsWith("⏳");

    const hd = document.createElement("div");
    hd.className = "power-card-hd";
    const dot = document.createElement("span");
    dot.className = "power-dot" + (isPending ? " pulse" : "");
    dot.style.background = isPending ? "#f59e0b" : (pt.ok ? "var(--ok, #3ecf8e)" : "#ff6b6b");

    const pTitle = document.createElement("span");
    pTitle.style.color = pm.c;
    pTitle.textContent = pt.p;

    const meta = document.createElement("span");
    meta.className = "power-card-meta";
    if (isPending) {
      meta.textContent = "streaming…";
    } else if (pt.ok) {
      const words = pt.words || String(pt.text || "").split(/\s+/).filter(Boolean).length;
      const sec = pt.durationMs ? `${(pt.durationMs / 1000).toFixed(1)}s` : "";
      meta.textContent = `${words} words${sec ? " · " + sec : ""}`;
    } else {
      meta.textContent = "failed";
      meta.style.color = "#ff6b6b";
    }

    hd.append(dot, pTitle, meta);

    const body = document.createElement("div");
    body.className = "power-card-body";
    body.appendChild(mdLite(isPending ? pt.text : (pt.ok ? pt.text : "ERROR " + (pt.error || "unknown"))));
    (pt.images || []).filter((im) => /^(https?:|data:image\/)/.test(im.src || "")).slice(0, 2).forEach((im) => {
      const img = document.createElement("img");
      img.src = im.src; img.alt = im.alt || "image";
      img.style.cssText = "max-width:100%;border-radius:9px;border:1px solid var(--line);margin-top:6px";
      img.loading = "lazy";
      body.appendChild(img);
    });

    const foot = document.createElement("div");
    foot.className = "power-card-foot";

    const cp = document.createElement("button");
    cp.className = "power-card-act";
    cp.textContent = "📋 Copy";
    cp.onclick = async () => {
      await navigator.clipboard.writeText(pt.ok ? pt.text : "ERROR " + (pt.error || "")).catch(() => {});
      cp.textContent = "✓ Copied";
      setTimeout(() => (cp.textContent = "📋 Copy"), 1200);
    };

    const canvasBtn = document.createElement("button");
    canvasBtn.className = "power-card-act";
    canvasBtn.textContent = "🔍 Focus";
    canvasBtn.onclick = () => {
      openCanvas(pt.ok ? pt.text : "Error: " + (pt.error || "unknown"), pt.p + " Response");
    };

    const contBtn = document.createElement("button");
    contBtn.className = "power-card-act primary";
    contBtn.textContent = "💬 Continue";
    contBtn.title = `Switch single model to ${pt.p} and continue`;
    contBtn.onclick = () => {
      switchProvider(pt.p);
      toggleMultiMode(false);
      $("q")?.focus();
      toast(`Switched active model to ${pt.p}`);
    };

    foot.append(cp, canvasBtn, contBtn);
    card.append(hd, body, foot);
    container.appendChild(card);
  });

  outer.appendChild(container);
  bub.appendChild(outer);
  wrap.append(av, bub);
  return wrap;
}

function powerSave(providers, all, modeLabel = "⚡ Power Ask") {
  const parts = providers.map((p) => {
    const r = all[p] || {};
    return {
      p,
      ok: !!r.ok,
      text: r.ok ? String(r.text).slice(0, 15000) : "",
      error: String(r.error || "").slice(0, 200),
      images: (r.ok ? (r.images || []).slice(0, 2) : []).map((im) => ({ src: im.src, alt: im.alt })),
      durationMs: r.durationMs,
      words: r.ok ? String(r.text || "").split(/\s+/).filter(Boolean).length : 0
    };
  });
  const sum = modeLabel + " — " + providers.map((p) => p + (all[p]?.ok ? " ✓" : " ✗")).join(" ");

  const lastAiRow = document.querySelector("#chat .ai-row:last-of-type");
  const existingGridWrap = lastAiRow?.querySelector(".multi-grid-wrap, .power-card");
  if (existingGridWrap && lastAiRow) {
    const newEl = powerGridEl(parts);
    lastAiRow.replaceWith(newEl);
  } else {
    document.querySelector("#chat").appendChild(powerGridEl(parts));
  }
  if ($("chat")) $("chat").scrollTop = 99999;
  saveChat("ai", sum, null, { parts, grid: true });
}
let tcache = {};
try { chrome.storage.local.get("sb_thread_cache").then((x) => { tcache = x.sb_thread_cache || {}; }).catch(() => {}); } catch {}
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.sb_thread_cache) tcache = ch.sb_thread_cache.newValue || {}; });
let sessionNavBusy = false;
function renderSessions(filter) {
  const box = $("sessions");
  if (!box) return;
  box.innerHTML = "";
  const q = (filter || "").trim().toLowerCase();
  const sdb = $("sdeep"); if (sdb) sdb.style.display = q ? "" : "none";
  const groups = {};
  let matches = 0;
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).forEach((s) => {
    if (s.provider && s.provider !== current && !(isMultiActive && s.provider === "Multi") && !q) return;
    if (q) {
      const hay = [String(s.title || ""), ...(s.messages || []).map((m) => String(m.text)), ...((s.url && tcache[s.url]?.thread) || []).map((t) => String(t.text))];
      if (!hay.some((x) => x.toLowerCase().includes(q))) return;
    }
    matches++;
    const g = groupLabel(s.updatedAt);
    (groups[g] = groups[g] || []).push(s);
  });
  ["Today", "Yesterday", "Previous 7 days", "Older"].forEach((g) => {
    const list = groups[g] || [];
    if (!list.length) return;
    const h = document.createElement("div"); h.className = "grp"; h.textContent = g; box.appendChild(h);
    list.forEach((s) => {
      const r = document.createElement("button");
      r.className = "sess" + (s.id === activeId ? " on" : "");
      if (q || s.provider === "Multi") { const pc = document.createElement("span"); pc.style.cssText = "flex:none;font-size:9px;background:rgba(124,108,255,.2);color:#a9a0ff;border-radius:6px;padding:2px 5px"; pc.textContent = s.provider || "?"; r.appendChild(pc); }
      const t = document.createElement("span"); t.className = "tt"; t.textContent = s.title; t.title = new Date(s.updatedAt).toLocaleString();
      t.ondblclick = async (e) => { e.stopPropagation(); const nt = prompt("Rename chat", s.title); if (nt) { s.title = nt.slice(0, 60); await persist(); renderSessions($("ssearch")?.value || ""); } };
      const dt = document.createElement("span"); dt.className = "dt"; dt.textContent = new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const del = document.createElement("span"); del.textContent = "✕"; del.style.cursor = "pointer";
      del.onclick = async (e) => { e.stopPropagation(); const ix = sessions.findIndex((x) => x.id === s.id); const [gone] = sessions.splice(ix, 1); if (activeId === s.id) activeId = sessions[0]?.id || null; await persist(); loadSessionsView(); toast("Chat deleted", async () => { sessions.splice(ix, 0, gone); await persist(); loadSessionsView(); }); };
      r.onclick = async () => { if (sessionNavBusy) return; sessionNavBusy = true; try { activeId = s.id; await chrome.storage.local.set({ sb_active: activeId }).catch(() => {}); if (s.provider === "Multi") toggleMultiMode(true); loadSessionsView(); if (s.url && !s.messages?.length) $("refreshchat").click(); } finally { sessionNavBusy = false; } };
      if (q) {
        const hitm = (s.messages || []).find((m) => String(m.text).toLowerCase().includes(q));
        const hitt = !hitm && s.url ? ((tcache[s.url]?.thread) || []).find((tm) => String(tm.text).toLowerCase().includes(q)) : null;
        const src = hitm ? hitm.text : hitt ? hitt.text : "";
        if (src) {
          const ix = src.toLowerCase().indexOf(q);
          const snip = document.createElement("span");
          snip.style.cssText = "flex-basis:100%;font-size:10.5px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
          snip.textContent = (ix > 30 ? "…" : "") + src.slice(Math.max(0, ix - 30), ix + 90).replace(/\s+/g, " ");
          r.appendChild(snip);
        }
      }
      r.append(t, dt, del);
      box.appendChild(r);
    });
  });
  const c = $("count"); if (c) c.textContent = q ? matches + " matches" : sessions.length + " chats";
}
function loadSessionsView() { renderSessions($("ssearch")?.value || ""); const a = active(); if ($("curtitle")) $("curtitle").textContent = a ? a.title : ""; $("chat").innerHTML = ""; let lastDay = ""; (a?.messages || []).forEach((m) => { const day = new Date(m.ts || Date.now()).toDateString(); if (day !== lastDay) { const dv = document.createElement("div"); dv.className = "day"; dv.textContent = day; $("chat").appendChild(dv); lastDay = day; } if (m.grid && m.parts) $("chat").appendChild(powerGridEl(m.parts)); else bubble(m.who, m.text, true, m.ts, [...(m.images || []), ...(m.videos || [])]); }); const c = $("count"); if (c) c.textContent = sessions.length + " chats"; }
// Ctrl+K opens Omni Command Palette handled below
loadSessions().catch(() => {});
const FETCH_URLS = { chatgpt: URLS.ChatGPT, gemini: URLS.Gemini, claude: "https://claude.ai/chats", grok: URLS.Grok, kimi: URLS.Kimi, deepseek: URLS.DeepSeek, perplexity: URLS.Perplexity };
async function waitTabComplete(tabId, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const t = await chrome.tabs.get(tabId); if (t.status === "complete") return; } catch { return; }
    await new Promise((r) => setTimeout(r, 300));
  }
}
async function fetchDirect(name) {
  const key = String(name || "chatgpt").toLowerCase();
  const url = FETCH_URLS[key] || FETCH_URLS.chatgpt;
  let tabId = null;
  try {
    const own = await chrome.runtime.sendMessage({ type: "SB_OWNTAB", key: "fetch:" + key, url });
    if (own?.ok) tabId = own.tabId;
  } catch {}
  if (!tabId) { logBug("fetchDirect:owntab", "no tabId", key); return { ok: false, error: "owntab-failed" }; }
  await waitTabComplete(tabId);
  for (let i = 0; i < 3; i++) {
    try { await chrome.tabs.sendMessage(tabId, { type: "SB_READ" }); }
    catch { try { await chrome.scripting.executeScript({ target: { tabId }, files: ["debug-shared.js", "content.js"] }); await new Promise((r) => setTimeout(r, 800)); } catch (e) { if (i === 2) { logBug("fetchDirect:inject", e, key); return { ok: false, error: "inject-failed: " + String(e).slice(0, 120) }; } continue; } }
    await new Promise((r) => setTimeout(r, 1200));
    try { return await chrome.tabs.sendMessage(tabId, { type: "SB_FETCH" }); }
    catch (e) { if (i === 2) { logBug("fetchDirect:retry", e, key); return { ok: false, error: "fetch-retry-failed: " + String(e).slice(0, 120) }; } await new Promise((r) => setTimeout(r, 700)); }
  }
}
async function fetchPageCtx(tab) {
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: "SB_PAGE", tabId: tab.id }); } catch {}
  if (r?.error === "host-permission-required") {
    toast(r.hint || "Enable 'Allow reading any page' to read this site.");
    return null;
  }
  if (r?.ok) r.url = r.url || tab.url;
  if (r?.ok && String(r.text || "").length > 120) return r;
  const r2 = await sendToTab(tab.id, { type: "SB_READ" }).catch(() => null);
  if (r2?.ok) return { ok: true, url: r2.url || tab.url, title: r2.title || tab.title, heads: "", meta: "", text: String(r2.text || ""), sel: String(r2.selection || ""), chars: String(r2.text || "").length };
  return null;
}
function renderChip() {
  const c = $("ctxchip");
  if (!c) return;
  if (!pageCtx) { c.style.display = "none"; c.innerHTML = ""; return; }
  const kb = Math.round(String(pageCtx.text || "").length / 100) / 10;
  c.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = `📄 ${String(pageCtx.title || pageCtx.url || "page").slice(0, 44)} (${kb}k chars)`;
  s.title = pageCtx.url || "";
  const x = document.createElement("span");
  x.textContent = " ✕"; x.style.cssText = "cursor:pointer;margin-left:6px";
  x.onclick = () => { pageCtx = null; renderChip(); };
  c.append(s, x);
  c.style.display = "block";
}
let pageCtx = null;
async function pageContext() {
  try {
    let out = "";
    const pins = await chrome.storage.local.get("sb_pins").then((x) => x.sb_pins || []).catch(() => []);
    if (pins.length) out += `\n[Pinned tabs: ${pins.map((p) => p.title + " " + p.url).join(" | ").slice(0, 800)}]`;
    const t = await activeTab();
    if (!t?.id || !t.url?.startsWith("http")) return out;
    if (!$("attach")?.checked) return out;
    if (!pageCtx || pageCtx.url !== t.url) { pageCtx = await fetchPageCtx(t); renderChip(); }
    if (!pageCtx) return out;
    const sel = pageCtx.sel ? `\nSelected: ${pageCtx.sel}` : "";
    return out + `\n[Attached page — the user is asking about THIS page:\nURL: ${pageCtx.url}\nTitle: ${pageCtx.title}\nKey sections: ${pageCtx.heads || "(none)"}\nPage summary: ${pageCtx.meta || "(none)"}\nMain content:\n${String(pageCtx.text || "").slice(0, 8000)}${sel}]`;
  } catch { return ""; }
}
async function switchProvider(name) {
  current = name; $("modelname").textContent = name; chrome.storage.local.set({ sb_provider: name }).catch(() => {});
  dlog("info", "switchProvider", name);
  if (grid) [...grid.children].forEach((c) => c.classList.toggle("on", c.textContent === current));
  renderSessions($("ssearch")?.value || "");
  autoFetchProvider(name);
}
async function autoFetchProvider(name) {
  const last = Number((await chrome.storage.local.get("sb_fetch_" + name).then((s) => s["sb_fetch_" + name]).catch(() => 0)) || 0);
  if (Date.now() - last < 5 * 60 * 1000 && sessions.some((s) => s.provider === name)) { renderSessions($("ssearch")?.value || ""); return; }
  bubble("ai", "Loading " + name + " chats...", true);
  $("st").textContent = "working";
  dlog("info", "autoFetch:start", name);
  try {
    const res = await fetchDirect(name);
    if (!res) { bubble("ai", "Fetch error (" + name + "): no response — reload extension and retry.", true); logBug("autoFetch:noresponse", "empty", name); }
    document.querySelector("#chat .ai-row:last-child")?.remove();
    if (!res?.ok) { bubble("ai", "Fetch error (" + current + "): " + (res?.error || "no-receiver") + " — reload extension, open " + current + " visibly once, then switch again.", true); }
    else if (!res.items?.length) { bubble("ai", `No ${name} chats found (${res.debug?.host || ""}, links:${res.debug?.links ?? 0}, loggedIn:${res.debug?.loggedIn}). Samples: ${(res.debug?.raw || []).join(" | ").slice(0, 200) || "none"} — open ${name} visibly, wait sidebar, switch again.`, true); }
    else {
      sessions = sessions.filter((s) => s.provider !== name || s.mine);
      res.items.slice(0, 100).forEach((it) => sessions.unshift({ id: "f" + Date.now() + Math.random().toString(16).slice(2), title: it.title, provider: name, url: it.url, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }));
      sessions = sessions.slice(0, 120); await persist(); renderSessions($("ssearch")?.value || "");
      await chrome.storage.local.set({ ["sb_fetch_" + name]: Date.now() }).catch(() => {});
      dlog("info", "autoFetch:ok", name + " items=" + res.items.length);
      bubble("ai", "Loaded " + res.items.length + " " + name + " chats in rail — click one to open.", true);
    }
  } catch (e) { document.querySelector("#chat .ai-row:last-child")?.remove(); bubble("ai", friendlyError(String(e)), true); }
  $("st").textContent = "ready";
}
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
function escH(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function inlineMd(s) {
  s = escH(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:!)])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!)])/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function blockMd(t) {
  const L = String(t).replace(/\r/g, "").split("\n");
  const out = []; let i = 0;
  const cleanRow = (r) => { const c = r.slice(); if (c.length && c[0] === "") c.shift(); if (c.length && c[c.length - 1] === "") c.pop(); return c; };
  while (i < L.length) {
    const ln = L[i];
    if (/^####\s/.test(ln)) { out.push("<h4>" + inlineMd(ln.slice(5)) + "</h4>"); i++; continue; }
    if (/^###\s/.test(ln)) { out.push("<h3>" + inlineMd(ln.slice(4)) + "</h3>"); i++; continue; }
    if (/^##\s/.test(ln)) { out.push("<h2>" + inlineMd(ln.slice(3)) + "</h2>"); i++; continue; }
    if (/^#\s/.test(ln)) { out.push("<h2>" + inlineMd(ln.slice(2)) + "</h2>"); i++; continue; }
    if (/^\s*([-*_]\s?){3,}\s*$/.test(ln)) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(ln)) { const q = []; while (i < L.length && /^>\s?/.test(L[i])) { q.push(L[i].replace(/^>\s?/, "")); i++; } out.push("<blockquote>" + inlineMd(q.join(" ")) + "</blockquote>"); continue; }
    if (ln.includes("|") && i + 1 < L.length && /^[\s|:-]+$/.test(L[i + 1])) {
      const rows = [];
      while (i < L.length && L[i].includes("|")) { rows.push(L[i].split("|").map((s) => s.trim())); i++; }
      rows.splice(1, 1);
      const cells = rows.map(cleanRow);
      let h = "<table><thead><tr>" + (cells[0] || []).map((c) => "<th>" + inlineMd(c) + "</th>").join("") + "</tr></thead><tbody>";
      cells.slice(1).forEach((r) => { h += "<tr>" + r.map((c) => "<td>" + inlineMd(c) + "</td>").join("") + "</tr>"; });
      out.push(h + "</tbody></table>"); continue;
    }
    const isOl = /^(\d+)[.)]\s/.test(ln.trim()), isUl = /^[-*+]\s/.test(ln.trim());
    if (isOl || isUl) {
      const markerRe = isOl ? /^(\d+)[.)]\s/ : /^[-*+]\s/;
      const otherRe = isOl ? /^[-*+]\s/ : /^(\d+)[.)]\s/;
      const items = []; let cur = null;
      while (i < L.length) {
        const x = L[i];
        if (markerRe.test(x.trim())) { if (cur) items.push(cur); cur = x.replace(/^\s*(\d+[.)]|[-*+])\s/, ""); }
        else if (x.trim() === "") { if (cur) { items.push(cur); cur = null; } }
        else if (otherRe.test(x.trim()) || /^(#{1,4}\s|>\s?|[-*_]\s?){1}/.test(x) || (x.includes("|") && i + 1 < L.length && /^[\s|:-]+$/.test(L[i + 1]))) { break; }
        else if (cur !== null) cur += "\n" + x;
        else break;
        i++;
      }
      if (cur) items.push(cur);
      out.push((isOl ? "<ol>" : "<ul>") + items.map((it) => "<li>" + inlineMd(it) + "</li>").join("") + (isOl ? "</ol>" : "</ul>"));
      continue;
    }
    if (ln.trim() === "") { i++; continue; }
    const para = [ln]; i++;
    while (i < L.length && L[i].trim() !== "" && !/^(#{1,4}\s|>\s?|(\d+)[.)]\s|[-*+]\s)/.test(L[i]) && !(L[i].includes("|") && i + 1 < L.length && /^[\s|:-]+$/.test(L[i + 1]))) { para.push(L[i]); i++; }
    out.push("<p>" + inlineMd(para.join("\n")).replace(/\n/g, "<br>") + "</p>");
  }
  return out.join("");
}
const KEYWORDS = /^(?:function|return|if|else|elif|for|while|const|let|var|class|def|import|from|print|async|await|try|catch|except|finally|switch|case|break|continue|new|typeof|instanceof|export|default|null|true|false|self|this|lambda|yield|in|not|and|or|with|as|select|from|where|group|order|by|join|insert|update|delete|create|table|index|indicator|strategy|plot|plotshape|plotchar|plotbar|ta|color|input|crossover|crossunder|sma|ema|rsi|macd|series|float|int|bool|string|na|nz|hline|fill|alert|alertcondition)$/i;
function hl(src) {
  let out = "", i = 0;
  const esc = (s) => escH(s);
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; } out += '<span class="tok-str">' + esc(src.slice(i, j)) + "</span>"; i = j; continue; }
    if (c === "/" && src[i + 1] === "/") { let j = src.indexOf("\n", i); if (j < 0) j = src.length; out += '<span class="tok-com">' + esc(src.slice(i, j)) + "</span>"; i = j; continue; }
    if (c === "/" && src[i + 1] === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? src.length : j + 2; out += '<span class="tok-com">' + esc(src.slice(i, j)) + "</span>"; i = j; continue; }
    if (c === "#" && (i === 0 || src[i - 1] === "\n" || src[i - 1] === " ")) { let j = src.indexOf("\n", i); if (j < 0) j = src.length; out += '<span class="tok-com">' + esc(src.slice(i, j)) + "</span>"; i = j; continue; }
    if (/[0-9]/.test(c) && !/[0-9a-zA-Z_$]/.test(src[i - 1] || "")) { let j = i; while (j < src.length && /[0-9._xXa-fA-F]/.test(src[j])) j++; out += '<span class="tok-num">' + esc(src.slice(i, j)) + "</span>"; i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++; const w = src.slice(i, j); out += KEYWORDS.test(w) ? '<span class="tok-key">' + esc(w) + "</span>" : esc(w); i = j; continue; }
    out += esc(c); i++;
  }
  return out;
}
function mdLite(text) {
  const d = document.createElement("div");
  const parts = String(text).split(/```/);
  const unclosed = parts.length % 2 === 0;
  parts.forEach((p, i) => {
    if (i % 2 === 1 || (unclosed && i > 0 && i === parts.length - 1)) {
      const lines = p.replace(/^\n/, "").split("\n");
      const first = lines[0].trim();
      const lang = /^[a-zA-Z0-9+#*._-]{1,16}$/.test(first) ? first : "";
      const code = (lang ? lines.slice(1) : lines).join("\n").replace(/\s+$/, "");
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      const bar = document.createElement("div");
      bar.className = "code-wrap-bar";
      const lg = document.createElement("span");
      lg.className = "code-wrap-lang";
      lg.textContent = lang ? lang.toUpperCase() : "CODE";

      const acts = document.createElement("div");
      acts.style.cssText = "display:flex;gap:5px;align-items:center";

      const wb = document.createElement("button");
      wb.textContent = "↩ Wrap";
      wb.className = "code-wrap-copy";
      wb.title = "Toggle line wrapping";
      wb.onclick = () => {
        wrap.classList.toggle("wrapped");
        wb.classList.toggle("copied", wrap.classList.contains("wrapped"));
      };

      const isPine = lang.toLowerCase().includes("pine") || code.includes("//@version=") || code.includes("indicator(") || code.includes("strategy(");
      if (isPine) {
        const pb = document.createElement("button");
        pb.textContent = "🌲 Pine Studio";
        pb.className = "code-wrap-copy";
        pb.style.borderColor = "var(--ok)";
        pb.style.color = "var(--ok)";
        pb.onclick = () => {
          if ($("pinepop")) {
            $("pinepop").classList.add("open");
            if ($("pine-code")) $("pine-code").value = code;
          }
        };
        acts.appendChild(pb);
      }

      const cnb = document.createElement("button");
      cnb.textContent = "🎨 Canvas";
      cnb.className = "code-wrap-copy";
      cnb.onclick = () => openCanvas(code, (lang ? lang.toUpperCase() : "Code") + " Snippet");
      acts.appendChild(cnb);

      const cb = document.createElement("button");
      cb.textContent = "📋 Copy";
      cb.className = "code-wrap-copy";
      cb.onclick = async () => {
        await navigator.clipboard.writeText(code).catch(() => {});
        cb.textContent = "✓ Copied";
        cb.classList.add("copied");
        setTimeout(() => { cb.textContent = "📋 Copy"; cb.classList.remove("copied"); }, 1400);
      };
      acts.append(wb, cb);
      bar.append(lg, acts);

      const pre = document.createElement("pre");
      const codeLines = code.split("\n");
      const showLns = !document.getElementById("set-linenos") || document.getElementById("set-linenos").checked;
      if (codeLines.length > 2 && showLns) {
        pre.innerHTML = codeLines.map((line, idx) => {
          return `<div class="code-line"><span class="code-ln">${idx + 1}</span><span class="code-content">${hl(line) || "&nbsp;"}</span></div>`;
        }).join("");
      } else {
        pre.innerHTML = hl(code);
      }
      wrap.append(bar, pre);
      d.append(wrap);
    } else {
      if (!p) return;
      const w = document.createElement("div");
      w.innerHTML = blockMd(p);
      d.appendChild(w);
    }
  });
  return d;
}
function startEdit(row, bub, orig) {
  const turn = row._turn && active() && active().messages.indexOf(row._turn) >= 0 ? row._turn : null;
  if (!turn) { $("q").value = orig; $("q").focus(); $("q").dispatchEvent(new Event("input")); toast("Copy placed in composer — press Send"); return; }
  const old = bub.cloneNode(true);
  bub.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.value = orig;
  ta.rows = Math.min(9, orig.split("\n").length + 1);
  ta.style.cssText = "width:100%;background:var(--card2);border:1px solid var(--acc);border-radius:10px;color:var(--txt);padding:8px;font-family:inherit;font-size:13px;outline:none";
  const bar = document.createElement("div"); bar.className = "acts";
  const sv = document.createElement("button"); sv.textContent = "Save & re-run"; sv.style.fontWeight = "700";
  const cx = document.createElement("button"); cx.textContent = "Cancel";
  cx.onclick = () => { bub.innerHTML = ""; [...old.childNodes].forEach((n) => bub.appendChild(n)); };
  sv.onclick = async () => {
    turn.text = String(ta.value).slice(0, 10000);
    const a = active();
    a.messages = a.messages.slice(0, a.messages.indexOf(turn) + 1);
    await persist();
    $("chat").innerHTML = "";
    renderChip();
    a.messages.forEach((m) => bubble(m.who, m.text, true, m.ts, m.images, m));
    $("q").value = turn.text; $("q").dispatchEvent(new Event("input"));
    $("go").click();
  };
  bar.append(sv, cx);
  bub.append(ta, bar);
  ta.focus();
}
function openCanvas(text, title) {
  const t = String(text || "");
  $("ctitle").textContent = String(title || "Reader").slice(0, 70);
  $("ctitle").title = t.slice(0, 200);
  const b = $("cbody"); b.innerHTML = ""; b.appendChild(mdLite(t));
  const dl = $("cdown");
  dl.onclick = () => { try { const slug = ($("ctitle").textContent || "navibridge").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40); const a2 = document.createElement("a"); a2.href = URL.createObjectURL(new Blob([t], { type: "text/markdown" })); a2.download = slug + ".md"; a2.click(); } catch {} };
  $("ccopy").onclick = async () => { await navigator.clipboard.writeText(t).catch(() => {}); $("ccopy").textContent = "Copied"; setTimeout(() => ($("ccopy").textContent = "Copy"), 1200); };
  $("canvas").classList.add("open");
}
$("cclose").onclick = () => $("canvas").classList.remove("open");
function streamInto(el, partialText) {
  let bub = el.querySelector(".bub");
  if (!bub) { bub = document.createElement("div"); bub.className = "bub"; el.appendChild(bub); }
  bub.classList.add("streaming");
  bub.innerHTML = "";
  bub.appendChild(mdLite(partialText));
  const c = document.createElement("span"); c.className = "caret";
  bub.appendChild(c);
  const ch = $("chat"); ch.scrollTop = ch.scrollHeight;
}
function updateChipbar(force) {
  const cb = $("chipbar"); if (!cb) return;
  const a = active();
  const show = force || ($("chat").scrollTop > 90 && a && (a.messages || []).length > 1);
  cb.classList.toggle("show", !!show);
  if (show) {
    const pm = PROVIDER_META[current];
    $("chipprov").textContent = pm ? pm.l : "S"; $("chipprov").style.cssText = "background:" + (pm ? pm.c : "#888") + "22;border-color:" + (pm ? pm.c : "#888");
    $("chiptitle").textContent = (a && a.title ? a.title : "New chat").slice(0, 70);
  }
}
$("chat").addEventListener("scroll", () => { updateChipbar(false); });
function toast(msg, onUndo) {
  $("toastmsg").textContent = msg;
  const t = $("toast"); t.style.display = "flex";
  const b = $("toastbtn"); b.style.display = onUndo ? "" : "none";
  b.onclick = async () => { t.style.display = "none"; if (onUndo) await onUndo(); };
  clearTimeout(window._tt); window._tt = setTimeout(() => (t.style.display = "none"), 5000);
}
let attachImgs = [];
function renderAttach() {
  const box = $("attachrow"); if (!box) return;
  box.innerHTML = "";
  attachImgs.slice(0, 5).forEach((src) => {
    const w = document.createElement("span"); w.style.cssText = "position:relative;display:inline-block";
    const im = document.createElement("img"); im.src = src; im.style.cssText = "width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--line)";
    const x = document.createElement("span"); x.textContent = "✕"; x.style.cssText = "position:absolute;top:-7px;right:-7px;cursor:pointer;font-size:10px;background:#313844;border-radius:50%;width:16px;height:16px;display:grid;place-items:center;color:#fff";
    x.onclick = () => { attachImgs = attachImgs.filter((s) => s !== src); renderAttach(); };
    w.append(im, x);
    box.appendChild(w);
  });
}
$("imgbtn").onclick = () => { $("ifile").click(); };
$("ifile").onchange = async (e) => {
  const list = [...(e.target.files || [])];
  const vids = list.filter((f) => !f.type.startsWith("image/"));
  const files = list.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, 5 - attachImgs.length));
  for (const f of files) {
    try { const du = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }); attachImgs.push(du); } catch {}
  }
  renderAttach();
  if (vids.length) toast("Web AIs can't take video files — paste the video link instead and I'll analyze it");
  e.target.value = "";
};
$("shot").onclick = async () => {  if (attachImgs.length >= 5) { toast("Max 5 images"); return; }
  try {
    const du = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 80 });
    attachImgs.push(String(du).slice(0, 400000));
    renderAttach();
    toast("Screenshot attached");
  } catch (e) { toast("Screenshot failed: " + String(e).slice(0, 80)); }
};
function bubble(who, text, nosave, ts, images, turnRef) {
  document.querySelector("#chat .empty")?.remove();
  const row = document.createElement("div");
  row.className = who === "me" ? "me-row msg" : "ai-row msg";
  row._turn = turnRef || null;
  const pm = PROVIDER_META[current];
  const av = document.createElement("div"); av.className = "av"; av.textContent = who === "me" ? "Y" : pm && pm.l ? pm.l : "S";
  if (who !== "me" && pm) { av.style.cssText = "background:" + pm.c + "22;border:1px solid " + pm.c + "55;color:" + pm.c; }
  const bub = document.createElement("div"); bub.className = "bub";
  if (who === "me" && images && images.length) bub.classList.add("wide");
  if (who === "me" && images && images.length) {
    const ip = document.createElement("div");
    ip.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px";
    images.slice(0, 5).forEach((im) => {
      if (im && im.video && /^(https?:|blob:)/.test(im.src || "")) { const v = document.createElement("video"); v.src = im.src; if (im.poster) v.poster = im.poster; v.controls = true; v.muted = true; v.loop = true; v.style.cssText = "max-width:220px;max-height:200px;border-radius:9px;border:1px solid rgba(255,255,255,.12)"; ip.appendChild(v); return; }
      const img = document.createElement("img");
      img.src = (im && im.src) || im; img.alt = (im && im.alt) || "image";
      img.style.cssText = "max-width:180px;max-height:180px;object-fit:cover;border-radius:9px;margin-top:0;border:1px solid rgba(255,255,255,.12)";
      img.loading = "lazy";
      const wrap = document.createElement("a"); wrap.href = img.src; wrap.target = "_blank"; wrap.appendChild(img);
      ip.appendChild(wrap);
    });
    bub.appendChild(ip);
  }
  bub.appendChild(mdLite(text));
  (images || []).filter((im) => !(who === "me") && im && !im.video && /^(https?:|data:image\/)/.test(im.src || "")).slice(0, 5).forEach((im) => {
    const img = document.createElement("img");
    img.src = im.src; img.alt = im.alt || "image";
    img.style.cssText = "max-width:100%;border-radius:9px;margin-top:6px;border:1px solid rgba(255,255,255,.12)";
    img.loading = "lazy";
    bub.appendChild(img);
  });
  (images || []).filter((im) => im && im.video && /^(https?:|blob:)/.test(im.src || "")).slice(0, 3).forEach((im) => {
    const v = document.createElement("video");
    v.src = im.src; if (im.poster) v.poster = im.poster;
    v.controls = true; v.muted = true; v.loop = true; v.playsInline = true;
    v.style.cssText = "max-width:100%;border-radius:9px;margin-top:6px;border:1px solid rgba(255,255,255,.12)";
    bub.appendChild(v);
  });
  const tm = ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const meta = document.createElement("div"); meta.style.cssText = "font-size:10px;color:#8b98a9;margin-top:4px"; meta.textContent = tm;
  bub.appendChild(meta);
  if (who === "me") {
    const acts = document.createElement("div");
    acts.className = "acts";
    const ed = document.createElement("button"); ed.textContent = "✎ Edit"; ed.title = "Edit and re-run from here";
    ed.onclick = () => startEdit(row, bub, text);
    acts.append(ed);
    bub.appendChild(acts);
  }
  if (who !== "me" && (text || "").length > 1400) {
    const acts = document.createElement("div");
    acts.className = "acts";
    const cp = document.createElement("button"); cp.textContent = "Copy";
    cp.onclick = async () => { await navigator.clipboard.writeText(text).catch(() => {}); cp.textContent = "Copied"; setTimeout(() => (cp.textContent = "Copy"), 1000); };
    const vw = document.createElement("button"); vw.textContent = "⤢ Reader"; vw.title = "Open in the reader view";
    vw.onclick = () => openCanvas(text, "Reader");
    const rt = document.createElement("button"); rt.textContent = "Retry";
    rt.onclick = async () => { $("q").value = lastQ; $("go").click(); };
    acts.append(cp, vw, rt);
    bub.appendChild(acts);
  }
  row.append(av, bub);
  $("chat").appendChild(row);
  $("chat").scrollTop = 99999;
  $("r").textContent = text;
  if (!nosave) { const saved = saveChat(who, text, images); if (saved) row._turn = saved; }
  return row;
}
let stopFlag = false;
let lastQ = "";
function typing() {
  const d = document.createElement("div");
  d.className = "msg ai-row msg";
  d.innerHTML = '<div class="av">S</div><div class="bub"><span class="typing"><i></i><i></i><i></i></span></div>';
  d.id = "typing";
  document.querySelector("#chat .empty")?.remove();
  $("chat").appendChild(d);
  $("chat").scrollTop = 99999;
}
$("stop").onclick = () => { stopFlag = true; };
$("lib").onchange = (e) => { if (e.target.value) { $("q").value = e.target.value; $("q").focus(); e.target.value = ""; } };
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("go").click(); } });
$("q").addEventListener("input", () => { const t = $("q"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; });
document.querySelectorAll(".sugg").forEach((b) => { b.onclick = () => { $("q").value = b.dataset.q || ""; $("q").focus(); $("q").dispatchEvent(new Event("input")); }; });
const scrollb = document.createElement("button"); scrollb.id = "scrollb"; scrollb.title = "Jump to latest"; scrollb.textContent = "↓"; document.querySelector("main").appendChild(scrollb);
scrollb.onclick = () => { const c = $("chat"); c.scrollTo({ top: c.scrollHeight, behavior: "smooth" }); };
$("chat").addEventListener("scroll", () => { const c = $("chat"); const near = c.scrollHeight - c.scrollTop - c.clientHeight < 80; scrollb.classList.toggle("show", !near && c.scrollHeight > c.clientHeight + 200); });
$("snip").onclick = async () => {
  if (attachImgs.length >= 5) { toast("Max 5 images"); return; }
  try {
    const r = await chrome.runtime.sendMessage({ type: "SB_SNIPCROP" });
    if (r?.ok) toast("Drag on the page to select a region");
    else { toast(friendlyError(r?.error)); dlog("warn", "snip:send", r?.error || "?"); }
  } catch (e) { toast("Snippet failed"); dlog("warn", "snip:send", String(e).slice(0, 100)); }
};
async function expandSlash(raw) {
  if (!raw || !raw.startsWith("/")) return raw;
  const m = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(raw);
  if (!m) return raw;
  const defs = ((await chrome.storage.local.get("sb_prompts")).sb_prompts) || PROMPT_DEFAULTS;
  const p = defs.find((x) => x && x.slash === m[1]);
  if (!p) return raw;
  const args = (m[2] || "").trim();
  let clip = "";
  try { clip = await navigator.clipboard.readText(); } catch {}
  let page = "";
  try { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t) page = (t.title || "") + " — " + (t.url || ""); } catch {}
  const hasVars = /\{\{/.test(p.text || "");
  const fill = (s, key) => key === "text" ? (args || clip) : key === "clip" ? clip : page;
  let out = hasVars ? String(p.text).replace(/\{\{\s*(text|clip|page)\s*\}\}/g, (_, k) => String(fill(p.text, k))) : String(p.text) + (args ? "\n\n" + args : "");
  dlog("info", "slash:expand", "/" + m[1] + " len=" + out.length);
  return out.slice(0, 8000);
}
const PROMPT_DEFAULTS = [
  { id: "sp1", slash: "sum", text: "Summarize this page in 5 concise bullets:\n\n{{page}}" },
  { id: "sp2", slash: "explain", text: "Explain in simple terms, then give one example:\n\n{{text}}" },
  { id: "sp3", slash: "tr", text: "Translate into polished English. Reply with only the translation:\n\n{{text}}" },
  { id: "sp4", slash: "code", text: "Review this code for bugs, edge cases and performance:\n\n{{text}}" },
  { id: "sp5", slash: "pros", text: "Pros/cons table, then a verdict:\n\n{{text}}" },
];
async function ensurePrompts() {
  try {
    const s = await chrome.storage.local.get("sb_prompts");
    if (!s.sb_prompts || !s.sb_prompts.length) await chrome.storage.local.set({ sb_prompts: PROMPT_DEFAULTS }).catch(() => {});
  } catch {}
}
ensurePrompts();
function esc2(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
let plEditing = null;
function promptRow(p) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)";
  const use = document.createElement("div");
  use.style.cssText = "flex:1;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis";
  use.innerHTML = `<b style="color:var(--acc)">/${esc2(p.slash)}</b> ${esc2(String(p.text || "").slice(0, 80))}`;
  use.title = "Insert /" + p.slash + " in composer";
  const edit = document.createElement("button"); edit.className = "iconbtn"; edit.textContent = "✎";
  const del = document.createElement("button"); del.className = "iconbtn"; del.textContent = "✕";
  use.onclick = () => { $("q").value = "/" + p.slash + " "; $("prompts").classList.remove("open"); $("q").focus(); };
  edit.onclick = () => { plEditing = p.id; $("pl-slash").value = p.slash; $("pl-text").value = p.text; $("pl-slash").focus(); };
  del.onclick = async () => {
    const defs = ((await chrome.storage.local.get("sb_prompts")).sb_prompts) || PROMPT_DEFAULTS;
    await chrome.storage.local.set({ sb_prompts: defs.filter((x) => x.id !== p.id) }).catch(() => {});
    renderPrompts();
  };
  row.append(use, edit, del);
  return row;
}
async function renderPrompts() {
  const el = $("pl-list"); if (!el) return;
  const defs = ((await chrome.storage.local.get("sb_prompts")).sb_prompts) || PROMPT_DEFAULTS;
  while (el.firstChild) el.firstChild.remove();
  defs.forEach((p) => el.appendChild(promptRow(p)));
}
$("plbtn").onclick = () => { plEditing = null; $("pl-slash").value = ""; $("pl-text").value = ""; $("prompts").classList.add("open"); renderPrompts(); };
$("pl-close").onclick = () => $("prompts").classList.remove("open");
$("pl-new").onclick = () => { plEditing = null; $("pl-slash").value = ""; $("pl-text").value = ""; $("pl-slash").focus(); };
$("pl-save").onclick = async () => {
  const slash = ($("pl-slash").value || "").trim().replace(/^\/+/, "").toLowerCase();
  const text = ($("pl-text").value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(slash)) { toast("Alias: 1-20 chars a-z 0-9 _ -"); return; }
  if (text.length < 3) { toast("Prompt text too short"); return; }
  const defs = ((await chrome.storage.local.get("sb_prompts")).sb_prompts) || PROMPT_DEFAULTS.slice();
  const idx = defs.findIndex((x) => x.id === plEditing);
  const rec = { id: idx >= 0 ? defs[idx].id : "sp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5), slash, text: text.slice(0, 4000) };
  if (idx >= 0 && defs.some((x) => x.slash === slash && x.id !== rec.id)) { toast("Alias already used"); return; }
  if (idx >= 0) defs[idx] = rec; else { if (defs.some((x) => x.slash === slash)) { toast("Alias already used"); return; } defs.push(rec); }
  await chrome.storage.local.set({ sb_prompts: defs }).catch(() => {});
  plEditing = null; $("pl-slash").value = ""; $("pl-text").value = "";
  renderPrompts(); toast("Prompt saved — use /" + slash + " in the composer");
};
let comonitor = null;
async function sbMonitors(msg) {
  try { return await chrome.runtime.sendMessage(msg); } catch (e) { dlog("warn", "mon:send", String(e).slice(0, 100)); return { ok: false, error: String(e).slice(0, 120), monitors: [] }; }
}
function monRow(m, all) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)";
  const info = document.createElement("div");
  info.style.cssText = "flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis";
  let mh = ""; try { mh = m.url ? new URL(m.url).hostname : ""; } catch {}
  info.innerHTML = `<b>${esc2(m.title || mh || "site")}</b> <small style="color:var(--mut)">${esc2(m.kind)} · ${esc2(m.intervalMin)}m · ⏱ ${m.lastTs ? new Date(m.lastTs).toLocaleTimeString() : "—"}</small>`;
  const tg = document.createElement("button"); tg.className = "iconbtn"; tg.textContent = m.enabled ? "⏸" : "▶"; tg.title = "Toggle";
  const st = document.createElement("span"); st.textContent = String(m.lastVal || "").slice(0, 18); st.style.cssText = "color:var(--mut);font-size:10px;max-width:80px;overflow:hidden";
  const del = document.createElement("button"); del.className = "iconbtn"; del.textContent = "✕";
  tg.onclick = async () => { const r = await sbMonitors({ type: "SB_MON_SET", id: m.id, patch: { enabled: !m.enabled } }); if (r?.ok) { renderMonitors(); toast(m.enabled ? "Monitor paused" : "Monitor resumed"); } };
  del.onclick = async () => { const r = await sbMonitors({ type: "SB_MON_DEL", id: m.id }); if (r?.ok) { renderMonitors(); toast("Monitor removed"); } };
  row.append(info, st, tg, del);
  return row;
}
async function renderMonitors() {
  const el = $("monlist"); if (!el) return;
  while (el.firstChild) el.firstChild.remove();
  const r = await sbMonitors({ type: "SB_MON_LIST" });
  const ms = r?.monitors || [];
  if (!ms.length) { const d = document.createElement("div"); d.style.color = "var(--mut)"; d.textContent = "No monitors — add a URL above (checked every N minutes, alert on change)."; el.appendChild(d); return; }
  ms.forEach((x) => el.appendChild(monRow(x, ms)));
}
$("monbtn").onclick = () => { $("monitors").classList.add("open"); renderMonitors(); };
$("monclose").onclick = () => $("monitors").classList.remove("open");
$("monadd").onclick = async () => {
  const url = ($("monurl").value || "").trim();
  if (!/^https?:\/\//i.test(url)) { toast("Enter a valid http(s) URL"); return; }
  const r = await sbMonitors({ type: "SB_MON_ADD", url, kind: $("monkind").value, intervalMin: Number($("monint").value || 5), title: ($("montitle").value || "").trim().slice(0, 120) });
  if (r?.ok) { $("monurl").value = ""; $("montitle").value = ""; renderMonitors(); toast("Monitoring added"); dlog("info", "mon:add", url.slice(0, 80)); }
  else toast(friendlyError(r?.error));
};
$("research").onclick = async () => {
  const q = $("q").value.trim() || lastQ;
  if (!q) { toast("Type a research question first"); return; }
  if ($("research").disabled) return;
  $("research").disabled = true; $("st").textContent = "researching";
  clearFollowups();
  bubble("me", "🔬 " + q, false);
  $("q").value = ""; lastQ = q;
  typing();
  const t0 = Date.now();
  try {
    const tabCtx = await getTabCtx();
    const res = await chrome.runtime.sendMessage({ type: "SB_RESEARCH", prompt: (tabCtx ? tabCtx + "\n\n" : "") + q });
    $("typing")?.remove();
    if (res?.ok) {
      bubble("ai", (res.text || "(no synthesis — see sources)") + (res.partial ? "\n[partial — some reads failed]" : ""), false, Date.now(), res.images);
      if (res.sources && res.sources.length) bubble("ai", "📚 Sources:\n" + res.sources.map((s, i) => `[${i + 1}] ${s.title || ""}\n${s.url}`).join("\n"), true);
      dlog("info", "research:done", `ok=1 mins=${Math.round((Date.now() - t0) / 6000) / 10} src=${res.sources ? res.sources.length : 0} partial=${!!res.partial}`);
      toast("Research done — " + (res.sources ? res.sources.length : 0) + " sources");
    } else { $("typing")?.remove(); bubble("ai", friendlyError(res?.error)); dlog("warn", "research:fail", res?.error || "?"); }
  } catch (e) { $("typing")?.remove(); bubble("ai", friendlyError(String(e))); $("st").textContent = "error"; dlog("warn", "research:err", String(e).slice(0, 120)); }
  $("st").textContent = "ready"; $("research").disabled = false;
};
const VID_HOSTS = /(^|\.|\/\/)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|x\.com|twitter\.com|tiktok\.com|facebook\.com|instagram\.com|reddit\.com|linkedin\.com)|(\/reel\/|\.(mp4|webm|mov|mkv|avi)(\?|$))/i;
$("go").onclick = async () => {
  const raw = $("q").value.trim();
  if (!raw && !attachImgs.length) return;
  if (/^\/(power|llm)(\s+|$)/i.test(raw)) {
    const q = raw.replace(/^\/(power|llm)\s*/i, "").trim();
    toggleMultiMode(true, "power");
    if (q) runPower(q);
    else { $("q").value = ""; $("q").focus(); }
    return;
  }
  if (/^\/council(\s+|$)/i.test(raw)) {
    const q = raw.replace(/^\/council\s*/i, "").trim();
    toggleMultiMode(true, "council");
    if (q) runCouncil(q);
    else { $("q").value = ""; $("q").focus(); }
    return;
  }
  if (/^\/debate(\s+|$)/i.test(raw)) {
    const q = raw.replace(/^\/debate\s*/i, "").trim();
    toggleMultiMode(true, "debate");
    if (q) runDebate(q);
    else { $("q").value = ""; $("q").focus(); }
    return;
  }
  if (/^\/compare(\s+|$)/i.test(raw)) {
    const q = raw.replace(/^\/compare\s*/i, "").trim();
    toggleMultiMode(true, "compare");
    if (q) runCompare(q);
    else { $("q").value = ""; $("q").focus(); }
    return;
  }
  if (isMultiActive) {
    clearFollowups();
    const q = await expandSlash(raw);
    const provs = getSelectedMultiProviders();
    if (currentMultiMode === "council") runCouncil(q, provs);
    else if (currentMultiMode === "debate") runDebate(q, provs);
    else if (currentMultiMode === "compare") runCompare(q, provs);
    else runPower(q, provs);
    return;
  }
  clearFollowups();
  const q = await expandSlash(raw);
  lastQ = q;
  bubble("me", q, false, Date.now(), attachImgs.map((s) => ({ src: s })));
  $("q").value = "";
  const myImgs = attachImgs.slice(0, 5);
  attachImgs = []; renderAttach();
  typing();
  $("st").textContent = "working";
  stopFlag = false; $("stop").disabled = false;
  const poll = setInterval(async () => {
    if (stopFlag) { clearInterval(poll); return; }
    try {
      const cur = await chrome.runtime.sendMessage({ type: "SB_POLL", provider: current });
      if (cur?.ok && cur.text && cur.text.length > 20) { const t = $("typing"); if (t) streamInto(t, "✍ " + String(cur.text)); }
    } catch {}
  }, 1500);
  try {
    let vidCtx = "";
    const um = q.match(/https?:\/\/\S+|www\.[^\s]+/);
    if (um && VID_HOSTS.test(um[0])) {
      let u = um[0];
      try { u = new URL(/^https?:/i.test(u) ? u : "https://" + u).href; } catch {}
      bubble("ai", "🎬 Reading video page...", true);
      try {
        const vc = await chrome.runtime.sendMessage({ type: "SB_VIDCTX", url: u });
        if (vc?.ok) vidCtx += `\n[Video context for ${u}]: title="${vc.title}". Page text:\n${String(vc.text || "").slice(0, 3000)}`;
        else { bubble("ai", "⚠ Video page unreadable — sending the link only.", true); logBug("vidctx", vc?.error || "empty", u); }
      } catch (e) { logBug("vidctx:send", e, u); }
    }
    const ctx = await pageContext();
    const tabCtx = await getTabCtx();
    const mem = await chrome.storage.local.get("sb_memory").then((s) => s.sb_memory || "").catch(() => "");
    dlog("info", "ask:start", current + " chars=" + (q + ctx).length + " imgs=" + myImgs.length + " tabs=" + ctxTabs.length);
    const res = await chrome.runtime.sendMessage({ type: "SB_ASK", provider: current, prompt: q + vidCtx + tabCtx + ctx + (mem ? `\n[Memory: ${mem.slice(0, 500)}]` : ""), images: myImgs.length ? myImgs : undefined });
    clearInterval(poll); $("stop").disabled = true;
    dlog(res?.ok ? "info" : "warn", "ask:result", current + " ok=" + !!res?.ok + (res?.partial ? " partial" : "") + (res?.ok ? " chars=" + String(res.text || "").length : " err=" + (res?.error || "")));
    $("typing")?.remove();
    if (stopFlag) bubble("ai", "■ Stopped.");
    else if (!res?.ok) bubble("ai", friendlyError(res?.error));
    else { bubble("ai", res.text + (res.partial ? "\n[partial — retry for rest]" : ""), false, Date.now(), res.images); addFollowups(); }
    $("st").textContent = "ready";
  } catch (e) { clearInterval(poll); $("stop").disabled = true; $("typing")?.remove(); bubble("ai", friendlyError(String(e))); $("st").textContent = "error"; }
};
const POWER_PROVIDERS = ["ChatGPT", "Gemini", "Claude", "Grok", "Kimi", "DeepSeek", "Perplexity"];
function openWorkspace(mode, qOverride) {
  try {
    const q = encodeURIComponent(qOverride ?? ($("q")?.value?.trim() || ""));
    const url = chrome.runtime.getURL("workspace.html") + "?mode=" + mode + (q ? "&q=" + q : "");
    chrome.tabs.create({ url });
    $("st").textContent = "ready";
  } catch (e) {
    dlog("warn", "workspace:open", String(e).slice(0, 120));
  }
}
if ($("power")) {
  $("power").onclick = () => {
    toggleMultiMode(true, "power");
    const q = $("q").value.trim();
    if (q) runPower(q);
  };
}
async function runPower(qArg, provArg) {
  const q = qArg || $("q").value.trim() || lastQ;
  if (!q && !attachImgs.length) {
    toast("Type a prompt for Power Ask");
    $("q").focus();
    return;
  }
  const providers = (provArg && provArg.length ? provArg : getSelectedMultiProviders());
  lastQ = q;
  clearFollowups();
  bubble("me", "⚡ **Power Ask:** " + q + "\n\n_Targeting: " + providers.join(", ") + "_", false, Date.now(), attachImgs.map((s) => ({ src: s })));
  $("q").value = "";
  const myImgs = attachImgs.slice(0, 5);
  attachImgs = []; renderAttach();

  // Instantly render live card skeletons so real-time responses show up as soon as they complete
  const placeholderParts = providers.map((p) => ({ p, ok: false, pending: true, text: "⏳ Querying " + p + "..." }));
  document.querySelector("#chat").appendChild(powerGridEl(placeholderParts));
  $("chat").scrollTop = 99999;

  typing();
  $("st").textContent = "power asking";
  stopFlag = false; $("stop").disabled = false;
  dlog("info", "power:start", providers.join(",") + " imgs=" + myImgs.length);
  try {
    const ctx = await pageContext();
    const mem = await chrome.storage.local.get("sb_memory").then((s) => s.sb_memory || "").catch(() => "");
    const res = await chrome.runtime.sendMessage({ type: "SB_POWER", providers, prompt: q + ctx + (mem ? `\n[Memory: ${mem.slice(0, 500)}]` : ""), images: myImgs.length ? myImgs : undefined });
    $("stop").disabled = true;
    $("typing")?.remove();
    if (stopFlag) bubble("ai", "■ Stopped.");
    else if (!res?.ok) bubble("ai", "Power Ask failed: " + friendlyError(res?.error || "no response"), false, Date.now());
    else powerSave(providers, res.all || {}, "⚡ Power Ask");
    $("st").textContent = "ready";
  } catch (e) { $("stop").disabled = true; $("typing")?.remove(); bubble("ai", friendlyError(String(e))); $("st").textContent = "error"; }
}
$("sdeep").onclick = async () => { await deepSearch(); };
let deepBusy = false;
async function deepSearch() {
  if (deepBusy) return;
  const q = ($("ssearch").value || "").trim().toLowerCase();
  if (!q) { toast("Type a search term first"); return; }
  const unmatched = sessions.filter((s) => s.url && !(
    String(s.title || "").toLowerCase().includes(q) ||
    (s.messages || []).some((m) => String(m.text).toLowerCase().includes(q)) ||
    (tcache[s.url] && (tcache[s.url].thread || []).some((t) => String(t.text).toLowerCase().includes(q)))
  )).slice(0, 15);
  if (!unmatched.length) { toast("All chats with URLs already searched — no deeper data"); return; }
  deepBusy = true;
  const btn = $("sdeep"); if (btn) btn.disabled = true;
  $("st").textContent = "searching";
  try {
    const BY = 4;
    for (let i = 0; i < unmatched.length; i += BY) {
      const batch = unmatched.slice(i, i + BY);
      await Promise.all(batch.map(async (s) => {
        try { const r = await chrome.runtime.sendMessage({ type: "SB_THREAD", url: s.url }); if (r && r.ok && r.thread?.length) dlog("info", "deepSearch:hit", s.provider + " turns=" + r.thread.length); } catch {}
      }));
      try { tcache = ((await chrome.storage.local.get("sb_thread_cache")).sb_thread_cache) || {}; } catch {}
      $("count").textContent = "⌕ deep " + Math.min(i + batch.length, unmatched.length) + "/" + unmatched.length;
      if (($("ssearch").value || "").trim().toLowerCase() !== q) break;
      renderSessions(q);
    }
  } catch (e) { dlog("warn", "deepSearch", String(e).slice(0, 140)); }
  deepBusy = false;
  if (btn) btn.disabled = false;
  $("st").textContent = "ready";
  renderSessions(($("ssearch").value || "").trim().toLowerCase());
}
if ($("compare")) {
  $("compare").onclick = () => {
    toggleMultiMode(true, "compare");
    const q = $("q").value.trim();
    if (q) runCompare(q);
  };
}
async function runCompare(qArg, provArg) {
  const q = qArg || $("q").value.trim() || lastQ;
  if (!q && !attachImgs.length) {
    toast("Type a prompt to Compare");
    $("q").focus();
    return;
  }
  const providers = (provArg && provArg.length >= 2 ? provArg : getSelectedMultiProviders()).slice(0, 5);
  if (providers.length < 2) {
    toast("Select at least 2 models to compare");
    return;
  }
  lastQ = q;
  clearFollowups();
  bubble("me", "⚔ **Compare:** " + q + "\n\n_Comparing: " + providers.join(" vs ") + "_", false, Date.now(), attachImgs.map((s) => ({ src: s })));
  $("q").value = "";
  const myImgs = attachImgs.slice(0, 5);
  attachImgs = []; renderAttach();

  // Instantly render live card skeletons
  const placeholderParts = providers.map((p) => ({ p, ok: false, pending: true, text: "⏳ Querying " + p + "..." }));
  document.querySelector("#chat").appendChild(powerGridEl(placeholderParts));
  $("chat").scrollTop = 99999;

  typing();
  $("st").textContent = "comparing";
  stopFlag = false; $("stop").disabled = false;
  dlog("info", "compare:start", providers.join(",") + " imgs=" + myImgs.length);
  try {
    const ctx = await pageContext();
    const mem = await chrome.storage.local.get("sb_memory").then((s) => s.sb_memory || "").catch(() => "");
    const res = await chrome.runtime.sendMessage({ type: "SB_POWER", providers, prompt: q + ctx + (mem ? `\n[Memory: ${mem.slice(0, 500)}]` : ""), images: myImgs.length ? myImgs : undefined });
    $("stop").disabled = true;
    $("typing")?.remove();
    if (stopFlag) bubble("ai", "■ Stopped.");
    else if (!res?.ok) bubble("ai", "Compare failed: " + friendlyError(res?.error || "no response"), false, Date.now());
    else powerSave(providers, res.all || {}, "⚔ Compare");
    $("st").textContent = "ready";
  } catch (e) { $("stop").disabled = true; $("typing")?.remove(); bubble("ai", friendlyError(String(e))); $("st").textContent = "error"; }
}
function friendlyError(e) {
  e = String(e || "no-response");
  if (e.includes("login_required")) return "🔑 Sign in on the provider tab first, then Retry.";
  if (e.includes("no-input")) return "↻ Provider page changed — opening fresh tab, hit Retry.";
  if (e.includes("rate_limited")) return "⏳ Rate limited — wait a minute, then Retry.";
  if (e.includes("provider-busy")) return "⏭ The provider tab is still answering the previous message — wait a few seconds, then Retry.";
  if (e.includes("gen-timeout")) return "⌛ Provider took too long to answer — Retry.";
  return "ERROR " + e.slice(0, 200);
}
$("clear").onclick = async () => { const id = "c" + Date.now(); sessions.unshift({ id, title: "New chat", provider: current, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }); sessions = sessions.slice(0, 30); activeId = id; await persist(); loadSessionsView(); };
let __ssT = 0;
$("ssearch").oninput = (e) => { const v = e.target.value; clearTimeout(__ssT); __ssT = setTimeout(() => renderSessions(v), 150); };
$("newchat").onclick = () => $("clear").click();
document.querySelectorAll("#diag,#diag2").forEach((b) => (b.onclick = async () => {
  bubble("ai", "🩺 Diagnosing " + current + " fetch...", true);
  try {
    const res = await chrome.runtime.sendMessage({ type: "SB_DIAG", provider: current });
    document.querySelector("#chat .ai-row:last-child")?.remove();
    if (!res) bubble("ai", "DIAG: no response — background worker asleep/stale. Reload extension, reopen sidebar, retry.", true);
    else bubble("ai", "DIAG " + current + ":\n" + JSON.stringify(res.diag || res, null, 1).slice(0, 1200) + "\n— paste this to me.", true);
  } catch (e) { document.querySelector("#chat .ai-row:last-child")?.remove(); bubble("ai", "DIAG failed: " + String(e).slice(0, 200), true); }
}));
$("fetch").onclick = async () => { await doFetch(current); };
async function applyThread(a, thread, title, ts) {
  a.messages = (thread || []).slice(0, 100).map((t) => ({ who: t.role === "me" ? "me" : "ai", text: String(t.text).slice(0, 8000), ts: ts || Date.now(), images: (t.images || []).slice(0, 3), videos: (t.videos || []).slice(0, 2) }));
  if (title) a.title = String(title).slice(0, 60);
  await persist(); loadSessionsView();
}
$("refreshchat").onclick = async () => {
  const a = active();
  const url = a?.url;
  if (!url) { const n = a?.messages?.length || 0; toast(`This chat is already complete locally (${n} messages) — refresh is for fetched ${current} chats`); return; }
  const FRESH = 10 * 60 * 1000;
  let cached = null;
  try { const cc = ((await chrome.storage.local.get("sb_thread_cache")).sb_thread_cache) || {}; const hit = cc[url]; if (hit && hit.thread?.length && Date.now() - (hit.ts || 0) < 7 * 864e5) cached = hit; } catch {}
  if (cached && Date.now() - (cached.ts || 0) < FRESH) { await applyThread(a, cached.thread, cached.title, cached.ts); toast("Loaded " + a.messages.length + " messages"); return; }
  if (cached) await applyThread(a, cached.thread, cached.title, cached.ts);
  else bubble("ai", "⟳ Loading full messages...", true);
  dlog("info", "refresh:start", url + (cached ? " cached-hit" : ""));
  try {
    const res = await chrome.runtime.sendMessage({ type: "SB_THREAD", url });
    document.querySelector("#chat .ai-row:last-child")?.remove();
    if (!res?.ok) {
      if (cached) { await applyThread(a, cached.thread, cached.title, cached.ts); toast("Loaded " + a.messages.length + " cached messages"); }
      else bubble("ai", "Refresh failed: " + (res?.error || ""), true);
    } else if (!res.thread?.length) {
      if (cached) { await applyThread(a, cached.thread, cached.title, cached.ts); toast("Showing cached messages"); }
      else { logBug("refreshchat:empty", "turns=" + (res.found ?? 0), url); bubble("ai", "No messages found — open the chat visibly once, then refresh.", true); }
    } else {
      await applyThread(a, res.thread, res.title, Date.now());
      dlog("info", "refresh:ok", "msgs=" + a.messages.length);
      toast("Loaded " + a.messages.length + " messages");
    }
  } catch (e) { document.querySelector("#chat .ai-row:last-child")?.remove(); bubble("ai", friendlyError(String(e)), true); }
};
async function doFetch(name) {
  bubble("ai", "Fetching " + current + " chats (hidden tab)...");
  $("st").textContent = "working";
  try {
    const res = await fetchDirect(current);
    document.querySelector("#chat .ai-row:last-child")?.remove();
    if (!res?.ok) { bubble("ai", "Fetch failed: " + (res?.error || "unknown")); logBug("doFetch", res?.error, current); }
    else if (!res.items?.length) bubble("ai", "No chats found on " + current + " — sign in and open one chat first, then Fetch.");
    else {
      const items = res.items.slice(0, 100);
      items.forEach((it) => sessions.unshift({ id: "f" + Date.now() + Math.random().toString(16).slice(2), title: it.title, provider: name, url: it.url, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }));
      sessions = sessions.slice(0, 150); activeId = sessions[0]?.id || activeId; await persist(); renderSessions($("ssearch")?.value || "");
      bubble("ai", "Loaded " + items.length + " " + name + " chats — click one to pull its full messages.", true);
    }
    $("st").textContent = "ready";
  } catch (e) { document.querySelector("#chat .ai-row:last-child")?.remove(); bubble("ai", friendlyError(String(e))); }
};
$("export").onclick = async () => {
  const a = active(); if (!a) return;
  let md = `# ${a.title}\n\n_Exported ${new Date().toISOString()} · ${a.provider}_\n\n`;
  a.messages.forEach((m) => { md += m.who === "me" ? `## 🙋 ${m.text}\n\n` : `${m.text}\n\n`; });
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  const el = document.createElement("a"); el.href = url; el.download = a.title.replace(/[^\w]+/g, "-") + ".md"; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
window.addEventListener("keydown", async (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && window._undo) { await window._undo(); window._undo = null; } });
if ($("pin")) {
  $("pin").onclick = async () => {
    try {
      const t = await activeTab();
      const s = await chrome.storage.local.get("sb_pins").then((x) => x.sb_pins || []).catch(() => []);
      if (t?.url && !s.find((p) => p.url === t.url) && s.length < 6) { s.push({ url: t.url, title: t.title }); await chrome.storage.local.set({ sb_pins: s }).catch(() => {}); renderPins(); toast("Pinned (" + s.length + "/6)"); }
    } catch {}
  };
}
async function renderPins() {
  const s = await chrome.storage.local.get("sb_pins").then((x) => x.sb_pins || []).catch(() => []);
  const box = $("pins"); if (!box) return; box.innerHTML = "";
  s.forEach((p, i) => {
    let host = ""; try { host = new URL(p.url).hostname; } catch { host = String(p.url || "site").slice(0, 40); }
    const c = document.createElement("button"); c.className = "iconbtn"; c.textContent = "📌 " + host + " ✕"; c.title = p.title;
    c.onclick = async () => { s.splice(i, 1); await chrome.storage.local.set({ sb_pins: s }).catch(() => {}); renderPins(); };
    box.appendChild(c);
  });
}
renderPins();
$("gsearch").onclick = async () => {
  const q = $("q").value.trim() || lastQ;
  if (!q) return;
  bubble("me", "🔍 " + q);
  typing();
  try {
    const res = await chrome.runtime.sendMessage({ type: "SB_SEARCH", prompt: q });
    $("typing")?.remove();
    if (!res?.ok) bubble("ai", "Search failed: " + (res?.error || ""));
    else if (res.ai) bubble("ai", "【Google AI Overview】\n" + res.ai + (res.results ? "\n\nTop results:\n" + res.results : ""));
    else bubble("ai", "【Google】(no AI Overview on this query)\n" + (res.results || res.text || "").slice(0, 2000));
  } catch (e) { $("typing")?.remove(); bubble("ai", friendlyError(String(e))); }
};
$("sum").onclick = async () => { $("q").value = "Summarize this page in 5 bullets"; $("go").click(); };
if ($("debate")) {
  $("debate").onclick = () => {
    toggleMultiMode(true, "debate");
    const q = $("q").value.trim();
    if (q) runDebate(q);
  };
}
async function runDebate(qArg, provArg) {
  const q = qArg || $("q").value.trim() || lastQ;
  if (!q) {
    toast("Type a topic for the Debate first");
    $("q").focus();
    return;
  }
  const all = (provArg && provArg.length >= 2 ? provArg : getSelectedMultiProviders()).slice(0, 4);
  if (all.length < 2) {
    toast("Select at least 2 models for Debate");
    return;
  }
  clearFollowups();
  lastQ = q;
  bubble("me", "🗣 **Debate:** " + q + `\n\n_Teams: ${all.join(" vs ")} (${debateRounds} rounds)_`);
  $("q").value = "";
  typing();
  $("st").textContent = "debate in session";
  try {
    const res = await chrome.runtime.sendMessage({ type: "SB_DEBATE", providers: all, prompt: q, rounds: debateRounds });
    $("typing")?.remove();
    if (!res?.ok) bubble("ai", "Debate failed: " + friendlyError(res?.error || "unknown"));
    else (res.thread || []).slice(1).forEach((t) => bubble("ai", `【${t.who}】\n\n` + t.text.slice(0, 8000)));
    $("st").textContent = "ready";
  } catch (e) { $("typing")?.remove(); bubble("ai", friendlyError(String(e))); $("st").textContent = "error"; }
}
if ($("council")) {
  $("council").onclick = () => {
    toggleMultiMode(true, "council");
    const q = $("q").value.trim();
    if (q) runCouncil(q);
  };
}
async function runCouncil(qArg, provArg) {
  const q = qArg || $("q").value.trim() || lastQ;
  if (!q) {
    toast("Type your question or proposal for the Council first");
    $("q").focus();
    return;
  }
  const all = (provArg && provArg.length >= 2 ? provArg : getSelectedMultiProviders()).slice(0, 4);
  clearFollowups();
  lastQ = q;
  bubble("me", "🏛 **Council:** " + q + "\n\n_Council Members: " + all.join(", ") + "_");
  $("q").value = "";
  typing();
  $("st").textContent = "council convening";
  const t0 = Date.now();
  try {
    const ctx = await pageContext();
    const res = await chrome.runtime.sendMessage({ type: "SB_COUNCIL", providers: all, prompt: q + ctx });
    $("typing")?.remove();
    if (!res?.ok) {
      bubble("ai", "🏛 Council session failed: " + friendlyError(res?.error || "unknown"));
    } else {
      const c = res.council || {};
      (c.proposals || []).forEach((x) => {
        const err = String(x.t || "").startsWith("ERROR");
        bubble("ai", `📝 **${x.p} Proposal:**\n\n` + (err ? `⚠️ Could not generate proposal: ${x.t}` : x.t.slice(0, 8000)));
      });
      (c.critiques || []).filter((x) => x.t && !x.t.startsWith("ERROR")).forEach((x) => {
        bubble("ai", `🔍 **${x.p} Critique:**\n\n` + x.t.slice(0, 8000));
      });
      (c.revisions || []).filter((x) => x.t && !x.t.startsWith("ERROR")).forEach((x) => {
        bubble("ai", `✍ **${x.p} Revised Solution:**\n\n` + x.t.slice(0, 8000));
      });
      if (c.verdict) {
        bubble("ai", `🏆 **Council Final Verdict & Recommendation:**\n\n` + c.verdict.slice(0, 8000));
      } else {
        bubble("ai", `🏆 **Council Verdict:** No consensus verdict reached.`);
      }
      toast("Council completed (" + Math.round((Date.now() - t0) / 1000) + "s)");
    }
    $("st").textContent = "ready";
  } catch (e) {
    $("typing")?.remove();
    bubble("ai", friendlyError(String(e)));
    $("st").textContent = "error";
  }
}
/* Multi-run guard: one multi-model round at a time so stacked runs can't clobber each other's grids */
let multiRunning = false;
function guardMulti(fn) {
  return async function (...args) {
    if (multiRunning) { toast("A multi-model round is already running — wait for it to finish."); return; }
    multiRunning = true;
    try { return await fn(...args); }
    finally { multiRunning = false; }
  };
}
runPower = guardMulti(runPower);
runCompare = guardMulti(runCompare);
runDebate = guardMulti(runDebate);
runCouncil = guardMulti(runCouncil);
$("skills").onclick = async () => {
  const a = active(); if (!a) return;
  const skill = { name: a.title, provider: current, steps: a.messages.filter((m) => m.who === "me").map((m) => m.text) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(skill, null, 2)], { type: "application/json" }));
  const el = document.createElement("a"); el.href = url; el.download = "skill-" + Date.now() + ".json"; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Skill saved — replay by pasting steps");
};
$("open").onclick = async () => { await chrome.tabs.create({ url: URLS[current] }); };
$("read").onclick = async () => {
  const t = await activeTab();
  try {
    pageCtx = await fetchPageCtx(t);
    renderChip();
    const res = pageCtx?.ok ? pageCtx : (await sendToTab(t.id, { type: "SB_READ" }).catch(() => null));
    $("r").textContent = res?.ok ? (res.text || "") : "ERROR " + (res?.error || "?");
    if (pageCtx?.ok) toast("Page context attached — sent with your next message when 'Attach page' is on");
  } catch (e) { $("r").textContent = "ERROR " + String(e).slice(0, 160); }
};
$("copy").onclick = async () => { await navigator.clipboard.writeText($("r").textContent || "").catch(() => {}); };

/* ===== v0.21: multi-tab context, follow-ups, quote-reply, window ===== */
let ctxTabs = [];
async function getTabCtx() {
  if (!ctxTabs.length) return "";
  try {
    const r = await chrome.runtime.sendMessage({ type: "SB_TABCTX", tabIds: ctxTabs.slice(0, 3).map((t) => t.id) });
    if (r?.ok && r.text) return String(r.text).slice(0, 12000);
    dlog("warn", "tabctx:empty", String(r?.error || "?").slice(0, 100));
  } catch (e) { dlog("warn", "tabctx:send", String(e).slice(0, 100)); }
  return "";
}
function renderCtxTabChips() {
  const w = $("tabchips"); if (!w) return;
  w.innerHTML = "";
  w.classList.toggle("show", ctxTabs.length > 0);
  ctxTabs.forEach((t, i) => {
    const c = document.createElement("span"); c.className = "tchip";
    const s = document.createElement("span"); s.className = "tt"; s.textContent = "🗂 " + String(t.title || "Tab " + t.id).slice(0, 30); s.title = t.url || "";
    const x = document.createElement("span"); x.className = "tx"; x.textContent = "✕"; x.setAttribute("role", "button"); x.setAttribute("aria-label", "Remove tab context");
    x.onclick = () => { ctxTabs.splice(i, 1); renderCtxTabChips(); };
    c.appendChild(s); c.appendChild(x); w.appendChild(c);
  });
}
async function openTabPop() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ lastFocusedWindow: true }); } catch {}
  const list = $("tablist"); if (!list) return;
  list.innerHTML = "";
  const sel = new Set(ctxTabs.map((t) => t.id));
  tabs.filter((t) => /^https?:/i.test(t.url || "")).slice(0, 24).forEach((t) => {
    const lb = document.createElement("label");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = sel.has(t.id);
    cb.dataset.tabid = String(t.id); cb.dataset.title = String(t.title || "Tab " + t.id); cb.dataset.url = t.url || "";
    const tt = document.createElement("span"); tt.textContent = cb.dataset.title.slice(0, 80); tt.style.flex = "1";
    let host = ""; try { host = new URL(t.url).host; } catch {}
    const ho = document.createElement("span"); ho.className = "thost"; ho.textContent = host;
    lb.appendChild(cb); lb.appendChild(tt); lb.appendChild(ho);
    list.appendChild(lb);
  });
  if (!list.children.length) { const none = document.createElement("div"); none.className = "tnone"; none.textContent = "No http(s) tabs in this window."; list.appendChild(none); }
  $("tabpop").classList.add("open");
}
$("tabctxbtn").onclick = () => { openTabPop(); };
$("tabadd").onclick = () => {
  const cbs = [...$("tablist").querySelectorAll("input[type=checkbox]:checked")];
  const ids = new Set(ctxTabs.map((t) => t.id));
  for (const cb of cbs) {
    if (ids.size >= 3) break;
    const id = Number(cb.dataset.tabid);
    if (ids.has(id)) continue;
    ids.add(id);
    ctxTabs.push({ id, title: cb.dataset.title, url: cb.dataset.url });
  }
  ctxTabs = ctxTabs.slice(-3);
  renderCtxTabChips();
  $("tabpop").classList.remove("open");
  if (cbs.length) toast("Tab context armed (" + ctxTabs.length + "/3)");
};
$("tabclear").onclick = () => { ctxTabs = []; renderCtxTabChips(); $("tabpop").classList.remove("open"); };
$("tabpopclose").onclick = () => $("tabpop").classList.remove("open");

const FUS = ["Explain this more simply", "What are the key risks?", "Give concrete examples", "What should I do next?", "Summarize in 3 bullets"];
function addFollowups() {
  const chat = $("chat"); if (!chat) return;
  const row = document.createElement("div"); row.className = "fus";
  FUS.forEach((t) => {
    const b = document.createElement("button"); b.className = "fuc"; b.textContent = t;
    b.onclick = () => { $("q").value = t; $("go").click(); };
    row.appendChild(b);
  });
  chat.appendChild(row);
  row.scrollIntoView({ block: "end" });
}
function clearFollowups() { document.querySelectorAll(".fus").forEach((f) => f.remove()); }

const qsel = document.createElement("button");
qsel.id = "qsel"; qsel.textContent = "❝ Reply"; qsel.setAttribute("aria-label", "Quote selection into composer");
document.body.appendChild(qsel);
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  let withinChat = false;
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const n = sel.getRangeAt(0).commonAncestorContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    withinChat = !!el?.closest?.("#chat");
  }
  if (!withinChat) { qsel.classList.remove("show"); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  qsel.classList.add("show");
  qsel.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 86)) + "px";
  qsel.style.top = Math.max(8, r.top - 36) + "px";
});
qsel.addEventListener("mousedown", (e) => e.preventDefault());
qsel.onclick = () => {
  const sel = String(window.getSelection() || "").slice(0, 220);
  qsel.classList.remove("show");
  if (sel) { const cur = $("q").value; $("q").value = (cur ? cur + "\n" : "") + "> " + sel + "\n"; $("q").focus(); }
};
document.addEventListener("mousedown", (e) => { if (e.target !== qsel) qsel.classList.remove("show"); });

$("winbtn").onclick = () => {
  try { chrome.windows.create({ url: chrome.runtime.getURL("sidepanel.html"), type: "popup", width: 540, height: 840 }); $("settings").classList.remove("open"); }
  catch (e) { toast("Window failed: " + String(e).slice(0, 80)); }
};

/* ===== CLI Bridge Guide & Status Controls ===== */
function renderBridgeStatus(status) {
  const state = typeof status === "string" ? status : (status?.state || "disconnected");
  const msg = (typeof status === "object" && status?.msg) ? status.msg : "";
  const bDot = $("bridge-dot");
  const gDot = $("guide-bridge-dot");
  const gText = $("guide-bridge-status");
  const gTog = $("guide-bridge-toggle");

  let color = "#8b98a9";
  let label = "Disconnected";
  let title = "CLI Bridge: Disconnected";

  if (state === "connected") {
    color = "var(--acc2, #3ecf8e)";
    label = "Connected (:10086)";
    title = "CLI Bridge: Connected (:10086)";
    if (gTog) gTog.textContent = "Disconnect";
  } else if (state === "connecting") {
    color = "#e5a50a";
    label = "Connecting...";
    title = "CLI Bridge: Connecting...";
    if (gTog) gTog.textContent = "Connecting...";
  } else if (state === "bad_token") {
    color = "#ff6b6b";
    label = "Token Mismatch (check token below)";
    title = "CLI Bridge: Token mismatch";
    if (gTog) gTog.textContent = "Reconnect";
  } else if (state === "disabled") {
    color = "#475260";
    label = "Disabled (Link CLI unchecked)";
    title = "CLI Bridge: Disabled";
    if (gTog) gTog.textContent = "Connect";
  } else {
    color = "#8b98a9";
    label = "Disconnected (run: npm run bridge)";
    title = "CLI Bridge: Disconnected";
    if (gTog) gTog.textContent = "Connect";
  }

  if (msg) title += " — " + msg;

  if (bDot) {
    bDot.style.background = color;
    bDot.title = title;
  }
  if (gDot) {
    gDot.style.background = color;
  }
  if (gText) {
    gText.textContent = label;
  }
}

chrome.storage.local.get(["sb_bridge_status", "sb_bridge_token"]).then((s) => {
  if (s.sb_bridge_status) renderBridgeStatus(s.sb_bridge_status);
  if ($("guide-bridge-token") && s.sb_bridge_token) $("guide-bridge-token").value = s.sb_bridge_token;
}).catch(() => {});

if ($("cliguidebtn")) {
  $("cliguidebtn").onclick = async () => {
    const s = await chrome.storage.local.get(["sb_bridge_token", "sb_bridge_status"]).catch(() => ({}));
    if ($("guide-bridge-token") && s.sb_bridge_token) $("guide-bridge-token").value = s.sb_bridge_token;
    if (s.sb_bridge_status) renderBridgeStatus(s.sb_bridge_status);
    $("cliguide")?.classList.add("open");
  };
}
if ($("closecliguide")) {
  $("closecliguide").onclick = () => $("cliguide")?.classList.remove("open");
}
if ($("guide-save-token")) {
  $("guide-save-token").onclick = async () => {
    const t = String($("guide-bridge-token")?.value || "").trim();
    await chrome.storage.local.set({ sb_bridge_token: t }).catch(() => {});
    toast(t ? "Bridge token saved. Reconnecting..." : "Bridge token cleared.");
    chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
  };
}
if ($("guide-bridge-toggle")) {
  $("guide-bridge-toggle").onclick = async () => {
    const s = await chrome.storage.local.get("sb_bridge_status").catch(() => ({}));
    const state = s?.sb_bridge_status?.state;
    if (state === "connected") {
      $("agent").checked = false;
      await chrome.storage.local.set({ sb_agent: false }).catch(() => {});
      chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
      toast("Bridge disconnected");
    } else {
      $("agent").checked = true;
      await chrome.storage.local.set({ sb_agent: true }).catch(() => {});
      chrome.runtime.sendMessage({ type: "SB_BRIDGE_RECONNECT" }).catch(() => {});
      toast("Connecting to local bridge...");
    }
  };
}
document.querySelectorAll(".copy-code-btn").forEach((btn) => {
  btn.onclick = async () => {
    const text = btn.dataset.copy || btn.parentElement.querySelector("code")?.textContent || "";
    if (text) {
      await navigator.clipboard.writeText(text).catch(() => {});
      const orig = btn.textContent;
      btn.textContent = "Copied! ✓";
      setTimeout(() => (btn.textContent = orig), 1400);
    }
  };
});

/* ===== v0.22: YouTube Video Deep Copilot ===== */
let currentYtTab = null;
let currentYtTranscript = null;

function isYouTubeWatchUrl(u) {
  if (!u || typeof u !== "string") return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i.test(u);
}

async function checkActiveTabYouTube() {
  try {
    let t = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && isYouTubeWatchUrl(tabs[0].url)) t = tabs[0];
    } catch {}
    if (!t) {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0] && isYouTubeWatchUrl(tabs[0].url)) t = tabs[0];
      } catch {}
    }
    if (!t) {
      try {
        const tabs = await chrome.tabs.query({ active: true });
        const match = tabs.find((x) => x && isYouTubeWatchUrl(x.url));
        if (match) t = match;
      } catch {}
    }

    const banner = $("yt-copilot-banner");
    if (!banner) return;
    if (!t || !t.url || !isYouTubeWatchUrl(t.url)) {
      banner.classList.remove("show");
      currentYtTab = null;
      return;
    }
    currentYtTab = t;
    const titleEl = $("yt-title");
    if (titleEl) {
      let cleanTitle = (t.title || "").replace(/ - YouTube$/i, "").trim();
      titleEl.textContent = cleanTitle || "Watching YouTube Video";
      titleEl.title = t.url;
    }
    banner.classList.add("show");
  } catch (e) {
    dlog("warn", "checkActiveTabYouTube", String(e).slice(0, 100));
  }
}

try {
  chrome.tabs.onActivated.addListener(() => checkActiveTabYouTube());
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title) checkActiveTabYouTube(); });
  chrome.windows?.onFocusChanged?.addListener(() => checkActiveTabYouTube());
  checkActiveTabYouTube();
} catch {}

if ($("yt-dismiss")) {
  $("yt-dismiss").onclick = () => {
    $("yt-copilot-banner")?.classList.remove("show");
  };
}

if ($("yt-sum-btn")) {
  $("yt-sum-btn").onclick = async () => {
    if (!currentYtTab?.url) { toast("No active YouTube video found"); return; }
    toast("Extracting video transcript...");
    typing();
    $("st").textContent = "reading video...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "SB_YTTRAN", url: currentYtTab.url, tabId: currentYtTab.id });
      if (!res?.ok || !res?.text) {
        $("typing")?.remove();
        bubble("ai", "⚠️ Could not retrieve transcript for this YouTube video. Ensure closed captions/subtitles are available.");
        $("st").textContent = "ready";
        return;
      }
      currentYtTranscript = res;
      if (res.fallback) {
        toast("Summarizing via chapters & description (no CC track)...");
      }
      const cleanTitle = (currentYtTab.title || "").replace(/ - YouTube$/i, "").trim();
      const p = `Summarize this YouTube video ('${cleanTitle}') in high detail:
1. 🎯 Executive Summary (2-3 sentences)
2. 💡 5 Key Takeaways & Core Insights
3. ⏱ Chronological Highlights with timestamps

Transcript / Context:
${res.text.slice(0, 18000)}`;
      $("q").value = p;
      $("go").click();
    } catch (e) {
      $("typing")?.remove();
      bubble("ai", friendlyError(String(e)));
      $("st").textContent = "error";
    }
  };
}

if ($("yt-time-btn")) {
  $("yt-time-btn").onclick = async () => {
    if (!currentYtTab?.url) { toast("No active YouTube video found"); return; }
    toast("Extracting video chapters & timestamps...");
    typing();
    $("st").textContent = "reading timestamps...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "SB_YTTRAN", url: currentYtTab.url, tabId: currentYtTab.id });
      if (!res?.ok || !res?.text) {
        $("typing")?.remove();
        bubble("ai", "⚠️ Could not retrieve transcript for this YouTube video.");
        $("st").textContent = "ready";
        return;
      }
      currentYtTranscript = res;
      if (res.fallback) {
        toast("Extracting chapters & description timestamps...");
      }
      const cleanTitle = (currentYtTab.title || "").replace(/ - YouTube$/i, "").trim();
      const p = `Extract all key chronological moments and timestamped chapters from this video ('${cleanTitle}'). Provide timestamp markers (e.g. [01:24]) and summarize what happens or is explained at each stage:

Transcript / Context:
${res.text.slice(0, 18000)}`;
      $("q").value = p;
      $("go").click();
    } catch (e) {
      $("typing")?.remove();
      bubble("ai", friendlyError(String(e)));
      $("st").textContent = "error";
    }
  };
}

if ($("yt-copy-btn")) {
  $("yt-copy-btn").onclick = async () => {
    if (!currentYtTab?.url) { toast("No active YouTube video found"); return; }
    toast("Fetching transcript to copy...");
    try {
      const res = currentYtTranscript || (await chrome.runtime.sendMessage({ type: "SB_YTTRAN", url: currentYtTab.url, tabId: currentYtTab.id }));
      if (res?.ok && res?.text) {
        await navigator.clipboard.writeText(res.text).catch(() => {});
        toast(res.fallback ? "✓ Copied chapters & description to clipboard!" : "✓ Full transcript copied to clipboard!");
      } else {
        toast("⚠️ No transcript available for this video.");
      }
    } catch {
      toast("Failed to copy transcript");
    }
  };
}

/* ===== v0.22: Magic Prompt Enhancer ===== */
function enhancePrompt(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t.includes("Role:") || t.includes("Objective:") || t.length > 800) {
    return t + "\n\nRequirements:\n- Structure with clear headings and bullet points.\n- Ensure complete accuracy, depth, and actionable takeaways.\n- Include concrete examples or edge-case warnings where applicable.";
  }
  const isCode = /code|script|function|bug|api|python|javascript|typescript|rust|c\+\+|html|css|sql|regex|debug|refactor/i.test(t);
  const isAnalysis = /compare|pros|cons|analyze|vs|versus|evaluate|review|audit|critique/i.test(t);
  const isWriting = /email|letter|post|blog|article|rewrite|draft|speech|message/i.test(t);
  
  if (isCode) {
    return `You are a senior software architect and principal engineer.\nTask: ${t}\n\nRequirements:\n1. Provide production-ready, clean, and robust code.\n2. Explain the architecture, data structures, and algorithmic complexity (Time & Space).\n3. Handle edge cases, errors, and validation gracefully.\n4. Include a concise usage example and testing instructions.`;
  } else if (isAnalysis) {
    return `You are an expert strategic analyst and subject matter authority.\nTopic: ${t}\n\nPlease provide a deep, objective analysis structured as follows:\n1. Executive Overview & Core Problem Framing\n2. Direct Comparison Matrix / Factor-by-Factor Evaluation\n3. Key Advantages (Pros) & Critical Drawbacks (Cons)\n4. Hidden Risks, Trade-offs & Edge Cases\n5. Decisive Recommendation / Verdict based on common scenarios`;
  } else if (isWriting) {
    return `You are a professional editor and world-class communicator.\nTask: ${t}\n\nGuidelines:\n1. Tone: Polished, engaging, and authoritative yet accessible.\n2. Structure: Clear logical flow with compelling hooks and concise paragraphs.\n3. Clarity: Eliminate fluff, clichés, and passive voice.\n4. Output: Provide the finalized piece first, followed by optional alternative variants.`;
  } else {
    return `Act as an expert specialist in this subject domain.\nObjective: ${t}\n\nPlease deliver an authoritative, structured, and comprehensive answer:\n- Executive Summary: Concise overview answering the core question directly.\n- Key Insights & Concepts: Detailed breakdown with clear subheadings and bullet points.\n- Concrete Examples & Best Practices: Real-world applications or step-by-step guidance.\n- Nuances & Caveats: Common pitfalls, limitations, or things to watch out for.`;
  }
}

if ($("enhance-btn")) {
  $("enhance-btn").onclick = () => {
    const raw = $("q").value.trim();
    if (!raw) {
      toast("Type a prompt or topic first, then click 🪄 to enhance!");
      $("q").focus();
      return;
    }
    const enhanced = enhancePrompt(raw);
    $("q").value = enhanced;
    $("q").style.boxShadow = "0 0 0 3px rgba(139,124,255,0.45)";
    setTimeout(() => { $("q").style.boxShadow = ""; }, 800);
    $("q").dispatchEvent(new Event("input"));
    toast("🪄 Prompt enhanced into expert structure!");
  };
}

/* ===== v0.22: Page Intelligence Hub ===== */
async function runPageIntel(kind) {
  const t = await activeTab();
  if (!t) { toast("No active page found"); return; }
  toast("Analyzing page...");
  try {
    let p = pageCtx?.ok ? pageCtx : null;
    if (!p) {
      p = await fetchPageCtx(t);
      if (p?.ok) pageCtx = p;
    }
    const title = p?.title || t.title || "Page";
    const text = (p?.text || "").slice(0, 14000);
    if (!text.trim()) {
      toast("Could not read content from this page");
      return;
    }
    let prompt = "";
    if (kind === "takeaways") {
      prompt = `Extract the top 5 most valuable key takeaways and core insights from this page ('${title}'). For each takeaway, provide a bold concept title and a crisp 2-sentence explanation.\n\nPage Content:\n${text}`;
    } else if (kind === "questions") {
      prompt = `Generate the 5 most critical questions answered by this page ('${title}'), followed by authoritative, concise answers directly derived from the content.\n\nPage Content:\n${text}`;
    } else if (kind === "proscons") {
      prompt = `Perform an objective, deep Pros & Cons evaluation of the topics, arguments, strategies, or products presented on this page ('${title}'). Conclude with a balanced summary verdict.\n\nPage Content:\n${text}`;
    } else if (kind === "actions") {
      prompt = `Extract a clear, prioritized checklist of actionable steps, implementation tips, and practical to-dos from this page ('${title}'). Format as numbered action items with brief rationale.\n\nPage Content:\n${text}`;
    }
    $("q").value = prompt;
    $("go").click();
  } catch (e) {
    toast("Page Intel error: " + String(e).slice(0, 80));
  }
}

if ($("pi-takeaways")) $("pi-takeaways").onclick = () => runPageIntel("takeaways");
if ($("pi-questions")) $("pi-questions").onclick = () => runPageIntel("questions");
if ($("pi-proscons")) $("pi-proscons").onclick = () => runPageIntel("proscons");
if ($("pi-actions")) $("pi-actions").onclick = () => runPageIntel("actions");

// ===== 1. Voice-to-Prompt Dictation (Web Speech API) =====
let speechRec = null;
let isListening = false;
function toggleDictation() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    toast("Speech recognition is not supported in this browser");
    return;
  }
  const btn = $("micbtn");
  if (isListening && speechRec) {
    speechRec.stop();
    isListening = false;
    if (btn) { btn.style.background = ""; btn.style.color = ""; }
    toast("Microphone stopped");
    return;
  }
  try {
    speechRec = new Speech();
    speechRec.continuous = true;
    speechRec.interimResults = true;
    speechRec.lang = "en-US";
    speechRec.onstart = () => {
      isListening = true;
      if (btn) { btn.style.background = "rgba(255, 75, 75, 0.25)"; btn.style.color = "#ff6b6b"; }
      toast("Listening... speak now");
    };
    speechRec.onresult = (ev) => {
      let finalTranscript = "";
      for (let i = ev.resultIndex; i < ev.results.length; ++i) {
        if (ev.results[i].isFinal) finalTranscript += ev.results[i][0].transcript + " ";
      }
      if (finalTranscript && $("q")) {
        const cur = $("q").value;
        $("q").value = cur ? (cur.trimEnd() + " " + finalTranscript.trim()) : finalTranscript.trim();
      }
    };
    speechRec.onerror = (e) => {
      dlog("warn", "speech:err", e.error);
      isListening = false;
      if (btn) { btn.style.background = ""; btn.style.color = ""; }
      toast("Speech error: " + e.error);
    };
    speechRec.onend = () => {
      isListening = false;
      if (btn) { btn.style.background = ""; btn.style.color = ""; }
    };
    speechRec.start();
  } catch (e) {
    toast("Microphone error: " + String(e).slice(0, 60));
  }
}
if ($("micbtn")) $("micbtn").onclick = toggleDictation;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
    e.preventDefault();
    toggleDictation();
  }
});

// ===== 2. One-Click Artifact Exporters (Obsidian, Markdown, HTML, JSON) =====
function openExportModal() {
  const pop = $("exportpop");
  if (pop) pop.classList.add("open");
}
if ($("exportbtn")) $("exportbtn").onclick = openExportModal;
if ($("exportclose")) $("exportclose").onclick = () => $("exportpop")?.classList.remove("open");

function getActiveChatMarkdown() {
  const sess = active();
  const msgs = (sess?.messages || []);
  const title = sess?.title || "NaviBridge Chat";
  const dateStr = new Date().toISOString().split("T")[0];
  let md = `# ${title}\n*Exported on ${dateStr} from NaviBridge*\n\n---\n\n`;
  msgs.forEach((m) => {
    const role = m.who === "me" ? "User" : "AI Assistant";
    md += `### ${role} (${new Date(m.ts || Date.now()).toLocaleTimeString()})\n\n`;
    if (m.grid && Array.isArray(m.parts)) {
      m.parts.forEach((part) => {
        md += `#### ${String(part?.p || "Model").toUpperCase()}\n${part?.text || ""}\n\n`;
      });
    } else {
      md += `${m.text || ""}\n\n`;
    }
    md += `---\n\n`;
  });
  return md;
}

if ($("exp-obsidian")) {
  $("exp-obsidian").onclick = () => {
    const sess = active();
    const title = sess?.title || "NaviBridge Note";
    const dateStr = new Date().toISOString().split("T")[0];
    const frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${dateStr}\ntags: [navibridge, ai, research]\nagent: navibridge-0.23.0\n---\n\n`;
    const fullMd = frontmatter + getActiveChatMarkdown();
    const blob = new Blob([fullMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "chat"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Obsidian markdown downloaded!");
    $("exportpop")?.classList.remove("open");
  };
}

if ($("exp-md")) {
  $("exp-md").onclick = () => {
    const md = getActiveChatMarkdown();
    navigator.clipboard.writeText(md).then(() => {
      toast("Markdown copied to clipboard!");
      $("exportpop")?.classList.remove("open");
    }).catch(() => {});
  };
}

if ($("exp-html")) {
  $("exp-html").onclick = () => {
    const sess = active();
    const msgs = (sess?.messages || []);
    let html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:800px;margin:0 auto;color:#222;line-height:1.6"><h2>${sess?.title || "Chat Export"}</h2>`;
    msgs.forEach((m) => {
      const isUser = m.who === "me";
      const bg = isUser ? "#f0f4ff" : "#f9f9f9";
      html += `<div style="padding:10px 14px;margin:8px 0;background:${bg};border-radius:8px;border:1px solid #ddd"><b>${isUser ? "You" : "AI"}:</b><div style="white-space:pre-wrap;margin-top:6px">${(m.text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`;
    });
    html += `</div>`;
    try {
      const blobHtml = new Blob([html], { type: "text/html" });
      const blobText = new Blob([getActiveChatMarkdown()], { type: "text/plain" });
      navigator.clipboard.write([new ClipboardItem({ "text/html": blobHtml, "text/plain": blobText })]).then(() => {
        toast("Rich HTML copied!");
        $("exportpop")?.classList.remove("open");
      }).catch(() => {});
    } catch {
      navigator.clipboard.writeText(html).then(() => {
        toast("HTML copied!");
        $("exportpop")?.classList.remove("open");
      }).catch(() => {});
    }
  };
}

if ($("exp-json")) {
  $("exp-json").onclick = () => {
    const sess = active() || { messages: [] };
    const blob = new Blob([JSON.stringify(sess, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `navibridge-chat-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("JSON archive downloaded!");
    $("exportpop")?.classList.remove("open");
  };
}

// ===== 3. Local AI Hybrid Fallback (window.ai / Ollama) =====
async function runLocalAI(prompt) {
  bubble("me", prompt);
  const aiRow = bubble("ai", "⚡ Connecting to Local AI (Offline)...", false);
  const outEl = aiRow.querySelector(".bub");

  // Priority 1: Built-in Chrome Gemini Nano (window.ai)
  if (typeof window !== "undefined" && (window.ai?.languageModel || window.chrome?.aiOriginTrial?.languageModel)) {
    try {
      const aiFactory = window.ai?.languageModel || window.chrome?.aiOriginTrial?.languageModel;
      const session = await aiFactory.create();
      if (outEl) outEl.textContent = "";
      const stream = session.promptStreaming(prompt);
      for await (const chunk of stream) {
        if (outEl) outEl.textContent = chunk;
      }
      active()?.messages.push({ who: "ai", text: outEl ? outEl.textContent : "", ts: Date.now() });
      persist();
      toast("Generated via Chrome Gemini Nano (On-device)");
      return;
    } catch (e) {
      dlog("warn", "localAI:nano-failed", String(e));
    }
  }

  // Priority 2: Local Ollama daemon at 127.0.0.1:11434
  try {
    if (outEl) outEl.textContent = "Querying local Ollama (:11434)...";
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3.2", prompt, stream: false })
    });
    if (res.ok) {
      const data = await res.json();
      const ans = data.response || "No response";
      if (outEl) outEl.textContent = `[Local Ollama: llama3.2]\n\n${ans}`;
      active()?.messages.push({ who: "ai", text: outEl ? outEl.textContent : "", ts: Date.now() });
      persist();
      toast("Generated via Local Ollama");
      return;
    }
  } catch (e) {
    dlog("warn", "localAI:ollama-failed", String(e));
  }

  if (outEl) {
    outEl.textContent = "⚡ No local AI engine available.\n\nTo use Local AI:\n1. Enable chrome://flags/#prompt-api-for-gemini-nano in Chrome 127+\n2. Or start Ollama locally (ollama run llama3.2).";
  }
}

if ($("localbtn")) {
  $("localbtn").onclick = () => {
    const p = $("q").value.trim();
    if (!p) { toast("Type a prompt first!"); return; }
    $("q").value = "";
    runLocalAI(p);
  };
}

// ===== 4. Blind Arena Mode (LMSYS-Style Side-by-Side Comparison) =====
let arenaState = null;
async function startBlindArena(prompt) {
  const pool = ["ChatGPT", "Claude", "Gemini", "DeepSeek", "Perplexity", "Kimi"];
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const pA = shuffled[0];
  const pB = shuffled[1];
  arenaState = { modelA: pA, modelB: pB, prompt, ts: Date.now() };

  bubble("me", `[Arena Prompt]: ${prompt}`);
  const gridEl = powerGridEl([
    { p: "Model A", ok: false, pending: true, text: "⏳ Streaming anonymous response..." },
    { p: "Model B", ok: false, pending: true, text: "⏳ Streaming anonymous response..." }
  ]);
  $("chat").appendChild(gridEl);

  const pop = $("arenapop");
  if (pop) {
    pop.classList.add("open");
    renderArenaLeaderboard();
  }

  // Query both models in parallel
  const [resA, resB] = await Promise.allSettled([
    chrome.runtime.sendMessage({ type: "SB_ASK", provider: pA.toLowerCase(), prompt, timeoutMs: 120000 }),
    chrome.runtime.sendMessage({ type: "SB_ASK", provider: pB.toLowerCase(), prompt, timeoutMs: 120000 })
  ]);

  const textA = resA.status === "fulfilled" && resA.value?.ok ? resA.value.text : "Error generating Model A";
  const textB = resB.status === "fulfilled" && resB.value?.ok ? resB.value.text : "Error generating Model B";

  const updatedGrid = powerGridEl([
    { p: "Model A", ok: true, text: textA },
    { p: "Model B", ok: true, text: textB }
  ]);
  gridEl.replaceWith(updatedGrid);
}

function renderArenaLeaderboard() {
  chrome.storage.local.get("arena_scores", (s) => {
    const scores = s.arena_scores || {};
    const div = $("arena-leaderboard");
    if (!div) return;
    const entries = Object.entries(scores).sort((a, b) => (b[1].wins || 0) - (a[1].wins || 0));
    if (!entries.length) {
      div.innerHTML = "<b>Arena Leaderboard:</b> No votes yet. Vote to build your personal ranking!";
      return;
    }
    let html = "<b>Personal AI Arena Rankings:</b><br>";
    entries.forEach(([name, data], i) => {
      html += `${i + 1}. <b>${escH(String(name))}</b>: ${Number(data.wins || 0)} Wins, ${Number(data.losses || 0)} Losses<br>`;
    });
    div.innerHTML = html;
  });
}

function submitArenaVote(winner) {
  if (!arenaState) return;
  chrome.storage.local.get("arena_scores", (s) => {
    const scores = s.arena_scores || {};
    const init = (m) => { scores[m] = scores[m] || { wins: 0, losses: 0, ties: 0 }; };
    init(arenaState.modelA);
    init(arenaState.modelB);

    if (winner === "A") {
      scores[arenaState.modelA].wins++;
      scores[arenaState.modelB].losses++;
    } else if (winner === "B") {
      scores[arenaState.modelB].wins++;
      scores[arenaState.modelA].losses++;
    } else {
      scores[arenaState.modelA].ties++;
      scores[arenaState.modelB].ties++;
    }
    chrome.storage.local.set({ arena_scores: scores }, () => {
      toast(`Revealed: Model A was ${arenaState.modelA}, Model B was ${arenaState.modelB}!`);
      $("arenapop")?.classList.remove("open");
    });
  });
}

if ($("arenabtn")) {
  $("arenabtn").onclick = () => {
    const p = $("q").value.trim();
    if (!p) { toast("Enter a prompt to compare models blindly!"); return; }
    $("q").value = "";
    startBlindArena(p);
  };
}
if ($("vote-a")) $("vote-a").onclick = () => submitArenaVote("A");
if ($("vote-b")) $("vote-b").onclick = () => submitArenaVote("B");
if ($("vote-tie")) $("vote-tie").onclick = () => submitArenaVote("tie");
if ($("arenaclose")) $("arenaclose").onclick = () => $("arenapop")?.classList.remove("open");

// ===== 5. RPA Human-in-the-Loop Checkpoint =====
let pendingCheckpointResolver = null;
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m.type === "SB_ACTION_CHECKPOINT") {
    const pop = $("checkpop");
    if ($("check-msg")) $("check-msg").textContent = m.message || "Agent requests to perform sensitive action:";
    if ($("check-details")) $("check-details").textContent = JSON.stringify(m.action || {}, null, 2);
    if (pop) pop.classList.add("open");

    // A second pending action supersedes the first: deny it explicitly so its port
    // cannot hang until timeout while the user answers the newer dialog.
    if (pendingCheckpointResolver) { pendingCheckpointResolver(false); pendingCheckpointResolver = null; }
    pendingCheckpointResolver = (approved) => {
      pop?.classList.remove("open");
      send({ approved });
      pendingCheckpointResolver = null;
    };
    return true; // Keep message port open
  }
});
if ($("check-allow")) $("check-allow").onclick = () => { const r = pendingCheckpointResolver; pendingCheckpointResolver = null; if (r) r(true); };
if ($("check-deny")) $("check-deny").onclick = () => { const r = pendingCheckpointResolver; pendingCheckpointResolver = null; if (r) r(false); };

// ===== 6. TradingView Chart Vision Analyst =====
if ($("chartbtn")) {
  $("chartbtn").onclick = async () => {
    toast("Capturing chart screenshot...");
    try {
      const du = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 85 });
      attachImgs.push(String(du).slice(0, 450000));
      renderAttach();
      $("q").value = `📈 Analyze this trading chart (SMC & Quantitative Technicals):
1. Market Structure: (Bullish / Bearish / Consolidating)
2. Key Levels: Major Resistance, Support, and Liquidity Pools
3. Smart Money Insights: Order Blocks (OB), Fair Value Gaps (FVG), BOS/CHoCH
4. Momentum & Oscillators (RSI/MACD divergence if visible)
5. Actionable Setup: Directional Bias (LONG/SHORT), Entry Zone, Invalidation Stop-Loss, TP1/TP2 Targets, Risk-to-Reward Ratio (R:R)`;
      toast("Chart captured! Click Send ➤ to analyze");
    } catch (e) {
      toast("Failed to capture chart: " + String(e).slice(0, 60));
    }
  };
}

// ===== 7. Multi-Model Pipeline Chain Runner =====
if ($("chainbtn")) {
  $("chainbtn").onclick = async () => {
    const raw = $("q").value.trim();
    if (!raw) {
      toast("Enter a goal or prompt to run through the 3-step pipeline!");
      return;
    }
    $("q").value = "";
    bubble("me", `⛓️ **Running Autonomous Pipeline Chain:**\n${raw}`);
    const statusRow = bubble("ai", "Step 1/3: Researching specifications via Perplexity...", false);
    const outEl = statusRow.querySelector(".bub");

    try {
      // Step 1: Perplexity specs
      const res1 = await chrome.runtime.sendMessage({
        type: "SB_ASK",
        provider: "perplexity",
        prompt: `Research technical specs, best practices, and edge cases for:\n${raw}`
      });
      const spec = res1?.text || "No spec found";

      // Step 2: DeepSeek code
      if (outEl) outEl.textContent = `✓ Step 1 Complete (Perplexity).\n\nStep 2/3: Implementing code via DeepSeek...`;
      const res2 = await chrome.runtime.sendMessage({
        type: "SB_ASK",
        provider: "deepseek",
        prompt: `Based on these specifications, implement production-grade, complete code:\n\n${spec.slice(0, 8000)}`
      });
      const code = res2?.text || "No code generated";

      // Step 3: Claude audit
      if (outEl) outEl.textContent = `✓ Step 1 & 2 Complete (Perplexity + DeepSeek).\n\nStep 3/3: Running security and logic audit via Claude...`;
      const res3 = await chrome.runtime.sendMessage({
        type: "SB_ASK",
        provider: "claude",
        prompt: `Audit this code for security vulnerabilities, logic bugs, and edge-case memory leaks:\n\n${code.slice(0, 8000)}`
      });
      const audit = res3?.text || "Audit complete";

      const finalReport = `### ⛓️ Pipeline Completed: Code Architecture & Security Audit\n\n#### 1. Research & Specifications (Perplexity)\n${spec.slice(0, 2000)}...\n\n---\n\n#### 2. Implementation (DeepSeek)\n${code}\n\n---\n\n#### 3. Security Audit & Hardening (Claude)\n${audit}`;
      if (outEl) outEl.innerHTML = "";
      outEl.appendChild(mdLite(finalReport));
      active()?.messages.push({ who: "ai", text: finalReport, ts: Date.now() });
      persist();
      toast("Pipeline chain completed across 3 models!");
    } catch (e) {
      if (outEl) outEl.textContent = `Pipeline error: ${String(e)}`;
    }
  };
}

// ===== 8. Live Trading Alert Receiver =====
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === "trading_alert" && m.alert) {
    const a = m.alert;
    const alertMsg = `🚨 [Trading Alert]: ${a.ticker || a.symbol || "Signal"} - ${a.action || a.side || "ALERT"} @ ${a.price || ""}\n${a.message || ""}`;
    bubble("ai", alertMsg);
    toast(`Trading Alert: ${a.ticker || "Asset"} ${a.action || ""}`);
  }
});

// ===== 9. Omni Command Palette (Ctrl+K / ⌘K) =====
const PALETTE_COMMANDS = [
  { id: "chart", title: "Analyze TradingView Chart", icon: "📈", desc: "SMC structure, liquidity pools, order blocks & trade setup", run: () => $("chartbtn")?.click() },
  { id: "pine", title: "Pine Script v6 Studio", icon: "🌲", desc: "Generate or fix TradingView indicators & backtest strategies", run: () => $("pinepop")?.classList.add("open") },
  { id: "scrape", title: "Autonomous Web Scraper", icon: "🕸️", desc: "Extract structured tables, metrics, or JSON from active page", run: () => $("scrapepop")?.classList.add("open") },
  { id: "pipeline", title: "Run Multi-Model Pipeline Chain", icon: "⛓️", desc: "Specs (Perplexity) → Code (DeepSeek) → Audit (Claude)", run: () => $("chainbtn")?.click() },
  { id: "research", title: "Deep Research Agent", icon: "🔬", desc: "Autonomous web search, source reads, and synthesis", run: () => $("research")?.click() },
  { id: "arena", title: "Blind Arena Battle", icon: "🎭", desc: "Unbiased double-blind model comparison and voting", run: () => $("arenapop")?.classList.add("open") },
  { id: "voice", title: "Toggle Voice Dictation", icon: "🎙️", desc: "Dictate prompt via browser speech-to-text", run: () => $("micbtn")?.click() },
  { id: "export", title: "Export Chat Archive", icon: "📦", desc: "Export as Obsidian Markdown, Rich HTML, or JSON", run: () => $("exportpop")?.classList.add("open") },
  { id: "local", title: "Toggle Local AI Engine", icon: "💻", desc: "Switch to offline Gemini Nano or local Ollama", run: () => $("localbtn")?.click() },
  { id: "enhance", title: "Magic Prompt Enhancer", icon: "🪄", desc: "Transform draft into structured, high-accuracy prompt", run: () => $("enhance-btn")?.click() },
  { id: "sum", title: "Summarize Current Page", icon: "✨", desc: "Instant 5-bullet summary of active tab", run: () => $("sum")?.click() },
  { id: "multi", title: "Toggle Multi-Mode Terminal", icon: "⚡", desc: "Council, Debate, Compare, and Power-Ask cockpit", run: () => $("multimode-toggle")?.click() },
  { id: "tabs", title: "Multi-Tab Context Picker", icon: "🗂", desc: "Attach up to 3 background tabs as prompt context", run: () => $("tabctxbtn")?.click() },
  { id: "cliguide", title: "CLI & MCP Server Guide", icon: "⚙️", desc: "Terminal commands, bridge tokens, and Claude config", run: () => $("cliguidebtn")?.click() }
];

let paletteIdx = 0;
let filteredPalette = [...PALETTE_COMMANDS];

function renderPalette(query = "") {
  const q = query.trim().toLowerCase();
  filteredPalette = PALETTE_COMMANDS.filter((c) => !q || c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.id.includes(q));
  paletteIdx = 0;
  const listEl = $("palette-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!filteredPalette.length) {
    listEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--mut);font-size:12px">No matching commands found.</div>`;
    return;
  }

  filteredPalette.forEach((cmd, i) => {
    const item = document.createElement("button");
    item.className = "palette-item" + (i === paletteIdx ? " selected" : "");
    item.innerHTML = `<span class="p-icon">${cmd.icon}</span><span class="p-title">${cmd.title}</span><span class="p-desc">${cmd.desc}</span>`;
    item.onclick = () => {
      $("palettepop")?.classList.remove("open");
      cmd.run();
    };
    listEl.appendChild(item);
  });
}

function updatePaletteSelection() {
  const items = document.querySelectorAll(".palette-item");
  items.forEach((it, i) => it.classList.toggle("selected", i === paletteIdx));
  if (items[paletteIdx]) items[paletteIdx].scrollIntoView({ block: "nearest" });
}

function togglePalette(open) {
  const pop = $("palettepop");
  if (!pop) return;
  const isOpen = open !== undefined ? open : !pop.classList.contains("open");
  pop.classList.toggle("open", isOpen);
  if (isOpen) {
    if ($("palette-input")) {
      $("palette-input").value = "";
      renderPalette("");
      setTimeout(() => $("palette-input").focus(), 50);
    }
  }
}

if ($("cmdpalettebtn")) $("cmdpalettebtn").onclick = () => togglePalette(true);
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    togglePalette();
  } else if (e.key === "Escape" && $("palettepop")?.classList.contains("open")) {
    togglePalette(false);
  }
});

if ($("palette-input")) {
  $("palette-input").addEventListener("input", (e) => renderPalette(e.target.value));
  $("palette-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredPalette.length) {
        paletteIdx = (paletteIdx + 1) % filteredPalette.length;
        updatePaletteSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredPalette.length) {
        paletteIdx = (paletteIdx - 1 + filteredPalette.length) % filteredPalette.length;
        updatePaletteSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredPalette[paletteIdx]) {
        $("palettepop")?.classList.remove("open");
        filteredPalette[paletteIdx].run();
      }
    }
  });
}

// ===== 10. Pine Script v6 Studio =====
if ($("pinebtn")) $("pinebtn").onclick = () => $("pinepop")?.classList.add("open");
if ($("pineclose")) $("pineclose").onclick = () => $("pinepop")?.classList.remove("open");

if ($("pine-run-btn")) {
  $("pine-run-btn").onclick = async () => {
    const prompt = $("pine-prompt")?.value.trim();
    if (!prompt) { toast("Please specify indicator or strategy rules!"); return; }
    const error = $("pine-error")?.value.trim() || undefined;
    const isStrategy = $("pine-type-strat")?.checked;
    const provider = $("pine-prov")?.value || "deepseek";

    const runBtn = $("pine-run-btn");
    runBtn.disabled = true;
    runBtn.textContent = "Generating v6 Code...";

    try {
      toast("Querying " + provider.toUpperCase() + " with Pine v6 constraints...");
      const sysPrompt = `You are an elite TradingView Pine Script v6 expert developer.
Write clean, optimized, production-ready Pine Script v6 code for:
"${prompt}"
${error ? `\nFix this compiler error:\n${error}\n` : ""}

CRITICAL PINE SCRIPT v6 RULES:
1. First line must be: //@version=6
2. Use ${isStrategy ? 'strategy("...", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)' : 'indicator("...", overlay=true)'}
3. Always use the 'ta.' namespace for technical indicators (ta.sma, ta.ema, ta.rsi, ta.macd, ta.crossover, ta.crossunder, ta.atr, ta.bb).
4. Use 'input.int()', 'input.float()', 'input.string()', 'input.bool()' for all customizable user inputs with minval/maxval.
5. In strategies, calculate proper risk management (ATR-based trailing stop-loss, take-profit levels with strategy.exit).
6. Ensure no undeclared variables, correct reassignments with ':=', and valid color declarations (color.new(color.green, 20)).
7. Return ONLY the complete, copy-paste ready Pine Script code inside a markdown code block (\`\`\`pinescript).`;

      const res = await chrome.runtime.sendMessage({
        type: "SB_ASK",
        provider,
        prompt: sysPrompt
      });

      const raw = res?.text || "No code returned";
      const match = raw.match(/```(?:pinescript|pine)?([\s\S]*?)```/i);
      const pineCode = match ? match[1].trim() : raw.trim();

      const wrap = $("pine-result-wrap");
      const codeEl = $("pine-result-code");
      if (codeEl) codeEl.textContent = pineCode;
      if (wrap) wrap.style.display = "block";
      toast("Pine Script v6 successfully generated!");
    } catch (e) {
      toast("Generation error: " + String(e).slice(0, 80));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "⚡ Generate v6 Code";
    }
  };
}

if ($("pine-copy-btn")) {
  $("pine-copy-btn").onclick = async () => {
    const code = $("pine-result-code")?.textContent || "";
    await navigator.clipboard.writeText(code).catch(() => {});
    toast("Pine Script copied to clipboard!");
  };
}

if ($("pine-insert-btn")) {
  $("pine-insert-btn").onclick = () => {
    const code = $("pine-result-code")?.textContent || "";
    $("q").value = `\`\`\`pinescript\n${code}\n\`\`\``;
    $("pinepop")?.classList.remove("open");
    toast("Inserted Pine Script into composer!");
  };
}

if ($("pine-down-btn")) {
  $("pine-down-btn").onclick = () => {
    const code = $("pine-result-code")?.textContent || "";
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `navibridge_strategy_v6.pine`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Downloaded .pine file!");
  };
}

// ===== 11. Autonomous Web Scraper =====
if ($("scrapebtn")) $("scrapebtn").onclick = () => $("scrapepop")?.classList.add("open");
if ($("scrapeclose")) $("scrapeclose").onclick = () => $("scrapepop")?.classList.remove("open");

if ($("scrape-run-btn")) {
  $("scrape-run-btn").onclick = async () => {
    const goal = $("scrape-goal")?.value.trim();
    if (!goal) { toast("Please specify what data or schema to extract!"); return; }
    const provider = $("scrape-prov")?.value || "deepseek";
    const format = $("scrape-format")?.value || "json";

    const runBtn = $("scrape-run-btn");
    runBtn.disabled = true;
    runBtn.textContent = "Extracting Data...";

    try {
      toast("Reading active tab content...");
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let pageText = "";
      if (tabs[0]?.id) {
        try {
          const [execRes] = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => document.body ? document.body.innerText.slice(0, 18000) : ""
          });
          pageText = execRes?.result || "";
        } catch {
          pageText = $("q")?.value || "";
        }
      }

      if (!pageText || pageText.length < 50) {
        throw new Error("Unable to read active tab text");
      }

      toast("Transforming unstructured DOM with " + provider.toUpperCase() + "...");
      const prompt = `You are a precision structured web data extraction engine.
Target Schema / Extraction Goal:
"${goal}"
Output format: ${format.toUpperCase()}

--- RAW PAGE CONTENT ---
${pageText.slice(0, 15000)}
--- END PAGE CONTENT ---

CRITICAL INSTRUCTIONS:
1. Extract ALL matching rows, items, and metrics.
2. Return ONLY clean, valid ${format === "json" ? "JSON inside ```json ... ```" : "CSV inside ```csv ... ```"}.
3. Strongly type numbers and booleans. No conversation.`;

      const res = await chrome.runtime.sendMessage({
        type: "SB_ASK",
        provider,
        prompt
      });

      const raw = res?.text || "No data returned";
      const match = raw.match(new RegExp("```(?:" + format + ")?([\\s\\S]*?)```", "i"));
      const extracted = match ? match[1].trim() : raw.trim();

      const wrap = $("scrape-result-wrap");
      const codeEl = $("scrape-result-code");
      if (codeEl) codeEl.textContent = extracted;
      if (wrap) wrap.style.display = "block";
      toast("Structured extraction complete!");
    } catch (e) {
      toast("Scraping error: " + String(e).slice(0, 80));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "🕸️ Scrape Page";
    }
  };
}

if ($("scrape-copy-btn")) {
  $("scrape-copy-btn").onclick = async () => {
    const data = $("scrape-result-code")?.textContent || "";
    await navigator.clipboard.writeText(data).catch(() => {});
    toast("Extracted data copied to clipboard!");
  };
}

if ($("scrape-down-btn")) {
  $("scrape-down-btn").onclick = () => {
    const data = $("scrape-result-code")?.textContent || "";
    const format = $("scrape-format")?.value || "json";
    const blob = new Blob([data], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extracted_data_${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Downloaded extracted ${format.toUpperCase()}!`);
  };
}





