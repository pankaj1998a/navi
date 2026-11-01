# Single-image scene reconstruction (track guide)

Use this track when a photo, render or painting of a whole **scene** must be matched through its camera: layout, perspective, light and look. For a single object or product on a plain background, [object-modeling.md](object-modeling.md) is usually enough; borrow the camera and review sections below only when the match must be exact. The shared workflow, helpers and finish checklist are in the main SKILL.md.

Goal: an editable, reproducible Blender scene whose render through the solved camera **matches the reference**, plus evidence that it matches and an honest list of what still doesn't.

Core order: **contract → analysis → component decomposition → camera → blockout → light → build components → materials → review loop → finish**. Each phase has a gate. Don't detail a stage whose foundation failed its gate: a wrong camera or wrong light can't be fixed by better leaves.

Scripts are in `../scripts/` (relative to this file). `compare.py` needs numpy inside Blender's Python; distro builds (apt) often lack it. Then compare visually with `read_file`, or with system Python and PIL if available. Run the bpy ones as `blender -b [file.blend] -P script.py -- args`. Detailed references:
- [camera-and-geometry.md](camera-and-geometry.md): camera solve math, scale, depth, projection mapping
- [lighting-and-color.md](lighting-and-color.md): sun from shadows, exposure, white balance, albedo tables
- [representation-guide.md](representation-guide.md): how to build each element type, with budgets
- [construction-patterns.md](construction-patterns.md): reusable profiles, attachment interfaces, repeated forms, mesh batching, material layers and transmissive volumes; read the relevant sections when implementing a component
- [review-protocol.md](review-protocol.md): evidence pack, blind critic, A/B, acceptance gates
- [failure-patterns.md](failure-patterns.md): known failures and fixes

---

## 0. Contract (decide before modeling)

Determine, from the request and the image:

| Decision | Options |
|---|---|
| **Fidelity mode** | **A. Exact view**: one camera, maximum pixel fidelity; 2.5D allowed (projected backgrounds, cards). **B. Editable 3D**: real geometry everywhere it matters, so it survives small camera moves and edits. **C. Look-alike**: same subject, mood and style; layout may differ (a prompt-led generation pipeline with reference-image input fits here, if available). Default to **B** when unspecified. |
| What must match | Composition, geometry, materials, light/time of day, color grade, all of these |
| Deliverables | `scene.py` (self-contained rebuild), `scene.blend`, final render at reference aspect, comparison sheet, `report.md` with metrics and open gaps |
| Constraints | Blender version, render time, polycount/instance budget, external assets allowed or not |
| Animation | If motion is requested, finish the still match first, then add motion (events with onset/peak/end) or switch to blender-scene-reconstruction when available |

Ask the user only when an answer changes the result materially (e.g. mode A vs B). Otherwise choose, state the choice, and proceed.

**Workspace** (one directory per attempt; never overwrite an earlier attempt):
```
recon/<name>/
  reference.<ext>       # copied input, never modified
  analysis.json         # phase 1 output
  camera.json           # phase 2 output (scripts/camera_solve.py)
  scene.py              # from scripts/scene_template.py
  scene.blend
  evidence/round_NN/    # renders + comparison sheets per review round
  reviews.jsonl         # critic verdicts, one per round
  failures.jsonl        # categorized visible failures (for later rounds/runs)
  state.json            # phase, round, accepted incumbent, budget used (resume from here)
  report.md
```

## 1. Analyze the image (output: analysis.json)

Look at the full image and at zoomed crops. **Separate observation from inference.** Record:

1. **Inventory by layer** (foreground / midground / background). For each element: name, role (hero / support / context), normalized bbox `[x0,y0,x1,y1]` (top-left origin), estimated real size, element type (architecture, terrain, rock, vegetation, water, ground cover, prop, sky, people), material notes, and a planned representation (see representation-guide).
2. **Camera evidence**: horizon line position and tilt, vanishing points and which world axis their lines follow, lens feel (wide/normal/tele, distortion), focus plane and depth of field, camera height (eye level? drone? low?). Use EXIF focal length and sensor size if available.
3. **Scale anchors**: doors ~2.0–2.1 m, steps 0.17–0.19 m, adult 1.6–1.8 m, cars ~1.5 m tall / 4.5 m long, bricks 0.065 m tall, lane width 3.5 m, chair seat 0.45 m.
4. **Lighting evidence**: direct sun or overcast; shadow direction (pick 2–3 object/shadow-tip pairs); shadow length vs object height; shadow edge softness; sky color; bounce color; artificial lights; haze or fog.
5. **Look**: contrast, saturation, white balance, grade, grain/noise, vignette, bloom.
6. **Visual contract**: 4–8 concrete, checkable visible requirements, e.g. "arched red bridge spans the pond center at ~45% height", "pond reflects the bridge", "maple canopy fills the top-left third". The critic checks these one by one.
7. **Uncertainties**: hidden surfaces, ambiguous scale, unknown materials, each with the assumption you'll use.

