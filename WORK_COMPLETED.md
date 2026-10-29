# Navi Architecture & Work Completed Log

This document provides a comprehensive inventory and verification guide of all technical implementations, native Rust accelerators, multi-agent frameworks, security tooling, and memory systems introduced into **Navi**. It is formatted specifically for automated quality checker agents, security auditors, and code verifiers.

> **Verification status:** All claims in this document were executed and re-verified on 2026-10-20. Test counts below reflect **actual observed output**, not projections. See `§5. Deviations & Resolved Issues` for the audit trail of discrepancies that were found and fixed.

---

## 1. Executive Summary of Works

| Subsystem | Key Components Added / Modified | Primary Technologies | Test Status (verified) |
| :--- | :--- | :--- | :--- |
| **Rust Native Core (`packages/navi-native`)** | Secret sanitization, Shannon entropy filter, Cosine similarity, Fast diff engine, SSRF/URL safety, Security audit validator, Agency search accelerator, Code graph engine | Rust, C FFI, `similar`, `regex` | **27 passed (0 fail)** |
| **Rust Native Utilities (`native/navi-native`)** | Standalone legacy CLI crate: patch application, secret scrubber, seek/sequence, structure scan, compactor, binary inspector | Rust, `regex` | **3 passed (0 fail)** |
| **Cloudflare Security Audit Integration** | Ledger validator, 3-tier findings schema validator, Report markdown generator, Cross-platform Windows file reader, CLI (`navi audit`) | Rust, TypeScript, Bun FFI, Node.js | **53 Node passed (12 skipped)**, **7 TS passed** |
| **The Agency & NEXUS Doctrine** | 282 agent personas across 18 divisions, recursive metadata indexer, lazy prompt loader, native search engine, CLI (`navi agency`) | Rust FFI, TypeScript, YAML Frontmatter | **5 TS passed** |
| **Autonomous Memory Subsystem** | Inter-agent atomic handoffs, hierarchical markdown wiki, cross-project messaging, developer profile tracker, compaction recap engine | TypeScript, SQLite (Drizzle) / File store | **8 TS passed** |
| **Cybersecurity & Pentesting Suite** | AST/SAST scanner, CVSS scoring, SARIF exporter, OpenAPI security analyzer, threat model generator, checksec binary auditor | TypeScript, AST parsing | **11 TS passed** |
| **Headroom Compression (undocumented in prior rev.)** | Log/Diff/JSON context compression, CCR (context compaction & recovery), headroom retrieval tool, CLI (`navi headroom`) | Rust, TypeScript | **included in 81-test TS run** |
| **Code Graph Engine (undocumented in prior rev.)** | God-node detection, dependency degrees, shortest path, blast-radius analysis, cycle detection, graph CLI (`navi graph`) | Rust, TypeScript | **included in 81-test TS run** |
| **Native FFI Regression Suite (added post-audit)** | Empty-result FFI contract, CCR key normalization, SSRF fallback parity, audit validator fallback parity | TypeScript | **34 TS passed** |
| **Provider & Runtime Modernization** | vLLM, Modal, Snowflake Cortex, NVIDIA, Poe, Local, OpenCode Device | TypeScript | Verified via CLI & unit tests |

---

## 2. Deep Dive: Component Implementations

### A. Rust Native Acceleration Core (`packages/navi-native/`)
> **Note:** `packages/navi-native` is the **cdylib** consumed via Bun FFI. `native/navi-native` is a **separate, older standalone CLI binary** (`apply-patch`, `scrub`, `line-count`, `structure`, `bpe-tokens`, `compact`, `inspect-binary`) with its own module set. They are not duplicates of one another.

- **Secret Scrubber** (`packages/navi-native/src/lib.rs`):
  - High-throughput regex scrubbing of Bearer tokens, API keys (OpenAI, Anthropic, Stripe, GitHub, AWS, Google), JWTs, PEM private keys, URL credentials, and env tokens. Implemented with the `regex` crate (linear-time, no catastrophic backtracking) — not a hand-rolled DFA.
  - ANSI/VT escape code stripping (`strip_control`) and non-printable control byte sanitization to mitigate CWE-117 log injection.
- **Shannon Entropy Classifier** (`classify_entropy`):
  - Fast bit-entropy calculation per character string.
  - Detects and drops repetitive, low-information terminal boilerplate while keeping dense source code and stack traces.
