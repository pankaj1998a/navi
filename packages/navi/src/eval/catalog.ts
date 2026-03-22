import z from "zod"

export const BenchmarkCase = z
  .object({
    id: z.string(),
    mode: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
  })
  .meta({
    ref: "EvalBenchmarkCase",
  })
export type BenchmarkCase = z.infer<typeof BenchmarkCase>

export const VerificationGate = z
  .object({
    id: z.string(),
    description: z.string(),
    required: z.boolean().default(true),
  })
  .meta({
    ref: "VerificationGate",
  })
export type VerificationGate = z.infer<typeof VerificationGate>

export const VerificationProfile = z
  .object({
    mode: z.string(),
    description: z.string(),
    gates: z.array(VerificationGate),
  })
  .meta({
    ref: "VerificationProfile",
  })
export type VerificationProfile = z.infer<typeof VerificationProfile>

export const DEFAULT_BENCHMARKS: BenchmarkCase[] = [
  { id: "build-refactor", mode: "build", description: "Implement a focused feature and pass verification", tags: ["coding", "verification"] },
  { id: "ask-explain", mode: "ask", description: "Explain code precisely without unnecessary edits", tags: ["explanation", "accuracy"] },
  { id: "vibemode-orchestrate", mode: "vibemode", description: "Delegate work and enforce quality gates", tags: ["orchestration", "delegation"] },
  { id: "researcher-synthesize", mode: "researcher", description: "Produce evidence-backed synthesis with citations", tags: ["research", "synthesis"] },
  { id: "review-findings", mode: "review", description: "Identify real regressions and missing tests", tags: ["review", "quality"] },
  { id: "qa-validate", mode: "qa", description: "Catch bugs and validation gaps", tags: ["qa", "regression"] },
]

export const DEFAULT_VERIFICATION_PROFILES: VerificationProfile[] = [
  {
    mode: "build",
    description: "Verification gates for implementation work",
    gates: [
      { id: "diff-review", description: "Review the changed files and summarize the behavioral impact", required: true },
      { id: "lint", description: "Run lint or static checks when available", required: true },
      { id: "tests", description: "Run targeted tests that cover the changed behavior", required: true },
      { id: "build", description: "Run a build or typecheck when the project supports it", required: false },
    ],
  },
  {
    mode: "review",
    description: "Verification gates for code review tasks",
    gates: [
      { id: "evidence", description: "Attach concrete file references and failure evidence for each finding", required: true },
      { id: "severity", description: "Assign a defensible severity to each finding", required: true },
      { id: "tests-gap", description: "Call out missing or insufficient regression coverage", required: true },
    ],
  },
  {
    mode: "researcher",
    description: "Verification gates for research and synthesis tasks",
    gates: [
      { id: "sources", description: "Use primary or directly relevant sources", required: true },
      { id: "freshness", description: "Check source freshness for time-sensitive claims", required: true },
      { id: "contradictions", description: "Call out contradictions or unresolved uncertainty", required: true },
      { id: "confidence", description: "State confidence and the limiting factors", required: true },
    ],
  },
  {
    mode: "qa",
    description: "Verification gates for validation and QA tasks",
    gates: [
      { id: "repro", description: "Document reproduction steps and observed behavior", required: true },
      { id: "expected", description: "State the expected behavior or acceptance criteria", required: true },
      { id: "regression", description: "Check for nearby regression risk, not only the reported issue", required: true },
    ],
  },
  {
    mode: "vibemode",
    description: "Verification gates for orchestrated multi-agent work",
    gates: [
      { id: "handoff", description: "Summarize what each delegated agent produced", required: true },
      { id: "reviewer", description: "Run a reviewer or QA pass before finalizing", required: true },
      { id: "stop-criteria", description: "Stop only after the requested outcome is verified or a blocker is explicit", required: true },
    ],
  },
]

export function getVerificationProfile(mode: string) {
  return DEFAULT_VERIFICATION_PROFILES.find((profile) => profile.mode === mode)
}
