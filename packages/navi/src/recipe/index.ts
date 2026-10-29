/**
 * Deterministic Workflow Recipes Engine
 * Inspired by Goose (crates/goose/src/recipe/).
 * Allows defining, validating, parameterizing, and executing structured AI workflows.
 */

import path from "node:path"
import fs from "node:fs"
// @ts-ignore
import yaml from "js-yaml"

export interface RecipeParameter {
  name: string
  description?: string
  required?: boolean
  default?: string | number | boolean
}

export interface RecipeStep {
  name: string
  description?: string
  tool?: string
  command?: string
  prompt?: string
  skill?: string
  condition?: string
  on_failure?: "stop" | "continue" | "retry"
}

export interface RecipeManifest {
  version: string
  title: string
  description: string
  parameters?: Record<string, RecipeParameter>
  steps: RecipeStep[]
  metadata?: Record<string, any>
}

export interface RecipeExecutionResult {
  recipe: string
  success: boolean
  totalSteps: number
  completedSteps: number
  stepOutputs: Array<{
    step: string
    success: boolean
    output?: string
    error?: string
    durationMs: number
  }>
  totalDurationMs: number
}

export class RecipeEngine {
  static loadRecipe(filePath: string): RecipeManifest {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Recipe file not found: ${resolved}`)
    }

    const content = fs.readFileSync(resolved, "utf8")
    let parsed: any
    if (resolved.endsWith(".yaml") || resolved.endsWith(".yml")) {
      parsed = yaml.load(content)
    } else if (resolved.endsWith(".json")) {
      parsed = JSON.parse(content)
    } else {
      try {
        parsed = yaml.load(content)
      } catch {
        parsed = JSON.parse(content)
      }
    }

    this.validateRecipe(parsed)
    return parsed as RecipeManifest
  }

  static validateRecipe(manifest: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!manifest || typeof manifest !== "object") {
      errors.push("Recipe manifest must be a non-empty object")
      return { valid: false, errors }
    }

    if (!manifest.title || typeof manifest.title !== "string") {
      errors.push("Recipe missing required string 'title'")
    }

    if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
      errors.push("Recipe must contain a non-empty array of 'steps'")
    } else {
      manifest.steps.forEach((step: any, idx: number) => {
        if (!step || typeof step !== "object") {
          errors.push(`Step [${idx}] is not an object`)
        } else if (!step.name) {
          errors.push(`Step [${idx}] missing required 'name'`)
        } else if (!step.command && !step.prompt && !step.skill && !step.tool) {
          errors.push(`Step [${idx}] ('${step.name}') must specify at least one of 'command', 'prompt', 'skill', or 'tool'`)
        }
      })
    }

    if (errors.length > 0) {
      throw new Error(`Invalid recipe manifest: ${errors.join("; ")}`)
    }

    return { valid: true, errors: [] }
  }

  static discoverRecipes(searchDirs: string[]): Array<{ name: string; path: string; title: string; description: string }> {
    const recipes: Array<{ name: string; path: string; title: string; description: string }> = []

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml") || entry.name.endsWith(".json"))) {
            const fullPath = path.join(dir, entry.name)
            try {
              const manifest = this.loadRecipe(fullPath)
              recipes.push({
                name: path.basename(entry.name, path.extname(entry.name)),
                path: fullPath,
                title: manifest.title,
                description: manifest.description || "",
              })
            } catch {
              // Ignore non-recipe YAML files
            }
          }
        }
      } catch {
        // Skip unreadable dirs
      }
    }

    return recipes
  }

  static interpolate(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
      const trimmed = key.trim()
      return vars[trimmed] !== undefined ? String(vars[trimmed]) : `{{${trimmed}}}`
    })
  }
}