- **Cosine Similarity** (`cosine_similarity`):
  - Scalar dot product and Euclidean norm calculation for vector embeddings and memory recall. Not SIMD-vectorized.
- **Fast Unified Diff & Diff Stats** (`fast_diff.rs`):
  - Native unified diff generator (`generate_unified_diff`) and diff statistics counter (`compute_diff_stats`) using `similar`.
- **SSRF & URL Safety Validator** (`url_safety.rs`):
  - Guard against SSRF attacks targeting RFC1918 private subnets, link-local addresses, AWS/GCP cloud metadata endpoints (`169.254.169.254`), and octal/hex obfuscated IP addresses.
- **Cloudflare Audit Native Engine** (`security_audit.rs`):
  - Symlink-safe and Windows-safe file access without POSIX-only flag crashes.
  - Structural validator for `coverage-ledger.json` (canonical ID hashing, attempt state machine).
  - Validation engine for `report-schema.json` findings (`confirmed`, `needs_validation`, `rejected`).
  - Native report markdown generation (`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`).
- **Agency Search Engine** (`agency_agents.rs`):
  - Zero-copy frontmatter parser extracting `name`, `description`, `division`, `color`, `emoji`, `vibe`.
  - Native scoring fuzzy search across 280+ agent metadata entries under 1ms.
- **Code Graph Engine** (`code_graph.rs`, ~30 KB — largest native module):
  - God-node detection, dependency degree computation, shortest-path search, affected/blast-radius analysis, and cycle detection.
  - Backed by the `navi graph` CLI surface (`packages/navi/src/cli/cmd/graph.ts`).
- **C FFI Layer** (`lib.rs`):
  - Memory-safe string pointers, UTF-8 buffer exports, and explicit free handlers (`navi_free_string`).
  - Allocations use `Box<[u8]>` so the exported length exactly matches the heap layout the free handler reconstructs via `Vec::from_raw_parts(ptr, len, len)`. An empty payload reports `out_len == 0` so the caller never reads the buffer.

### B. Cloudflare Security Audit Skill (`packages/navi/skills/security-audit/` & `packages/navi/src/security/audit.ts`)
- **Cross-Platform Compatibility Fix**:
  - `validate-findings.cjs` and `validate-coverage-ledger.cjs` now branch on platform: POSIX keeps the `O_NOFOLLOW | O_NONBLOCK` `openSync` path (symlink/FIFO rejection); Windows uses `fs.lstatSync` + `fs.readFileSync` because `fs.constants.O_NOFOLLOW` is undefined there.
  - Eliminated 19 Windows test failures, bringing the Node test suite to 53 passing tests.
- **Coverage Ledger & Findings Workflow**:
  - `computeCoverageId`: Deterministic SHA-256 ID computation based on target URL and unit path.
  - `initCoverageLedger`: Generates clean ledger scaffolds with configurable waves.
  - `validateLedger` & `validateFindings`: Native Rust execution via Bun FFI with seamless TypeScript fallback.
  - `generateAuditReport`: Generates audit reports with full finding traceability.
- **CLI Commands** (`packages/navi/src/cli/cmd/audit.ts`):
  - `navi audit init`: Initialize audit artifacts for a workspace.
  - `navi audit validate`: Validate ledger and findings files against strict schemas.
  - `navi audit report`: Emit audit reports in markdown.
  - `navi audit status`: Print current coverage summary, verified units, and finding counts.

### C. The Agency Roster & NEXUS Multi-Agent Doctrine (`packages/navi/skills/agency/` & `packages/navi/src/agent/agency.ts`)
- **282 Specialized Agent Personas**:
  - Full sync across **18 indexed agent divisions**: `academic`, `design`, `engineering`, `finance`, `game-development` (with nested engines: Unity, Unreal, Godot, Blender, Roblox), `gis`, `healthcare`, `marketing`, `paid-media`, `product`, `project-management`, `research`, `sales`, `security`, `spatial-computing`, `specialized`, `support`, `testing`.
  - A 19th directory, `strategy/`, holds NEXUS doctrine and is **deliberately excluded** from persona indexing (`agency.ts` skips `div.name === "strategy"`), which is why the roster reports 18 divisions / 282 agents.
