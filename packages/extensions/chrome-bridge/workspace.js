const $ = (id) => document.getElementById(id);
const AV = ["#3ecf8e", "#5b8cff", "#ffb454", "#c478ff", "#00c4cc", "#ff6b7a", "#f2c94c"];
const PROVIDERS = ["ChatGPT", "Gemini", "Claude", "Grok", "Kimi", "DeepSeek", "Perplexity"];
const POS = {
  chat: [],
  compare: [],
  debate: ["Team A — FOR", "Team B — AGAINST"],
  council: ["Proposer", "Critic", "Judge"],
};
const POSTAG = { "Proposer": "📝", "Critic": "🔍", "Judge": "⚖", "Team A — FOR": "🅰", "Team B — AGAINST": "🅱" };
const MODE_LABEL = { chat: "Multi-AI Chat", compare: "Compare Providers", debate: "Debate", council: "Council" };
const cut = (s, n) => String(s || "").slice(0, n);

let cfg = null;
let running = false;
let stopFlag = false;

async function loadCfg() {
  let saved = null;
  try { saved = await chrome.storage.local.get("sb_multi_cfg").then((s) => s.sb_multi_cfg).catch(() => null); } catch {}
  cfg = {
    mode: (saved && POS[saved.mode]) ? saved.mode : "council",
    rounds: Math.min(Math.max(Number((saved && saved.rounds) || 2), 1), 3),
    members: {},
  };
  PROVIDERS.forEach((p, i) => {
    const s = (saved && saved.members && saved.members[p]) || {};
    const roles = POS[cfg.mode];
    cfg.members[p] = { on: !!s.on, pos: roles.includes(s.pos) ? s.pos : "" };
  });
  const on = PROVIDERS.filter((p) => cfg.members[p].on);
  if (cfg.mode === "council" && on.length < 3) {
    ["ChatGPT", "Gemini", "Claude"].forEach((p) => { if (cfg.members[p]) cfg.members[p].on = true; });
  } else if (cfg.mode === "debate" && on.length < 2) {
    ["ChatGPT", "Claude"].forEach((p) => { if (cfg.members[p]) cfg.members[p].on = true; });
  } else if (!on.length) {
    ["ChatGPT", "Gemini", "Claude"].forEach((p) => { if (cfg.members[p]) cfg.members[p].on = true; });
  }
  if (POS[cfg.mode].length) ensurePositions();
}
const saveCfg = () => chrome.storage.local.set({ sb_multi_cfg: cfg }).catch(() => {});

function ensurePositions() {
  const on = PROVIDERS.filter((p) => cfg.members[p].on);
  const roles = POS[cfg.mode].filter(Boolean);
  if (!roles.length) {
    on.forEach((p) => { cfg.members[p].pos = ""; });
    return;
  }
  if (cfg.mode === "council" && on.length < 3) {
    for (const p of PROVIDERS) {
      if (!cfg.members[p].on) {
        cfg.members[p].on = true;
        on.push(p);
        if (on.length >= 3) break;
      }
    }
  } else if (cfg.mode === "debate" && on.length < 2) {
    for (const p of PROVIDERS) {
      if (!cfg.members[p].on) {
        cfg.members[p].on = true;
        on.push(p);
        if (on.length >= 2) break;
      }
    }
  }
  roles.forEach((role, i) => {
    if (!on.some((p) => cfg.members[p].pos === role)) {
      const candidate = on[i] || on.find((p) => !roles.includes(cfg.members[p].pos)) || on[0];
      if (candidate) cfg.members[candidate].pos = role;
    }
  });
  on.forEach((p, i) => { if (cfg.members[p].pos && !roles.includes(cfg.members[p].pos)) cfg.members[p].pos = roles[i % roles.length] || ""; });
}

const qs = new URLSearchParams(location.search);
if (qs.get("mode") && POS[qs.get("mode")]) {
  (async () => {
    await loadCfg();
    cfg.mode = qs.get("mode");
    if (POS[cfg.mode].length) ensurePositions();
    saveCfg();
    init();
  })();
} else loadCfg().then(init);

