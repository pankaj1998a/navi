---
name: threejs
description: Three.js 3D reference hub. Use when working with Three.js: pick the topic below and read its file for patterns and API guidance.
source: https://github.com/CloudAI-X/threejs-skills
license: MIT
---

# Three.js

This skill is a hub: one catalog row pointing at ten topic references.
When the task touches a topic, read that topic's file in one hop: join
its `references/threejs-<topic>.md` path against the `skill-dir` value in
this body's wrapper header and pass the absolute path to the file-reading tool.

- `references/threejs-fundamentals.md` — scene setup, cameras, renderer, Object3D hierarchy, coordinate systems.
- `references/threejs-geometry.md` — built-in shapes, BufferGeometry, custom geometry, instancing.
- `references/threejs-materials.md` — PBR, basic, phong, shader materials, material properties.
- `references/threejs-lighting.md` — light types, shadows, environment lighting.
- `references/threejs-textures.md` — texture types, UV mapping, environment maps, texture settings.
- `references/threejs-animation.md` — keyframe and skeletal animation, morph targets, animation mixing.
- `references/threejs-loaders.md` — GLTF, textures, images, models, async loading patterns.
- `references/threejs-shaders.md` — GLSL, ShaderMaterial, uniforms, custom effects.
- `references/threejs-postprocessing.md` — EffectComposer, bloom, depth of field, screen effects (for WebGPU, follow the correction below).
- `references/threejs-interaction.md` — raycasting, controls, mouse/touch input, object selection.

## Corrections to the references

The reference files are upstream text, kept unchanged. Where a correction
below covers a section, follow the correction.

- `references/threejs-postprocessing.md`, "WebGPU Post-Processing": its
  `three/addons/nodes/Nodes.js` import no longer exists (removed in r167), and
  r183 renamed `PostProcessing` to `RenderPipeline`. The `EffectComposer`
  passes in that file work only with `WebGLRenderer`. With `WebGPURenderer`,
  build the chain from `three/webgpu`, `three/tsl`, and the node effects in
  `three/addons/tsl/display/` (checked against three 0.186.1):

  ```html
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
        "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
        "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.tsl.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
      }
    }
  </script>
  ```

  ```javascript
  import { WebGPURenderer, RenderPipeline } from "three/webgpu";
  import { pass } from "three/tsl";
  import { bloom } from "three/addons/tsl/display/BloomNode.js";

  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();

  const renderPipeline = new RenderPipeline(renderer); // PostProcessing before r183
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  renderPipeline.outputNode = sceneColor.add(bloom(sceneColor, 0.5, 0.4, 0.85)); // strength, radius, threshold

  renderer.setAnimationLoop(() => renderPipeline.render()); // not renderer.render()
  ```
