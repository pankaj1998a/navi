// One blind critic round for a render that must match a reference image (blender skill,
// references/critic-loop.md). Each reviewer is a fresh child that sees only the images, so no checklist
// can be skipped and none knows what the builder intended.
//
// args: { reference: abs path, render: abs path, pack: [abs png paths] (optional),
//         observations: abs path to critic/observations.md (optional) }

let A = args || {};
if (typeof A === "string") {
  try { A = JSON.parse(A); } catch (e) { A = {}; }
}
if (!A.reference || !A.render) {
  return { summary: JSON.stringify({ error: "args.reference and args.render are required" }) };
}

const images = [
  `REFERENCE: ${A.reference}`,
  `RENDER: ${A.render}`,
  ...(A.pack || []).map((p, i) => `COMPARISON ${i + 1}: ${p} (blue bar = reference, orange bar = render; under the overview, a strip of each subject's main colours, band width = share; the details image pairs matching cells, reference left)`),
].join("\n");

const COMMON = `You are one member of a panel of strict, independent art critics. A 3D artist tried to recreate the object in the REFERENCE image as a Blender RENDER. You know nothing about how it was made. Open every image below with the read_file tool and look at it before answering; judge only what is visible.

${images}

Report findings as precise visual differences, each naming where it is and in which direction the render is wrong, for example "boom arm: reference bends down near the tip, render is straight". Severity: critical = a viewer would see a different or broken object at first glance, or a whole part is missing; major = clearly visible at normal size; minor = visible only when looking for it. Do not invent defects you cannot see, and do not praise. Be unforgiving: a toy-like, chunky, matte or simplified look is a defect, not a style; arms, legs, frames and rods drawn thicker than in the reference are a shape defect. Do not edit any file.

Score your aspect 1-10: 10 nearly identical; 7-9 clearly matching, minor differences; 6 noticeably different but related; 5 partly matching, major differences; 2-4 mostly wrong; 1 missing. A critical finding caps the score at 5, a major one at 7.

Your aspect:`;

// Three reviewers, each carrying the full checklists of the critics it merges (SKILL.md section 1a step D),
// plus the grader: four parallel children per round instead of eight keeps a busy deployment usable.
const CRITICS = [
  ["form", "Three aspects, each checked separately and named in every finding's `where`: (1) VIEWPOINT AND FRAMING. Does the object face the same way (which end points to image-left or image-right)? Are the same faces visible in the same proportions (front versus side)? Same camera height (amount of top surface visible, flatness of ellipses on round parts)? Same perspective strength? Does the object fill the same fraction of the frame at the same position? A mirrored or wrongly rotated view is critical. (2) SILHOUETTE AND PROPORTIONS. Ignore colour and material. Compare the outlines: overall width-to-height ratio, the relative size and position of each major part, every bump, notch, overhang, taper and curve along the outline, open gaps and holes (negative space), and the thickness of thin members. Walk the reference outline all the way round and name each place the render departs from it. (3) CONSTRUCTION AND RENDER INTEGRITY. Floating parts, visible gaps where parts should touch, parts pushing through each other, faceted curves, black faces or streaks, render noise or fireflies, parts cut off by the frame, obviously low-poly or blobby shapes, missing undersides or back faces visible from this camera."],
  ["parts", "PART INVENTORY AND DETAIL. Using the comparison details image if given, go cell by cell: list each part visible in the reference and say whether the render has it right, wrong (shape, size, position or count), or missing. Then list parts the render has that the reference does not (invented parts are defects). Check counts of repeated parts (wheels, windows, keys, spokes, slats, blades, legs) and the small recognizable features (handles, buttons, dials, vents, seams, rivets, hinges, cables, mirrors)."],
  ["surface", "Three aspects, each checked separately and named in every finding's `where`: (1) COLOUR. For each part, compare the colour as it appears: hue (redder, more orange, greener, bluer), lightness and saturation; name the direction of each error. Check that stripes, two-tone borders, trim and accents run in the same places, and that each colour covers a similar share of the object. Ignore shape and material. (2) MATERIAL AND SURFACE FINISH. For each part, does the surface read as the same material: mirror chrome, brushed or matte metal, glossy or matte paint, plastic, clear or tinted glass, rubber, wood with grain, fabric, leather, ceramic? Look at reflections, highlight sharpness and shape, and surface texture. Flag the uniform 'CG plastic' or clay look, glass that reads as a flat light-grey pane, crushed black or blown white surfaces, and visible grain. Ignore hue and shape. (3) LIGHT AND SHADING. Same side for the key light and the brightest highlights? Shadow side as dark as in the reference (not black, not flat)? Overall exposure: clipped whites or crushed darks? A soft contact shadow under the object with similar darkness and spread? Highlights on curved surfaces in similar places? Glowing parts where the reference glows? Any visible render grain or speckle on surfaces or in the floor shadow? Ignore the background shade."],
];

const CRITIC_SCHEMA = {
  type: "object",
  required: ["score", "findings", "checked"],
  properties: {
    score: { type: "number" },
    checked: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "where", "difference", "fix"],
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          where: { type: "string" },
          difference: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};

const GRADER_SCHEMA = {
  type: "object",
  required: ["shape", "color", "texture", "detail", "lighting", "worst_differences"],
  properties: {
    shape: { type: "number" }, color: { type: "number" }, texture: { type: "number" },
    detail: { type: "number" }, lighting: { type: "number" },
    worst_differences: { type: "array", items: { type: "string" } },
  },
};

phase("Blind critics");
const requests = CRITICS.map(([key, focus]) => ({
  input: `${COMMON} ${focus}`,
  schema: CRITIC_SCHEMA,
  effort: "medium",
  label: `critic:${key}`,
  phase: "Blind critics",
}));
requests.push({
  input: `You are a strict visual-similarity grader. Open these two images with read_file: image 1 is the REFERENCE object (${A.reference}), image 2 is a Blender RENDER that tries to recreate it (${A.render}). Score each aspect 1-10 independently (10 nearly identical, 7-9 clearly matching with minor differences, 6 noticeably different but related, 5 partly matching, 2-4 mostly wrong, 1 nothing recognizable): shape (silhouette, proportions, part layout, camera viewpoint), color (palette and where each colour is), texture (material feel and surface finish), detail (small parts present and faithful; missing or invented parts lower it), lighting (light direction, softness, highlights, shadow under the object, exposure). Then list the five most visible differences, most important first, each as: where - reference shows X, render shows Y. Be unforgiving: a toy-like, chunky, matte or simplified look is a defect, not a style. Judge only what you see.`,
  schema: GRADER_SCHEMA,
  effort: "medium",
  label: "grader",
  phase: "Blind critics",
});

const results = await parallel(requests);
const SEV = { critical: 0, major: 1, minor: 2 };
const report = { scores: {}, grader: null, findings: [], failed: [] };
results.forEach((r, i) => {
  const key = i < CRITICS.length ? CRITICS[i][0] : "grader";
  if (!r || r.error_kind || !r.data) {
    report.failed.push(key);
    return;
  }
  if (key === "grader") {
    report.grader = r.data;
    return;
  }
  report.scores[key] = r.data.score;
  for (const f of r.data.findings || []) report.findings.push({ critic: key, ...f });
});
report.findings.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));
if (report.grader) {
  const g = report.grader;
  report.grader_mean = (g.shape + g.color + g.texture + g.detail + g.lighting) / 5;
}
log(`critic scores ${JSON.stringify(report.scores)}; grader mean ${report.grader_mean}`);
return { summary: JSON.stringify(report) };
