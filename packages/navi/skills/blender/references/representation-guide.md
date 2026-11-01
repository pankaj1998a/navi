# Choosing and building representations

Choose the **simplest representation that reproduces the visible evidence** at its screen size. Hero elements get real geometry; distant context may be cheap. Silhouette first, then structural detail, materials, and fine detail last.

For implementation details, read the relevant parts of [construction-patterns.md](construction-patterns.md): shared profiles for coupled parts, surface/attachment queries, repeated-form hierarchy, instancing versus batching, material coordinates and optical thickness. These patterns also apply to interiors, products, machinery and still lifes; use only element types present in the reference.

## By element type

### Architecture and man-made structures
- Build from measured proportions (scale anchors), with boxes and lathes merged per object via a mesh builder. Bevel modifier (1–10 mm) on every hard edge; no perfectly sharp CG edges.
- Wood: store a per-part `grain` coordinate (part-local, long axis → Z) so the grain follows each board and beam; noise streaks along it plus rings across it, with variation per part.
- Repeated detail that sells scale: rafters, lattices, railings, tiles, joints, footings. Add it where the camera sees it.
- Ground contact: footings and walls extend below the terrain; level pads on slopes.

### Terrain and ground
- Heightfield function (see camera-and-geometry.md). Material driven by attributes such as moss/soil coverage, wetness and paths.
- Ground cover (moss, grass, gravel, pebbles, leaf litter): Geometry Nodes Distribute Points on Faces with a **density attribute** = coverage × camera frustum × distance falloff (dense < ~25 m, sparse up to ~45 m). Keep the base mesh in the output (Join Geometry) so gaps show a matching base color.
- Fallen leaves: lie flat with slight curl, sit just above the cover layer (offset ~1–2 cm over moss), concentrated under their source trees; muted mixed colors (not saturated confetti). Density 10–40 /m² under trees, near zero in swept areas.

### Rocks and stones
- Icosphere (subdiv 4–6) → large fractal lumps → soft clipping against 5–11 random planes (angular facets) → medium fractal → strata ripple → fine fractal. Flatten tops for stepping stones; sink 25–40% into the ground.
- Material: dark base (albedo 0.05–0.12), mottling at 3 scales, mineral grain, fracture lines, crustose lichen (dull, not white), moss on up-facing normals broken by noise, cavity darkening (Pointiness, Cycles), wet dark band + algae near water.
- Walked-on stones: no moss on top, smoother and lower roughness, moss at the margins only.

### Vegetation
- Trees: recursive branch generator (trunk → limbs → branches → twigs) swept into tapered tubes with UVs; per-level taper (tips 0.15–0.3 of base radius), angles, gravity/phototropism, golden-angle phyllotaxis. Leaves are instanced on points with attributes (`rot` euler, `scl`, `var`, color factor) via Instance on Points; color from instance attributes in the shader (outer/top leaves different from inner ones).
- Leaf counts at mid distance: a 6 m broadleaf crown needs roughly 30–60k leaves at 8–10 cm to read as full; background trees 5–20k with larger leaves. An initial plan budget (≤ 15k per tree) suits small shots; exceed it only when the tree dominates the frame and the render budget allows, and record why.
- Conifers and pruned pines: needle tufts instanced on pad points (domed discs at branch tips). Cryptomeria: dense sprays along short drooping branches.
- Leaf shader: principled + translucent mix (25–45% translucency), varied hue per instance; slight vein bump.
- Shrubs and hedges: displaced core mesh (dark) + small leaves scattered at high density, aligned to the normal with moderate tilt. Hedges must be **one continuous swept mesh**, not a row of blobs.
- Ferns: arching rachis with separated, tapered, lobed pinnae (gaps between pinnae, not a solid fan). Grasses and sedges: curved tapered strips in clumps.
- Bamboo: segmented culms with node rings, slight lean, branches and lanceolate leaves only in the upper half.
- Use collection instances for repeated background trees and bamboo (build 2–5 variants, place many with random rotation and scale).
- Treat counts and dimensions above as starting examples for those plant types. Judge projected unit size, cluster depth and gaps before increasing density. Use batches for unique small geometry when instancing is unsuitable, preserving UVs and variation attributes.

### Water
- Closed volume (solidified surface) with IOR 1.333, low roughness, a fine ripple bump; volume absorption (depth color) plus slight scatter. Bed and bank geometry inside the volume.
- An optional approximation for admitting light to the bed without full caustics is to mix to Transparent BSDF on shadow rays (Light Path → Is Shadow Ray). Volume absorption can still attenuate the path. Use it deliberately and verify required shadows; it is not a default remedy for incorrect lighting, thickness or overlapping interfaces.
- Floating things (leaves, lily pads) sit 2–5 mm above the surface. Fish below with depth-faded visibility.

### Sky and far background
- Physical sky aligned with the sun; real geometry (tree lines, hills) for anything that occludes or reflects. Mode A may use projected cards for far backgrounds.

### People, animals, vehicles, text
- Hard to make convincing procedurally. In mode B, use simplified but correctly scaled proxies unless the user supplies assets or asks for character work (then use the character skills). Don't let a weak figure become the focal point.

## Budgets (defaults; state when you exceed them)
| Item | Default budget |
|---|---|
| Components | 3–8 |
| Unique leaf/needle instance meshes | ≤ 6 per library |
| Instances total | ≤ ~10M (GPU memory permitting; Cycles instancing is cheap) |
| Terrain spacing | 0.1–0.25 m |
| Rock mesh | subdiv 4 (small) to 6 (hero) |
| Preview render | ~960 px wide, 64–128 spp, adaptive 0.03 |
| Final render | reference resolution, 512–1024 spp, adaptive 0.01, OIDN |

## Detail priority
Spend detail where the eye goes: the hero, contact zones (where objects meet the ground or water), silhouettes against the sky, and anything within ~5 m of the camera. A distant hillside needs color variation, not leaves you can count.

For scenes at a different scale, use projected size and the permitted camera movement instead of those distance examples. Include objects visible through reflection or refraction in the budget, even when they are outside the primary camera frustum. More samples or geometry do not resolve an incorrect silhouette or lighting pattern.
