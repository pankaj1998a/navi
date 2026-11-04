# Navi — Slash Commands Reference

> Generated from source at `master` (working tree). All file:line references are relative to `packages/navi/`.
> Companion diagram: [`slash-commands.mmd`](./slash-commands.mmd).

## 0. Which TUI is actually wired

The `navi` binary (`bin/navi` → `src/index.ts:123` → `src/cli/cmd/tui/thread.ts:231`) uses **`src/cli/cmd/tui/`** (`@tui/*` → `./src/cli/cmd/tui/*`, `tsconfig.json:14`).
`packages/tui/` is a separate opencode-flavoured copy consumed only by `@navi-ai/cli` (`packages/cli/src/tui.ts:1`) — **not reachable from `navi`**. There are no runtime collisions; where both define a name, the `packages/navi` copy wins.

## 1. Dispatch mechanics

| Kind | Behaviour |
|---|---|
| **Native (palette) commands** | Registered as keymap "palette" commands (`cli/cmd/tui/app.tsx:484`, `routes/session/index.tsx:444`, `component/prompt/index.tsx`). Surfaced by `context/command-palette.tsx:61-80`. Selected → **executes immediately** (no arguments). |
| **Prompt/server commands** | Autocomplete inserts `/name ` (`component/prompt/autocomplete.tsx:403-417`); on submit the text goes to `sdk.client.session.command` (`component/prompt/index.tsx:1169-1198`). Support `$ARGUMENTS` and `$1…$n`. |
| **`/plan`, `/build`** | Special-cased at submit (`component/prompt/index.tsx:1100-1157`); a native palette entry also exists for each. |
| **Skill commands** | Loaded from skills; **excluded from autocomplete** (`autocomplete.tsx:404`) — typed only. |
| **MCP prompts** | Shown with a `:mcp` suffix; resolved lazily. |
| **Config / file / plugin commands** | Can add arbitrary slash names at runtime. |

---

## 2. Native TUI commands — 32 (29 unconditional + 3 conditional)

### Session (12)
| Command | Aliases | Description | Behaviour | Handler |
|---|---|---|---|---|
| `/new` | `/clear` | New session | Navigate home, clear dialog | `app.tsx:511` |
| `/sessions` | `/resume`, `/continue` | Switch session | Session list dialog | `app.tsx:500` |
| `/share` | — | Share session | Share API, copies URL (consent) | `routes/session/index.tsx:451` |
| `/unshare` | — | Unshare session | Revoke share | `routes/session/index.tsx:570` |
| `/rename` | — | Rename session | Rename dialog | `routes/session/index.tsx:488` |
| `/timeline` | — | Jump to message | Timeline dialog | `routes/session/index.tsx:499` |
| `/fork` | — | Fork session | Fork-from-timeline dialog | `routes/session/index.tsx:521` |
| `/compact` | `/summarize` | Compact session | Summarize with current model | `routes/session/index.tsx:543` |
| `/undo` | — | Undo previous message | Aborts + reverts last user message, refills prompt | `routes/session/index.tsx:592` |
| `/redo` | — | Redo | Step revert forward / unrevert | `routes/session/index.tsx:630` |
| `/copy` | — | Copy transcript | Format + clipboard | `routes/session/index.tsx:897` |
| `/export` | — | Export transcript | Options dialog → `.md` in cwd/editor | `routes/session/index.tsx:927` |

### Editing / Input (5)
| Command | Aliases | Description | Behaviour | Handler |
|---|---|---|---|---|
| `/editor` | — | Open editor | Edit prompt in `$EDITOR` | `component/prompt/index.tsx:500` |
| `/skills` | — | Skills | Picker; inserts `/skillname` | `component/prompt/index.tsx:584` |
| `/warp` | — | Warp (workspace) | Move session to workspace *(flag: `NAVI_EXPERIMENTAL_WORKSPACES`)* | `component/prompt/index.tsx:606` |
| `/timestamps` | `/toggle-timestamps` | Show/hide timestamps | Toggle | `routes/session/index.tsx:677` |
| `/thinking` | `/toggle-thinking` | Show/hide thinking | Toggle | `routes/session/index.tsx:690` |

