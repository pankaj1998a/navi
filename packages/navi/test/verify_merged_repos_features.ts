/**
 * Verification Script: Merged GitHub Repos Features in Navi
 *
 * Tests:
 * 1. Diagram Design Tool (cathrynlavery/diagram-design)
 * 2. Context Mode Tool (mksglu/context-mode)
 * 3. PPT Master Tool (hugohe3/ppt-master)
 * 4. Andrej Karpathy Guidelines Integration (multica-ai/andrej-karpathy-skills)
 * 5. Matt Pocock Engineering Skills (mattpocock/skills)
 * 6. Extra Slash Commands Registration
 */

import { Effect, Layer } from "effect"
import { DiagramDesignTool } from "../src/tool/diagram"
import { ContextModeTool } from "../src/tool/context-mode"
import { PptMasterTool } from "../src/tool/ppt-master"
import { EXTRA_COMMANDS, EXTRA_COMMAND_DESCRIPTIONS } from "../src/slash/extra-commands"
import { InstanceRef } from "../src/effect/instance-ref"
import * as Truncate from "../src/tool/truncate"
import { Agent } from "../src/agent/agent"
import fs from "fs"
import path from "path"

async function runTests() {
  console.log("=== Testing Merged GitHub Repos Features in Navi ===\n")

  const testInstanceContext = {
    directory: "v:/pankaj/navi",
    worktree: "v:/pankaj/navi",
    project: {} as any,
  }

  const mockTruncate = Layer.succeed(Truncate.Service, {
    output: (c: string) => Effect.succeed({ truncated: false, content: c }),
  } as any)

  const mockAgent = Layer.succeed(Agent.Service, {
    get: () => Effect.succeed({} as any),
  } as any)

  const testEnvLayer = Layer.mergeAll(
    mockTruncate,
    mockAgent,
    Layer.succeed(InstanceRef, testInstanceContext as any)
  )

  // Mock Tool Context
  const mockContext = {
    sessionID: "test-session-merged-repos",
    messageID: "msg-001",
    agent: "primary",
    directory: "v:/pankaj/navi",
    worktree: "v:/pankaj/navi",
    abort: new AbortController().signal,
    callID: "call-001",
    extra: {},
    ask: async () => {},
  }

  // 1. Diagram Design Tool
  console.log("1. Testing Diagram Design Tool (cathrynlavery/diagram-design)...")
  const diagramToolInit = await Effect.runPromise(
    DiagramDesignTool.pipe(Effect.provide(testEnvLayer))
  )
  const diagramDef = await Effect.runPromise(diagramToolInit.init().pipe(Effect.provide(testEnvLayer)))
  
  // 1a. List templates
  const templateListResult = await Effect.runPromise(
    diagramDef.execute({ action: "list_templates" }, mockContext as any).pipe(
      Effect.provide(testEnvLayer)
    )
  )
  if (!templateListResult.output.includes("flowchart") || !templateListResult.output.includes("slate-dark")) {
    throw new Error("DiagramDesignTool list_templates failed")
  }

  // 1b. Lint diagram
  const lintResult = await Effect.runPromise(
    diagramDef.execute(
      { action: "lint", diagram_type: "sequence", content: "sequenceDiagram\nAlice->>Bob: Hello" },
      mockContext as any
    ).pipe(Effect.provide(testEnvLayer))
  )
  if (!(lintResult.metadata as any).valid) {
    throw new Error("DiagramDesignTool lint failed")
  }

  // 1c. Generate styled diagram
  const genDiagramResult = await Effect.runPromise(
    diagramDef.execute(
      {
        action: "generate",
        diagram_type: "flowchart",
        theme: "cyber-neon",
        title: "Test Architecture Flow",
        content: "graph TD\nA[Client] --> B[Navi Core]\nB --> C[LLM Runtime]",
      },
      mockContext as any
    ).pipe(Effect.provide(testEnvLayer))
  )
  if (!genDiagramResult.output.includes("cyber-neon") || !genDiagramResult.output.includes("mermaid")) {
    throw new Error("DiagramDesignTool generate failed")
  }
  console.log("  [PASS] Diagram Design Tool verified")

  // 2. Context Mode Tool
  console.log("\n2. Testing Context Mode Tool (mksglu/context-mode)...")
  const ctxToolInit = await Effect.runPromise(
    ContextModeTool.pipe(Effect.provide(testEnvLayer))
  )
  const ctxDef = await Effect.runPromise(ctxToolInit.init().pipe(Effect.provide(testEnvLayer)))

  // 2a. Stats
  const ctxStatsResult = await Effect.runPromise(
    ctxDef.execute({ action: "stats" }, mockContext as any).pipe(
      Effect.provide(testEnvLayer)
    )
  )
  if (!ctxStatsResult.output.includes("Context Window & Session Analytics")) {
    throw new Error("ContextModeTool stats failed")
  }

  // 2b. Doctor
  const ctxDocResult = await Effect.runPromise(
    ctxDef.execute({ action: "doctor" }, mockContext as any).pipe(
      Effect.provide(testEnvLayer)
    )
  )
  if (!ctxDocResult.output.includes("Context Health Doctor")) {
    throw new Error("ContextModeTool doctor failed")
  }

  // 2c. Compress
  const ctxCompressResult = await Effect.runPromise(
    ctxDef.execute(
      {
        action: "compress",
        content: "Line 1\n\n\n\nLine 2\n\nLine 3",
      },
      mockContext as any
    ).pipe(Effect.provide(testEnvLayer))
  )
  if (!(ctxCompressResult.metadata as any).compressedLength) {
    throw new Error("ContextModeTool compress failed")
  }
  console.log("  [PASS] Context Mode Tool verified")

  // 3. PPT Master Tool
  console.log("\n3. Testing PPT Master Tool (hugohe3/ppt-master)...")
  const pptToolInit = await Effect.runPromise(
    PptMasterTool.pipe(Effect.provide(testEnvLayer))
  )
  const pptDef = await Effect.runPromise(pptToolInit.init().pipe(Effect.provide(testEnvLayer)))

  // 3a. List styles
  const pptStylesResult = await Effect.runPromise(
    pptDef.execute({ action: "list_styles" }, mockContext as any).pipe(
      Effect.provide(testEnvLayer)
    )
  )
  if (!pptStylesResult.output.includes("MBB Consulting") || !pptStylesResult.output.includes("technical-deepdive")) {
    throw new Error("PptMasterTool list_styles failed")
  }

  // 3b. Generate deck
  const pptGenResult = await Effect.runPromise(
    pptDef.execute(
      {
        action: "generate_deck",
        topic: "Navi Next Generation Architecture",
        style: "technical-deepdive",
        slides: [
          {
            title: "Navi Core Scalability",
            layout: "title",
            points: ["Zero-dependency engine", "High-throughput Effect runtime"],
            notes: "Introduce executive overview",
          },
          {
            title: "Performance Benchmarks",
            layout: "metrics",
            points: ["10x AST indexing", "Sub-10ms tool routing"],
            notes: "Highlight speed enhancements",
          },
        ],
      },
      mockContext as any
    ).pipe(Effect.provide(testEnvLayer))
  )
  if (!pptGenResult.output.includes("Navi Core Scalability") || !pptGenResult.output.includes("marp: true")) {
    throw new Error("PptMasterTool generate_deck failed")
  }
  console.log("  [PASS] PPT Master Tool verified")

  // 4. Karpathy Guidelines Integration
  console.log("\n4. Testing Karpathy Guidelines Integration (multica-ai/andrej-karpathy-skills)...")
  const karpathySkillPath = path.resolve(__dirname, "../skills/karpathy-guidelines/SKILL.md")
  if (!fs.existsSync(karpathySkillPath)) {
    throw new Error(`Karpathy skill file missing at ${karpathySkillPath}`)
  }
  const karpathySkillContent = fs.readFileSync(karpathySkillPath, "utf-8")
  if (!karpathySkillContent.includes("Think Before Coding") || !karpathySkillContent.includes("Surgical Changes")) {
    throw new Error("Karpathy skill missing core heuristics")
  }

  const buildSwitchPrompt = fs.readFileSync(path.resolve(__dirname, "../src/session/prompt/build-switch.txt"), "utf-8")
  if (!buildSwitchPrompt.includes("Karpathy Engineering Invariants") || !buildSwitchPrompt.includes("Simplicity First")) {
    throw new Error("Build switch prompt missing Karpathy invariants")
  }
  console.log("  [PASS] Karpathy Guidelines verified")

  // 5. Matt Pocock Engineering Skills
  console.log("\n5. Testing Matt Pocock Skills (mattpocock/skills)...")
  const expectedPocockSkills = [
    "ask-matt",
    "domain-modeling",
    "improve-codebase-architecture",
    "prototype",
    "retro",
    "to-tickets",
    "wayfinder",
    "wizard",
    "chief-of-staff",
    "loop-me",
    "writing-for-agents",
  ]
  for (const s of expectedPocockSkills) {
    const sPath = path.resolve(__dirname, "../skills", s, "SKILL.md")
    if (!fs.existsSync(sPath)) {
      throw new Error(`Expected Matt Pocock skill missing: ${s}`)
    }
  }
  console.log(`  [PASS] ${expectedPocockSkills.length} Matt Pocock skills verified`)

  // 6. Slash Commands Registration
  console.log("\n6. Testing Slash Commands Registration...")
  const expectedSlashCommands = [
    "/diagram",
    "/ctx",
    "/ctx-stats",
    "/ctx-doctor",
    "/karpathy-guidelines",
    "/ppt",
    "/presentation",
    "/ask-matt",
    "/diagnose",
    "/domain-model",
    "/tdd",
    "/to-tickets",
    "/wayfinder",
    "/prototype",
  ]
  for (const cmd of expectedSlashCommands) {
    if (!EXTRA_COMMANDS.includes(cmd as any)) {
      throw new Error(`Slash command missing from EXTRA_COMMANDS: ${cmd}`)
    }
    if (!EXTRA_COMMAND_DESCRIPTIONS[cmd]) {
      throw new Error(`Description missing for slash command: ${cmd}`)
    }
  }
  console.log(`  [PASS] ${expectedSlashCommands.length} new slash commands verified`)

  // 7. Semantic Tool Discovery & Provider JSON Schema Generation
  console.log("\n7. Testing Semantic Tool Discovery & Provider JSON Schema Generation...")
  const { toJsonSchema } = await import("@navi-ai/core/effect-zod")
  
  const diagramSchema = toJsonSchema(diagramDef.parameters) as any
  if (!diagramSchema || diagramSchema.type !== "object" || !diagramSchema.properties.action) {
    throw new Error("Invalid JSON Schema generated for DiagramDesignTool")
  }

  const ctxSchema = toJsonSchema(ctxDef.parameters) as any
  if (!ctxSchema || ctxSchema.type !== "object" || !ctxSchema.properties.action) {
    throw new Error("Invalid JSON Schema generated for ContextModeTool")
  }

  const pptSchema = toJsonSchema(pptDef.parameters) as any
  if (!pptSchema || pptSchema.type !== "object" || !pptSchema.properties.action) {
    throw new Error("Invalid JSON Schema generated for PptMasterTool")
  }
  console.log("  [PASS] Provider JSON Schema serialization verified for all new tools")

  // 8. Tool Search Semantic Resolution
  console.log("\n8. Testing ToolSearch Semantic Resolution...")
  const { ToolSearchTool } = await import("../src/tool/tool-search")
  const mockRegistryService = {
    ids: () => Effect.succeed([
      "read", "write", "shell", "diagram_design", "context_mode", "ppt_master", "teammate_swarm", "magic_docs", "patch"
    ]),
  }
  const { Service: ToolRegistryService } = await import("../src/tool/registry-service")
  const toolSearchInit = await Effect.runPromise(
    ToolSearchTool.pipe(Effect.provide(testEnvLayer))
  )
  const toolSearchDef = await Effect.runPromise(toolSearchInit.init().pipe(Effect.provide(testEnvLayer)))

  const testSearchQueries = [
    { query: "generate an architecture diagram", expected: "diagram_design" },
    { query: "make a presentation slide deck", expected: "ppt_master" },
    { query: "analyze context window bloat", expected: "context_mode" },
    { query: "coordinate swarm teammates", expected: "teammate_swarm" },
  ]

  for (const { query, expected } of testSearchQueries) {
    const res = await Effect.runPromise(
      toolSearchDef.execute({ query }, mockContext as any).pipe(
        Effect.provideService(ToolRegistryService, mockRegistryService as any),
        Effect.provide(testEnvLayer)
      )
    )
    if (!res.output.includes(expected)) {
      throw new Error(`ToolSearch failed to match "${query}" to "${expected}". Output:\n${res.output}`)
    }
  }
  console.log("  [PASS] ToolSearch semantic resolution verified across 4 domains")

  // 9. Session Prompt Queue (ULID, Merging & Eviction)
  console.log("\n9. Testing Session Prompt Queue...")
  const { SessionPromptQueue } = await import("../src/session/prompt-queue")
  const queue = new SessionPromptQueue()
  const qItem1 = queue.enqueue("sess-1", "First prompt")
  const qItem2 = queue.enqueue("sess-1", "Followup instruction")
  if (!qItem1.id.startsWith("pq_") || qItem1.id.length < 20) {
    throw new Error("Prompt item ID is not a valid ULID")
  }
  const merged = queue.drainMerged("sess-1")
  if (!merged || !merged.includes("First prompt") || !merged.includes("Followup instruction")) {
    throw new Error("Prompt queue failed to drain merged followups")
  }
  if (queue.hasQueued("sess-1")) {
    throw new Error("Prompt queue retained items after drain")
  }
  console.log("  [PASS] Session Prompt Queue ULID generation and drainage verified")

  // 10. Sandbox Path Guard & Destructive Command Defense
  console.log("\n10. Testing Sandbox Path Guard & Destructive Command Defense...")
  const { SandboxPathGuard, DestructiveCommandGuard, SecretScrubber } = await import("../src/sandbox")
  
  // 10a. Path prefix containment test (e.g. /workspace-other vs /workspace)
  const fakeWorkspace = path.resolve("v:/pankaj/navi")
  const siblingFolder = path.resolve("v:/pankaj/navi-secret/passwords.txt")
  let prefixBlocked = false
  try {
    SandboxPathGuard.assertPathAllowed(siblingFolder, { mode: "workspace-write", workspaceRoot: fakeWorkspace }, true)
  } catch (err: any) {
    if (err.message.includes("SANDBOX_VIOLATION")) {
      prefixBlocked = true
    }
  }
  if (!prefixBlocked) {
    throw new Error("SandboxPathGuard failed to block sibling path prefix collision")
  }

  // 10b. Sensitive path blocking
  let sshBlocked = false
  try {
    SandboxPathGuard.assertPathAllowed("C:/Users/test/.ssh/id_rsa", { mode: "workspace-write", workspaceRoot: fakeWorkspace }, false)
  } catch (err: any) {
    if (err.message.includes("SANDBOX_VIOLATION")) {
      sshBlocked = true
    }
  }
  if (!sshBlocked) {
    throw new Error("SandboxPathGuard failed to block .ssh credential path")
  }

  // 10c. Destructive command blocking
  let formatBlocked = false
  try {
    DestructiveCommandGuard.assertCommandSafe("format C: /fs:NTFS")
  } catch (err: any) {
    if (err.message.includes("SANDBOX_VIOLATION")) {
      formatBlocked = true
    }
  }
  if (!formatBlocked) {
    throw new Error("DestructiveCommandGuard failed to block disk format command")
  }

  // 10d. Secret scrubbing
  const scrubbed = SecretScrubber.scrub("Authorization: Bearer sk-123456789012345678901234")
  if (!scrubbed.includes("[REDACTED_") || scrubbed.includes("sk-123456789012345678901234")) {
    throw new Error("SecretScrubber failed to scrub bearer/API key token")
  }
  console.log("  [PASS] Sandbox Path Guard and Destructive Command Defense verified")

  console.log("\n=== ALL MERGED GITHUB REPOS & AUDIT FIXES VERIFIED DEEPLY AND SUCCESSFULLY ===")
}

runTests().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
