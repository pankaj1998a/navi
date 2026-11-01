# Large and grand environments

For landscapes, cities, forests, coastlines, interiors, battlefields, space scenes: anything where the scene is bigger than one object and the sense of **scale** matters. The shared workflow is in the main SKILL.md. For matching a specific photo of a place, also use image-reconstruction.md.

## Compose for scale first

A grand scene reads as grand because of composition, not polygon count.

- **Layer the depth.** A foreground element close to the camera (rocks, grass, a railing, a character), a midground hero (the castle, the bridge, the ship), and a background that fades (mountains, skyline, sky). Each layer gets less detail and less contrast than the one in front of it.
- **Give a known-size reference.** People (about 1.7 m), cars, doors, trees or windows next to the hero tell the eye how big it is. Without one, a mountain looks like a rock.
- **Choose the lens for the feeling:**
  - 14–24 mm: dramatic, deep, vast foreground.
  - 35–50 mm: natural.
  - 85–200 mm: compresses layers so distant giants loom over the foreground.

  Put a low camera at human eye height (1.5–1.7 m) to make things tower.
- **Use atmospheric perspective.** Distant objects get lighter, bluer and lower in contrast. Add a `volume_fog` box or a mist gradient; without one, distance reads as flat.
  - Scale the density to the view: start near 0.1 / D per metre, where D is the distance to the farthest feature that must stay readable. That gives about 0.0001 for a 1 km valley view and 0.001 at 100 m.
  - A first render that is milky all over means the fog is 3–10× too dense.
- **Light for depth.** Low sun (5–25°), backlight or side light gives long shadows and rim light. Light shafts need sun, occluders and haze together.
- Block out the whole composition with grey proxies and check it through the camera before building any asset.

## Terrain

- **Write a height function `ground_z(x, y)` in Python** that combines:
  - broad shape: plateau, valley, slope, river bed;
  - fractal noise (`mathutils.noise.fractal` or `hetero_terrain`) for medium relief;
  - flattened pads where buildings stand.

  Build a grid mesh from it (with bmesh, or vertex coordinates via `foreach_set`). Place every object by querying the same function, so nothing floats or sinks.
- **Resolution follows the camera.** Use fine spacing near the camera (0.1–0.5 m) and coarse spacing far away, or one moderate grid plus a displacement modifier.
- **Material by attributes:** slope (normal Z) for rock vs grass, height for snow lines, noise for patches. In the shader, use `Geometry > Normal`, a Separate XYZ node and a Map Range node. Use 3 scales of variation.
- **Water:** a plane or volume at sea level with a glossy, slightly rough, IOR 1.33 material and a noise bump for waves. The shoreline is where terrain crosses the water height. Add foam with a mask near that line.
- **Far mountains** can be a separate coarse mesh ring or a few big displaced planes. Fog makes them read as distant.

## Scattering many objects (vegetation, rocks, buildings, crowds)

- **Build a few variants per kind, then instance them.** 3–6 tree variants, 5–10 rocks, 4–8 building types. Instances cost almost no memory in Cycles; real copies do.
  - In Python: put each variant in its own collection, hide those source collections from rendering, then `H.collection_instance(col, name, location, rotation, scale)` per placement (thousands are fine), or `H.instance(mesh_obj, ...)` for single meshes.
  - **Geometry Nodes** for tens of thousands to millions of points (grass, forests). Use Distribute Points on Faces with a density from a vertex group or attribute, then Instance on Points with a Collection Info node (Separate Children + Reset Children, Pick Instance), and random rotation and scale. Keep the instances unrealized. Check socket names by printing `node.inputs.keys()`; they changed between versions.
- **Placement rules:**
  - Seeded random positions with minimum spacing (Poisson-disc-like rejection).
  - Density masks: no trees on roads, in water or on steep slopes; more near rivers.
  - Clustering (noise thresholds).
  - Random yaw, a little tilt, scale 0.7–1.3.
  - Sink the bases a little into the terrain.
  - **Keep the camera clear.** Leave a clearance around the camera position and along the sightline to the hero. One tree that lands on the camera fills the whole frame with leaf colour; place foreground elements deliberately instead.

  Perfect grids and uniform sizes read as fake; real distributions clump.
