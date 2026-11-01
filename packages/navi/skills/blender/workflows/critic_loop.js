// The whole critic loop (blender skill, SKILL.md section 1a, steps C-F) as a fixed script: every round,
// blind critics review the current render in parallel, then one builder child fixes the top findings,
// renders a candidate, keeps or reverts it, and writes the round file. Launch it with task set: a first
// builder writes the observation sheet, the build script and the first complete render before the rounds
// start. A rounds-only relaunch (no task) continues from the current files and must pass startRound. It
// returns when the scores are high, the rounds run out or the deadline nears.
//
// args: { reference: abs path, render: abs path of the deliverable render, script: abs path of the build
//         script, build: shell command that rebuilds the scene and writes render (and .blend),
//         task: the task's full requirements, verbatim (set it to have the workflow do the first build),
//         skillDir: abs path of the blender skill, workdir: abs dir holding critic/ (default: script dir),
//         rounds: max rounds (default 5), target: stop when every grader score >= this (default 8),
//         criticEffort: reasoning effort for the reviewers (default "medium"),
//         deadline: unix seconds when the loop must be done (e.g. `date -d '+70 minutes' +%s`); builders
//         read the clock with `date +%s` and the loop starts no round with under 12 minutes left,
//         startRound: number of the first round; required without task (one past the last round reported,
//         so earlier round files, packs and backups are kept), defaults to 1 with task }
// Scripts may not read the clock themselves (workflow scripts are deterministic), so the builders do.

// Object args arrive deep-frozen, and the loop records the observation sheet's path, so work on a copy.
let A = args || {};
if (typeof A === "string") {
  try { A = JSON.parse(A); } catch (e) { A = {}; }
} else {
  A = { ...A };
}
const missing = ["reference", "render", "script", "build", "skillDir"].filter((k) => !A[k]);
if (missing.length) {
  return { summary: JSON.stringify({ error: "invalid_arguments", missing }) };
}
// A rounds-only launch must say where its numbering starts, or it would overwrite round 1's files.
if (!A.task && !A.startRound) {
  return { summary: JSON.stringify({ error: "invalid_arguments", detail: "a rounds-only launch (no task) needs startRound: one past the last round reported" }) };
}
const WORK = A.workdir || A.script.replace(/\/[^/]*$/, "");
const ROUNDS = Math.max(1, Math.min(Number(A.rounds) || 5, 10));
const START = Math.max(1, Math.floor(Number(A.startRound)) || 1);
const TARGET = Number(A.target) || 8;
const CRITIC_EFFORT = A.criticEffort || "medium";
const DEADLINE = Number(A.deadline) || 0;
const clockStep = DEADLINE
  ? `Time: the loop must finish by unix time ${DEADLINE}. Run \`echo $(( (${DEADLINE} - $(date +%s)) / 60 ))\` now for the minutes left; with under 10 minutes left make only one small safe change. Report minutes_left (that number, re-read at the end).`
  : "Report minutes_left as -1.";
const PACK = (n) => `${WORK}/critic/pack/loop_${String(n).padStart(2, "0")}`;
const packCmd = (n, render) =>
  `blender -b --factory-startup --python-exit-code 1 -P ${A.skillDir}/scripts/critic_pack.py -- --ref ${A.reference} --render ${render} --out ${PACK(n)}`;

