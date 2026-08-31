import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export const DENYSET: Rule[] = [
  { permission: "*", pattern: "rm -rf /", action: "deny" },
  { permission: "*", pattern: "mkfs*", action: "deny" },
  { permission: "*", pattern: "dd of=/dev*", action: "deny" },
  { permission: "*", pattern: "curl *|*sh", action: "deny" },
  { permission: "*", pattern: "wget *|*sh", action: "deny" },
]

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  for (const rule of DENYSET) {
    if (Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) return rule
  }
  const rules = rulesets.flat()
  const denyMatch = rules.find(
    (rule) => rule.action === "deny" && Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  if (denyMatch) return denyMatch
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
