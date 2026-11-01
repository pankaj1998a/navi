# bpy pitfalls: versions, background mode, silent failures

Check the version first: `blender --version`, or `bpy.app.version` inside a script. `scripts/bpy_helpers.py` already handles the items marked (H).

## Running headless

- `blender -b --factory-startup --python-exit-code 1 -P script.py -- args`.
  - `--factory-startup` ignores user preferences and add-ons, for reproducible results.
  - `--python-exit-code 1` makes Python errors fail the process. Without it, a traceback still exits 0.
- Script arguments come after `--`: `argv = sys.argv[sys.argv.index("--") + 1:]`.
- Open an existing file with `blender -b file.blend -P script.py`. Save with `bpy.ops.wm.save_as_mainfile(filepath=...)` (H: `save_blend`). Saving over an existing file writes a `.blend1` backup next to it.
- **EEVEE and Workbench need an OpenGL/GPU context.** On a server without a GPU or display they fail or hang. Use Cycles with `device='CPU'` there.
- **Distro builds (Debian/Ubuntu `apt install blender`)** run on the system Python. They often have **no numpy** (`import numpy` fails inside Blender even if pip installed it for another Python) and **no OpenImageDenoise**: rendering with `cycles.use_denoising = True` then fails with "build has no OpenImageDenoise support". Check with `import _cycles; _cycles.with_openimagedenoise` (H: `has_denoiser`; `set_render` turns denoising off automatically). Use more samples instead.
- Cycles on CPU uses all cores by default. GPU rendering must be enabled explicitly (H: `enable_gpu`).

## Operators (`bpy.ops`) in background mode

- Many operators check a UI context (VIEW_3D area, active object, edit mode) and fail or silently do nothing headless. Prefer the data API:
  - `bpy.data.objects.new(name, mesh)` and `collection.objects.link(obj)` to create objects;
  - bmesh to build geometry;
  - `obj.modifiers.new` for modifiers;
  - `bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))` to apply them (H: `apply_modifiers`).
- If an operator is unavoidable: `with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]): bpy.ops....`. Check that it returns `{'FINISHED'}`. Operators change selection and the active object as a side effect.
- Edit-mode changes are not visible to the data API until you leave edit mode or call `bmesh.update_edit_mesh`. Avoid edit mode in scripts: use `bmesh.new()`, `bm.from_mesh(me)`, edit, then `bm.to_mesh(me)` and `bm.free()`.
- `bpy.ops.mesh.primitive_cube_add(size=1)` makes a 1 m cube (half-extent 0.5). Scaling multiplies that.

## Renamed or removed APIs by version

| Area | Old | New |
|---|---|---|
| Principled BSDF inputs (4.0) (H) | `Subsurface`, `Specular`, `Transmission`, `Clearcoat`, `Sheen`, `Emission` | `Subsurface Weight`, `Specular IOR Level`, `Transmission Weight`, `Coat Weight`, `Sheen Weight`, `Emission Color` |
| Find nodes | `nodes["Principled BSDF"]` (the name is localized and can be renamed) | `next(n for n in nodes if n.type == "BSDF_PRINCIPLED")` |
| Auto smooth (4.1) (H) | `mesh.use_auto_smooth`, `auto_smooth_angle` | `mesh.set_sharp_from_angle(angle=...)` or the "Smooth by Angle" modifier |
| EEVEE engine id (H) | `BLENDER_EEVEE` (≤4.1 and ≥5.0) | `BLENDER_EEVEE_NEXT` (4.2–4.5 only) |
| View transform (H) | `Filmic` (≤3.6 default) | `AgX` (4.0+ default), `Khronos PBR Neutral` (4.2+) |
| Sky texture types (H) | `NISHITA` (≤4.5) | `SINGLE_SCATTERING` / `MULTIPLE_SCATTERING` (5.x); `dust_density` → `aerosol_density` |
| Actions and F-curves (H) | `action.fcurves` | 4.4+ slotted actions; 5.0 removed `Action.fcurves`: use `action.layers[i].strips[j].channelbag(slot).fcurves` (H: `fcurves(obj)`) |
| Video output (5.0) (H) | `image_settings.file_format = "FFMPEG"` | set `image_settings.media_type = "VIDEO"` first |
| Compositor (5.0) | `scene.use_nodes`, `scene.node_tree`, Composite node | `scene.compositing_node_group`, Group Output node |
| Material and world nodes (5.0) | `mat.use_nodes = True` needed | always on; setting it is deprecated (harmless) |
| Node group sockets (4.0) | `group.inputs.new(...)` | `group.interface.new_socket(name, in_out="INPUT", socket_type=...)` |
| Boolean solver (5.x) | `FAST` | `FLOAT` (`EXACT` and `MANIFOLD` also exist) |
| Light units | — | AREA, POINT and SPOT energy in watts; SUN strength in W/m² (irradiance) |