- **Level of detail by distance:** full meshes within about 30 m of the camera, simplified variants or cards farther out, and painted colour on the terrain beyond that. Skip anything outside the camera frustum unless it casts visible shadows or reflections.

## Cities and architecture

- **Lay out a street grid or organic blocks** from a seeded generator. Make buildings from footprint polygons extruded to random heights within a zoning profile (taller near the centre), then give each a roof type and a window pattern.
- **Windows:** use a procedural material (brick or checker texture driven by object coordinates, with emissive cells at night) rather than geometry, except near the camera.
- **Hero buildings near the camera** get real geometry: ledges, frames, balconies (`ARRAY`), signage.
- **Add life:** streets with sidewalks and curbs, lamp posts (instanced), cars (instanced, varied colours), people (simple proxies at a distance).

## Interiors

- Room shell from boxes (walls with thickness, floor, ceiling), with windows cut by `boolean`. Real-world dimensions: ceiling 2.4–3 m, door 2.0–2.1 × 0.8–0.9 m, table 0.75 m, counter 0.9 m.
- Light from the windows (area lights in the openings, or sun plus sky through them) plus practical lamps. Add `light.cycles.is_portal = True` on area lights in window openings for less noise in older versions. Raise the bounces if the interior looks too dark.
- Furnish from object-modeling.md recipes, and use instances for repeated chairs and books.

## Space and sky scenes

- Black world with stars: a world shader with a Voronoi texture thresholded into points, or instanced tiny emissive spheres.
- A planet: a sphere with a procedural texture, an atmosphere shell (a slightly larger sphere with volume scatter or a fresnel emission rim), and the sun as a strong sun lamp. Keep real scale ratios plausible but cheat distances for composition.

## Performance budgets (headless CPU)

- **Memory:** instance aggressively and keep unique geometry under a few million polygons. Turn on `scene.render.use_simplify` and `simplify_subdivision_render` for previews.
- **Render time:**
  - Cycles with adaptive sampling (threshold 0.02–0.05 for previews, 0.01 for finals) and OIDN denoising.
  - Limit `max_bounces` (4–8 for opaque landscapes, but keep 12 when glass or water is visible) and volume bounces (0–1). Volumes are the slowest part, so keep fog boxes tight.
  - Time a preview and extrapolate to the final resolution and samples before committing.
- **Clipping:** raise `camera.data.clip_end` to the scene size (kilometres) and keep `clip_start` reasonable (0.1 m) to avoid depth precision artefacts.
- **Light many lamps efficiently:** Cycles' light tree (on by default in 4.x) handles hundreds of small lights such as city windows and street lamps. Use emissive materials for distant lights instead of lamp objects.

## Grand-scene defects

| Symptom | Cause | Fix |
|---|---|---|
| Looks like a miniature or diorama | No scale cue, a high camera, everything sharp and saturated far away | Add people, cars or doors; a camera near eye level; haze and desaturation with distance; less depth of field |
| Flat and empty | Single layer, uniform terrain, no foreground | Add a foreground element, midground variation and background silhouettes; clumped scattering |
| Repetition visible | Few variants, identical rotation and scale | More variants; random rotation, scale and tint per instance (object info Random in the shader) |
| Milky, low contrast | Fog density too high for the scene scale | Use about 0.1 / D per metre (D = farthest readable distance); make density fall off with height; keep the near foreground clear |
| Render takes forever | Realized instances, unbounded volumes, high bounces | Keep instances unrealized, tighten volume bounds, lower bounces, use adaptive sampling and denoising |
| Floating trees or buildings | Placed at the wrong ground height | Query `ground_z(x, y)` at the footprint and sink bases slightly |