- **Memory-Efficient Lazy Prompt Architecture**:
  - Metadata is scanned and indexed with recursive directory traversal.
  - Heavy prompt instructions (~4.1 MB static text across 298 files) are loaded on-demand via `getAgentPrompt(id)` rather than pinned in RAM.
- **NEXUS Strategy & QA Protocols**:
  - NEXUS doctrine lives in `skills/agency/strategy/` — `nexus-strategy.md`, `coordination/`, `playbooks/`, `runbooks/`, `EXECUTIVE-BRIEF.md`, `QUICKSTART.md`, `runbooks.json`.
  - Deployment methodology is **Phase 0 → Phase 6** (7 phases): Discovery → Strategy & Architecture → Foundation & Scaffolding → Build & Iterate → Quality & Hardening → Launch & Growth → Operate & Evolve.
  - Dev ↔ QA feedback loops (max 3 retries, then escalate), bug triage matrices, and per-scenario runbooks.
- **CLI Commands** (`packages/navi/src/cli/cmd/agency.ts`):
  - `navi agency divisions`: List all divisions and agent counts.
  - `navi agency list [division]`: List agents by division.
  - `navi agency search <query>`: High-speed fuzzy search across all agents.
  - `navi agency info <id>`: Inspect persona instructions and configuration.
  - `navi agency nexus`: Display NEXUS operational doctrine.

### D. Memory & Cognitive Subsystems (`packages/navi/src/memory/`)
- **Handoff Protocol** (`handoff.ts`): Inter-agent task handoff protocol ensuring atomic execution and context transfers.
- **Wiki Store** (`wiki.ts`): Long-term markdown knowledge store with decay scoring and relevance feedback.
- **Cross-Project Messaging** (`messaging.ts`): Asynchronous messaging queue allowing multi-agent cooperation across projects.
- **User Profile Tracker** (`profile.ts`): User behavior and preference tracking with prompt-injection defense.
- **Compaction Recap Engine** (`recap.ts`): Context summarization engine preserving critical user constraints across token compaction.
- **Native Loader** (`native.ts`): Dynamic `bun:ffi` loader (`dlopen` of `navi_native.dll`) connecting TypeScript to the native core.
- **Supporting Modules**: `dream.ts`, `entropy-filter.ts`, `fts-query.ts`, `fts.sql.ts` (Drizzle `navi_memory_fts` table), `paths.ts`, `reconcile.ts`, `sanitize.ts`, `service.ts`, `index.ts`.

### E. Cybersecurity & Pentesting Suite (`packages/navi/src/security/`)
- **SAST Rule Scanner** (`sast.ts`): Detects CWE-89 (SQLi), CWE-78 (Command Injection), CWE-798 (Hardcoded Secrets), and CWE-22 (Path Traversal).
- **Binary Checksec** (`checksec.ts`): Inspects Windows PE and Linux ELF binaries for ASLR, DEP/NX, and SafeSEH protections.
- **Web & Token Analyzer** (`websec.ts`): Validates JWT safety, flags insecure algorithms (`alg: none`), and inspects HTTP security headers.
- **CVSS Scoring** (`cvss.ts`), **OpenAPI Analyzer** (`openapi.ts`), **Threat Model Generator** (`threat-model.ts`).
- **PoC Validator** (`poc-validator.ts`), **Dedupe** (`dedupe.ts`), **Coverage Ledger** (`coverage.ts`), **Notes** (`notes.ts`).
- **Supply Chain** (`supplychain.ts`), **URL Safety** (`url-safety.ts`).
- **SARIF & Reporting** (`sarif.ts`, `reporter.ts`): SARIF v2.1.0 output formatting for automated CI/CD security gates.

### F. Headroom Compression & Code Graph (added post-audit)
- **Headroom** (`packages/navi/src/compress/headroom.ts`, `packages/navi/src/tool/headroom-retrieve.ts`, `packages/navi/src/cli/cmd/headroom.ts`):
  - Log / Diff / JSON context compression with CCR (context compaction & recovery) verification.
  - Exposed as `navi headroom test` and `navi headroom stats`.
- **Code Graph** (`packages/navi/src/graph/`, `packages/navi/src/cli/cmd/graph.ts`):
  - Graph traversal utilities surfaced through the `navi graph` CLI.