function renderSetup() {
  $("modetag").textContent = MODE_LABEL[cfg.mode];
  $("mode").value = cfg.mode;
  $("roundsrow").style.display = cfg.mode === "debate" ? "" : "none";
  $("rounds").value = cfg.rounds;
  const box = $("members");
  box.innerHTML = "";
  PROVIDERS.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "member" + (cfg.members[p].on ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = cfg.members[p].on;
    cb.onchange = () => { cfg.members[p].on = cb.checked; if (cb.checked && !POS[cfg.mode].includes(cfg.members[p].pos)) cfg.members[p].pos = POS[cfg.mode][0] || ""; ensurePositions(); saveCfg(); renderSetup(); };
    const nm = document.createElement("b"); nm.textContent = p;
    const sel = document.createElement("select");
    if (POS[cfg.mode].length) {
      POS[cfg.mode].forEach((x) => { const o = document.createElement("option"); o.value = x; o.textContent = (POSTAG[x] || "") + " " + x; sel.appendChild(o); });
      sel.value = cfg.members[p].pos || POS[cfg.mode][0];
    } else { const o = document.createElement("option"); o.value = ""; o.textContent = "— participant —"; sel.appendChild(o); }
    sel.disabled = !cfg.members[p].on;
    sel.onchange = () => { cfg.members[p].pos = sel.value; ensurePositions(); saveCfg(); renderSetup(); };
    row.append(cb, nm, sel);
    box.appendChild(row);
  });
  $("poshint").textContent =
    cfg.mode === "council" ? "Council needs ≥1 Proposer, ≥1 Critic, ≥1 Judge." :
    cfg.mode === "debate" ? "Debate needs ≥2 selected, with both Team A and Team B assigned." :
    "All selected AIs answer the same question in parallel.";
}
function init() {
  renderSetup();
  const qParam = qs.get("q");
  if (qParam && $("qq") && !$("qq").value) {
    let dec = qParam.trim();
    try { dec = decodeURIComponent(qParam).trim(); } catch {}
    $("qq").value = dec;
    if (dec && !running) {
      setTimeout(() => { onClickRun(); }, 400);
    }
  }
}

$("mode").onchange = () => {
  cfg.mode = $("mode").value;
  const roles = POS[cfg.mode].filter(Boolean);
  PROVIDERS.forEach((p, i) => {
    if (!roles.length) cfg.members[p].pos = "";
    else if (!roles.includes(cfg.members[p].pos)) cfg.members[p].pos = roles[i % roles.length];
  });
  ensurePositions(); saveCfg(); renderSetup();
};
$("rounds").onchange = () => { cfg.rounds = Math.min(Math.max(Number($("rounds").value || 2), 1), 3); saveCfg(); };

function st(text, cls) { const s = $("st"); s.textContent = text; s.className = cls || ""; }
function avColor(p) { return AV[PROVIDERS.indexOf(p) % AV.length]; }
function clearEmpty() { document.querySelector("#stream .empty")?.remove(); }
function phaseHead(txt) {
  clearEmpty();
  const t = document.createElement("div"); t.className = "turn phasehead";
  const b = document.createElement("div"); b.className = "bubble"; b.textContent = txt;
  t.appendChild(b); $("stream").appendChild(t);
  $("stream").scrollTop = 99999;
}
function turn(p, pos, text, opts = {}) {
  clearEmpty();
  const t = document.createElement("div"); t.className = "turn" + (opts.verdict ? " verdict" : "") + (opts.working ? " ai-working" : "");
  const av = document.createElement("div"); av.className = "av"; av.style.background = avColor(p); av.textContent = p[0];
  const body = document.createElement("div"); body.className = "body";
  const meta = document.createElement("div"); meta.className = "meta";
  const nm = document.createElement("b"); nm.textContent = p;
  meta.appendChild(nm);
  if (pos) { const ps = document.createElement("span"); ps.className = "pos"; ps.textContent = (POSTAG[pos] || "") + " " + pos; meta.appendChild(ps); }
  const bub = document.createElement("div"); bub.className = "bubble"; bub.textContent = text || "…answering";
  body.append(meta, bub); t.append(av, body); $("stream").appendChild(t);
  $("stream").scrollTop = 99999;
  return bub;
}
$("stopbtn").onclick = () => { stopFlag = true; st("stopping…", "bad"); };

async function askOne(provider, prompt) {
  const bub = turn(provider, cfg.members[provider]?.pos || "", "…answering", { working: true });
  try {
    const r = await chrome.runtime.sendMessage({ type: "SB_ASK", provider, prompt: cut(prompt, 20000) });
    bub.closest(".turn")?.classList.remove("ai-working");
    if (stopFlag) { bub.textContent = "■ stopped"; return ""; }
    if (!r?.ok) { bub.textContent = "✕ " + (r?.error || "no response"); return ""; }
    bub.textContent = String(r.text || "");
    return String(r.text || "");
  } catch (e) {
    bub.closest(".turn")?.classList.remove("ai-working");
    bub.textContent = "✕ " + String(e).slice(0, 140);
    return "";
  }
}
function mem(pos) { return PROVIDERS.filter((p) => cfg.members[p].on && cfg.members[p].pos === pos); }
function valid() {
  const on = PROVIDERS.filter((p) => cfg.members[p].on);
  if (!on.length) return "select ≥1 AI";
  if (cfg.mode === "council" && (!mem("Proposer").length || !mem("Critic").length || !mem("Judge").length)) return "council needs ≥1 Proposer, Critic, Judge";
  if (cfg.mode === "debate" && (!mem("Team A — FOR").length || !mem("Team B — AGAINST").length)) return "debate needs Team A + Team B";
  return null;
}
async function run(q) {
  running = true; stopFlag = false; $("startbtn").disabled = true; $("sendbtn").disabled = true;
  st("running", "ok");
  turn("You", "", q);
  try {
    if (cfg.mode === "council") await runCouncil(q);
    else if (cfg.mode === "debate") await runDebate(q);
    else {
      phaseHead(cfg.mode === "compare" ? "⚔ PARALLEL ANSWERS — compare side by side" : "💬 ALL SELECTED AIs — answering");
      await Promise.all(PROVIDERS.filter((p) => cfg.members[p].on).map((p) => askOne(p, q)));
    }
  } catch (e) { turn("System", "", "⚠ " + String(e).slice(0, 180)); }
  running = false; $("startbtn").disabled = false; $("sendbtn").disabled = false;
  st("done", "ok");
}
function onClickRun() {
  if (running) return;
  const q = $("qq").value.trim();
  if (!q) { st("type a question below", "bad"); $("qq").focus(); return; }
  const err = valid();
  if (err) { st(err, "bad"); return; }
  $("qq").value = "";
  run(q);
}
$("startbtn").onclick = onClickRun;
$("sendbtn").onclick = onClickRun;
$("qq").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onClickRun(); } });

