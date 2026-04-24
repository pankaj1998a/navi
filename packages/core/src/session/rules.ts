import { Effect, Layer, ServiceMap } from "effect"
import { Filesystem } from "../filesystem"
import { Instance } from "../project/instance"
import path from "path"
import { Log } from "../util/log"
import { makeRuntime } from "../effect/run-service"

export namespace RulesEngine {
  const log = Log.create({ service: "rules.engine" })

  const RULE_FILES = [
    ".navi/rules.md",
    ".cursorrules",
    ".windsurfrules",
    "RULES.md",
  ]

  export interface Interface {
    readonly getRules: () => Effect.Effect<string>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/RulesEngine") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const getRules = Effect.fn("RulesEngine.getRules")(function* () {
        const root = Instance.worktree
        const rules: string[] = []

        for (const file of RULE_FILES) {
          const filepath = path.join(root, file)
          const exists = yield* Effect.promise(() => Filesystem.exists(filepath))
          if (exists) {
            log.info("found rule file", { file })
            const content = yield* Effect.promise(() => Filesystem.readText(filepath))
            if (content.trim()) {
              rules.push(`### Rules from ${file}\n\n${content.trim()}`)
            }
          }
        }

        if (rules.length === 0) return ""

        return [
          "## Project Specific Rules",
          "The following rules were discovered in the project root and MUST be followed strictly:",
          "",
          ...rules,
        ].join("\n")
      })

      return Service.of({
        getRules,
      })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, layer)

  export async function getRules() {
    return runPromise((svc) => svc.getRules())
  }
}


