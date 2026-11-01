# Camera, scale and layout from one image

## Conventions
- Image pixels: origin top-left, x right, y down. Normalized coords = pixel / size.
- Blender camera space: +X right, +Y up, looks along −Z. World: Z up.
- `camera_solve.py` reports `lens_mm` for a **36 mm-wide sensor with sensor_fit HORIZONTAL** (focal px × 36 / width). Keep `sensor_fit = 'HORIZONTAL'` even for portrait images, or the lens value is wrong.
- 35 mm-equivalent EXIF focal length ≈ `lens_mm` directly. A physical focal length needs the crop factor: lens_36 = f_phys × 36 / sensor_width_mm.

## Picking line segments
- Choose long segments that are far apart in the image and certainly parallel in the world: building edges, roof lines, window rows, paving joints, fence rails, tiles, railway tracks. Avoid curved or organic edges and lens-distorted borders.
- Use ≥ 3 segments per axis when possible. Check `residual_deg`: < 0.5° good; 0.5–2° acceptable; > 2° means a bad segment, wrong axis label, or strong lens distortion.
- Axis labels: two horizontal orthogonal directions → `x` and `y`; one horizontal direction plus verticals → `x` (or `y`) and `z`.
- Where no usable straight lines exist, use horizon mode only when a true horizon is visible, such as a distant level water horizon. A nearby shoreline, tabletop edge or terrain boundary is not a horizon. Otherwise estimate pose and focal length, then constrain them with known-size proxies at multiple depths.

## Math (what the script does)
- Least-squares vanishing point of lines `aᵢx + bᵢy + cᵢ = 0` (normalized).
- Two orthogonal VPs v₁, v₂ with principal point p: `f² = −(v₁ − p)·(v₂ − p)`. A negative value means the VPs aren't orthogonal (wrong labels, cropped or off-center image, or a tilt-shift lens).
- World axis direction in camera space: `d = normalize(vₓ − pₓ, −(v_y − p_y), −f)`; third axis = cross product; flipped so world Z is up and +Y points away from the camera.
- Camera rotation (camera→world) = transpose of [dX dY dZ]; Blender XYZ euler extracted from it.
- Horizon line known with f: world up = normalize(r₁ × r₂) for rays r₁, r₂ through two horizon points. The horizon passes through the image at `y = p_y + f·tan(pitch)` (pitch is negative when looking down).
- Scale: camera at height h; `ground_ref` (two ground pixels plus their real distance) solves for h. A cropped photo moves the principal point off-center; if the solve looks systematically wrong, crop symmetrically or use `principal_point`.

## Verifying the camera (Gate C)
1. `setup_reference.py --grid 1 --proxies proxies.json --overlay-out evidence/camera_check.png`.
2. The grid should run along paving joints and floor lines, converge at the photo's vanishing points, and meet the horizon where the photo does.
3. Proxies of known size (doors, people, cars, steps) at their estimated ground positions should cover their photo counterparts within ~2% of image width.
4. If the sizes match but positions drift with depth, the focal length is wrong. If everything is uniformly too big or small, the height/scale is wrong. If verticals lean differently, the pitch or roll is wrong.

## Layout from depth cues
- Occlusion order → relative depth ordering. Object image height h_px at distance d: real height ≈ h_px × d / f_px.
- Ground contact: a pixel on the ground plane maps to world coordinates by intersecting its camera ray with z = 0 (or the terrain function). Use this to place every grounded object.
- Atmospheric perspective (lower contrast, bluer) indicates distance; use it when the ground isn't visible.
- Optional helpers, if installed locally: monocular depth (relative depth, scale-ambiguous; calibrate it with two known points) and segmentation masks (better overlays and per-object IoU). Treat them as evidence, not truth.

## Projected landmarks and parameter diagnosis

For a centered perspective camera with horizontal sensor fit and square pixels, `f_px = lens_mm * image_width / sensor_width_mm`. At camera-space distance `D = -Z > 0`:

```text
u_px = image_width/2  + f_px * X/D
v_px = image_height/2 - f_px * Y/D
projected_extent_px ≈ f_px * real_extent / D
```

This explains the coupling between lens, object size and distance. Use the actual Blender projection for measurements when camera shift, aspect or other settings differ:

```python
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

def landmark_top_left(scene, camera, point_world):
    p = world_to_camera_view(scene, camera, Vector(point_world))
    if p.z <= 0:
        return None  # Behind the camera: report separately.
    return [float(p.x), float(1.0 - p.y)]
```

Blender's normalized Y origin is bottom-left; analysis bboxes use top-left. Convert once when writing observations. Preserve out-of-frame coordinates rather than clamping them into the image and concealing a framing error.

Choose landmarks with a defensible correspondence: a rigid corner, a topmost tip, a contact point or the end of a major span. Store reference pixel/normalized position, corresponding world anchor, projected position and uncertainty. Derive world anchors from the built component's interface, not a second copy of its design constants. Keep IDs stable across candidates. For soft silhouettes, combine bbox/region evidence with landmarks; a noisy leaf tip should not drive the whole camera fit.

| Pattern across several landmarks | First investigation |
|---|---|
| Most move together across the frame | Camera aim/shift or a common layout transform |
| Relative size/position errors change with depth | Focal length and camera distance, using near and far anchors |
| Grounded objects have inconsistent contact heights | Camera pitch/height, surface model and placement assumptions |
| One object is wrong while nearby anchors align | That component's dimensions, pose or silhouette |
| Contours align but the image feels flatter | Light/dark structure, occlusion, roughness and atmospheric depth |

These are diagnostic hypotheses, not unique solutions. Change one causal group at a time and check multiple anchors. Once Gate C passes, hold the camera fixed while repairing components. If new evidence demonstrates a camera error, reopen Gate C deliberately and recheck layout/lighting rather than permanently compensating with distorted objects.

Compare images at the same aspect ratio and coordinate convention. A uniformly scaled preview is useful; independent cropping or warping to make a candidate align invalidates the original camera/layout comparison. Record any crop used for a detail comparison and use corresponding regions in both images.

## Terrain
- Write the terrain as a function `height(x, y)` built from primitives (base slope + Gaussian mounds + carved basins + flattened pads + low-frequency noise). Build the mesh from it and place everything with the same function: a single source of truth avoids floating and buried objects.
- Grid spacing 0.1–0.25 m near the camera is enough; add bump or micro-geometry for finer detail. Push the terrain edges outside the view and reflections.
- Steep banks next to buildings: level a pad (flatten the function inside a rotated rectangle with a smooth blend) and extend footings below ground.

## 2.5D / camera projection (mode A only)
- For distant backgrounds that won't be seen from another angle, project the photo itself onto simple proxy geometry: add a UV Project modifier with the solved camera as projector (aspect = image W/H) and an emission or diffuse material using the reference image. It matches perfectly from this camera and smears from others.
- Never project onto hero objects in mode B. Never let projected pixels carry baked lighting that conflicts with your new light.

## Lens look
- Depth of field: estimate the focus distance from the sharpest plane; f-stop from how quickly blur grows (phone or landscape photos: f/5.6–11 equivalent; portraits f/1.8–2.8).
- Distortion: wide lenses have barrel distortion (straight lines bow outward near the edges). Use the compositor Lens Distortion at −0.005…−0.03. Chromatic aberration only if visible, ≤ 0.005.