Express important requirements as relationships as well as object names: projected span, silhouette, overlap, negative space, contact and light/dark grouping. Assign stable landmark IDs to a few visible corners, tips or contact points; preserve the same IDs through revisions. Use the landmark conventions in [camera-and-geometry.md](camera-and-geometry.md). A detail inventory is not evidence that these relationships match.

## 1b. Decompose the scene into components (output: `components` in analysis.json)

Decompose at two levels: **elements** are what you see (each bridge, rock, tree, lantern); **components** are how you build, review and repair them. The inventory lists elements; components group them into 3–8 build units that each own their geometry, materials and helpers.

**Procedure**
1. **Start from the inventory.** Every element must end up in exactly one component, or be explicitly dropped as out of scope.
2. **Group elements** that share any of:
   - a generator (all bank rocks, island rocks and stepping stones share one rock generator);
   - a material family;
   - a physical coupling (bridge deck, girders, piers and railings);
   - a placement rule (all ground cover scattered by one density map).
3. **Split** when elements need independent control, review or repair: hero trees vs background woodland; hardscape vs the building. Merge when splitting would break continuity, such as terrain and pond bed in one surface.
4. **Define interfaces.** For each component, record what it produces and what it consumes, for example:
   - terrain produces `ground_z(x, y)` and `pond_sdf(x, y)`;
   - structures produce their footprints, which terrain uses to level pads;
   - presentation consumes the sun direction from the lighting analysis.

   Consumers query these interfaces; they never re-guess heights or positions.
5. **Order by dependency.** Declare layout footprints and attachment frames before building surfaces that depend on them; then build support surfaces, primary forms, attached secondary forms, repeated detail and presentation. Skip roles absent from the reference. Publish actual surface queries and attachment transforms for downstream consumers. Keep presentation last in the builder; establish and verify its lighting parameters earlier at Gate V. Shared mesh and material libraries are helpers, not extra scene components.
6. **Attach to each component:** its representation and budget (representation-guide), the image regions it covers (normalized bboxes, used to map review failures back to it), and its acceptance evidence (which crop or close-up proves it).

**Possible component roles** (choose and rename for the scene; these are not a required inventory):

| Component | Elements | Produces / consumes |
|---|---|---|
| `support_surfaces` | floor, tabletop, ground, sloped base | consumes layout footprints; produces surface position/normal queries |
| `primary_forms` | main object, building shell, furniture, machinery body | consumes support queries; produces silhouettes and attachment frames |
| `secondary_forms` | trim, handles, rails, joints, cables, smaller props | consumes attachment frames and clearances |
| `repeated_forms` | fasteners, tiles, foliage, books, modular panels | consumes placement domains, density and exclusion masks |
| `background` | room shell, distant structures, landforms, planting | provides visible, reflected and shadow-casting context |
| `surface_detail` | wear, deposits, seams, fragments, fine growth | consumes surface coordinates, masks and viewing-distance budgets |
| `transmissive_forms` | liquid or glass and visible contents, when present | consumes container boundaries, interfaces and physical scale |
| `presentation` | environment, lights, atmosphere, cameras, render, compositor | consumes camera and lighting analysis |

**Why it matters later:** blockout places one proxy group per component. Review maps each failure (worst cell or critic region) to the component that owns that region, so a repair rewrites one component, or at most 3 coupled ones. Components that already pass stay untouched, which avoids regressions.

## 2. Solve the camera first (output: camera.json) — Gate C

Use `../scripts/camera_solve.py` (stdlib Python, no Blender needed):

