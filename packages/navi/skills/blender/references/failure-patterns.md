# Known failure patterns

Sources: an autumn Japanese-garden build iterated over 14 review rounds (Blender 4.5, Cycles) and an earlier reconstruction pipeline's failure log. Each row lists the visible symptom, the usual cause, and the general fix.

Treat these as conditional diagnoses, not scene requirements or universal numeric presets. Check the reference and the relevant representation first; for example, an empty background is a defect only when the reference requires more context. Reusable construction details are in [construction-patterns.md](construction-patterns.md).

## Camera, layout and light
| Symptom | Cause | Fix |
|---|---|---|
| Objects keep needing reshaping to "fit" | Camera focal/pitch wrong | Re-solve camera; never compensate with geometry |
| Subject/foreground unexpectedly in shade, flat and dark | Off-frame objects block the key light (outdoor shadow length = h/tan(elev)) | Inspect the light path and relocate unintended occluders; change light direction only if reference evidence supports it |
| Milky, low-contrast image | Haze density too high, strong forward scattering toward the sun | Reduce density 3–10×, anisotropy ~0.3, fade with height |
| Hero hidden by a tree or object | Layout chosen from the top view, not checked in camera | Check occlusion in camera at blockout; move the occluder or the hero |
| Building floats or its foundations hang in the air | Placed at the center's ground height on a slope; pond bank cuts under it | Level a pad in the terrain function; extend footings below ground; keep banks clear of the footprint |
| Background has large gaps absent from the reference | Context geometry removed, undersized or too sparse | Match the reference's background silhouettes and mid-height coverage with the relevant structures, landforms or planting |
| Smeared, doubled frame edges | Compositor lens dispersion too strong | Dispersion ≤ 0.002–0.005; distortion ≤ 0.01 |

## Materials and detail
| Symptom | Cause | Fix |
|---|---|---|
| Rocks look like pale soap or pillows | Albedo too high; smooth low-frequency displacement; bright lichen | Albedo 0.05–0.12, plane-clipped facets + fine fractal, fractures, darker lichen, cavity darkening |
| Stepping stones blobby and white | Moss mask on flat tops, high albedo, over-smoothed flattening | Dedicated walked-stone material; keep relief on flattened tops |
| Moss/ground reads as plastic or golf-course lawn | Uniform shader, no geometry, density ends too close | Instanced sprigs with distance falloff; 3-scale color variation; extend sparse instancing to ~45 m |
| Wood grain runs across posts like corrugation | One object-space texture on merged parts | Per-part grain attribute (long axis → Z) |
| Bronze/metal looks like pale plastic | Patina too light and saturated | Darker base, patina in patches, metallic varying with patina |
| Bamboo, ladles, small props blown out white | Light albedo plus coat under sun with AgX | Lower albedo, warmer hue, less coat; check in close-up |
| Everything pale in the wide shot | Typical first-pass albedos too high | Check against the albedo table; sample the reference |

## Vegetation
| Symptom | Cause | Fix |
|---|---|---|
| Tree looks like a stubby bush | Child lengths too short relative to trunk | Limbs longer than trunk (×2), spreading angles, layered horizontals |
| Canopy sparse, sky everywhere | Too few or too small leaves | Bigger leaves (8–10 cm), more per twig, 30–60k for a hero crown |
| Thick stubs at branch ends | Global taper applied to all levels | Per-level taper (tips 0.15–0.3) |
| Ferns look like palms or combs | Pinnae too wide and overlapping | Narrow, lobed pinnae with gaps, one pair per segment |
| Shrubs covered in shiny flakes | Leaves too big and glossy, too few | Smaller leaves (≈1.8 cm), 2–3× density, spec ~0.35 |
| Hedge reads as a row of eggs | Separate blobs | One continuous swept mesh with a rounded profile |
| Fallen leaves like orange stars or confetti | Strong curl, buried in moss, saturated, uniform density | Low curl, lifted above cover, muted mixed colors, concentrated under trees |
| Background trees look like eucalyptus | Long bare pale trunks forking high | Short trunk, full crown, dark bark; hide trunk bases behind hedges or understory |

## Coupled geometry and shading

| Symptom | Cause to investigate | Targeted repair |
|---|---|---|
| Rails, trim or repeated pieces stop meeting after a shape edit | Related parts use copied curves or were scaled after rotation | Rebuild from one profile, its derivative and shared attachment frames |
| Surface layers intersect or supporting ribs protrude | Thickness/offset convention differs between layers | Use the same envelope and explicit normal or vertical offsets; inspect a side view |
| Repeated pieces lose grain direction or color variation after merging | Object-level coordinates/randomness replaced part-level data | Preserve local coordinates, UVs and variation attributes through batching |
| Growth or deposits look like stickers | Large flat opaque patches with uniform edges | Match broad coverage first, then add attached small relief or fibers only where visible |
| A transparent object reveals too much substrate detail | Substrate contrast, absorption path length or interface shape is wrong | Inspect bed/background, thickness and absorption separately; retune at the correct scene scale |
| Reflection is missing or has the wrong silhouette | The reflected object is absent, misplaced or outside the useful ray directions | Inspect reflected surroundings and surface normals before changing reflectivity |
| Material shows an abrupt wet/stained stripe | A global height threshold was reused across unrelated surfaces | Derive a smooth mask from the actual contact or liquid interface |
| Geometry generation produces complex/non-finite coordinates | Fractional power, zero tangent or division evaluated outside its domain | Validate profile domains, clamp appropriate inputs and remove repeated path points |
| One local edit reshuffles the whole scene | Shared random stream depends on build order | Use stable component/element seeds and preserve unrelated streams |
| A large merged mesh still consumes excessive memory | Batching reduced objects but kept all repeated vertices | Instance repeated source geometry and measure evaluated cost separately |

## Review process
| Symptom | Cause | Fix |
|---|---|---|
| Editor accepts tiny changes while the main defect stays | Intent-biased, single-frame self-judging | Blind critic plus both-order A/B; withhold intent and metrics |
| Exposure tweaked endlessly | Numeric averages treated as the target | Exposure metrics advisory; fix structure first |
| Numerically present, visually absent | Element exists but is too small, faint or low-contrast | Review at output scale; require visible evidence |
| Washed-out principal materials accepted | Lenient rubric | Washed-out color/shading or subject merging with the background = major failure |
| Same failed fix repeated | No escalation rule | After 2 rejections switch representation or target |
| Rendering changed the simulation result | Unbaked caches (animation only) | Bake point caches before checks and rendering |
| Check targets silently missing | Names changed during refinement | Final pass treats missing targets as failures |
