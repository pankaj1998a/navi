import { RulesEngine } from "./packages/navi/src/session/rules"
import { Instance } from "./packages/navi/src/project/instance"
import { Filesystem } from "./packages/navi/src/util/filesystem"
import path from "path"

async function verify() {
  const root = process.cwd()
  const naviRulesPath = path.join(root, ".navi")
  const ruleFile = path.join(naviRulesPath, "rules.md")

  console.log("Creating mock rule file...")
  await Filesystem.write(ruleFile, "RULE: Always be extremely professional.")

  try {
    // We need to provide Instance context because RulesEngine uses Instance.worktree
    await Instance.provide({
      directory: root,
      fn: async () => {
        console.log("Fetching rules via RulesEngine...")
        const rules = await RulesEngine.getRules()
        console.log("--- DISCOVERED RULES ---")
        console.log(rules)
        console.log("------------------------")

        if (rules.includes("Always be extremely professional")) {
          console.log("SUCCESS: RulesEngine correctly discovered and read the rule file.")
        } else {
          console.log("FAILURE: RulesEngine did not find the expected rule content.")
        }
      }
    })
  } finally {
    // Cleanup
    // await Filesystem.remove(ruleFile)
  }
}

verify().catch(console.error)
