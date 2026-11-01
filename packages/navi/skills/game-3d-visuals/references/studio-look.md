# Studio look on a white background

A common reference style: a single subject on a seamless pure-white background, soft studio light, a soft contact shadow under the subject, crisp highlights. Two things usually go wrong when recreating it:

- **The background turns gray.** A white floor or world lit by the scene renders below 255, especially under AgX/Filmic, and dimming the lights to get contrast makes it worse.
- **The subject looks flat.** Brightening the world to rescue the background washes out the subject's shading and highlights.

Fix both by separating what the camera sees in the background from what lights the subject.

## Blender (Cycles; works in Blender 4.x and 5.x)

```python
import bpy

scene = bpy.context.scene
scene.view_settings.view_transform = "Standard"   # white stays 255; AgX/Filmic gray it out
scene.view_settings.look = "None"

world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld")
light_path = nt.nodes.new("ShaderNodeLightPath")
camera_bg = nt.nodes.new("ShaderNodeBackground")       # what the camera sees: pure white
camera_bg.inputs["Color"].default_value = (1, 1, 1, 1)
camera_bg.inputs["Strength"].default_value = 1.0
ambient = nt.nodes.new("ShaderNodeBackground")         # what lights the subject: dim neutral fill
ambient.inputs["Color"].default_value = (1, 1, 1, 1)
ambient.inputs["Strength"].default_value = 0.15        # lower = darker shadow side, more contrast
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(light_path.outputs["Is Camera Ray"], mix.inputs[0])
nt.links.new(ambient.outputs[0], mix.inputs[1])
nt.links.new(camera_bg.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs["Surface"])

# Ground: a large plane under the subject that only receives shadows.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))   # z = bottom of the subject
bpy.context.active_object.is_shadow_catcher = True

# Key: one large area light, above and to the side the reference's highlights and shadow imply.
key = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "AREA"))
key.data.energy, key.data.size = 600, 3.0     # scale energy with distance; size sets shadow softness
scene.collection.objects.link(key)
key.location = (-3, -3, 5)                    # then aim it at the subject
```

Measured on a test scene (dark cube + cream sphere, ambient 0.35): background corners 255 (vs 181–209 with a plain white world at strength 0.6 plus a white floor under AgX), soft contact shadow kept, stronger form contrast. The default above is lower (0.15) because object renders with 0.35, measured against their references, still came out with shadow sides about 25 levels lighter than their references.

Tune against the reference, in this order: the key direction from where the reference's highlights and shadow fall; `ambient` strength for shadow-side darkness; key `size` for shadow softness; a weak fill or rim light only if the reference shows lit shadow sides or edge highlights. Then check corner pixels are 255 and the subject's darkest and brightest areas match the reference's.

## three.js

`scene.background = new THREE.Color(0xffffff)`; ground plane with `THREE.ShadowMaterial({ opacity: 0.2 })` and `receiveShadow`; one `DirectionalLight` (or `SpotLight`) with `castShadow` and a soft shadow map (`PCFSoftShadowMap`, larger `shadow.radius`), plus a low-intensity `HemisphereLight` or `RoomEnvironment` for fill; `renderer.toneMapping = THREE.NoToneMapping` (or keep ACES and verify the background still reads #FFFFFF).
