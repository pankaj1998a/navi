# Navi vs DeepSeek Harness — Deep Comparison & Improvement Roadmap

| Field | Value |
|---|---|
| Title | Navi vs DeepSeek-Harness Harness Comparison |
| Date | 2026-08-25 |
| Authors | Navi team (pankaj) |
| Sources | `V:\pankaj\navi\packages\navi\src\...` · `V:\pankaj\deepseek-harness\packages\...` |

## Executive Summary

| Dimension | Navi (`navi`) | DeepSeek-Harness (`dsh`) |
|---|---|---|
| Package manager | **bun** 1.3.13 (`bun.lock`, `bunfig.toml`) | **pnpm** 11.7.0 (`pnpm-workspace.yaml`) |
| Runtime framework | **Effect** 4.0.0-beta.74 (`Effect.gen`, `Layer`, `Context.Service`) | **Cordis** (`Context`, `Service`, `ctx.plugin`, `FiberState`) + `schemastery`/`zod` |
| Tools | ~35 tools via `ToolRegistry` + MCP/LSP; `effect/unstable/http`, ripgrep | Typed `ToolSchema` via `@deepseek-ai/dsh-tools` + `run_code` bridge, `CodeDispatch` events |
| Session model | `SessionTable`/`PartTable` (Drizzle SQLite) + `InstanceState` + `Runner` per session; parent/child sessions | `SessionId` branded + `SessionHeader`/`SessionEvent` append-log, `SESSION_FORMAT_VERSION=0` |
| Persistence | Drizzle `db.bun.ts`/`db.node.ts` + `storage.ts` + JSON migrations; SQLite file per instance | Pluggable `storage` hub: `storage-sqlite` (`DatabaseSync`), `storage-json`, `storage-domain` |
| Prompting | `SystemPrompt` + `Instruction` + `Agent` config, `ToolRegistry` injects schemas | `SystemPrompt` registry (waterfall `system-prompt/assemble`, `PromptAssembly`, scope-filtered) |
| Security/Sandbox | `sandbox/index.ts` stub (TODO → `probes.ts` with `PLATFORM_CHAINS`/`STATIC_ENFORCEMENT`) | `sandbox-local` (bwrap→landlock→seatbelt→windows-acl chain, functional probes, fail-closed) |
| Testing | 857 `*.test.ts` (bun test, `test:ci` junit) — `do-not-run-tests-from-root` guard | 697 `*.spec.ts` (vitest/tsdown), REAL-composition loader tests, `verify-package-invariants` |

**One-line:** Navi is a feature-rich Effect monolith (broad tool surface, strong session UX); DSH is a plugin-factored Cordis kernel (strict invariants, durable event log, defense-in-depth sandbox). Navi should steal DSH's seam discipline, log-versioning, and sandbox probe chain without losing its tool breadth.

## 1. Architecture

| Aspect | Navi | DSH |
|---|---|---|
| Kernel | Effect `Layer` graph; `InstanceState`/`InstanceRegistry` scoping | Cordis `Context`/`Service`/`FiberState`, plugin `name`/`inject`/`apply` |
| Entry | `V:\pankaj\navi\packages\navi\src\index.ts:1` → `session/prompt.ts:1` assembles agent | `V:\pankaj\deepseek-harness\packages\boot\app-boot\src\index.ts:1` → `bundle/headless` / `bundle/web-app\src\startup.ts:1` |
| Modularity | 63 top-level `src/*` dirs (monolith); plugins via `@navi-ai/plugin` | 40+ `packages/*/*` (one service per package: `core/agent`, `core/session`, `sbox/*`, `interaction/*`) |
| DI | `Context.Service` + `Layer.effect` (`V:\pankaj\navi\packages\navi\src\session\run-state.ts:14`, `V:\pankaj\navi\packages\navi\src\effect\instance-state.ts:1`) | `declare module '@deepseek-ai/cordis' { interface Context { approval: ApprovalService }}` (`V:\pankaj\deepseek-harness\packages\interaction\user-approval\src\index.ts:12`) |
| Config | `src/config/*` self-export pattern | `dsh-scope` + `settings` + `preset` + `cordis.yml` loader |

**Takeaway:** DSH's package-per-capability forces explicit contracts; Navi's monolith is faster to ship but leaks cross-cutting concerns. Port DSH's `scope`/`preset` scoping.

## 2. Agent Loop

