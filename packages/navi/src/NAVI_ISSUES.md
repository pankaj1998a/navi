# Navi Project - Issues Report

Based on comprehensive analysis of the codebase in `V:\pankaj\navi\packages\navi`, the following issues and problems were identified:

---

## 1. Security Issues (Critical)

### Hardcoded Secrets

| File                         | Line | Issue                                                                                                                 |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `src/provider/gemini-cli.ts` | 33   | `GEMINI_CLIENT_SECRET = "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"` - Hardcoded OAuth secret                               |
| `src/provider/gemini-cli.ts` | 32   | `GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"` - Hardcoded client ID |

### Unsecured Server Warning

| File                   | Line | Issue                                                           |
| ---------------------- | ---- | --------------------------------------------------------------- |
| `src/cli/cmd/serve.ts` | 15   | Warning: `NAVI_SERVER_PASSWORD is not set; server is unsecured` |

---

## 2. TypeScript Type Issues

### Excessive `any` Usage (691 occurrences)

| File                        | Lines           | Issue                           |
| --------------------------- | --------------- | ------------------------------- |
| `src/session/processor.ts`  | 185-383         | Multiple `as any` casts         |
| `src/config/config.ts`      | 579,596,839,876 | `z.any()` for catchall schemas  |
| `src/storage/jsonl.ts`      | 15,25,39        | Functions return `Promise<any>` |
| `src/agent/orchestrator.ts` | 164             | `as any` cast                   |

### Type Suppressions (23 occurrences)

| File                                  | Lines   | Issue                   |
| ------------------------------------- | ------- | ----------------------- |
| `src/index.ts`                        | 254-269 | 8 `@ts-ignore` comments |
| `src/tool/executor.ts`                | 85      | `@ts-ignore`            |
| `src/session/prompt.ts`               | 59      | `@ts-ignore`            |
| `src/voice/service.ts`                | 20,106  | `@ts-ignore`            |
| `src/session/llm.ts`                  | 359     | `@ts-expect-error`      |
| `src/session/index.ts`                | 205,207 | `@ts-expect-error`      |
| `src/server/server.ts`                | 21      | `@ts-ignore`            |
| `src/server/routes/tui.ts`            | 270     | `@ts-expect-error`      |
| `src/server/instance.ts`              | 34      | `@ts-expect-error`      |
| `src/provider/provider.ts`            | 1424    | `@ts-ignore`            |
| `src/provider/models.ts`              | 93      | `@ts-ignore`            |
| `src/file/watcher.ts`                 | 2       | `@ts-ignore`            |
| `src/control-plane/adaptors/index.ts` | 17      | `@ts-expect-error`      |
| `src/cli/cmd/generate.ts`             | 12      | `@ts-expect-error`      |

---

## 3. Error Handling Issues

### Empty Catch Blocks

| File                            | Line        | Issue                                          |
| ------------------------------- | ----------- | ---------------------------------------------- |
| `src/agent/roles/bug-buster.ts` | 37          | Searches for async functions without try-catch |
| `src/config/config.ts`          | 149,199     | `.catch(() => null)` - Silent failure          |
| `src/config/config.ts`          | 241,280,318 | `.catch(async (err) => {})` - Silent failure   |
| `src/config/config.ts`          | 1283        | `.catch(() => {})` - Silent failure            |

### Potential Unhandled Promises

| Count | Issue                                                       |
| ----- | ----------------------------------------------------------- |
| 343   | `throw new Error()` usages with inconsistent error handling |
| 567   | Various `throw` statements                                  |
| 877   | Async/Promise patterns requiring careful error handling     |

---

## 4. Logging Issues (219 occurrences)

### Excessive Console Logging

| File                       | Lines   | Issue                                  |
| -------------------------- | ------- | -------------------------------------- |
| `src/index.ts`             | 184,234 | Performance timing logs                |
| `src/cli/cmd/stats.ts`     | 152-400 | Heavy console.log output               |
| `src/cli/cmd/trace.ts`     | 90-138  | Debug console logging                  |
| `src/provider/qwen-cli.ts` | 316-341 | Debug diagnostic logs                  |
| `src/p2p/discovery.ts`     | 100-125 | Monkey-patches console.log temporarily |

---

## 5. TODOs and Technical Debt (41 occurrences)