### View / UI (5)
| Command | Aliases | Description | Behaviour | Handler |
|---|---|---|---|---|
| `/help` | — | Help | Help dialog | `app.tsx:725` |
| `/status` | — | View status | Status dialog | `app.tsx:688` |
| `/themes` | — | Switch theme | Theme list | `app.tsx:697` |
| `/viz` | — | Toggle debug panel | Debug overlay | `app.tsx:757` |
| `/exit` | `/quit`, `/q` | Exit the app | Exit (only when prompt empty) | `app.tsx:743` |

### Config / Model / Agent (10)
| Command | Aliases | Description | Behaviour | Handler |
|---|---|---|---|---|
| `/models` | — | Switch model | Model dialog | `app.tsx:525` |
| `/variants` | — | Switch model variant | Hidden when no variants | `app.tsx:646` |
| `/agents` | — | Switch agent | Agent dialog | `app.tsx:570` |
| `/agent` | `/ctz` | Configure agent model | Agent-model dialog | `app.tsx:579` |
| `/buddy` | — | Switch buddy | Mascot picker (navi-only) | `app.tsx:590` |
| `/mcps` | — | Toggle MCPs | MCP dialog | `app.tsx:599` |
| `/connect` | — | Connect provider | Provider list | `app.tsx:664` |
| `/org` | `/orgs`, `/switch-org` | Switch org | Only when >1 org | `app.tsx:676` |
| `/plan` | — | Switch to Plan mode | Sets agent; args become prompt | `app.tsx:608` + `prompt/index.tsx:1100` |
| `/build` | — | Switch to Build mode | Same, build agent | `app.tsx:618` + `prompt/index.tsx:1100` |

---

## 3. Prompt commands (server registry) — 33 core + 31 official plugins

Defined in `src/command/index.ts`; expanded to a user turn via `session.command`. May pin an agent, run as a subtask, and take `$ARGUMENTS` / `$n` hints — unlike native handlers, which are in-process UI actions.

### Core built-ins (33) — `src/command/index.ts`
| Command | What it does | Line |
|---|---|---|
| `/init` | Guided AGENTS.md setup | 107 |
| `/review` | Review changes [commit\|branch\|pr] | 116 |
| `/forge` | Structured waterfall build (architect) | 126 |
| `/teleport` | Export session archive | 136 |
| `/github-pr-review` | GitHub PR review (agent) | 145 |
| `/github-issue-triage` | Issue triage (agent) | 155 |
| `/release-notes` | Generate release notes | 165 |
| `/loop` | Autonomous experiment loop | 175 |
| `/karpathy-loop` | Same, on a target metric | 185 |
| `/goal` | Perseverant goal execution | 195 |
| `/grill-me` | Interrogate requirements/tradeoffs | 204 |
| `/learn` | Persist corrections to AGENTS.md | 213 |
| `/schedule` | Manage cron/background tasks | 222 |
| `/cost` | Token/cost accounting | 231 |
| `/checkpoint` | Create snapshot checkpoint | 240 |
| `/rewind` | Restore snapshot checkpoint | 249 |
| `/diff` | Git status + uncommitted diff | 258 |
| `/doctor` | Environment diagnostics | 267 |
| `/recap` | 40–60 word session catch-up | 276 |
| `/watch-ui` | Resolve UI annotations (agent) | 285 |
| `/agentation` | Visual-feedback setup (agent) | 295 |
| `/acceptpr` | Land a PR end-to-end | 305 |
| `/landpr` | Land PR via temp-branch rebase | 314 |
| `/fixissue` | Issue → fix → close | 323 |
| `/handoff` | Capture session state for next agent | 332 |
| `/pickup` | Rehydrate context onto active task | 341 |
| `/raise` | Open CHANGELOG Unreleased | 350 |
| `/sectriage` | Triage GitHub Security Advisory | 359 |
| `/plan` | Run in plan agent | 374 |
| `/build` | Run in build agent | 384 |
| `/permissions` | 4-tier permission mode (`supervised\|auto_accept_edits\|auto\|full_access`) | 394 |
| `/swarm` | Fan out teammate swarm | 403 |
| `/magicdocs` | Audit living docs (architecture/changelog/memory) | 412 |