| Aspect | Navi | DSH |
|---|---|---|
| Loop impl | `V:\pankaj\navi\packages\navi\src\session\prompt.ts:1` (LLM call → tool dispatch → `processor.ts` → compaction) + `V:\pankaj\navi\packages\navi\src\session\run-state.ts:30` (`Runner`/`Latch`/`Scope`) | `V:\pankaj\deepseek-harness\packages\core\agent-loop\src\agent.ts:1` (`ReactLoopAgent`, `Phase idle|maintenance|running`, `Inbox`, `BlockAssembler`) + `V:\pankaj\deepseek-harness\packages\core\agent-loop\src\index.ts:1` (`FactoryOwnership`, `FiberState` gates) |
| Turn control | `max-steps.txt`, `SessionProcessor`, `SessionStatus` busy/idle | `TurnEndReason` (`completed`/`max-tokens`), `PreStepDecision`, `RequestErrorAction`, `maxParallelToolCalls` (`constants.ts:1`) |
| Context assembly | `prompt.ts` joins `SystemPrompt`+`Instruction`+`ToolRegistry` schemas | `runtime-context.ts:1` (`RuntimeContextProjection`) + `renderContextSections`/`joinContextSections` from `system-prompt` |
| Tool exec | `V:\pankaj\navi\packages\navi\src\session\prompt.ts:120` inline + `tool/tool.ts:1` | `V:\pankaj\deepseek-harness\packages\core\agent-loop\src\tool-calls.ts:1` (`executeToolCalls`) + `core/tools\src\code-mode.ts:1` + `tool\presentation.ts:1` |
| Cancellation | `run-state.ts:62` `cancel`/`cancelChildren`, `Latch`, `AbortController` | `agent.ts` `Phase.abort: AbortController` + `FactoryOwnership.teardown` + `AgentCancelCause` |

**Takeaway:** DSH's `FactoryOwnership` + `Phase` state machine is more auditable. Navi should extract its loop into a dedicated `agent-loop` package with explicit phases.

## 3. Tools

| Aspect | Navi | DSH |
|---|---|---|
| Registry | `V:\pankaj\navi\packages\navi\src\tool\registry.ts:1` + `V:\pankaj\navi\packages\navi\src\tool\registry-service.ts:1` (30+ imports, `Tool.make`) | `V:\pankaj\deepseek-harness\packages\core\tools\src\index.ts:1` + `V:\pankaj\deepseek-harness\packages\core\tools\src\types.ts:1` (`ToolSchema`, `CodeDispatchEventData`) |
| Inventory | read/write/edit/glob/grep/shell/task/todo/skill/lsp/apply_patch + 9 search variants (websearch, google-search, webscrape, webcrawl, grounding, tavily, firecrawl, exa, ddg) + codesearch/repo_clone/overview + memory/history | `run_code` bridge dominates; host tools via `@deepseek-ai/dsh-host`; `tool-ask-user` is a tool, not a side-channel |
| Schema | `ai` SDK `tool()` + `jsonSchema` + `effect/unstable/http` | `schemastery` `z`, `ToolSchema` with `presentation.ts` contracts |
| Search pipeline | `V:\pankaj\navi\packages\navi\src\tool\search-pipeline.ts:1` fan-out | No equivalent — single `run_code` dispatch avoids fan-out complexity |
| Safety | `V:\pankaj\navi\packages\navi\src\tool\guard.ts:1`, `memory-path-guard.ts:1`, `truncate.ts:1`, `truncation-dir.ts:1` | `tool/code-dispatch-start` + `tool/code-dispatch` log-only events (never re-enter model context) |

**Takeaway:** Navi's breadth wins for UX; DSH's narrow `run_code` surface wins for model contract stability. Keep Navi breadth but add DSH's tool-result vocabulary and presentation seam.

## 4. Session / Persistence