- **2 vanishing points** (best): give line segments that follow two orthogonal world axes. The script recovers focal length, rotation and reprojection residual.
- **1 VP + horizon** or **horizon only**: requires focal length (EXIF, or assume one and verify).
- **No usable lines**: use a true visible horizon if available and choose a focal-length estimate from the lens feel (wide 18–24 mm, normal 35–50 mm, tele 85 mm+). Otherwise fit pose and lens with known-size proxies at multiple depths. A finite water/terrain boundary is not a horizon.
- Camera height and scale come from `--camera-height` or from a ground reference of known length (`--ground-ref`).

Then run `../scripts/setup_reference.py` to create the camera, set the render resolution to the reference aspect, attach the reference as camera background, and add a verification grid and proxy boxes.

**Gate C:** with the reference overlay, the ground grid lines up with ground features, vertical proxies stay vertical where the photo's verticals do, and anchor objects project at the right size (within ~2% of image width). Fix the camera now. Never reshape objects to hide a camera error.

## 3. Blockout (gray proxies) — Gate L

Place simple proxies (boxes, cylinders, displaced planes, low-poly blobs) at real-world scale for every element in the inventory, one proxy group per component (name proxies `<component>_<element>`), seen through the locked camera.

- Use depth cues: occlusion order, size falloff, texture gradient, haze. If a monocular depth model or segmentation masks are available locally, use them for layout and masks; they are optional helpers, not ground truth.
- Lay terrain out as a heightfield function first; place objects *on* it by querying the same function (single source of truth for surface heights).
- Render with `../scripts/render_evidence.py --clay` and compare with `../scripts/compare.py`.

**Gate L:** every hero/support element occupies the right image region (silhouette overlay; bbox error < ~3% of image size); occlusion order is right; nothing has implausible scale.

## 4. Lighting and exposure — Gate V

Read [lighting-and-color.md](lighting-and-color.md).

- Sun: azimuth from shadow direction (transform image directions to the ground plane with the solved camera), elevation from `atan(object height / shadow length)`, angular size from edge softness (0.5° hard; 2–5° hazy). Overcast: no sun; bright sky or HDRI dominant.
- Sky: physical sky (Nishita in 4.x, Single Scattering in 5.x) aligned with the sun; `sun_rotation = atan2(sx, sy)` for a sun direction `(sx, sy, sz)`, where 0 = +Y.
- Check what blocks the light: off-frame trees and hills cast long shadows at low sun (shadow length = h / tan(elevation)).
- Exposure: match the brightness of a neutral or known patch (gray stone, white wall) via `compare.py sample`, using AgX.

**Gate V (clay render):** shadow directions, shadow shapes and the big light/dark structure match the reference. Most of the realism is decided here.

## 5. Build components (scene.py)

Start from `../scripts/scene_template.py`: a self-contained script with `PARAMS`, one `build_<component>(P)` per component, orchestration that resets the scene, creates the camera from `PARAMS["shot"]`, runs components in dependency order, tags object ownership, and runs `presentation` last. Rules:

- Native bpy/bmesh/mathutils/numpy and Geometry Nodes only, unless the user allows assets. Deterministic `random.Random(seed)`. SI units.
- Each component creates its own geometry, materials and helpers and never edits another component's objects. Derive shared interfaces (surface heights, attachment points, footprints) from the geometry actually built.
- Pick the representation per element from [representation-guide.md](representation-guide.md): hero objects get real geometry; distant backgrounds may use cards or projection (mode A); vegetation uses generators with instancing; ground cover is scattered with density highest near the camera.
- Respect budgets (see guide). More instances don't fix a bad silhouette.
- Keep tunables in `P` (≤ ~25 keys per component); setting an unused key does nothing.
- Separate controls for layout, silhouette, structure and surface detail. Coupled pieces should derive from one profile or attachment frame, so changing a span or curvature also updates supports, trim and repeated elements. See [construction-patterns.md](construction-patterns.md).
- Use instancing for repeated source meshes; use mesh batches for unique small geometry when appropriate. Preserve per-part coordinates and variation when combining meshes. Neither technique substitutes for a correct projected silhouette.

## 6. Materials

