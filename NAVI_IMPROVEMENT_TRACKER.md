# Navi Improvement Tracker

**Updated:** 2026-03-21  
**Purpose:** single root-level tracker for major Navi improvements, current completion status, and next high-value upgrades.

## Status Legend

- `[x]` Completed
- `[-]` Partially done / foundation added but still needs rollout or cleanup
- `[ ]` Not started

---

## 1. Completed Work

- `[x]` Replace stale hard-coded OpenAI model handling with JSON-driven provider model data.
- `[x]` Refresh provider model catalogs on a 7-day cadence instead of relying on hard-coded lists.
- `[x]` Auto-fetch latest models when a user connects a new provider.
- `[x]` Remove special-case OpenAI hard-coding so provider catalogs are the source of truth.
- `[x]` Add shared model-cache support and align cache TTL with the provider refresh window.
- `[x]` Add model awareness so agents can reason about active models and their likely strengths.
- `[x]` Improve `vibemode` awareness of currently available models for different task styles.
- `[x]` Move gstack-inspired workflows into subagents instead of skills.
- `[x]` Add spawnable-subagent allowlisting and enforce it at runtime.
- `[x]` Add a shared interaction protocol so visible agents follow a more consistent response style.
- `[x]` Add a structured question/response format for agent replies.
- `[x]` Add `autoresearch` as a research-oriented subagent and research protocol foundation.
- `[x]` Wire structured asking into runtime session flow so asking responses create real pending questions.
- `[x]` Improve transcript and TUI handling for structured questions and asking states.
- `[x]` Add agent execution policy foundations.
- `[x]` Add model-routing foundations for choosing better-fit models by agent/task.
- `[x]` Add provider health scoring foundations.
- `[x]` Add session trace logging foundations.
- `[x]` Add evaluation sample logging foundations.
- `[x]` Fix core integration issues in the new routing/policy/session path:
  - routed model is now defined before overflow checks
  - subtask path uses routed models
  - retry limits are enforced
  - delegation limits are enforced
  - structured response UI/transcript paths no longer break typed runtime flow

---

## 2. Partially Done

- `[-]` Evaluation system
  - Foundation exists through trace/eval logging.
  - Missing benchmark runner, scoring, dashboards, and pass/fail gates.

- `[-]` Model routing
  - Basic routing exists.
  - Missing richer capability scoring, latency-aware routing, cost-aware routing, and provider reliability feedback loops.

- `[-]` Provider health
  - Basic freshness/auth/model-count scoring exists.
  - Missing live failure-rate tracking, latency tracking, and automatic provider downgrade behavior.

- `[-]` Structured response system
  - Runtime asking flow exists.
  - Missing full server/API enforcement, richer response templates, and stronger UI presentation across all clients.

- `[-]` Vibemode
  - Better model awareness and subagent spawning are in place.
  - Missing deeper orchestration policies, planner/reviewer loops, and session health visibility.

- `[-]` Research system
  - `autoresearch` exists as a foundation.
  - Missing evidence ledgers, contradiction tracking, confidence scoring, and stopping criteria.

---

## 3. Highest Priority Next Improvements

- `[ ]` Build a real benchmark/evaluation harness for `ask`, `build`, `vibemode`, `review`, `qa`, and `research`.
- `[ ]` Add verification gates for serious workflows:
  - code change -> lint/test/build/review
  - research -> contradiction/source-quality checks
  - review -> evidence + severity format
- `[ ]` Upgrade model routing from static-fit routing to budget/latency/reliability/capability routing.
- `[ ]` Turn `vibemode` into a true orchestrator with planner, worker pool, reviewer, retry rules, and stop conditions.
- `[ ]` Add persistent memory with confidence, expiry, source, and project-fact tagging.
- `[ ]` Add provider reliability scoring from real runtime behavior, not only catalog freshness.

---

## 4. Suggested Major Improvements

### Agent System

- `[ ]` Add agent scorecards so Navi can learn which subagents perform best by task type.
- `[ ]` Add explicit subagent contracts:
  - allowed actions
  - success criteria
  - expected output shape
  - escalation rules
- `[ ]` Add first-class verifier agents:
  - factual verifier
  - regression verifier
  - UI verifier
  - security verifier
- `[ ]` Add agent handoff summaries so one subagent can transfer state cleanly to another.
- `[ ]` Add a “critic” or “adjudicator” layer for high-risk tasks before final answers are shown.

### Vibemode

- `[ ]` Add planner -> worker -> reviewer -> ship loop inside `vibemode`.
- `[ ]` Add visible session health in `vibemode`:
  - active subagents
  - burn rate
  - retry count
  - blocked reason
  - next expected action
