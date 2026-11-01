# Review protocol: evidence, blind critique, A/B gate, acceptance

Adapted from the evaluated source's review discipline (independent critic, both-order A/B, regression rejection, bounded budget, honest non-acceptance) and extended for single-image matching.

## Evidence pack per round
Stored in `evidence/round_NN/`:
1. `hero.png`: render through the reference camera at the reference aspect.
2. `clay.png`: when geometry or light changed (gray override; checks shadow shapes and value structure).
3. `sheet.png` + `metrics.json` from `compare.py compare` (reference | render | overlay / edges | ΔE heat | worst cells).
4. 1–3 close-ups (extra cameras) of hero elements or the worst cells, at least once at full resolution before acceptance. Preview resolution hides defects (smooth soap-like rocks, plastic leaves, floating footings).

Keep the reference's aspect and a fixed crop convention. For each candidate, record the source/parameter hash, camera settings, render settings and resource versions so the images can be traced to the actual scene. Preserve the incumbent's source or parameter snapshot as well as its render; a thumbnail alone is not enough to restore a rejected edit.

Use complementary evidence for distinct questions:

| Evidence | What it establishes |
|---|---|
| Hero/reference overlay and landmarks | Framing, projected size, silhouette and overlap |
| Clay render under reference lighting | Shadow structure, form and broad values for Gate V |
| Authored-material close-up | Grain direction, roughness, normal detail, openings and contact |
| Alternate view or neutral studio diagnostic | Support, thickness, intersections and hidden construction |
| Fresh reopen and dependency/geometry inspection | Technical portability and mesh validity |

An alternate view does not substitute for the reference-camera match. A studio-light pass does not count as a matched-lighting clay pass. If an opaque clay override hides something behind glass or replaces cutouts, document that limitation and include the material view.

## Blind critic (independent subagent)
Spawn a fresh subagent (Agent tool, general-purpose) for every absolute review. Give it **only**: the reference image path, the evidence image paths, the visual contract, and the prompt below. Never give it source code, edit intent, previous verdicts, metrics thresholds, or what you think improved. It must Read the images itself.

When the agent API supports history controls, disable conversation-history inheritance for this review. Use neutral image labels; names such as `fixed_final_better.png` reveal the editor's preference. The critic reviews visible evidence, while the editor retains the implementation context needed for repair.

Prompt template:
```
You are an independent art director judging whether a 3D render reconstructs a reference image.
Images: REFERENCE = <path>. RENDER = <path>. Also: <sheet path> (row 1: reference | render | 50% overlay;
row 2: edges cyan=reference magenta=render | color-difference heat | worst-matching cells), <clay path>, <close-ups>.
You know nothing about how the render was made. Judge only what is visible.

Visual contract (each item must be visibly satisfied):
1. ...
2. ...

Score 0-4 (0 absent/broken, 1 severe failure, 2 recognizable but obvious defects, 3 convincing with only minor defects,
4 indistinguishable at a glance). Be strict about 3.
- camera_layout: framing, horizon, perspective, positions and sizes of elements match
- silhouette_geometry: shapes, proportions, structure, plausible scale, ground contact (no floating or sinking)
- lighting_values: light direction, shadow shapes, light/dark structure, exposure, contrast
- color_materials: hues, saturation, material identity and response (roughness, translucency, wetness), variation
- detail_texture: appropriate fine detail at viewing distance, no repeated/tiling patterns, no CG uniformity
- realism_style: overall believability in the reference's style; no CG giveaways

Return STRICT JSON:
{"accepted": false,
 "scores": {"camera_layout":0,"silhouette_geometry":0,"lighting_values":0,"color_materials":0,"detail_texture":0,"realism_style":0},
 "contract": [{"item": 1, "satisfied": false, "evidence": "..."}],
 "strengths": ["..."],
 "failures": [{"category": "camera|layout|missing_content|geometry|scale|contact|lighting|exposure|color|material|texture|vegetation|water|atmosphere|post|composition",
               "severity": "minor|major|critical", "region": "where in the image",
               "evidence": "specific visible defect", "repair": "general causal correction"}]}
accepted=true only if every score >= 3, every contract item is satisfied, and there is no major/critical failure.
Do not invent defects you cannot see; say when something is ambiguous.
```