| Aspect | Navi | DSH |
|---|---|---|
| Model | `V:\pankaj\navi\packages\navi\src\session\session.ts:1` + `V:\pankaj\navi\packages\navi\src\session\session.sql.ts:1` (`SessionTable`, `PartTable`, `ProjectTable`) + `V:\pankaj\navi\packages\navi\src\session\schema.ts:1` (ULID, parent/child) | `V:\pankaj\deepseek-harness\packages\core\session\src\types.ts:1` (`SessionId` branded, `SessionHeader`, `SessionEvent` envelope, `SurfaceOp`/`SurfaceEventType`) |
| Log | Message/Part rows via Drizzle; `message-v2.ts:1`, `message.ts:1`, `revert.ts:1`, `overflow.ts:1` | Append-only `SessionEvent` log; `preparation.ts:1`, `request-header.ts:1`, `chunk-rows.ts:1`, `json.ts:1`, `repair.ts:1` |
| Revert | `V:\pankaj\navi\packages\navi\src\session\revert.ts:1` | `SessionPreparation` + in-memory view conversion; `deriveMessages()` ignores log-only events |
| Versioning | No log version — schema migrations via `storage/json-migration.ts:1` | `SESSION_FORMAT_VERSION=0` (`types.ts:35`), monotonic bump rule, upgrade-step chain |
| Storage backends | `V:\pankaj\navi\packages\navi\src\storage\db.ts:1` → `db.bun.ts:1`/`db.node.ts:1`; `storage.ts:1` (`RcMap`, `TxReentrantLock`) | `V:\pankaj\deepseek-harness\packages\storage\storage-sqlite\src\index.ts:1` (`DatabaseSync`, `JournalMode wal`), `storage-json`, `storage-domain` hub (`storage/src`) |
| Run-state | `V:\pankaj\navi\packages\navi\src\session\run-state.ts:14` (`Runner` map, `ensureRunning`/`startShell`) + `V:\pankaj\navi\packages\navi\src\effect\runner.ts:1` | `V:\pankaj\deepseek-harness\packages\core\session\src\runtime-context.ts:1` + `core/agent\src\agent.ts:1` (Agent owns Session) |

**Takeaway:** DSH's branded `SessionId` + versioned append-log + hub routing is more durable. Navi should add log versioning and a storage-backend abstraction.

## 5. Prompting / Context

| Aspect | Navi | DSH |
|---|---|---|
| Assembly | `V:\pankaj\navi\packages\navi\src\session\prompt.ts:1` + `V:\pankaj\navi\packages\navi\src\session\system.ts:1` + `V:\pankaj\navi\packages\navi\src\session\instruction.ts:1` + `prompt/plan.txt`, `prompt/build-switch.txt`, `prompt/max-steps.txt` | `V:\pankaj\deepseek-harness\packages\core\system-prompt\src\index.ts:1` (`SystemPrompt`, `PromptAssembly`, waterfall `system-prompt/assemble`) |
| Dynamic context | `V:\pankaj\navi\packages\navi\src\session\reminders.ts:1` + hooks (`context-window-monitor.ts`, `directory-agents-injector.ts`) | `ScopedLayers`/`scopeTarget` (`dsh-scope`), `joinContextSections`/`renderContextSections`/`renderPrompt` |
| Summarization | `V:\pankaj\navi\packages\navi\src\session\compaction.ts:1` + `V:\pankaj\navi\packages\navi\src\session\summary.ts:1` + `V:\pankaj\navi\packages\navi\src\util\token.ts:1` | `V:\pankaj\deepseek-harness\packages\compaction\compaction\src\index.ts:1` + `checkpoint.ts:1`/`brand.ts:1` + `command-compact\src\index.ts:1` |
| Scope | Global `Config`/`Global` registry | Per-`ScopeKey`/`ScopeLayer` waterfall; agent-scoped listeners only see their agent |
| Testing | Snapshot prompts | Verbatim pin of model-visible text (`Model Experience` format in README) |

**Takeaway:** DSH's waterfall + scope-filtering prevents prompt leakage across agents. Navi should adopt scoped prompt layers.

## 6. Security / Sandbox

| Aspect | Navi | DSH |
|---|---|---|
| Policy | `V:\pankaj\navi\packages\navi\src\sandbox\index.ts:1` (`SandboxMode: read-only|workspace-write|danger-full-access`, `SandboxPolicy`, `ConfinedExecution`) — TODO, probes not wired | `V:\pankaj\deepseek-harness\packages\sandbox\sandbox\src\index.ts:1` (`SandboxProvider`, `ConfinedArgv`, `SandboxEnforcement`) |
| Enforcement | `V:\pankaj\navi\packages\navi\src\sandbox\probes.ts:1` mirrors DSH (`PLATFORM_CHAINS`, `STATIC_ENFORCEMENT`, `DENIAL_SIGNATURES`, `RUNNER_FAILURE_RULES`) but `confineSync` not integrated | `V:\pankaj\deepseek-harness\packages\sandbox\sandbox-local\src\index.ts:1` + `profiles.ts:1` (functional probes, fail-closed on missing confinement) |
| Chains | Declared but unused | `linux: [bwrap, landlock]` (launcher `landlock-run` exit 125), `darwin: [seatbelt]`, `win32: [windows-acl]` (`workspaceWriteSid`/`tempWriteSid` DACL grants, `_ACL_RUNNER_FAILURE_EXIT=127`) |
| Permission | `V:\pankaj\navi\packages\navi\src\permission\index.ts:1` + `arity.ts`/`evaluate.ts` | `V:\pankaj\deepseek-harness\packages\interaction\user-approval\src\index.ts:12` (waterfall `approval/request`, fail-closed, `approval/asked`/`approval/decided` audit) + `permission-presets` + `guard` |
| Approval seam | Inline `Question`/`QuestionTool` | `tool-ask-user` as a real tool + `user-questions` + `user-approval` services; `Agent`/`Session` explicit at authority boundary |