function ctxBrief() {
  return [...document.querySelectorAll("#stream .turn:not(.phasehead) .bubble")]
    .map((b) => b.textContent).slice(-4).map((t) => cut(t, 500)).join(" | ").slice(0, 1200);
}
async function runDebate(q) {
  for (let r = 1; r <= cfg.rounds && !stopFlag; r++) {
    for (const [team, label] of [["Team A — FOR", "FOR"], ["Team B — AGAINST", "AGAINST"]]) {
      if (stopFlag) return;
      phaseHead(`🗣 ROUND ${r} — ${label} speaking`);
      const ctx = ctxBrief();
      const ask = `${q}\n\n[Debate round ${r}, you argue strictly ${label}. ${r > 1 ? "Counter the previous points and defend your side." : "State your opening position."} Turns so far: ${ctx || "(start fresh)"}]`;
      await Promise.all(mem(team).map((p) => askOne(p, ask)));
    }
  }
  if (!stopFlag) {
    phaseHead("⚖ CLOSING");
    const closer = mem("Team A — FOR")[0];
    if (closer) await askOne(closer, `${q}\n\n[Final: give your closing summary in ≤150 words]`);
  }
}
async function runCouncil(q) {
  const props = mem("Proposer"), crits = mem("Critic"), judges = mem("Judge");
  phaseHead("📝 PHASE 1 — proposals");
  const drafts = await Promise.all(props.map((p) => askOne(p, `${q}\n\nAnswer as a complete proposal draft (concise, actionable).`)));
  if (stopFlag) return;
  const validDrafts = props.map((p, i) => ({ p, text: drafts[i] })).filter((x) => x.text && x.text.length > 10);
  if (!validDrafts.length) {
    phaseHead("⚠ No proposals received — please ensure providers are logged in and retry.");
    return;
  }
  phaseHead("🔍 PHASE 2 — critiques");
  const cbrief = validDrafts.map((x) => `【${x.p}】${cut(x.text, 500)}`).join("\n").slice(0, 1800);
  const allCrit = await Promise.all(crits.map((p) => askOne(p, `Critique the proposals, 3 bullets each, weaknesses + fixes:\nQ: ${cut(q, 300)}\n${cbrief}`)));
  if (stopFlag) return;
  const validCrit = crits.map((p, i) => ({ p, text: allCrit[i] })).filter((x) => x.text && x.text.length > 5);
  phaseHead("✍ PHASE 3 — revisions");
  const ctext = (validCrit.length ? validCrit : [{ p: "Critic", text: "Address any potential weaknesses or gaps." }]).map((x) => `${x.p}: ${cut(x.text, 400)}`).join("\n").slice(0, 1600);
  const revis = await Promise.all(validDrafts.map((x) => askOne(x.p, `Revise your proposal given the critiques. Output only the revised proposal:\nQ: ${cut(q, 300)}\nYour draft: ${cut(x.text, 500)}\nCritiques:\n${ctext}`)));
  if (stopFlag) return;
  const validRevis = validDrafts.map((x, i) => ({ p: x.p, text: revis[i] || x.text })).filter((x) => x.text && x.text.length > 10);
  phaseHead("⚖ PHASE 4 — verdict");
  const rbrief = (validRevis.length ? validRevis : validDrafts).map((x) => `【${x.p}】${cut(x.text, 700)}`).join("\n").slice(0, 2600);
  for (const j of judges) {
    if (stopFlag) break;
    const v = await askOne(j, `Pick the best proposal. Reply: winner name, one-line reason, and the full winning text:\nQ: ${cut(q, 300)}\n${rbrief}`);
    if (v) { const b = document.querySelector("#stream .turn:last-child .bubble"); if (b) b.textContent = "🏆 " + v; b?.closest(".turn")?.classList.add("verdict"); }
  }
}