| File                                      | Line    | Description                                              |
| ----------------------------------------- | ------- | -------------------------------------------------------- |
| `src/config/config.ts`                    | 142     | TODO: get rid of this case (Bun issue)                   |
| `src/bun/index.ts`                        | 86      | TODO: get rid of this case                               |
| `src/plugin/copilot.ts`                   | 44      | TODO: re-enable once messages api has higher rate limits |
| `src/plugin/copilot.ts`                   | 45      | TODO: move hacky-ness to models.dev presets              |
| `src/agent/memory-manager.ts`             | 161     | TODO: replace with embeddings                            |
| `src/config/config.ts`                    | 145     | TODO: Injections not working for some reason             |
| `src/config/parsers.ts`                   | 240     | TODO: Replace with official tree-sitter-nix WASM         |
| `src/tool/advanced-features.ts`           | 327     | TODO: Generate summary with models                       |
| `src/tool/gsd.ts`                         | 367     | References TODO.md                                       |
| `src/session/prompt/reminders.ts`         | 25      | TODO: update to use anthropic one                        |
| `src/session/llm.ts`                      | 102     | TODO: move to proper hook                                |
| `src/server/routes/global.ts`             | 166     | TODO: don't pass def, just pass type                     |
| `src/server/router.ts`                    | 44      | TODO: session routing lookup                             |
| `src/provider/transform.ts`               | 378     | TODO: Remove after data fixed                            |
| `src/provider/sdk/openai-compatible`      | 1671    | TODO: AI SDK 6 - use optional                            |
| `src/provider/sdk/copilot`                | 1727    | TODO: AI SDK 6 - use optional                            |
| `src/permission/next.ts`                  | 237     | TODO: save permission ruleset to disk                    |
| `src/p2p/server.ts`                       | 394     | TODO: Implement streaming response                       |
| `src/hooks/todo-continuation-enforcer.ts` | 163     | TODO: Implement actual todo checking                     |
| `src/hooks/ralph-loop.ts`                 | 242,266 | TODO: Check completion promise                           |
| `src/hooks/preemptive-compaction.ts`      | 197,248 | TODO: Call session.summarize API                         |
| `src/sync/index.ts`                       | 129     | TODO: incomplete                                         |
| `src/cli/cmd/github.ts`                   | 213     | TODO: add guide for copilot                              |
| `src/cli/cmd/collab.ts`                   | 246     | TODO: Fetch sessions from peer                           |
| `src/hook/comment-checker.ts`             | 44      | Checks for TODO comments                                 |
| `src/agent/store.ts`                      | 129     | TODO: Implement registry                                 |
| `src/account/index.ts`                    | 345     | TODO: Multiple orgs selection                            |

---

## 6. Build Errors

| File                  | Issue                                                    |
| --------------------- | -------------------------------------------------------- |
| `script/build.ts:123` | Native module install fails                              |
| -                     | `error: @effect/platform-node@3.12.10 failed to resolve` |
| -                     | `error: @google/genai@0.22.0 failed to resolve`          |
| `build_error.txt`     | Contains full build error                                |

---

## 7. TypeScript Config Issues

### Cross-Project Type Errors

The tsconfig.json includes files from other projects (`console/app`, `console/core`) causing type errors:

- `TS6307`: Files not listed within the file list of project
- `TS2305`: Module has no exported member
- `TS2307`: Cannot find module
- `TS7006`: Parameter implicitly has 'any' type

---

## 8. Pattern Summary

| Pattern               | Count   | Notes                    |
| --------------------- | ------- | ------------------------ |
| `any` type            | 691     | Excessive type looseness |
| `process.env.*`       | 285     | Heavy environment usage  |
| `throw new Error()`   | 343     | Many throwing sites      |
| `console.*`           | 219     | Debug logging left in    |
| TODO/FIXME            | 41      | Technical debt           |
| `@ts-ignore`          | 23      | Type safety disabled     |
| `// @ts-expect-error` | Various | Test/type suppressions   |

---

## Recommended Priority Fixes

1. **Critical**: Remove hardcoded secrets from `src/provider/gemini-cli.ts`
2. **High**: Reduce `any` usage with proper types
3. **High**: Remove `@ts-ignore` comments and fix root causes
4. **Medium**: Address build errors for dependencies
5. **Medium**: Clean up console.log statements
6. **Low**: Address TODOs and technical debt