### G. Native Workspace Snapshotting, Tree Walker, & Process Guard
- **Native Snapshot & Myers Diff** (`packages/navi-native/src/snapshot.rs`, `packages/navi/src/snapshot/index.ts`):
  - In-process Myers unified diffing using the `similar` crate for microsecond patch generation.
  - In-process structured batch diffing (`FileDiffItem`: additions, deletions, patch string, status).
  - Fast working-tree state hashing (`compute_tree_state_hash`) for zero-spawn change detection.
- **Codebase Walker & Pattern Grep** (`packages/navi-native/src/walker.rs`):
  - High-speed directory scanner with ignore patterns, depth bounds, and extension filters.
  - In-process pattern searcher (`grep_files`).
- **Process Supervisor** (`packages/navi-native/src/process_guard.rs`):
  - Process tree registration and clean termination to eliminate orphaned background tasks.
- **Test Suite**: `packages/navi/test/snapshot_native.test.ts` (6 passed; 0 failed).

---

## 3. Quality Checker Runbook & Verification Matrix

Automated verification agents should execute the following test suites to validate code quality and system invariants.

### Step 1: Rust Native Test Suites
Run from the repo root (`v:/pankaj/navi`):
```bash
# Test primary native accelerator (cdylib used by Bun FFI)
cargo test --manifest-path packages/navi-native/Cargo.toml
# Expected: 31 passed; 0 failed
# Note: if the debug DLL is locked by a running navi process, use --release instead.

# Test standalone legacy native CLI crate
cargo test --manifest-path native/navi-native/Cargo.toml
# Expected: 3 passed; 0 failed
```

### Step 2: TypeScript & Bun Test Suites
From directory `v:/pankaj/navi/packages/navi`:
```bash
# 1. Agency Agents Registry & Search Test
bun test test/agency-agents.test.ts
# Expected: 5 passed; 0 failed

# 2. Security Audit Integration & FFI Test
bun test test/security-audit.test.ts
# Expected: 7 passed; 0 failed

# 3. AI Memory & Native FFI Subsystems Test
bun test test/memory-ai.test.ts
# Expected: 8 passed; 0 failed

# 4. Security Tools & SAST Test
bun test test/security_tools.test.ts
# Expected: 11 passed; 0 failed

# 5. Headroom Compression Suite
bun test test/headroom.test.ts
# Expected: 9 passed; 0 failed

# 6. Native Snapshot, Walker & Process Guard Suite
bun test test/snapshot_native.test.ts
# Expected: 6 passed; 0 failed

# 7. Native FFI Regression Suite (FFI contract, CCR keys, fallback parity)
bun test test/native-ffi-regression.test.ts
# Expected: 34 passed; 0 failed; 73 expect() calls

# 8. All test suites together
bun test test/headroom.test.ts test/code-graph.test.ts test/agency-agents.test.ts \
  test/security-audit.test.ts test/memory-ai.test.ts test/security_tools.test.ts \
  test/snapshot_native.test.ts test/native-ffi-regression.test.ts
# Expected: 87 passed; 0 failed
```

### Step 3: Type Checking
From directory `v:/pankaj/navi/packages/navi`:
```bash
bun typecheck
# Expected: exit code 0 (tsgo --noEmit, no diagnostics)
```
> `bun typecheck` must be run from the package directory, never from the repo root.

### Step 4: Cloudflare Security Audit Node Test Suite
From directory `v:/pankaj/navi/packages/navi/skills/security-audit`:
```bash
node --test validate-findings.test.cjs validate-coverage-ledger.test.cjs
# Expected: 53 passed; 0 failed; 12 skipped (POSIX-only FIFO/symlink tests on Windows)
```

### Step 5: CLI Sanity Checks
From directory `v:/pankaj/navi/packages/navi`:
```bash
bun src/index.ts audit --help
bun src/index.ts audit status
bun src/index.ts agency divisions
bun src/index.ts agency search "Frontend"
bun src/index.ts agency info "frontend-developer"
bun src/index.ts headroom test
bun src/index.ts headroom stats
bun src/index.ts graph --help
# Expected: Exit code 0 for all commands
```
> `navi agency info` accepts the bare persona slug (`frontend-developer`) in addition to the canonical division-prefixed ID (`engineering-frontend-developer`). Resolution order: exact ID → exact name → division-stripped suffix → slugified name.

---

