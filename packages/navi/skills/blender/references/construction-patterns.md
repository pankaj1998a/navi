# Procedural construction patterns

Use these patterns when an element's shape or repetition can be expressed reliably in code. Select the relevant sections; they do not prescribe a scene inventory, architectural style, plant species or fixed settings. A reusable generator serves the visual contract established through Gates C/L/V.

Contents:
- [Representation decisions](#representation-decisions)
- [Surface and attachment interfaces](#surface-and-attachment-interfaces)
- [Profiles, sweeps and layered structures](#profiles-sweeps-and-layered-structures)
- [Repeated and organic forms](#repeated-and-organic-forms)
- [Mesh batching and instancing](#mesh-batching-and-instancing)
- [Material construction](#material-construction)
- [Transparent and reflective volumes](#transparent-and-reflective-volumes)
- [Determinism and practical budgets](#determinism-and-practical-budgets)

## Representation decisions

Decide from what a feature contributes in the target view and permitted camera moves:

| Visible contribution | Useful representation |
|---|---|
| Outer contour, thickness, parallax or ground contact | Mesh geometry with a controlled silhouette |
| Opening that reveals another surface or lets light through | Real separation, opening or cutout geometry |
| Repeated contour, such as slats, needles, bolts or tiles | Instances of a small library; unique variation can use batched geometry |
| Fine grain, veins, pits or scratches inside a stable silhouette | Texture, bump or normal variation at the right scale |
| Broad surface staining or weathering | Low-frequency material masks, separate from illumination |
| Visible reflection, cast shadow or refracted background | Enough surrounding scene geometry to produce that effect |
| Unseen construction | Plausible continuation sufficient for shadows, reflections and allowed edits |

Keep two review distances: the intended image size for composition and a close-up for construction defects. Do not exaggerate a subpixel feature merely to make it visible in a preview. Improve shape first when a detailed object still occupies the wrong image region.

## Surface and attachment interfaces

Choose an interface that matches the geometry:

- A heightfield can publish `ground_z(x, y)` and a normal derived from its gradient. Use the same function to create the mesh and place objects. After sculpting or displacing the mesh, either update the function or query the evaluated surface.
- Curved shells, vertical walls, overhangs and layered floors need a surface query returning a position, normal and component ID, typically from mesh sampling or a ray/BVH query. A single Z height cannot represent these surfaces.
- A structural component can publish an attachment frame: position plus tangent/normal axes, along with a footprint, opening or clearance. Consumers should use that frame instead of copying coordinate literals.
- Layout footprints that affect a floor pad, foundation or support surface belong in shared planning data before those surfaces are built. Later builders publish the resulting attachment frames. This avoids a dependency cycle in which each component waits for the other to supply a height.

For a carved surface, combine broad terms first: base plane/slope, mounds, basin or recess, flat pads and path regions. Blend transitions smoothly, then add restrained irregularity. Keep the support/contact geometry coherent when adding fine displacement.

A useful narrow-channel representation is two boundary functions, `left(y)` and `right(y)`. The quantity `min(x-left(y), right(y)-x)` is positive inside the channel and can drive a bed transition or exclusion mask; it is not an exact Euclidean signed distance. For arbitrary boundaries, use a mesh/curve distance query or an actual SDF instead. Sample rocks, clutter or vegetation from these shared domains rather than independently reconstructing the boundary in each generator.

Check contact at multiple points across an object's footprint. A base placed at the center's surface height can still float on a slope. Level a support pad, adjust footings or sample the actual contact surface. Details attached to a rock or piece of furniture should query that object, not the ground beneath it.

## Profiles, sweeps and layered structures

### A shared curve for coupled parts

Arches, curved decks, rails, trim and repeated supports can share one profile. For a shallow parabolic profile:

```python
import math

def arch_z(s, half_span, base_z, rise):
    return base_z + rise * (1.0 - (s / half_span) ** 2)

def arch_slope(s, half_span, rise):
    return -2.0 * rise * s / (half_span * half_span)
```

Require `half_span > 0` and sample `s` within `[-half_span, half_span]`. The ends are at `base_z`; the center is at `base_z + rise`. Parameter values come from the reference and inferred scale.

- Place repeated pieces at arc-length intervals when constant physical spacing matters; uniform parameter intervals may suffice for a shallow curve.
- With a piece's long axis along local X, local Y as the cross axis and local Z up, a Y rotation of `-atan(arch_slope(...))` aligns it to the profile in the XZ plane.
- Derive rails and supports from the same profile. Use a vertical offset for a specified height above a deck; use a normal offset for constant layer thickness.
- Fold later height scaling into `base_z`, `rise` and the slope before rebuilding. Post-hoc scaling of rotated objects can change local thickness without correctly updating their tangent alignment.
- Derive abutments, posts and landing clearances from the final end positions. A well-shaped span with unsupported ends still fails the contact requirement.

The same idea applies to elliptical, circular or spline profiles; select the curve from visible evidence rather than assuming every arch is parabolic.

### Swept tubes and beams

For a beam between points `a` and `b`, its center is `(a+b)/2`, length is `|b-a|`, and its long axis follows `b-a`. Give dimensions physical units before applying bevels so the bevel width is meaningful.

For a curved tube, sample a path, estimate its tangent, construct a perpendicular basis and emit vertex rings. Connect adjacent rings with consistent winding. If the tangent is nearly parallel to the chosen reference axis, use another axis; for long curves that twist, transport the frame along the path to avoid sudden ring rotation. Apply taper by structural level, not by one global radius rule.

Cap solid tubes with consistent normals. Remove duplicate path points before tangent normalization. Avoid a final zero-radius ring of coincident vertices: use a single tip vertex or a small nonzero radius as appropriate.

### Surfaces with dependent layers

Represent a roof, canopy, shell or curved panel as `surface(u, v)` with an associated normal. Attach its cladding, ribs, edging and trim to that function. Choose whether offsets are vertical or along the surface normal and keep that convention consistent.

For example, a rectangular hipped surface can use a normalized distance to a ridge:

```text
q = max(abs(y)/half_y, max(0, (abs(x)-ridge_half)/(half_x-ridge_half)))
q = clamp(q, 0, 1)
z = eave_z + height * (1-q)^curvature + edge_lift * q^edge_power
```

Here `0 <= ridge_half < half_x`, `half_y > 0`, and the exponents are positive. This is one optional envelope, not a roof-style default. Build thickness and open edges explicitly; shingle, tile or panel strips follow the envelope with small overlaps. Keep supporting ribs beneath the finished surface and check eaves and ridge caps in a side view.

For frames, windows and furniture, define bay boundaries and generate repeated members between them. A dark opening is best represented by real depth when parallax, light transmission or secondary views matter. Bevels, joinery and seams should explain construction at the intended viewing distance.

### Revolved and lofted profiles

- Revolve a radius/height profile for vessels, caps, turned parts or pedestals. Fewer sides may be intentional for faceted forms. At a radius of zero, create one vertex and a triangle fan instead of a ring of coincident vertices.
- Loft ordered cross-sections for tapered housings, cushions, trunks or simple animal bodies. Vary width and height independently along the main axis and close the ends cleanly. Attach handles, fins or other appendages to the resulting body frame.
- Review recognizable proportions before adding surface patterns. A patterned but incorrectly tapered body remains visibly wrong. Complex anatomy, facial likeness or articulation may need a dedicated character workflow rather than extending a simple loft.

## Repeated and organic forms

Separate the authored arrangement from the stochastic variation. Major branches, shelf rows, clusters or panel divisions determine the silhouette and rhythm. Randomness supplies smaller variation inside that arrangement.

For plant-like structures, a useful hierarchy is root/trunk → major limbs → branches → twigs → leaf or needle units. Set attachment points along parent paths so small parts do not float. Control taper per level; preserve plausible junctions and branch thickness.

Choose a unit shape from the reference:

| Pattern | Construction controls |
|---|---|
| Broad or lobed leaves | Explicit outline, optional serrations, raised midrib, slight curl, petiole attachment, local UVs |
| Narrow leaves or needles | Tapered strips/ribbons or low-sided tubes, orientation around a twig, tip taper and small curvature |
| Jointed stems | Tapered internodes, node collars, mild lean, branch emergence at selected joints |
| Fronds | Curved central stalk with alternating or paired leaflets; length and spacing vary along the stalk |
| Dense small foliage | Supporting volume and branches plus surface-distributed leaves; preserve gaps and interior darkness |

Example frond controls are `height(t) = H*sin(pi*t) + end_height*t` and `leaf_length(t) = L*sin(pi*t)^p` for `t` in `[0,1]`, `p > 0`. Adjust these profiles to the reference. Avoid overlapping leaflets becoming an opaque fan. For tapered stems, clamp inputs to nonnegative fractional powers: a joint collar just below the root must not produce a complex coordinate through `t**1.35` when `t < 0`.

Tune coverage in this order: major path, cluster envelope, unit size, orientation distribution, then count. A flat canopy needs depth and branch placement; increasing leaf count alone produces a denser flat canopy. A broad needle ribbon can make a tree look like grass even at high density. Inspect outer contour, gaps, backlit translucency and shadow density separately.

Variation should have structure. Use a restrained palette and correlations by branch, cluster, exposure or age when supported by the reference. Independent saturated colors on every unit often read as confetti. The same principles apply to repeated manufactured objects: preserve alignment and spacing rules, then vary wear or small offsets.

## Mesh batching and instancing

Choose based on what repeats:

- **Instances:** many transforms of a small number of source meshes. Suitable for repeated fasteners, foliage units, panels, books and distant objects. Keep instancing through rendering when possible; realizing instances increases memory.
- **Batches:** many small pieces with unique geometry. Concatenate vertex and face arrays into one mesh per logical group, offsetting each piece's face indices by the current vertex count. This reduces object overhead but does not reduce the number of vertices or triangles.
- **Separate objects:** independently editable or animated parts, or a modest number of large components. Preserve ownership and selection at a useful level.

For large batches, create geometry with `Mesh.from_pydata` or equivalent array APIs and set polygon/material data with bulk operations such as `foreach_set`. Avoid a Blender operator per tiny piece.

Carry material indices and per-part attributes through assembly. Blender UV coordinates belong to loops (face corners): indexing a leaf's vertex UVs by the mesh's loop vertex indices works only where no UV seam requires distinct corner values. Preserve explicit loop UVs when seams exist.

Per-object random values and generated coordinates change meaning after a merge: all parts now share one object. Store part-specific grain coordinates, color factors or material assignments before batching. Otherwise timber grain rotates incorrectly and repeated pieces lose their intended variation.

## Material construction

### Distinguish the layers

| Layer | What it controls | Common diagnostic |
|---|---|---|
| Base color | Pigment and broad staining | Compare lit and shadowed regions after lighting is calibrated |
| Roughness | Width and strength distribution of reflected highlights | Inspect highlight shape and environment reflections |
| Bump/normal | Small surface-normal variation | Check at a grazing angle and at the intended image size |
| Displacement/geometry | Contour, depth and contact | Inspect silhouette and side view |
| Transmission/volume | Light passing through and attenuation with distance | Inspect thickness, contents and background together |

Use independent spatial scales for large patches, medium mottling and fine grain. A high-frequency noise plugged into every channel creates correlated speckle, not convincing material structure. Match feature size in object/world units rather than making every object receive one arbitrary texture repeat.

### Directional and authored maps

Align grain, brushing or fibers to the part's local construction axis. For merged parts, store this coordinate basis or UV mapping before combining them. Use small per-part offsets to prevent identical patterns while preserving direction.

When suitable maps are unavailable, authored maps can be generated from deterministic noise, streaks, fibers or vein patterns. This is optional: choose it when it provides useful control over a shader-only approach. Generate maps with NumPy/native image APIs or an available image-writing tool, keep them under the project, and record the seed and generation settings. Color images normally use sRGB interpretation; scalar roughness, height and normal data use Non-Color. Pack dependencies in the deliverable and keep reproducible source maps when needed for rebuilding.

### Deposits, growth and wetness

Use geometry-aware masks when the reference supports them. An upward-facing growth/deposit mask can combine the normal's alignment with an up vector and broad noise:

```text
coverage = clamp((normal_weight * dot(normal, up)
                  + noise_weight * noise - threshold) * gain, 0, 1)
```

Evaluate the normal and position in a consistent coordinate system. Add exclusion masks for walked, polished, swept or otherwise exposed regions. This is a useful starting mask for some growth or deposits; the actual distribution may depend on moisture, accessibility, wear and crevices.

Close growth can combine a broad material patch with sparse small geometric fibers. Keep fibers attached to the surface and varied in height/direction. Large flat opaque patches often look like stickers; dense uniform fibers can look like carpet. Judge both at the hero camera and a close-up.

For wet bands, derive distance from the actual liquid level or contact region, then use a smooth transition to darken the base color and reduce roughness. A hard global Z threshold can leave an obvious stripe or fail on a tilted container. Do not put the wet mask on unrelated dry surfaces merely because they share a material.

## Transparent and reflective volumes

Treat the visible result as a coupled system: surface geometry, normal variation, roughness, refractive index, thickness, absorption, lighting, reflected surroundings and visible contents.

1. Establish the silhouette and a closed, consistently oriented boundary when volume absorption is required. Resolve overlapping or duplicate interfaces. Keep unintended side/bottom boundaries out of the view or physically enclosed.
2. Place contents and supporting geometry at meaningful depths. A transparent surface above an empty or overly bright substrate cannot reproduce detailed transmitted content.
3. Use a plausible IOR for the material; water is approximately 1.333, while common glass is around 1.5. These are material examples, not universal settings.
4. Set fine normal variation separately from broad surface waves. Small bumps can break up highlights without greatly deforming the contour; stronger waves displace both reflected and refracted detail.
5. Tune absorption with scene scale: transmittance behaves approximately as `T = exp(-sigma * distance)`. Scaling the object changes the optical path, so copying a density from a differently scaled scene changes its appearance.
6. Inspect the reflected environment. Geometry outside the camera frame can still dominate reflections or cast shadows. Reflective appearance cannot be reconstructed from the visible object's shader alone.

For thin foliage or paper, a translucent shader contribution may be more appropriate than modeling a thick refractive solid. For solid glass or liquid, retain the physical interface and thickness behavior that the reference requires.

Temporary diagnostic renders can isolate the cause of a mismatch: reduce normal perturbation, neutralize substrate color, or isolate reflected surroundings one at a time. Restore the intended scene for candidate evaluation. If using a shadow-ray transparency approximation to admit light through glass/liquid without full caustics, label the approximation and verify that it does not remove required shadows; it is not a default fix for darkness.

## Determinism and practical budgets

- Give each component or stable element ID its own seeded random stream. Adding a detail in one component should not reshuffle unrelated geometry. Do not derive persistent seeds from Python's randomized `hash()`; use recorded integer seeds or a stable digest.
- Keep layout/silhouette parameters separate from detail counts, map resolution and render quality. Record the parameters actually consumed by the generator.
- During candidate/incumbent comparisons, hold unrelated random seeds, camera, color management and render settings fixed. Tag deliberate proxy or geometry-detail changes so preview/final differences are explainable.
- Budget by projected importance, allowed camera moves, reflection visibility, object overhead and evaluated geometry. A small instance library can have millions of placements; a large merged mesh may still exhaust memory. Record both object/instance counts and evaluated mesh cost where practical.
- Measure geometry construction time separately from render time. Use available GPU devices deliberately and verify the selected backend; successful device discovery is not proof the intended device rendered the scene.
- Choose samples from remaining noise and fine-feature stability. Increasing samples cannot repair composition, materials or incorrect normals. Rebuild and reopening checks are described in [review-protocol.md](review-protocol.md).