**Takeaway:** Navi's sandbox is scaffolding; DSH's is battle-tested (functional probes, fail-closed, Windows DACL lifecycle). Navi must wire `probes.ts` into `confine` and enforce at the executor, not via schema omission.

## 7. Testing / Infra

| Aspect | Navi | DSH |
|---|---|---|
| Runner | `bun test --timeout 30000` (`V:\pankaj\navi\packages\navi\package.json:9`), `test:httpapi` exercise, `do-not-run-tests-from-root` guard | `vitest` per-package, `tsdown` build, `cordis.yml` loader REAL-composition tests |
| Counts | 857 `*.test.ts` | 697 `*.spec.ts` |
| Invariants | Ad-hoc | `verify-package-invariants` + per-package `src/invariant.ts` (`No runtime invariant:` justification), `invariant.spec.ts` |
| Composition | Unit tests dominate | Policy: every product-visible plugin needs a non-unit REAL loader test (`packages/AGENTS.md:8`) |
| Types | `tsgo --noEmit` (`bun typecheck`) | `tsconfig.base.json`/`tsconfig.base.client.json`, `rootDir: src`/`outDir: lib/types` |
| CI | `oxlint`, `prettier`, `turbo typecheck` | `landlock-run` native addon (`native/landlock-run`), `schemastery` doc-sync gates |

**Takeaway:** Navi has more tests but weaker integration coverage. Adopt DSH's REAL-composition + invariant-manifest discipline.

## What Navi Keeps (Strengths to Preserve)

- **Tool breadth** — 35+ tools + MCP/LSP + 9 search providers (`V:\pankaj\navi\packages\navi\src\tool\registry.ts:1`) is a UX moat; DSH is deliberately narrow.
- **Effect ergonomics** — `Effect.gen`/`Layer`/`RcMap`/`TxReentrantLock` (`V:\pankaj\navi\packages\navi\src\storage\storage.ts:1`) gives typed errors and resource safety Cordis lacks.
- **Session UX** — parent/child sessions, `share`/`compact`/`revert`/`unrevert`, `SessionStatus` busy/idle, `MessageV2` parts model (`V:\pankaj\navi\packages\navi\src\session\session.ts:1`).
- **Worktree + project model** — `project.md` multi-project/worktree API; `worktree/index.ts:1`, `project/*` — DSH has no equivalent.
- **DST/provider flexibility** — `provider/*` (cline, gemini-cli, kilocode), `model-cache.ts`, `auth/*` — broader than DSH's `llm-*` packages.
- **Bun-native perf** — `Bun.file`, `DatabaseSync`-less path, `bun.lock` — faster cold-start than pnpm/Cordis.
- **Search pipeline** — `search-pipeline.ts:1` + `tavily/exa/firecrawl/grounding` fan-out has no DSH counterpart.

## Prioritized Roadmap

