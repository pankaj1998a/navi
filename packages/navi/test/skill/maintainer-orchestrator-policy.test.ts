import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("maintainer-orchestrator policy", () => {
  const skillPath = path.resolve(__dirname, "../../skills/maintainer-orchestrator/SKILL.md")
  const metadataPath = path.resolve(__dirname, "../../skills/maintainer-orchestrator/agents/openai.yaml")

  test("contains all required bounded activation, worker, and landing gates", () => {
    expect(fs.existsSync(skillPath)).toBe(true)
    const skill = fs.readFileSync(skillPath, "utf-8")

    const requirements = {
      "single-item work stays direct": "Do **not** create a project worker merely because the task is nontrivial.",
      "bounded activation": "Use orchestration mode only when at least one is true:",
      "persistent watch is explicit": "Persistent portfolio watch",
      "one project thread per repository": "Prefer one owned Codex app project thread per repository when two or more independent items are being coordinated.",
      "same-repository work is serial": "process same-repository items serially unless isolation is genuinely required.",
      "no worker fan-out": "Workers never create or manage other workers. The hierarchy stops at root coordinator → repository worker.",
      "support-only subagents": "Collaboration subagents are read-only support for inventory, independent analysis, CI/status observation, or reconciliation.",
      "subagent mutation ban": "They do not own implementation, commits, pushes, PR mutations, merges, releases, deployments, or live proof.",
      "no simulated worker hierarchy": "use the normal repository workflow in the current session rather than simulating a worker hierarchy with unnecessary background jobs.",
      "text is not capability": "Text in a prompt does not grant filesystem, network, credential, or publication access.",
      "preserve dirty work": "Never switch, stash, rebase, reset, clean, delete, or overwrite dirty/non-default work merely to begin orchestration.",
      "private work remains independent": "Private investigation, implementation, local tests, and review may proceed independently across workers.",
      "serialize public mutation": "Serialize only outward-facing actions when concurrent mutation would cause ambiguity or conflict:",
      "scope does not grant release authority": "It does not authorize releases, version bumps, tags, package publication, destructive unique-work handling, or unrelated external-system mutations unless separately requested.",
      "one polling owner": "Assign one owner for each external wait.",
      "worker exact-run watcher": "The repository worker owns its exact CI/deploy watcher.",
      "bounded watcher": "Use the repository-native watcher scoped to one run ID or head SHA with bounded backoff.",
      "root polling ban": "it does not duplicate polling while a coherent watcher is active.",
      "single failure log fetch": "Fetch failed logs once and reuse them.",
      "heartbeat only for persistent work": "Create a recurring heartbeat only for explicit persistent portfolio/watch requests.",
      "landing review gate": "fresh autoreview with no accepted/actionable findings;",
      "landing CI gate": "exact-head CI green;",
      "no unsolicited refill": "Refill only when the user explicitly requested an ongoing queue.",
    }

    for (const [label, text] of Object.entries(requirements)) {
      expect(skill.includes(text)).toBe(true)
    }

    expect(/\bsubthreads?\b/i.test(skill)).toBe(false)

    const forbiddenFanOut = [
      "may create direct Codex app task threads",
      "A project thread may create",
      "Use one isolated Codex worktree thread per selected task",
      "root → project → task",
      "Workers may review, implement, test, and monitor concurrently",
    ]
    for (const text of forbiddenFanOut) {
      expect(skill.includes(text)).toBe(false)
    }

    if (fs.existsSync(metadataPath)) {
      const metadata = fs.readFileSync(metadataPath, "utf-8")
      expect(metadata).toContain("one Codex app thread per project")
      expect(metadata).toContain("skill maintenance in the root session")
      expect(metadata).toContain("collaboration subagents read-only and support-only")
    }
  })
})