**Dynamic enums** (render engine, view transform, look, some node enums) cannot always be listed through `bl_rna` in background mode; you may see only a placeholder value. Assign inside `try/except TypeError` and fall back. The error message lists the valid values.

## Silent wrong results

- **Stale matrices:** after changing transforms, call `bpy.context.view_layer.update()` before reading `matrix_world` or bounding boxes.
- **Bounding boxes:** `obj.bound_box` is local and includes modifiers only after a depsgraph update. `obj.dimensions` includes scale. `obj.data.vertices` ignores modifiers; use `obj.evaluated_get(depsgraph)` for the real shape (H: `bbox`). Free evaluated meshes with `to_mesh_clear()`.
- **Name collisions:** creating `"Wheel"` twice gives `"Wheel.001"`. Keep references, and never look objects up by name after creating them.
- **Removed data:** a Python reference to a removed object, mesh or material crashes or raises when used. Re-fetch after deletions and after `reset_scene`.
- **Colour spaces:** a socket `default_value` is linear RGBA, so a colour picked from an sRGB image must be converted (H: `color("#hex")`). Image textures for roughness, normal or metal maps need `image.colorspace_settings.name = "Non-Color"`.
- **Rotation:** `rotation_euler` is in radians; check `rotation_mode` (defaults to XYZ). Helpers take degrees.
- **Normals:** faces created by hand can point inward and render black or invert with Solidify. Run `bmesh.ops.recalc_face_normals` (the helpers do).
- **Z-fighting:** coplanar overlapping faces flicker or show stripes. Offset them by about 0.1 mm or merge them.
- **Scale not applied:** modifiers such as Bevel and Solidify and physics use object scale. A large non-uniform scale gives uneven bevels and wrong mass. Build at size, or apply scale with `obj.data.transform(Matrix.Diagonal(...))` followed by `obj.scale = (1, 1, 1)`.
- **Drivers in restricted mode:** with `-b --factory-startup`, Python auto-execution is off. Driver expressions that touch `bpy` or use non-trivial code silently evaluate to 0, and stderr says "restricted access disallows …". Use arithmetic on `frame` plus driver variables, or pass `-y` for trusted files.
- **Glass renders dark:** stacked glass needs refraction depth. Keep `cycles.max_bounces` and `transmission_bounces` at 12 or more (H: `set_render`). `transparent_max_bounces` only affects alpha cut-outs.
- **Physics not baked:** rendering frame N without the earlier frames evaluated gives the initial state. Bake, or step through the frames in order.
- **Render output path:** `scene.render.filepath` without `write_still=True` writes nothing for stills. For animations the path is a prefix: frames become `<prefix>0001.png`.
- **Transparent film:** a PNG with alpha looks black or checkered in some viewers. Flatten onto a background when the deliverable needs one (H: `render_still(background=...)`).
- **Huge or tiny scenes:** keep `camera.clip_start` / `clip_end` sensible for the scene size, or geometry disappears.

## Quick introspection snippets

```python
print(bpy.app.version_string)
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
print([s.name for s in bsdf.inputs])                                    # real socket names
print([s.name for s in node.inputs if s.enabled])                       # any node
print(type(obj.data).bl_rna.properties.keys())                          # what a datablock exposes
print([i.identifier for i in bpy.types.ShaderNodeTexSky.bl_rna.properties["sky_type"].enum_items])
```