| # | Pri | Item | Source Ref (DSH) | Target to Create | Effort | Impact |
|---|---|---|---|---|---|---|
| 1 | **P0** | Wire sandbox probes into `confine` (fail-closed, functional probes, deny at executor) | `V:\pankaj\deepseek-harness\packages\sandbox\sandbox-local\src\index.ts:1` | `V:\pankaj\navi\packages\navi\src\sandbox\confine.ts` | M | Critical — closes sandbox bypass |
| 2 | **P0** | Approval waterfall (fail-closed, `approval/asked`+`decided` audit, agent-scoped) | `V:\pankaj\deepseek-harness\packages\interaction\user-approval\src\index.ts:12` | `V:\pankaj\navi\packages\navi\src\permission\approval-service.ts` | M | Security — permission bypass prevention |
| 3 | **P0** | Session log versioning (`SESSION_FORMAT_VERSION`, upgrade-step chain, reject incompatible logs) | `V:\pankaj\deepseek-harness\packages\core\session\src\types.ts:35` | `V:\pankaj\navi\packages\navi\src\session\log-version.ts` | S | Durability — prevents silent mis-read |
| 4 | **P0** | Storage backend abstraction (hub + `sqlite`/`json` backends, `JournalMode`) | `V:\pankaj\deepseek-harness\packages\storage\storage-sqlite\src\index.ts:1` | `V:\pankaj\navi\packages\navi\src\storage\backend.ts` | M | Portability — enables hub routing |
| 5 | **P1** | Extract agent loop to `agent-loop` package with `Phase` state machine + `FactoryOwnership` | `V:\pankaj\deepseek-harness\packages\core\agent-loop\src\agent.ts:1` | `V:\pankaj\navi\packages\navi\src\agent-loop\index.ts` | L | Maintainability — auditable turns |
| 6 | **P1** | Scoped system-prompt registry (waterfall, `PromptAssembly`, scope-filtered) | `V:\pankaj\deepseek-harness\packages\core\system-prompt\src\index.ts:1` | `V:\pankaj\navi\packages\navi\src\session\prompt-registry.ts` | M | Correctness — no cross-agent leakage |
| 7 | **P1** | `run_code` Code-Mode bridge (`code-dispatch-start`/`code-dispatch` log-only, deriveMessages ignores) | `V:\pankaj\deepseek-harness\packages\core\tools\src\code-mode.ts:1` | `V:\pankaj\navi\packages\navi\src\tool\code-mode.ts` | M | Model contract — stable tool surface |
| 8 | **P1** | Package invariant manifests + `verify-package-invariants` gate | `V:\pankaj\deepseek-harness\packages\AGENTS.md:1` | `V:\pankaj\navi\packages\navi\src\invariant.ts` | S | Quality — per-package contracts |
| 9 | **P2** | REAL-composition loader tests for every product-visible plugin | `V:\pankaj\deepseek-harness\packages\bundle\web-app\tests\startup.spec.ts:1` | `V:\pankaj\navi\packages\navi\tests\composition\loader.spec.ts` | M | Coverage — integration over units |
| 10 | **P2** | Tool presentation seam (separate schema vs UI rendering, `presentation.ts`) | `V:\pankaj\deepseek-harness\packages\core\agent-tool-presentation\src\index.ts:1` | `V:\pankaj\navi\packages\navi\src\tool\presentation.ts` | S | UX — model-visible text stability |
| 11 | **P2** | Surface/surfaceOp versioned envelope (`SurfaceEventType`, commit-point publishing) | `V:\pankaj\deepseek-harness\packages\core\session\src\surface.ts:1` | `V:\pankaj\navi\packages\navi\src\session\surface.ts` | M | Consistency — single commit point |
| 12 | **P2** | Windows ACL write-grant lifecycle (per-workspace SID + per-session temp SID) | `V:\pankaj\deepseek-harness\packages\sandbox\sandbox-local\src\index.ts:40` | `V:\pankaj\navi\packages\navi\src\sandbox\windows-acl.ts` | L | Security — Windows confinement parity |

> Effort: S <1d · M 2–5d · L 1–2w. P0 = ship next; P1 = next quarter; P2 = backlog.

## Closing Verdict

**Navi wins on breadth, DSH wins on depth.** Navi should not chase DSH's minimalism — its 35-tool surface, worktree model, and Effect typing are genuine advantages. But DSH's three non-negotiables — **fail-closed sandbox with functional probes**, **versioned append-log**, and **scope-filtered prompt/approval seams** — are structural, not stylistic. They prevent classes of bugs Navi currently tolerates (unwired `probes.ts:1`, no log version, global prompt registry, inline permission checks).

**Recommended sequencing:** P0 #1–#4 in the next sprint (security + durability), P1 #5–#7 in the following cycle (loop + prompt + code-mode), P2 #8–#12 as hardening. Success metric: `V:\pankaj\navi\packages\navi\src\sandbox\confine.ts:1` probes before every tool exec, `log-version.ts:1` rejects `SESSION_FORMAT_VERSION` drift, and at least one REAL loader test per product-visible plugin.

*This doc follows `project.md` style: concise tables, file:line anchors, no prose fluff.*