// Three reviewers, each carrying the full checklists of the critics it merges (SKILL.md section 1a step D),
// plus the grader: four parallel children per round instead of eight keeps a busy deployment usable.
const CRITICS = [
  ["form", "Three aspects, each checked separately and named in every finding's `where`: (1) VIEWPOINT AND FRAMING. Same facing (which end points image-left or image-right)? Same faces visible in the same proportions (front versus side)? Same camera height (top surface, ellipse flatness)? Same perspective strength? Same fraction of the frame and position, and the same share of the frame for each major part? A mirrored or wrongly rotated view is critical. (2) SILHOUETTE AND PROPORTIONS. Ignore colour and material. Overall width-to-height ratio; relative size and position of each major part; every bump, notch, overhang, taper and curve of the outline (angular where the reference curves is a defect); open gaps and holes; thickness of arms, legs, frames, rods and blades (drawn thicker than the reference is the commonest toy-look cause). (3) CONSTRUCTION AND RENDER INTEGRITY. Floating parts, visible gaps where parts should touch, parts pushing through each other, faceted curves, black faces or streaks, noise or fireflies, parts cut off by the frame, blobby or low-poly shapes, missing undersides visible from this camera."],
  ["parts", "PART INVENTORY AND DETAIL. Cell by cell in the details image: each part visible in the reference is right, wrong (shape, size, position, count) or missing in the render. Secondary parts must span their true attachment points (rams, struts, cables). Parts open or hollow in the reference must be open. List invented parts. Check counts of repeated parts and small recognizable features (handles, buttons, dials, vents, seams, panel lines, rivets, hinges, wheel spokes and hubs, window frames, mirrors, lights)."],
  ["surface", "Three aspects, each checked separately and named in every finding's `where`: (1) COLOUR. For each part, hue, lightness and saturation as they appear, with the direction of each error; stripes, two-tone borders, trim and accents in the same places; each colour's share of the object. Crushed black or washed-out white parts are colour errors too. Ignore shape and material. (2) MATERIAL AND SURFACE FINISH. For each part: does it read as the same material - glossy paint with crisp highlight streaks and reflections, chrome, brushed or dark steel, plastic, glass (reflective, darker, partly see-through, not a flat grey pane), rubber, wood grain, fabric, leather? A uniform satin 'CG plastic' or clay look is a defect even with the right colour. Visible grain or speckle noise on surfaces is a defect. Ignore hue and shape. (3) LIGHT AND SHADING. Key light on the same side; highlights as strong and crisp; gradient shading across curved surfaces; shadow side as dark (not black, not flat); exposure (clipped whites, crushed darks); a soft contact shadow under the object with similar darkness and spread (missing, too faint, too hard, too dark, or long shadows streaking sideways that the reference does not have are all defects); glows where the reference glows; any visible render grain or speckle. Ignore the background shade."],
];
const CRITIC_SCHEMA = {
  type: "object", required: ["score", "findings"],
  properties: {
    score: { type: "number" },
    findings: { type: "array", items: { type: "object", required: ["severity", "where", "difference", "fix"],
      properties: { severity: { type: "string", enum: ["critical", "major", "minor"] }, where: { type: "string" },
        difference: { type: "string" }, fix: { type: "string" } } } },
  },
};
const GRADER_SCHEMA = {
  type: "object", required: ["shape", "color", "texture", "detail", "lighting", "worst_differences"],
  properties: { shape: { type: "number" }, color: { type: "number" }, texture: { type: "number" },
    detail: { type: "number" }, lighting: { type: "number" }, worst_differences: { type: "array", items: { type: "string" } } },
};
const BUILD_SCHEMA = {
  type: "object", required: ["kept", "changes", "open", "minutes_left"],
  properties: { kept: { type: "boolean" }, changes: { type: "string" }, open: { type: "string" },
    pack: { type: "array", items: { type: "string" } }, minutes_left: { type: "number" } },
};
const GLOBAL_STEP = (render, out) => `Run: blender -b --factory-startup --python-exit-code 1 -P ${A.skillDir}/scripts/critic_pack.py -- --ref ${A.reference} --render ${render} --out ${out} ; read its GLOBAL CHECKS lines. They are measured (exposure, shadow side, highlights, floor-shadow size and darkness, framing) and outrank any reviewer's impression on those points: fix every line in this round, besides the other fixes (camera distance or margin, light energy or exposure, key size and height, fill, shadow-catcher strength). Product shots on white normally have a short soft shadow under the object; only the key light should cast it (H.studio_lighting already turns shadows off for fill and rim).`;

function images(render, pack) {
  return [`REFERENCE: ${A.reference}`, `RENDER: ${render}`,
    ...(pack || []).map((p, i) => `COMPARISON ${i + 1}: ${p} (blue bar = reference, orange bar = render; under the overview, a strip of each subject's main colours with band width = share, so a missing, extra or shifted colour region shows as a different band; in the details image each cell pairs the same region, reference left)`)].join("\n");
}