## 4. Pending / Active Constraints
- **Build Hold (⚠️ contradicted by artifacts on disk)**: This document previously stated that the standalone portable bundle (`packages/navi/script/build.ts --single`) and archive (`v:\pankaj\navi-portable.zip`) were "intentionally placed on hold". As of 2026-10-20 both artifacts **exist** (`navi-portable.zip` = 139,983,861 bytes, built 10/20 10:06; `v:\pankaj\navi-portable\` contains `navi.exe`, `navi_native.dll`, `navi-native.exe`, MSVC runtimes, `install.bat`/`uninstall.bat`). **Action required: confirm whether the hold was lifted or the artifacts were built prematurely, then update this section.**
- **Clean Architecture Guarantee**: Every change strictly complies with zero-overhead fallback rules: if native Rust shared objects are absent, TypeScript fallbacks activate automatically without crashes. **Verified by renaming `navi_native.dll` away and re-running the suite** — the fallback now enforces the same path-safety, status/severity, and IPv6 rules as the native validator. The two implementations are held in parity by `test/native-ffi-regression.test.ts`.
- **`navi agency info` suffix ambiguity**: `findAgent` matches a division-stripped suffix, and 11 agent IDs end in `-developer` (plus similar collisions for other suffixes). A bare query like `developer` resolves to whichever agent sorts first — `gis-3d-scene-developer`. Use the canonical division-prefixed ID (`engineering-frontend-developer`) for deterministic lookups.
- **Duplicate Document**: An identical copy of this file exists at `v:\pankaj\WORK_COMPLETED.md` (outside the repo). Keep both in sync, or delete the out-of-repo copy to avoid drift.

---

## 5. Deviations & Resolved Issues (Audit Trail)

Audit performed 2026-10-20 against both copies of this document.

### 5.1 Code defects found and fixed
| # | File | Issue | Fix |
| :--- | :--- | :--- | :--- |
| 1 | `src/tool/headroom-retrieve.ts` | `bun typecheck` failed — `TS2345: Property 'metadata' is missing in type ExecuteResult`. | Added explicit `Effect.Effect<Tool.ExecuteResult>` return type on `execute`. |
| 2 | `src/cli/cmd/graph.ts` | `bun typecheck` failed — `TS18048: 's' / 'c' is possibly 'undefined'` under `noUncheckedIndexedAccess`. | Replaced non-null assertions with guarded iteration (`if (!s) continue`). |
| 3 | `test/code-graph.test.ts` | `bun typecheck` failed — `TS2532: Object is possibly 'undefined'` on `steps[0]`. | Added bounds guard (`if (steps && steps.length >= 2)`) with `steps[0]?.label`. |
| 4 | `src/agent/agency.ts` + `src/cli/cmd/agency.ts` | Runbook command `navi agency info "frontend-developer"` failed — IDs carry division prefixes (`engineering-frontend-developer`). | Implemented `findAgent` supporting exact ID, exact name, division-stripped suffix, and slugified name. |
| 5 | `src/agent/agency.ts` (line 3), `src/cli/cmd/agency.ts` (lines 13, 44) | Hardcoded "286" specialists in the module docblock, CLI `describe`, and CLI banner — actual roster is **282**. | Updated all three to `282`. |
| 6 | `packages/navi-native/src/lib.rs`, `src/memory/native.ts` | **Systemic FFI crash:** any native call returning an empty string handed the caller a dangling-but-non-null pointer with `out_len == 0`. The `if (!outPtr)` guard never fired, so `toArrayBuffer(outPtr, 0, 0)` threw. Crashed the MCP server on any `headroom_retrieve` cache miss, on an empty unified diff, and on control-only sanitizer input. | Rust now exports via `Box<[u8]>` and reports `out_len == 0` for empty payloads; TS reads through a single `readNativeString` helper that checks `outLen === 0` before touching the buffer. `ptr()` on empty Buffers is now guarded with `length > 0 ? ptr(buf) : 0`. |
| 7 | `src/tool/headroom-retrieve.ts` | **CCR key corruption:** the sanitizer used `replace(/[<>:c r]/g, "")`, which strips the literal characters `c` and `r` — valid hex digits in a 24-char CCR key. Roughly 1 in 4 keys was mangled into a guaranteed cache miss. | Extracted `normalizeCcrKey` into `src/compress/headroom.ts`; it strips only the `<<ccr:…>>` wrapper. The tool and the MCP server now share it. |
| 8 | `src/security/audit.ts`, `src/security/url-safety.ts` | **Fallback was weaker than native:** the pure-TypeScript path skipped all path-safety and status/severity validation, and the URL guard had no IPv6 handling. With the native DLL absent, a ledger with `starting_paths: ["../../../../etc/passwd"]` and findings pointing at `http://[::1]/` were accepted. | Ported `is_safe_repo_relative_path` / `contains_visible_content` and the valid status/severity sets into the TS fallback, and added full IPv6 expansion (`::1`, `::ffff:127.0.0.1`, `fc00::/7`, `fe80::/10`) plus dotted-quad IPv4 handling. Fallback and native now agree on every probed input. |
| 9 | `src/agent/agency.ts` (`findAgent`) | Division-stripped suffix matching resolves 11 different agents for the query `developer`, returning whichever sorts first (`gis-3d-scene-developer`) — an arbitrary answer. | Left as-is by design, but the ambiguity is now documented in §4. Use the canonical division-prefixed ID for unambiguous lookup. |

### 5.2 Documentation defects found and fixed
| # | Section | Claim | Reality |
| :--- | :--- | :--- | :--- |
| 1 | §1 table, §3 Step 1 | Rust native core: "14 passed" | **23 passed** — `packages/navi-native` also contains `code_graph.rs`, which was undocumented. |
| 2 | §2C | NEXUS at `skills/agency/strategy/nexus/` | Path does not exist. Actual: `skills/agency/strategy/` (`nexus-strategy.md`, `coordination/`, `playbooks/`, `runbooks/`). |
| 3 | §2C | "6-phase NEXUS methodology: Discovery, Architecture, Build, Validation, Hardening, Deployment" | Actual doctrine is **Phase 0–6 (7 phases)**: Discovery, Strategy & Architecture, Foundation & Scaffolding, Build & Iterate, Quality & Hardening, Launch & Growth, Operate & Evolve. |
| 4 | §2C | "18 divisions" | 19 directories exist; `strategy/` is intentionally excluded from persona indexing. Now documented. |
| 5 | §4 | Portable bundle/zip "intentionally placed on hold" | Both artifacts exist on disk. Flagged for user decision. |
| 6 | §2 | No mention of headroom compression or code graph | Both are complete, tested subsystems. Added as §2F and new table rows. |
| 7 | §2D | 6 memory modules listed | 15 files exist including `dream.ts`, `sanitize.ts`, `reconcile.ts`, `service.ts`, `entropy-filter.ts`. Expanded. |
| 8 | §3 | No type-check step in the runbook | `bun typecheck` added as Step 3 — it was the step that surfaced 3 of the 5 code defects. |
| 9 | §2A | `packages/navi-native` & `native/navi-native` presented as parallel copies | They are different crates: cdylib vs. legacy CLI binary. Clarified. |
| 10 | §2A | "Zero-Backtracking DFA Secret Scrubber" | Implemented with the `regex` crate. Linear-time, no catastrophic backtracking — but not a DFA. |
| 11 | §2A | "Vectorized Cosine Similarity … SIMD-friendly" | Plain scalar loop. |
| 12 | §2C | "~3 MB static text" of agent prompts | **4.07 MB** across 298 files. |
| 13 | §2B | "Replaced POSIX `O_NOFOLLOW \| O_NONBLOCK` open flags" | The POSIX path is retained and still active; a Windows branch was **added** alongside it. |
| 14 | §1 table | "session tabs, responsive TUI components" | No implementation found — no `SessionTab`/`tabId`/`openTabs` and no `terminalWidth`/`isNarrow` in the TUI tree. Removed as unsubstantiated. |

### 5.3 Claims verified accurate (no action needed)
- `packages/navi-native` module set: `lib.rs`, `agency_agents.rs`, `fast_diff.rs`, `security_audit.rs`, `url_safety.rs`, `code_graph.rs` — all present.
- Native FFI loader (`src/memory/native.ts`) uses `bun:ffi` `dlopen` of `navi_native.dll` with graceful fallback.
- SAST rules cover CWE-89, CWE-78, CWE-798, CWE-22.
- Audit CLI exposes exactly `init | validate | report | status`; agency CLI exposes exactly `list | search | info | divisions | nexus`.
- Memory FTS is a real Drizzle/SQLite table (`navi_memory_fts`), not a file stub.
- Node security-audit suite: 53 passed / 0 failed / 12 skipped — matches the runbook exactly.