- Sample reference colors with `compare.py sample` in lit and shadowed regions. Convert sRGB to linear and divide out the light: a sunlit surface's pixel value is brighter than its albedo. Sanity-check against the albedo table.
- Read roughness from highlights and reflections; read scale from texture features (bricks, leaves, gravel size).
- Every natural surface needs variation at 3 scales (large patches, medium mottling, fine grain) plus wear: dirt in crevices, moss on up-facing surfaces, wet bands at waterlines. Uniform surfaces are the strongest CG tell.
- Check materials in a close-up render too, not only in the wide shot.
- Diagnose shape, pigment, roughness, surface normals and transmission separately. For reflective or transparent elements, include the scene they reflect or reveal in the diagnosis; a shader change alone may not fix the mismatch. Construction and material examples are in [construction-patterns.md](construction-patterns.md).

## 7. Review loop (the core) — see review-protocol.md

Each round:

1. **Render evidence** (`render_evidence.py`): hero at reference aspect (preview: ~960 px wide, 64–128 spp), clay pass when light or geometry changed, 1–3 close-ups of problem areas.
2. **Compare** (`compare.py`): sheet with reference | render | 50% overlay | edge overlay | difference heatmap, plus `metrics.json` (windowed SSIM, edge IoU, region-grid luminance/chroma deltas, worst cells).
3. **Blind critique**: spawn an independent subagent (Agent tool) that receives **only** the reference, the evidence images and the visual contract. It gets no code, no edit intent, no metrics verdicts, no earlier acceptance. It scores the 6 dimensions 0–4 and lists categorized failures with visible evidence (prompt template in review-protocol.md).
4. **Map each failure to its owning component** (by image region, using the component bboxes from 1b), then **choose one causal repair** for the highest-impact failure, in this order: camera/layout → silhouettes/missing content → light and values → color/materials → detail → post.
5. **A/B gate**: candidate vs incumbent judged blind **in both image orders**. If the two orders disagree, the result is inconclusive. Keep the candidate only if it wins or is equal with strictly better metrics and no new major failure. Otherwise revert (keep the useful sub-change as notes).
6. **Log** to `reviews.jsonl` / `failures.jsonl`; update `state.json`.

Policies:
- After **two rejected attempts on the same defect**, change approach (different representation, rewrite the component, or fix the shared interface) or move to another failure first.
- When a defect couples geometry, material and light across components, repair up to 3 components together and judge them as one candidate.
- Metrics are advisory. A higher SSIM never overrules a visible major failure, and exposure averages are not the target.
- Bounded budget (default 8–12 rounds). **Running out of budget is not success**: report unresolved failures.

**Acceptance:** Gates C/L/V passed; every visual-contract item visibly satisfied; blind critic scores ≥ 3 on all dimensions with no major/critical failure; a final full-resolution check plus close-ups shows no new defect.

## 8. Finish

- Final render: Cycles, AgX, adaptive sampling with denoising, reference resolution (or the requested size). Spread across multiple GPUs if available.
- Match the camera look: depth of field (focus distance, f-stop from the blur gradient), mild lens distortion, chromatic aberration only if visible, vignette, grain or noise at the reference level, grade. Keep these subtle; heavy dispersion smears frame edges.
- Rebuild check: `blender -b --factory-startup -P scene.py -- --output scene.blend` reproduces the scene in a fresh process.
- Reopen the saved file separately, verify required dependencies, and inspect geometry appropriate to the deliverable. Report these technical checks separately from Gates C/L/V and the visual verdict; see [review-protocol.md](review-protocol.md).
- `report.md`: final sheet, metrics, per-contract-item status, critic verdict, assumptions, and an **open gaps** list stated plainly.

## Pitfalls (short list; full table in failure-patterns.md)

- Detailing before the camera or light is right. Off-frame occluders shading the whole scene.
- Judging your own work with knowledge of your intent; one-frame judgments; preview resolution hiding defects.
- Pale, uniform, smooth surfaces (soap rocks, plastic moss); fallen leaves standing up; plants made of wide overlapping cards.
- Floating objects on slopes (query the terrain function; extend footings below ground or level a pad).
- Grain or texture running the wrong way on merged meshes (store a per-part grain coordinate).
- Over-strong haze, lens dispersion or bloom passed off as "atmosphere".
- Bright sky behind the subject washing out its silhouette. Ignoring background planting that reads as a park instead of the intended place.
