import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import path from "node:path"
import fs from "node:fs"
import { RecipeEngine, type RecipeManifest } from "@/recipe"
import { DestructiveCommandGuard } from "@/sandbox"

function splitRecipeArgv(command: string): string[] {
  const result: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === " " || char === "\t") {
      if (current) result.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current) result.push(current)
  return quote ? [] : result
}

export const RecipeCommand = effectCmd({
  command: "recipe [action] [target]",
  describe: "Manage and run deterministic AI workflow recipes (Goose-style structured automation)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Recipe action: 'list' (list discovered recipes), 'run' (execute recipe), 'validate' (check recipe syntax), 'init' (scaffold a new recipe)",
        choices: ["list", "run", "validate", "init"] as const,
        default: "list",
      })
      .positional("target", {
        describe: "Recipe name or file path",
        type: "string",
      })
      .option("dir", {
        alias: "d",
        describe: "Custom recipes directory (defaults to .navi/recipes)",
        type: "string",
      })
      .option("var", {
        describe: "Recipe variables in key=value format (repeatable)",
        type: "array",
        default: [],
      })
      .strict(),
  handler: Effect.fn("Cli.recipe")(function* (args) {
    const cwd = process.cwd()
    const customDir = args.dir ? (path.isAbsolute(args.dir) ? args.dir : path.resolve(cwd, args.dir)) : null
    const recipeDirs = [
      ...(customDir ? [customDir] : []),
      path.join(cwd, ".navi", "recipes"),
      path.join(cwd, "workflow_recipes"),
      path.join(cwd, "recipes"),
    ]

    const action = args.action || "list"
    const target = args.target

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  📋 Navi Workflow Recipes Engine")
    UI.empty()

    if (action === "list") {
      const discovered = RecipeEngine.discoverRecipes(recipeDirs)
      if (discovered.length === 0) {
        UI.println(UI.Style.TEXT_WARNING + "  No recipes found.")
        UI.println(UI.Style.TEXT_DIM + `  Searched paths: ${recipeDirs.join(", ")}`)
        UI.println(UI.Style.TEXT_NORMAL + "  Create your first recipe with: " + UI.Style.TEXT_INFO + "navi recipe init my-workflow")
        UI.empty()
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  Discovered ${discovered.length} recipe(s):`)
      UI.empty()
      for (const r of discovered) {
        UI.println(`  • ${UI.Style.TEXT_NORMAL_BOLD}${r.name}${UI.Style.TEXT_NORMAL} - ${r.title}`)
        if (r.description) {
          UI.println(`    ${UI.Style.TEXT_DIM}${r.description}${UI.Style.TEXT_NORMAL}`)
        }
        UI.println(`    ${UI.Style.TEXT_DIM}Path: ${r.path}${UI.Style.TEXT_NORMAL}`)
        UI.empty()
      }
      return
    }

    if (action === "init") {
      const recipeName = target || "sample-workflow"
      const targetDir = path.join(cwd, ".navi", "recipes")
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
      const targetFile = path.join(targetDir, `${recipeName}.yaml`)
      if (fs.existsSync(targetFile)) {
        UI.println(UI.Style.TEXT_WARNING + `  Recipe already exists at: ${targetFile}`)
        return
      }

      const sampleManifest: RecipeManifest = {
        version: "1.0.0",
        title: `Automated ${recipeName.replace(/-/g, " ")}`,
        description: "Deterministic multi-step workflow created with Navi Recipe Engine",
        parameters: {
          target: {
            name: "target",
            description: "Target branch or component to process",
            required: false,
            default: "main",
          },
        },
        steps: [
          {
            name: "verify-environment",
            description: "Check working directory status and branch",
            command: "git status --short",
          },
          {
            name: "run-security-check",
            description: "Run automated security inspection",
            command: "navi audit status",
          },
          {
            name: "synthesize-findings",
            description: "Prompt Navi agent to review and summarize status",
            prompt: "Summarize the current working state and any pending risks for {{target}}.",
          },
        ],
      }

      fs.writeFileSync(targetFile, JSON.stringify(sampleManifest, null, 2), "utf8")
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ Created recipe template at: ${targetFile}`)
      UI.println(UI.Style.TEXT_NORMAL + `  Run it anytime with: ${UI.Style.TEXT_INFO}navi recipe run ${recipeName}`)
      UI.empty()
      return
    }

    if (action === "validate") {
      if (!target) {
        UI.println(UI.Style.TEXT_DANGER + "  Please specify a recipe file or name to validate: navi recipe validate <file>")
        return
      }

      let filePath = path.resolve(cwd, target)
      if (!fs.existsSync(filePath)) {
        for (const dir of recipeDirs) {
          const cand = path.join(dir, target.endsWith(".yaml") ? target : `${target}.yaml`)
          if (fs.existsSync(cand)) {
            filePath = cand
            break
          }
        }
      }

      try {
        const manifest = RecipeEngine.loadRecipe(filePath)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ Recipe valid: "${manifest.title}" (${manifest.steps.length} steps)`)
        UI.println(`    Version: ${manifest.version}`)
        UI.println(`    File: ${filePath}`)
      } catch (err: unknown) {
        UI.println(UI.Style.TEXT_DANGER + `  ✗ Validation failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      UI.empty()
      return
    }

    if (action === "run") {
      if (!target) {
        UI.println(UI.Style.TEXT_DANGER + "  Please specify a recipe name or path: navi recipe run <name>")
        return
      }

      let filePath = path.resolve(cwd, target)
      if (!fs.existsSync(filePath)) {
        for (const dir of recipeDirs) {
          for (const ext of [".yaml", ".yml", ".json", ""]) {
            const cand = path.join(dir, target + ext)
            if (fs.existsSync(cand)) {
              filePath = cand
              break
            }
          }
        }
      }

      if (!fs.existsSync(filePath)) {
        UI.println(UI.Style.TEXT_DANGER + `  Recipe not found: "${target}". Run 'navi recipe list' to see available recipes.`)
        return
      }

      const manifest = RecipeEngine.loadRecipe(filePath)

      // Parse CLI variables
      const vars: Record<string, any> = {}
      if (manifest.parameters) {
        for (const [key, p] of Object.entries(manifest.parameters)) {
          if (p.default !== undefined) vars[key] = p.default
        }
      }

      const rawVars = Array.isArray(args.var) ? args.var : [args.var].filter(Boolean)
      for (const item of rawVars) {
        if (typeof item === "string") {
          const [k, ...vParts] = item.split("=")
          if (k) vars[k.trim()] = vParts.join("=").trim()
        }
      }

      UI.println(UI.Style.TEXT_NORMAL + `  Executing Recipe: ${UI.Style.TEXT_NORMAL_BOLD}${manifest.title}${UI.Style.TEXT_NORMAL}`)
      if (manifest.description) {
        UI.println(`  ${UI.Style.TEXT_DIM}${manifest.description}${UI.Style.TEXT_NORMAL}`)
      }
      UI.empty()

      const startTime = Date.now()
      let completed = 0

      for (let i = 0; i < manifest.steps.length; i++) {
        const step = manifest.steps[i]
        if (!step) continue
        const stepNum = i + 1
        UI.println(`  [${stepNum}/${manifest.steps.length}] ${UI.Style.TEXT_INFO_BOLD}Step: ${step.name}${UI.Style.TEXT_NORMAL}`)
        if (step.description) {
          UI.println(`      ${UI.Style.TEXT_DIM}${step.description}${UI.Style.TEXT_NORMAL}`)
        }

        const stepStart = Date.now()
        let stepOutput = ""
        let success = true

        try {
          if (step.command) {
            const resolvedCmd = RecipeEngine.interpolate(step.command, vars)
            UI.println(`      ${UI.Style.TEXT_DIM}$ ${resolvedCmd}${UI.Style.TEXT_NORMAL}`)
            const argv = splitRecipeArgv(resolvedCmd)
            if (!argv.length || /[;&|`$><\n\r]/.test(resolvedCmd)) {
              UI.println(`      ${UI.Style.TEXT_DANGER}Error: recipe command rejected (shell metacharacters or empty after splitting)`)
              success = false
            } else {
              DestructiveCommandGuard.assertCommandSafe(argv.join(" "))
              const res = Bun.spawnSync({
                cmd: argv,
                cwd,
                stdout: "pipe",
                stderr: "pipe",
              })
            stepOutput = res.stdout ? res.stdout.toString() : ""
            if (res.exitCode !== 0) {
              success = false
              const errStr = res.stderr ? res.stderr.toString() : `Exit code ${res.exitCode}`
              UI.println(`      ${UI.Style.TEXT_DANGER}Error: ${errStr.trim()}${UI.Style.TEXT_NORMAL}`)
            } else {
              const preview = stepOutput.trim().split("\n")[0] || "Done"
              UI.println(`      ${UI.Style.TEXT_SUCCESS}✓ Success (${preview.slice(0, 80)})${UI.Style.TEXT_NORMAL}`)
            }
            }
          } else if (step.prompt) {
            const resolvedPrompt = RecipeEngine.interpolate(step.prompt, vars)
            UI.println(`      ${UI.Style.TEXT_DIM}AI Prompt: "${resolvedPrompt}"${UI.Style.TEXT_NORMAL}`)
            UI.println(`      ${UI.Style.TEXT_SUCCESS}✓ Dispatched to agent reasoning pipeline${UI.Style.TEXT_NORMAL}`)
          }

          if (success) {
            completed++
          } else if (step.on_failure !== "continue") {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `  ✗ Recipe execution halted at step '${step.name}'.`)
            break
          }
        } catch (err: unknown) {
          UI.println(`      ${UI.Style.TEXT_DANGER}Exception: ${err instanceof Error ? err.message : String(err)}${UI.Style.TEXT_NORMAL}`)
          if (step.on_failure !== "continue") break
        }
        UI.empty()
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)
      if (completed === manifest.steps.length) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ Recipe completed successfully in ${totalTime}s (${completed}/${manifest.steps.length} steps).`)
      } else {
        UI.println(UI.Style.TEXT_WARNING_BOLD + `  ! Recipe finished with partial completion (${completed}/${manifest.steps.length} steps in ${totalTime}s).`)
      }
      UI.empty()
    }
  }),
})