### Official plugin commands (31) — `src/plugin/official/commands.ts`
Merged at `src/command/index.ts:369`; gated by `NAVI_DISABLE_DEFAULT_PLUGINS`. All are agent/`$ARGUMENTS` prompt templates with no native handler.

`/code-review`, `/review-pr`, `/feature-dev`, `/code-simplifier`, `/commit`, `/commit-push-pr`, `/clean_gone`, `/hookify`, `/create-plugin`, `/ralph-loop`, `/cancel-ralph`, `/new-sdk-app`, `/modernize`, `/create-docker-mcp-tunnel`, `/revise-claude-md`, `/skill-up`, `/security-audit`, `/diagnose`, `/grill`, `/to-spec`, `/codebase-design`, `/validate`, `/solo-plan`, `/spec`, `/tdd-build`, `/cso`, `/qa`, `/webperf`, `/ship`, `/investigate`, `/guard`.

### Overlaps
`/plan`, `/build`, `/permissions` exist in both native and prompt registries. Autocomplete suppresses the server duplicate (`autocomplete.tsx:405`); the native palette entry wins visually, but typing `/plan …` (with arguments) hits the server/submit path.

---

## 4. Dynamic command sources (unbounded)

| Source | Where | Would shadow? |
|---|---|---|
| **Config `command.*`** | `command.<name>: {template, description?, agent?, model?, subtask?}` — merged at `command/index.ts:426-439` | **Yes** — config entries overwrite built-ins |
| **Instruction files** | `{command,commands}/**/*.md` under project `.navi/` and global config; name derived from path (`config/command.ts:52-105`). Frontmatter: `description`, `agent`, `model`, `subtask`; body = template | Yes (same merge) |
| **MCP prompts** | `mcp.prompts()`; args mapped to `$1…$n`, rendered lazily (`command/index.ts:442-468`) | **Yes — highest precedence** (assigned last, overwrites all) |
| **Skills** | Every skill becomes a command (`command/index.ts:470-481`) | **No** — skipped if name already exists (`if (commands[item.name]) continue`) |
| **TUI plugins** | Runtime-added palette commands | Implementation-dependent |

Precedence observed: **MCP prompt > config/file command > built-in > skill**.
Name lookup strips `/`-style prefixes via `configEntryNameFromPath` for files; collision is "last writer wins" per the merge order above.
Skill commands are typed-only (no autocomplete); MCP prompts are shown with `:mcp`.

### Hidden / conditional
- `/variants` — only when the model has variants.
- `/org` — only when more than one org is available.
- `/warp` — only when `NAVI_EXPERIMENTAL_WORKSPACES` is set (`packages/core/src/flag/flag.ts:97`).
- `/share` — disabled when `config.share === "disabled"`.
- `/unshare`, `/redo` — enabled only when state allows.
- `/exit` — only when the prompt is empty.

---

## 5. Dead stub list — `src/slash/extra-commands.ts` (128 names)

The file defines 128 command names (85 with descriptions) plus a `registerExtraCommands()` stub, but **it is imported nowhere in `src/`** (verified by grep). These are **not registered** in the TUI or autocomplete and do nothing. The file's own comment says they exist "so `tsc` passes and completion can suggest them" — neither is currently true.

Grouped as in the source:

- **Navigation & Info (6):** `/help`, `/status`, `/files`, `/session`, `/cost`, `/usage`
- **Project Setup (4):** `/init`, `/add-dir`, `/onboarding`, `/doctor`
- **Git Operations (5):** `/commit`, `/branch`, `/diff`, `/pr-comments`, `/review`
- **Context Control (5):** `/compact`, `/memory`, `/clear`, `/rewind`, `/thinkback`
- **Configuration (6):** `/config`, `/theme`, `/color`, `/keybindings`, `/model`, `/permissions`
- **Automation (12):** `/workflows`, `/workflow`, `/tasks`, `/skills`, `/plugin`, `/loop`, `/karpathy-loop`, `/autoresearch`, `/goal`, `/grill-me`, `/learn`, `/recap`
- **Experimental (6):** `/voice`, `/vim`, `/buddy`, `/flash`, `/torch`, `/bughunter`
- **Extended (84):** `/plan`, `/agent`, `/context`, `/prompt`, `/fork`, `/retry`, `/mcp`, `/ide`, `/terminal`, `/sandbox`, `/history`, `/knowledge`, `/search`, `/grep`, `/glob`, `/read`, `/write`, `/edit`, `/shell`, `/task`, `/todo`, `/question`, `/schedule`, `/arch`, `/lsp`, `/browser`, `/image`, `/web`, `/fetch`, `/crawl`, `/scrape`, `/grounding`, `/tavily`, `/exa`, `/duck`, `/google`, `/firecrawl`, `/test`, `/checkpoint`, `/vcr`, `/teleport`, `/share`, `/context-epoch`, `/security-audit`, `/watch-ui`, `/agentation`, `/acceptpr`, `/landpr`, `/fixissue`, `/handoff`, `/pickup`, `/raise`, `/sectriage`, `/validate`, `/spec`, `/build`, `/cso`, `/qa`, `/qa-only`, `/webperf`, `/ship`, `/investigate`, `/guard`, `/careful`, `/freeze`, `/unfreeze`, `/benchmark`, `/reflect`, `/code-simplify`, `/constraints`, `/diagram`, `/ctx`, `/ctx-stats`, `/ctx-doctor`, `/karpathy-guidelines`, `/ppt`, `/presentation`, `/ask-matt`, `/diagnose`, `/domain-model`, `/tdd`, `/to-tickets`, `/wayfinder`, `/prototype`

Names that also exist as real commands are duplicated here and should be removed: `/help`, `/status`, `/cost`, `/init`, `/doctor`, `/diff`, `/review`, `/compact`, `/rewind`, `/clear` (alias), `/model` (as `/models`), `/permissions`, `/skills`, `/loop`, `/karpathy-loop`, `/goal`, `/grill-me`, `/learn`, `/recap`, `/plan`, `/agent` (as `/agents`), `/fork`, `/mcp` (as `/mcps`), `/schedule`, `/checkpoint`, `/teleport`, `/share`, `/watch-ui`, `/agentation`, `/acceptpr`, `/landpr`, `/fixissue`, `/handoff`, `/pickup`, `/raise`, `/sectriage`, `/validate` (official plugin), `/spec` (official), `/build`, `/cso` (official), `/qa` (official), `/webperf` (official), `/ship` (official), `/investigate` (official), `/guard` (official), `/diagnose` (official), `/security-audit` (official), `/buddy`, `/voice` (voice exists in codex but not navi).

---

## 6. Counts

| Bucket | Count |
|---|---|
| Native TUI (29 unconditional + 3 conditional) | **32** |
| Core prompt commands | **33** |
| Official plugin prompt commands | **31** |
| Distinct static, user-visible (after 3 overlaps) | **~93–94** |
| Dead stub names (unregistered) | **128** |
| Skills (typed-only, ~55 official + user skills) | **dynamic** |
| MCP prompts (`:mcp`) | **dynamic** |
| Config / file / plugin commands | **dynamic** |

## 7. Known inconsistencies

1. `extra-commands.ts` is dead code: 135 names, zero registrations — contradicts its header comment.
2. `/plan` and `/build` are implemented twice (native palette + prompt registry); `/permissions` likewise.
3. Skill commands cannot be autocompleted (typed only), which makes the skill catalog hard to discover.
4. `packages/tui` (the unused copy) has `/workspaces`, `/debug`, `/move` and lacks `/agent`, `/buddy`, `/plan`, `/build`, `/viz` — do not document it as navi behaviour.
5. Native commands take no arguments; only prompt commands support `$ARGUMENTS` / `$n`.