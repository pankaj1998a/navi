import { Wildcard } from "@/util/wildcard"
import { Policy } from "./policy"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/**
 * Return the last matching rule, or `undefined` when no rule applies.
 *
 * Unlike `evaluate`, this lets the runtime distinguish an explicit `ask` rule
 * from the default (no rule) so the configured mode can supply the fallback.
 */
export function match(permission: string, pattern: string, ...rulesets: Rule[][]): Rule | undefined {
  const rules = rulesets.flat()
  return rules.findLast(
    (rule) =>
      Wildcard.match(permission, rule.permission) && Policy.matchesPattern(permission, pattern, rule.pattern),
  )
}

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  return match(permission, pattern, ...rulesets) ?? { action: "ask", permission, pattern: "*" }
}

export * as Evaluate from "./evaluate"
