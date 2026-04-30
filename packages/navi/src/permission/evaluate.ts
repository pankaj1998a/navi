import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

const SAFE_PERMISSIONS = ["read", "glob", "grep", "websearch", "webfetch", "skill", "todowrite", "task"]

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  if (match) return match

  const action = SAFE_PERMISSIONS.includes(permission) ? "allow" : "ask"
  return { action, permission, pattern: "*" }
}