async function review(n, pack) {
  const imgs = images(A.render, pack);
  const common = `You are one member of a panel of strict, independent critics. A 3D artist tried to recreate the object in the REFERENCE image as a Blender RENDER. You know nothing about how it was made. Open every image below with read_file and look closely before answering; judge only what is visible. Do not edit any file.\n\n${imgs}\n\nReport precise visual differences, each naming where it is and in which direction the render is wrong. Severity: critical = a different or broken object at first glance, or a whole part missing; major = clearly visible at normal size; minor = visible only when looking for it. Be unforgiving: a toy-like, chunky, matte or simplified look is a defect, not a style. Do not praise and do not invent defects. Score your aspect 1-10 (10 nearly identical; 7-9 minor differences; 6 noticeably different; 5 major differences; 2-4 mostly wrong); a critical finding caps it at 5, a major one at 7.\n\nYour aspect: `;
  // Critics look and report; medium effort keeps a round of eight parallel reviews to a few minutes.
  const reqs = CRITICS.map(([k, focus]) => ({ input: common + focus, schema: CRITIC_SCHEMA, label: `r${n}:${k}`, phase: `Round ${n}: critics`, effort: CRITIC_EFFORT }));
  reqs.push({
    input: `You are a strict visual-similarity grader. Open with read_file: image 1, the REFERENCE object (${A.reference}); image 2, a Blender RENDER that tries to recreate it (${A.render}). Score each aspect 1-10 independently (10 nearly identical, 7-9 clearly matching with minor differences, 6 noticeably different but related, 5 partly matching, 2-4 mostly wrong, 1 nothing recognizable): shape (silhouette, proportions, part layout, viewpoint), color (palette and placement), texture (material feel and finish), detail (small parts present and faithful; missing or invented parts lower it), lighting (direction, softness, highlights, shadow under the object, exposure, grain). Then list the five most visible differences, most important first, each as: where - reference shows X, render shows Y. Be unforgiving: a toy-like, chunky, matte or simplified look is a defect. Do not edit any file.`,
    schema: GRADER_SCHEMA, label: `r${n}:grader`, phase: `Round ${n}: critics`, effort: CRITIC_EFFORT,
  });
  const res = await parallel(reqs);
  const out = { scores: {}, findings: [], grader: null, failed: [] };
  const SEV = { critical: 0, major: 1, minor: 2 };
  res.forEach((r, i) => {
    const key = i < CRITICS.length ? CRITICS[i][0] : "grader";
    if (!r || r.error_kind || !r.data) { out.failed.push(key); return; }
    if (key === "grader") { out.grader = r.data; return; }
    out.scores[key] = r.data.score;
    for (const f of r.data.findings || []) out.findings.push({ critic: key, ...f });
  });
  out.findings.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));
  return out;
}

