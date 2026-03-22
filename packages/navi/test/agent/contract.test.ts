import { expect, test } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { buildAgentContract, renderSubagentContractSection } from "../../src/agent/contract"

test("investigator contract stays read-focused and stage-based", () => {
  const contract = buildAgentContract({
    name: "investigator",
    mode: "subagent",
    description: "Large-codebase analysis and mapping specialist",
    permission: PermissionNext.fromConfig({
      "*": "deny",
      read: "allow",
      list: "allow",
      glob: "allow",
      grep: "allow",
      codesearch: "allow",
      investigate: "allow",
      map_codebase: "allow",
      bash: "allow",
      websearch: "allow",
      webfetch: "allow",
      question: "allow",
    }),
  } as any)

  expect(contract.allowedActions.some((x) => x.includes("Modify files"))).toBe(false)
  expect(contract.allowedActions.some((x) => x.includes("Inspect the codebase"))).toBe(true)
  expect(contract.successCriteria.join(" ")).toContain("reusable map")
  expect(contract.successCriteria.join(" ")).toContain("staged")
  expect(contract.expectedOutputShape.join(" ")).toContain("Directory-by-directory lookup")
  expect(renderSubagentContractSection("investigator", contract)).toContain("Subagent Contract")
  expect(renderSubagentContractSection("investigator", contract)).toContain("Contract owner: investigator")
})
