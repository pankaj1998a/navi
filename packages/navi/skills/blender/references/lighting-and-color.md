# Lighting, exposure and color matching

## Classify the light first
| Evidence | Lighting setup |
|---|---|
| Crisp cast shadows, bright highlights | Sun (0.5–1° angle) + physical sky |
| Soft but directional shadows | Hazy sun (2–5°) + stronger sky, maybe haze volume |
| No cast shadows, soft contact shadows only | Overcast: sky/HDRI only, no sun; low contrast |
| Warm long shadows, orange highlights | Low sun (5–20°), warm sun color, bluish shadows |
| Interior with window light | Area lights / portals at the windows + bounce; practical lights where visible |
| Night | Practical lights (warm), moonlight (cool, weak), emissive windows |

## Sun direction from shadows
1. Pick 2–3 pairs: (object top point, its shadow tip) and the object's base. Use vertical objects (poles, trunks, wall corners).
2. Map base and shadow tip to ground coordinates with the solved camera (ray ∩ z = 0). Shadow direction on the ground `s_g = tip − base` points **away** from the sun, so sun azimuth vector = −s_g.
3. Elevation = atan(object height / shadow length). Average the pairs; inconsistent pairs mean uneven ground or a wrong camera.
4. Sun lamp: `sun.rotation_euler = sun_dir.to_track_quat('Z','Y').to_euler()` (local +Z points toward the sun).
5. Nishita sky in 4.x: `sun_elevation = asin(sz)`, `sun_rotation = atan2(sx, sy)` (0 = +Y, 90° = +X). Use `sun_disc=False` plus a separate sun lamp for controllable shadows, or `sun_disc=True` alone.
6. Off-frame occluders: anything of height h between the sun and the subject casts a shadow of length h / tan(elevation). At 20° elevation a 20 m tree shades 55 m of ground. Remove or move occluders that the reference doesn't show shading the scene, and add them when the reference has dappled shade.

## Exposure and white balance
- Sample a neutral or known surface in the reference (`compare.py sample`): gray stone, white wall, concrete, asphalt. Render, sample the same region, adjust `view_settings.exposure` (in stops) or the light strengths until relative luminance matches within ~0.2 stops.
- White balance: neutral surfaces should have the same R:G:B ratio as in the reference. Adjust sun color (warm 1.0/0.85/0.7 at low sun, neutral at noon) and sky strength to shift shadow tint, before any grade.
- AgX is the default view transform; choose its look to match the reference's contrast and record it. "AgX - Medium High Contrast" is one option, not a preset for every image. Calibrate exposure for a bright scene without overdriving individual lights to hide material errors.
- Typical relative levels (sunny day): sky dome strength ~0.5–1.2 relative to a sun of 3–6 W/m² (Blender units). Shadowed areas often 3–8× darker than lit ones; if shadows come out black, increase sky fill; if they're too flat, reduce it.

## Recovering albedo from pixels
For a diffuse patch in scene-linear values, radiance is approximately proportional to albedo × illumination. This is a useful calibration model, not an exact factorization of an arbitrary reference pixel. Tone mapping, unknown exposure, specular reflections, translucency and clipping break the approximation. Converting sRGB to linear removes the sRGB transfer function; it does not undo a camera's tone curve or AgX.

Use relatively diffuse, unclipped comparison patches and a plausible known surface:
- Sunlit horizontal surface: albedo ≈ linear value / (lit level of a known reference surface ÷ its known albedo).
- Use neighbors with known albedo to calibrate, then sanity-check against this table (linear base color):

| Material | Albedo (linear) |
|---|---|
| Fresh snow | 0.8–0.9 |
| White paint / plaster | 0.6–0.8 |
| Light concrete | 0.35–0.5 |
| Weathered concrete, gray stone | 0.15–0.3 |
| Granite boulder (dark gray) | 0.06–0.15 |
| Sand (dry) | 0.3–0.45 |
| Raked white gravel | 0.3–0.5 |
| Asphalt | 0.04–0.1 |
| Grass / moss | 0.05–0.15 (green channel highest) |
| Tree foliage | 0.04–0.12 |
| Bare soil (dark) | 0.04–0.1 |
| Weathered wood (gray) | 0.1–0.2 |
| Fresh light wood | 0.3–0.5 |
| Red autumn maple leaf | R 0.3–0.6, G 0.02–0.1, B < 0.02 |

Lessons: renders of natural scenes usually come out **too bright and too uniform** at first. Real rocks, bark and soil are dark; their apparent brightness comes from sunlight.

## Separating lighting errors from material errors

Hold camera, geometry and the color-management setup fixed for the first diagnosis. Compare spatial patterns as well as image averages:

| Observation | Likely control group | Useful isolated check |
|---|---|---|
| Lit and shaded neutral patches shift by similar amounts | Exposure or overall illumination | Compare several diffuse patches at different depths |
| Shadows are too dark but lit patches are close | Fill/environment or excess occlusion | Compare shadow-to-lit ratios; inspect off-frame blockers |
| One material is consistently too bright in both light and shade | Base color or material response | Inspect that material under the established light |
| Highlight locations align but highlights are too broad | Roughness or normal variation | Reduce bump temporarily, then evaluate highlight width |
| Background contrast differs while foreground values align | Background geometry, haze depth/density | Compare near and far regions separately |
| A reflective object has the wrong bright/dark shapes | Reflected surroundings or surface shape | Inspect what its reflection rays see |

Use the clay pass under the proposed **reference lighting** to judge Gate V. A separate studio-light diagnostic helps inspect geometry but does not demonstrate that the reference's lighting matches. Transmissive or cutout elements can change scene visibility when overridden; document the clay override's treatment and inspect the authored-material view as well.

Build the broad illumination first, then investigate local bounce, practical lights and occluders supported by the image. Additional area lights can approximate broad sources or unresolved bounce, but should not introduce highlight patterns or shadows absent from the reference. There is no universal three-light arrangement for reconstruction.

For translucent leaves, thin fabric or paper, check front-lit and backlit regions before increasing material brightness. For glass or liquid, inspect the substrate, thickness and reflected environment alongside illumination; see [construction-patterns.md](construction-patterns.md#transparent-and-reflective-volumes).

## Atmosphere
- Haze: a bounded box volume with density that falls with height (0.0005–0.003 /m for clear-to-hazy outdoor air at landscape scale), anisotropy 0.3–0.6. Too much haze makes the image milky and lifts the black level; judge it against distant contrast in the reference.
- `visible_shadow = False` on the haze box so it doesn't shadow the scene; Cycles volume step rate 1–4.
- God rays need direct sun, occluders (foliage) and haze together.

## Color grade (last, subtle)
Match contrast, saturation and black level with the view transform's look first; then, only if needed, compositor curves or Color Balance. Add vignette (≤ 35% darkening at the corners), grain matching the reference noise, and gentle glare (Fog Glow, threshold > 1) only when the reference shows them.