- `[ ]` Add tool budgets and stop conditions specific to `vibemode`.
- `[ ]` Add better task decomposition so `vibemode` does not overuse subagents when the task is simple.

### Research

- `[ ]` Add evidence logs per research session.
- `[ ]` Add contradiction detection between sources and between subagent outputs.
- `[ ]` Add confidence scoring for research answers.
- `[ ]` Add source ranking and freshness ranking.
- `[ ]` Add explicit stopping criteria so research does not loop without improving answer quality.
- `[ ]` Add local-codebase-vs-web research planning before research starts.

### User Interaction

- `[ ]` Add a proper question system with:
  - why the question is being asked
  - recommended option
  - impact/tradeoff explanation
  - expected next step after answer
- `[ ]` Add standardized answer formats for:
  - direct answer
  - plan
  - implementation summary
  - blocker
  - recommendation
  - research report
  - review findings
- `[ ]` Add stronger “blocked / running / waiting / done” status rendering in all clients.
- `[ ]` Add conversation recovery so interrupted sessions resume cleanly from checkpoints.

### Provider and Model Layer

- `[ ]` Add normalized provider capability scoring for:
  - tool-calling reliability
  - structured-output reliability
  - reasoning quality
  - multimodal quality
  - streaming quality
- `[ ]` Add automatic fallback when a routed model is flaky, unavailable, or repeatedly fails tool calls.
- `[ ]` Add per-provider fetch diagnostics so model-sync failures are visible instead of silent.
- `[ ]` Add provider update history and “last refreshed” visibility in UI/CLI.
- `[ ]` Add cost/latency telemetry per provider-model pair to improve routing quality over time.

### Evaluation and Quality

- `[ ]` Add benchmark case storage under version control.
- `[ ]` Add pass/fail scoring for correctness, cost, latency, and user-interruption rate.
- `[ ]` Add regression suites for:
  - structured asking flow
  - routing decisions
  - vibemode delegation
  - provider fallback
  - stale-model prevention
- `[ ]` Add deterministic replay tooling for session traces so routing and agent regressions can be debugged.
- `[ ]` Add prompt/agent versioning so behavior changes can be measured over time.

### Product / Workflow

- `[ ]` Add branch and PR workflows:
  - review current branch
  - summarize diff
  - generate PR text
  - generate changelog
  - release checklist
- `[ ]` Add “spec mode” that maintains living requirements, design, tasks, and state files automatically.
- `[ ]` Add team presets and reusable project profiles.
- `[ ]` Add budget guardrails per session, per mode, and per provider.
- `[ ]` Add one-click “review this repo / branch / PR” workflows.

---

## 5. Additional Improvements Worth Considering

These are not yet discussed as deeply, but they would materially improve Navi.

- `[ ]` Add secret redaction in all logs and tool outputs before persistence.
- `[ ]` Add better cleanup of temporary/debug files and stricter repo hygiene.
- `[ ]` Add safer MCP/provider/tool sandboxing for high-risk external execution.
- `[ ]` Add crash-safe checkpointing for long sessions.
- `[ ]` Add a route planner that decides between local code search, docs lookup, browser research, and subagent delegation before acting.
- `[ ]` Add a lightweight “simple task mode” to avoid over-orchestration for short requests.
- `[ ]` Add acceptance-learning signals:
  - which responses the user accepted
  - which edits were reverted
  - which agent outputs led to retries
- `[ ]` Add better memory hygiene:
  - memory deduplication
  - expiration
  - contradiction cleanup
  - source linking
- `[ ]` Add a unified observability view for:
  - session traces
  - provider health
  - eval samples
  - cost
  - failures
- `[ ]` Add repo-level improvement automation:
  - stale test detector
  - broken import detector
  - prompt drift detector
  - dead subagent detector

---

## 6. Recommended Build Order

1. `[ ]` Evaluation harness + benchmark runner
2. `[ ]` Verification gates
3. `[ ]` Full model/provider routing
4. `[ ]` Vibemode orchestration upgrade
5. `[ ]` Persistent memory with hygiene
6. `[ ]` Provider reliability telemetry
7. `[ ]` Research evidence pipeline
8. `[ ]` Session health and observability UI

---

## 7. Notes

- This file is intentionally a working tracker, not a finished review document.
- Items should be moved from `[ ]` to `[-]` to `[x]` as work lands.
- The runtime integration foundation is significantly improved, but not every higher-level feature in this backlog is implemented yet.