## A/B comparison (candidate vs incumbent)
- Another blind subagent gets the reference plus two renders labelled only "A" and "B" and answers: which is closer to the reference overall and per dimension, with evidence. Run it **twice with A/B swapped**.
- Same winner both times → that's the result. Disagreement → inconclusive (tie).
- Keep the candidate if it wins; or on a tie, keep it only if its absolute review has no dimension regression, no new major failure, the targeted failure is visibly fixed, and supporting metrics strictly improve. Otherwise revert to the incumbent and record the rejected attempt, keeping useful sub-changes as notes for the next attempt.

## Repair policy
1. Fix in impact order: camera/layout → missing content and silhouettes → light and values → color/materials → detail → post.
2. **One causal repair per step**, or one coupled transaction of up to 3 components when geometry, material and light depend on each other.
3. Diagnose from visible evidence first; separate the observation ("rocks read as pale soap") from the presumed cause ("albedo too high, no micro-detail").
4. After 2 rejected attempts on the same defect: change representation, rewrite the component, or fix the shared interface; or work on another failure first.
5. If a concrete code or API defect is found, land the smallest fix alone before combining it with aesthetic changes.
6. Don't game metrics: no hiding a failing element behind foreground, removing contract items, or blurring/darkening to raise SSIM.

Before editing, write a compact causal hypothesis: **visible symptom → likely cause → owning component(s) → parameter change → expected evidence**. For example, an oversized reflected highlight may come from surface curvature, roughness or the reflected source; test the relevant control instead of changing all three at once. If a repair changes a shared interface, inspect its consumers too. Keep unrelated seeds and settings fixed so a new random arrangement does not confound the comparison.

## Gates and acceptance
| Gate | Pass condition |
|---|---|
| C (camera) | Grid and proxies align: anchor size error < ~2% of image width, verticals and horizon match |
| L (layout) | Every hero/support element in the right region (bbox error < ~3%), correct occlusion order |
| V (values) | Clay render: shadow directions and shapes, big light/dark masses match |
| Final | Critic accepted (all ≥ 3, contract satisfied, no major failure) **and** full-resolution check + close-ups clean |

Metrics are supporting evidence (useful ranges at preview size, not hard targets): exposure difference within ±0.3 stops, mean ΔE trending down, edge IoU up. SSIM against a real photo often stays modest (roughly 0.4–0.7) even for good reconstructions, because procedural detail never matches pixel-for-pixel; use its **trend** and the worst cells to find problems.

## Logging
- `reviews.jsonl`: `{"round": n, "candidate": "desc", "verdict": {...critic json...}, "ab": {"order1": "A", "order2": "B", "result": "tie"}, "kept": false}`
- `failures.jsonl`: one line per failure with category, severity, region, evidence, round, status (open/fixed/regressed).
- `state.json`: phase, round, incumbent render path and scene hash, budget used, open failures.
- A failed final review stays attached to that scene version (hash of scene.py + render settings). Re-reviewing an unchanged scene can't clear it.

## Budget and honesty
Default 8–12 rounds. When the budget runs out, deliver the incumbent with `accepted: false`, the open failures and the reasons. Running out of budget is not success.

## Technical handoff is a separate verdict

After the visual review, verify the deliverable in fresh processes:

1. Rebuild from the documented entry point and recorded parameters. Resolve bundled resources relative to the project, and record the Blender version and actual render backend.
2. Reopen the saved `.blend` independently. Check required objects/cameras, packed or supplied image dependencies, and the active render output. A render completed before saving does not prove the saved scene is portable.
3. Inspect evaluated geometry where it affects the handoff: finite coordinates, valid indices, nondegenerate faces, material assignments, and unexpected isolated or zero-length elements. Record evaluated mesh cost separately from object count.
4. Interpret open boundaries by representation and deliverable. Thin leaves, strips and ground surfaces can intentionally be open; a refractive volume or printable solid needs the appropriate closed boundary. Do not force every scene component through the same watertightness rule.
5. Save the final hero and required close-ups from the delivered state. If geometry, materials, camera or light changed after acceptance, rerun the affected visual checks.

Keep technical results and fidelity results separate in the report/state. For example:

```json
{
  "technical": {"rebuild": "pending", "reopen": "pending", "dependencies": "pending", "geometry": "pending"},
  "fidelity": {"camera_gate": "pending", "layout_gate": "pending", "lighting_gate": "pending", "critic_accepted": null},
  "open_gaps": []
}
```

Replace `pending` only with a performed check's result. Report inferred dimensions, unseen surfaces and material approximations plainly. A technically valid scene can still fail image fidelity, and an attractive hero render can still have broken dependencies or unsupported geometry.
