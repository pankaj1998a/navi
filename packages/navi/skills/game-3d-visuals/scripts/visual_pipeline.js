// The whole visual pipeline as one fixed Workflow (host API v1), so the steps run in a fixed order:
//   PRD   : an author writes the PRD; when maxReviewRounds > 0, an independent reviewer who did not write it
//           checks it against every reference and an editor applies the gaps, for up to that many rounds.
//   build : a builder implements the PRD, blockout gate first, and keeps the best output in bestDir.
//   accept: each round two independent reviewers who see only the reference(s) and the output record measured
//           differences; unless both accept, a fixer writes them into the PRD as "Polish round N", fixes the
//           source, rebuilds, and keeps the better of new and best in the output path.
// Children return only small results; details travel through files under visual-plan/reviews/, because large
// child results are not delivered inline. Planning and review children run at effort "high" and are told to stay
// short, so the builder and fixers (which inherit the parent's effort) get most of the time; the builder writes a
// complete rough output first, so a deliverable exists early.
//
// Run it as shipped (do not copy or edit): call the `workflow` tool with
//   scriptPath: "<skill dir>/scripts/visual_pipeline.js", expectedScriptHash: the sha256 given in SKILL.md
//   arguments: {
//     request: "<the user's request, verbatim>",
//     references: ["visual-plan/refs/hero.png", ...],
//     output: "/app/render.png",            // deliverable image (a screenshot for games)
//     deliverables: ["/app/render.png", "/app/scene.blend"],  // every file the task requires (default [output])
//     source: "/app/build_scene.py",         // the one source file that rebuilds the output
//     build: "blender -b --python /app/build_scene.py",   // rebuilds and writes `output`
//     skillDir: "<skill dir>",
//     measure: "blender -b --factory-startup --python <skill dir>/scripts/tone_compare.py -- visual-plan/refs/hero.png /app/render.png",  // optional
//     stages: ["prd", "build", "accept"],    // optional; e.g. ["accept"] to run more polish rounds later
//     maxReviewRounds: 0, maxRounds: 1   // defaults; more review or acceptance rounds cost a lot of time
//   }
export default async function workflow(host) {
  // Models often send args as a JSON-encoded string; without this every child ran with empty paths.
  let a = host.args;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch (e) { a = {}; } }
  if (!a || typeof a !== "object" || Array.isArray(a)) a = {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const missing = ["request", "output", "source", "build", "skillDir"].filter((k) => !a[k]);
  if (missing.length) {
    return { status: "invalid_arguments", text: `pass args as a JSON object; missing: ${missing.join(", ")}` };
  }
  const refs = list(a.references).join(", ");
  const prd = a.prdPath || "visual-plan/PRD.md";
  const best = a.bestDir || "visual-plan/best";
  const files = (list(a.deliverables).length ? list(a.deliverables) : [a.output]).join(", ");
  const reviews = "visual-plan/reviews";
  const stages = a.stages || ["prd", "build", "accept"];
  const request = JSON.stringify(a.request || "");
  const report = { status: "ok", prd: null, build: null, accept: [] };
  const data = (r) => (!r.error_kind && r.data && typeof r.data === "object" ? r.data : null);
  const small = "Return only the small JSON result asked for; put all details in the file.";

  if (stages.includes("prd")) {
    host.phase("PRD");
    const author = await host.agent({
      label: "PRD author",
      effort: "high",
      input:
        `Write the visual PRD for this request: ${request}\nView every reference image with read_file first: ${refs}. ` +
        `Follow ${a.skillDir}/references/prd-template.md (the 8 sections; do not add Review or Polish sections). ` +
        `Use numbers, ratios, hex colors, counts and positions; measure proportions and sample colors from the ` +
        `images instead of guessing. Every acceptance criterion must be checkable in a render and name its ` +
        `reference. Write ${prd} in one pass (about 10 tool calls). ${small} Return { written, criteria }.`,
      schema: { type: "object", required: ["written", "criteria"], properties: { written: { type: "boolean" }, criteria: { type: "number" } } },
    });
    if (author.error_kind) return { ...report, status: "failed", step: "PRD author", error: author.error_kind };
    report.prd = { criteria: data(author) ? data(author).criteria : null, review: [] };
    const reviewRounds = Number.isInteger(a.maxReviewRounds) ? Math.max(0, Math.min(3, a.maxReviewRounds)) : 0;
    for (let round = 1; round <= reviewRounds; round++) {
      const file = `${reviews}/prd-review-${round}.md`;
      const review = await host.agent({
        label: `PRD reviewer ${round}`,
        effort: "high",
        input:
          `Independent PRD review; you did not write ${prd} and must not edit it. View every reference image ` +
          `with read_file (${refs}), including zoomed crops of dense areas, then read ${prd}. Walk each reference ` +
          `in a 3x3 grid and list everything visible that the PRD omits, gets wrong, or states without numbers: ` +
          `missing parts, wrong counts, proportions (measure pixel bounding boxes), colors, materials, edge ` +
          `treatment, ground shadow, background, camera/framing; also criteria that cannot be checked in a render. ` +
          `Write the gaps to ${file}, one per line as "- <what is wrong> -> <exact fix>"; keep the review to about 15 ` +
          `tool calls and the material gaps only. ${small} Return { gaps } ` +
          `as the number of gaps (0 only if nothing material is missing).`,
        schema: { type: "object", required: ["gaps"], properties: { gaps: { type: "number" } } },
      });
      if (review.error_kind) { report.prd.review.push({ round, status: `reviewer failed: ${review.error_kind}` }); break; }
      const gaps = data(review) ? data(review).gaps : null;
      const entry = { round, gaps };
      report.prd.review.push(entry);
      if (gaps === 0) break;
      const edit = await host.agent({
        label: `PRD editor ${round}`,
        effort: "high",
        input:
          `Read the review gaps in ${file} and apply every one of them to ${prd} with exact numbers (edit the ` +
          `body, add missing criteria). Then append or extend a "## Review" section in ${prd} listing what changed ` +
          `in round ${round}, in a few edits. ${small} Return { applied } as the number of gaps applied.`,
        schema: { type: "object", required: ["applied"], properties: { applied: { type: "number" } } },
      });
      entry.applied = edit.error_kind ? `failed: ${edit.error_kind}` : (data(edit) ? data(edit).applied : "unknown");
    }
  }

  if (stages.includes("build")) {
    host.phase("Build");
    const built = await host.agent({
      label: "builder",
      input:
        `Build the deliverable for this request: ${request}\nRead ${prd} and view the references (${refs}). Follow ` +
        `${a.skillDir}/references/process.md section 4. First, within your first few steps, write ${a.source} as one ` +
        `reproducible source that already produces a complete rough version (every major part, the final camera, ` +
        `light and background), rebuild with \`${a.build}\` so that it writes every deliverable (${files}), and copy ` +
        `those files and ${a.source} into ${best}/ so a complete deliverable exists. Then refine it: blockout ` +
        `gate first (camera and framing, silhouette and proportions, big-mass values and colors, background must ` +
        `match the hero before any detail); for a single subject on white use ${a.skillDir}/references/studio-look.md; ` +
        `then secondary parts, materials and details in the PRD's work-breakdown order. Rebuild with \`${a.build}\` ` +
        `and view ${a.output} after each major step. ${a.measure ? `Check framing and tone with \`${a.measure}\`. ` : ""}` +
        `When every PRD part is present, make sure the rebuild wrote every deliverable (${files}) and copy them and ` +
        `${a.source} into ${best}/. Return { complete }.`,
      schema: { type: "object", required: ["complete"], properties: { complete: { type: "boolean" } } },
    });
    report.build = built.error_kind ? { error: built.error_kind } : (data(built) || { complete: "unknown" });
    if (built.error_kind) return { ...report, status: "failed", step: "builder" };
  }

  if (stages.includes("accept")) {
    host.phase("Acceptance");
    const verdictSchema = {
      type: "object",
      required: ["accept", "major", "moderate"],
      properties: { accept: { type: "boolean" }, major: { type: "number" }, moderate: { type: "number" } },
    };
    const reviewer = (round, name, focus) => ({
      label: `${name} reviewer r${round}`,
      effort: "high",
      input:
        `Independent visual review, round ${round}. You did not build this; do not read or edit code. ` +
        `${a.measure ? `First run \`${a.measure}\` with bash and use its numbers. ` : ""}View the reference(s) ${refs} ` +
        `and the output ${a.output} with read_file at full size and compare them for: ${focus}. Write every visible ` +
        `difference to ${reviews}/accept-r${round}-${name}.md, one per line as "- [major|moderate|minor] <difference ` +
        `as a measurement> -> <target>" (e.g. "lens barrel 15% too short", "body #5A5A5A -> #1A1A1A"). accept is ` +
        `true only if no major or moderate difference remains. ${small} Return { accept, major, moderate } with the counts.`,
      schema: verdictSchema,
    });
    const acceptRounds = Number.isInteger(a.maxRounds) ? Math.max(1, Math.min(6, a.maxRounds)) : 1;
    for (let round = 1; round <= acceptRounds; round++) {
      const results = await host.parallel([
        reviewer(round, "shape", "camera angle and framing, silhouette, proportions, missing or extra parts, part counts"),
        reviewer(round, "look", "colors and values of each part, materials (roughness, metal, gloss), lighting, shadows, background"),
      ]);
      const ok = results.filter((r) => !r.error_kind);
      if (ok.length === 0) { report.accept.push({ round, status: "reviewers failed" }); break; }
      const verdicts = ok.map(data).filter(Boolean);
      const major = verdicts.reduce((n, v) => n + (v.major || 0), 0);
      const moderate = verdicts.reduce((n, v) => n + (v.moderate || 0), 0);
      const accepted = verdicts.length === results.length && verdicts.every((v) => v.accept === true) && major + moderate === 0;
      const entry = { round, major, moderate, accepted };
      report.accept.push(entry);
      if (accepted) break;
      const fix = await host.agent({
        label: `fixer r${round}`,
        input:
          `Polish round ${round}. 1) Read ${reviews}/accept-r${round}-shape.md and ${reviews}/accept-r${round}-look.md. ` +
          `2) Append "## Polish round ${round}" to ${prd} listing the major and moderate differences, highest impact ` +
          `first (framing/silhouette/missing parts, then color/material, then lighting/shadow/background, then detail), ` +
          `with the code part that owns each. 3) Fix them in ${a.source} in one batch. 4) Rebuild with \`${a.build}\` ` +
          `so it writes every deliverable (${files}). 5) View ${a.output} and the reference with read_file. If the new ` +
          `output is better overall than ${best}/, copy the deliverables and the source into ${best}/; otherwise restore ` +
          `all of them from ${best}/, so the deliverables always hold the best complete version. ${small} Return { improved }.`,
        schema: { type: "object", required: ["improved"], properties: { improved: { type: "boolean" } } },
      });
      entry.improved = fix.error_kind ? `failed: ${fix.error_kind}` : (data(fix) ? data(fix).improved : "unknown");
      if (fix.error_kind) break;
    }
  }
  return report;
}
