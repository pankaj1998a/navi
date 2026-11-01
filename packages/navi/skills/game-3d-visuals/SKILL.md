---
name: game-3d-visuals
description: Use for 3D work where the user wants a polished, art-directed look: recreating an object or scene from reference image(s), modeling and rendering in Blender, or an explicit ask for high visual fidelity in a three.js, WebGL/WebGPU or game-engine scene. It adds consistent reference images, a detailed visual PRD, a blockout gate and a render-vs-reference acceptance loop, run as a fixed Workflow script when the workflow tool is available, which takes much longer than a direct build. Skip it for quick prototypes or playable pages where a fast working result matters more, small edits, and 2D work. When it applies, read it before tool-specific skills such as blender or threejs and use those for technique.
---

# Reference-driven 3D and game visuals

Goal: a result that looks art-directed, not like programmer art. The lever is a sharp visual target written down with numbers (consistent reference images and a detailed visual PRD) and independent comparisons of the real output against it, repeated until they match.

## When to run the full process

Run the procedure below when the user wants a polished, art-directed result: a reference image to match, a Blender model or render, or an explicit ask for high visual fidelity. It takes much longer than a direct build. For a quick prototype or a playable page where a fast working result matters more, do not run it: build directly (read and follow `web3d` or `browser-game` first when they are in your skill list) and answer the user's follow-up messages without waiting on long work.

## Required procedure (when it applies)

When it applies, this skill owns the process. If `blender`, `threejs` or another tool skill is also loaded, use it only as a technique reference (the builder inside the workflow reads it); do not follow its own step-by-step process instead of this one.

**A newer user message always wins over this method.** When the user writes while you work, read it first.
If it asks for no change (for example thanks, praise or a side question), answer it in a sentence and keep following
the procedure: wait for the running stage and launch the next one. Otherwise stop the loop at once: no more pipeline
stages, stage status checks, renders or reviews. Then do what they asked:
- Stop, exit, cancel or done: stop the running stage with `{{tool:work_stop}}` (skip this if they ask for no tool calls),
  reply in a sentence, and make no other tool calls.
- "Open it" or "just open it": open the delivered file and stop; if it does not exist yet, say so in a sentence and stop. Do not wait for a running stage or check it again.
- "Don't test", "I'll check it myself", or a new plan: drop the remaining stages and follow the new instruction.

After a stop, exit, cancel or new plan, a stage result that arrives later starts nothing: do not launch the next
stage or build from it; at most say in a sentence that the stage ended.

If the `{{tool:workflow}}` tool is in your tool list, steps 2–5 of this skill **are** the fixed Workflow script `scripts/visual_pipeline.js` shipped with it: you load it as is, you do not write, copy or edit any workflow code. Writing the PRD, the build or the reviews yourself instead does not count as following this procedure: the independent PRD reviewer and the independent visual reviewers are the point, and they only exist inside the workflow. `<skill dir>` is the directory of this SKILL.md, shown as `path:` in the {{tool:read_skill}} result.

1. **References** (done by you; details in references/process.md section 1): view the input, run `{{tool:image_generation}}` if offered, and put the references in `visual-plan/refs/`.
2. **Run the pipeline in three stages**: call the shipped script three times, one stage per call, loading it directly by its absolute path (the hash pins its exact bytes). Use the same args every time and change only `stages` and the run's `name` (the tool refuses a call without one): first `["prd"]` with `name="visual-pipeline-prd"`, then `["build"]` with `"visual-pipeline-build"`, then `["accept"]` with `"visual-pipeline-accept"`.
   ```
   workflow(name="visual-pipeline-prd",
            scriptPath="<skill dir>/scripts/visual_pipeline.js",
            expectedScriptHash="sha256:1e440d13ccd05b75286cc06d3fca70145a012b50165b92a442c11428c87d1d79",
            args={"request": "<the user's request, verbatim>",
                  "references": ["visual-plan/refs/hero.png", "visual-plan/refs/side.png"],
                  "output": "/app/render.png",
                  "deliverables": ["/app/render.png", "/app/scene.blend"],
                  "source": "/app/build_scene.py",
                  "build": "blender -b --python /app/build_scene.py",
                  "skillDir": "<skill dir>",
                  "measure": "blender -b --factory-startup --python <skill dir>/scripts/tone_compare.py -- visual-plan/refs/hero.png /app/render.png",
                  "maxReviewRounds": 0, "maxRounds": 1,
                  "stages": ["prd"]})
   ```
   Pass `args` as a JSON object, not a JSON-encoded string. Adapt `output`, `deliverables` (every file the task requires), `source` and `build` to the task (for a game: a screenshot path, the main source file, and the command that rebuilds and captures it; omit `measure` outside Blender). The stages are: `prd` (a PRD author writes visual-plan/PRD.md), `build` (a builder implements it, blockout gate first, best copy kept), `accept` (two independent reviewers who see only the reference and the output; unless both accept, a fixer writes "Polish round 1" into the PRD, fixes, rebuilds, keeps the best). `maxReviewRounds` above 0 adds independent PRD review rounds and `maxRounds` above 1 adds acceptance rounds, each at a large time cost.
3. **Keep the user informed, without stopping**: each stage can take a long time and the user sees only a status line while it runs, so report progress through your todo tool (for example `{{tool:write_todos}}`), which the user can see and which does not end your turn. Before the `prd` stage, create three todo items: "Visual plan (PRD)", "Build", "Acceptance and fix". When a stage's result arrives with `status: "ok"`, look at what it produced, mark its item done with a one-line result in the item text, and launch the next stage. Do not ask a question or wait for an answer between stages; do not edit the same files while a stage runs. If the user asks for a stop, the file or a change while a stage runs, follow the rule above: do not launch the next stage, and do not poll or wait on the running one. The one-line results:
   - `prd`: the visual target in a few words, the number of main parts and of acceptance criteria.
   - `build`: the path of the first complete output and what still looks off.
   - `accept`: the reviewers' main remaining difference and whether the new or the best earlier version was kept.
4. **Check and finish**: if a result is `invalid_arguments`, relaunch that stage with the missing args. If a stage result has `status: "failed"`, do not launch the next stage: put the failed `step` in that stage's todo item and report it in the final message. After the `accept` stage, confirm the deliverables exist and view the output once, then give the final message.

Without the `{{tool:workflow}}` tool, read [references/process.md](references/process.md) and follow it yourself, using a subagent tool (if offered) for the independent reviews.

## Final message

What was built, where the deliverables are, how many acceptance rounds ran, and the remaining visible differences, if any.