const history = [];
let pack = (A.pack && A.pack.length) ? A.pack : null;
if (A.task) {
  phase("First build");
  const first = await agent({
    label: "first-build", phase: "First build",
    schema: { type: "object", required: ["render_exists", "minutes_left"], properties: { render_exists: { type: "boolean" }, remarks: { type: "string" }, minutes_left: { type: "number" } } },
    input: `You are the builder. Recreate the object in a reference image as a Blender scene, following the task and the blender skill.
Task requirements (verbatim, they override everything else):
${A.task}

Reference: ${A.reference}. Build script to write: ${A.script}. Rebuild command: ${A.build}. Deliverable render: ${A.render}.
Blender skill: read ${A.skillDir}/SKILL.md sections 0 and 2-5 (helpers, workflow, build rules, materials, camera and light) and ${A.skillDir}/references/object-modeling.md; use the helpers in ${A.skillDir}/scripts/bpy_helpers.py.
1. View the reference, then run: cd ${WORK} && python3 ${A.skillDir}/scripts/critic.py init && blender -b --factory-startup --python-exit-code 1 -P ${A.skillDir}/scripts/zoom.py -- --image ${A.reference} --out ${WORK}/critic/zoom.png --grid 3x2 ; view the zoom image and fill every TODO in ${WORK}/critic/observations.md with checkable facts (orientation and view, frame, parts with relative sizes, member thickness and counts, colour map, material map, light, signature details).
2. Write the build script: true-scale parts, the reference camera view, H.studio_lighting, materials at the reference's gloss level. Use H.set_render and H.render_still(path, background="#FFFFFF") from the helpers. Read the table "Defects self-review misses most" in ${A.skillDir}/references/critic-loop.md first and avoid those defects from the start (sculpted housings built as boxes, merged multi-part forms, sparse repeated details, opaque windows, wrong main colour regions).
3. Run the rebuild command so the deliverable render and .blend exist and meet every task requirement. View the render once and fix anything broken (missing parts, wrong view, black or blank image).
4. ${GLOBAL_STEP(A.render, WORK + "/critic/pack/first")} Rebuild after fixing.
${clockStep}
Return render_exists, short remarks and minutes_left.`,
  });
  if (!first || !first.data || !first.data.render_exists) {
    return { summary: JSON.stringify({ error: "first_build_failed", remarks: first && (first.data ? first.data.remarks : first.text) }) };
  }
  A.observations = A.observations || `${WORK}/critic/observations.md`;
  if (DEADLINE && typeof first.data.minutes_left === "number" && first.data.minutes_left >= 0 && first.data.minutes_left < 12) {
    return { summary: JSON.stringify({ rounds: 0, stop: `time: ${first.data.minutes_left} min left after the first build` }) };
  }
}
for (let n = START; n < START + ROUNDS; n++) {
  phase(`Round ${n}: critics`);
  const r = await review(n, pack);
  const g = r.grader || {};
  const gScores = ["shape", "color", "texture", "detail", "lighting"].map((k) => g[k]).filter((v) => typeof v === "number");
  const majors = r.findings.filter((f) => f.severity !== "minor").length;
  log(`round ${n}: grader ${JSON.stringify(g && { shape: g.shape, color: g.color, texture: g.texture, detail: g.detail, lighting: g.lighting })}; ${majors} critical/major findings`);
  const entry = { round: n, grader: g, critic_scores: r.scores, majors };
  history.push(entry);
  // A reviewer that failed reported nothing, so its silence is not a pass.
  if (r.failed.length) entry.failed = r.failed;
  if (!r.failed.length && gScores.length === 5 && Math.min(...gScores) >= TARGET && majors === 0) { entry.stop = "target reached"; break; }

  phase(`Round ${n}: fix`);
  const rf = `${WORK}/critic/round_${String(n).padStart(2, "0")}.md`;
  const fixer = await agent({
    label: `r${n}:builder`, phase: `Round ${n}: fix`, schema: BUILD_SCHEMA,
    input: `You are the builder in round ${n} of a critic loop that makes a Blender render match a reference image.
Reference: ${A.reference}. Current best render (the deliverable): ${A.render}. Build script: ${A.script}. Rebuild command: ${A.build}. Blender skill (helpers, references): ${A.skillDir}; read ${A.skillDir}/references/critic-loop.md section "Defects self-review misses most" before editing.${A.observations ? ` Observation sheet: ${A.observations}.` : ""}

An independent panel reviewed the current render. Grader scores (1-10): ${JSON.stringify(g)}.
Critic scores: ${JSON.stringify(r.scores)}.
Findings, most severe first:
${r.findings.slice(0, 40).map((f) => `- [${f.severity}] (${f.critic}) ${f.where}: ${f.difference} -> fix: ${f.fix}`).join("\n")}

${clockStep}
Do exactly this:
0. ${GLOBAL_STEP(A.render, PACK(n) + "_pre")}
1. View the reference and the current render with read_file. Size the work to the scores. ${n === 1 ? "This first round also checks the material look once: the reference's gloss level on paint and plastic (satin is not mirror chrome), dark reflective glass, metals with something to reflect, no render noise (H.set_render). " : ""}Any grader or critic score of 5 or less requires a big change this round, not a parameter tweak: rebuild the component behind the worst finding with a different construction (lathe from a measured profile, swept curve, hollow shell, thin members at the measured thickness), or add a batch of at least eight small features the reference shows (seams, panel lines, frames, handles, bolts, hubs, spokes, rams, links, vents, lights), each visible at the output size. While any score is 6 or less, ignore minor findings. Order: viewpoint, silhouette rebuilds, parts and details, colour and material, light.
2. Back up: cp ${A.script} ${A.script}.bak_r${n}; cp ${A.render} ${A.render}.bak_r${n}; and the .blend next to the render if the build writes one.
3. Edit the build script to fix those causes. Keep it rebuildable and keep every task requirement (output paths, resolution, engine, samples, background) unchanged.
4. Run the rebuild command. If it fails, fix the error or restore the backups.
5. View the new render next to the reference and the backup render. Keep it only if the targeted findings are visibly fixed and nothing got visibly worse; otherwise restore the script, render and .blend from the backups (and rebuild if needed so all three agree).
6. Write ${rf}: the findings you chose, what you changed, kept or reverted and why, and the findings still open.
7. Run: ${packCmd(n + 1, A.render)}
Return JSON: kept (boolean), changes (one paragraph), open (the most important findings still open), pack (the two image paths the last command wrote), minutes_left.`,
  });
  const d = (fixer && fixer.data) || {};
  entry.kept = d.kept; entry.changes = d.changes; entry.open = d.open; entry.minutes_left = d.minutes_left;
  pack = (d.pack && d.pack.length) ? d.pack : [`${PACK(n + 1)}_overview.png`, `${PACK(n + 1)}_details.png`];
  if (DEADLINE && typeof d.minutes_left === "number" && d.minutes_left >= 0 && d.minutes_left < 12) {
    entry.stop = `time: ${d.minutes_left} min left`;
    break;
  }
}

const last = history[history.length - 1] || {};
return { summary: JSON.stringify({ rounds: history.length, last_grader: last.grader, history: history.map((h) => ({ round: h.round, grader: h.grader, majors: h.majors, failed: h.failed, kept: h.kept, minutes_left: h.minutes_left, changes: h.changes, open: h.open, stop: h.stop })) }) };
