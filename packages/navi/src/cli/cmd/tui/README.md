<!-- CONSOLIDATION PLAN (do NOT merge TUIs yet): shadow `cli/cmd/tui/` duplicates
     `packages/tui/src` file-for-file with drifted `@tui/*` imports. Collapse per
     Step 1→3 below. Upstream gap source: opencode `packages/tui/src`. -->

# Shadow TUI consolidation plan

## 1. Dialog/component gaps (opencode has, navi `packages/tui` lacks)

- `component/dialog-update.tsx` (6.0KB) — auto-update prompt
- `component/dialog-highlights.tsx` (4.0KB) — highlights picker
- `component/dialog-pair.tsx` (4.8KB) — device pairing
- `component/dialog-config.tsx` (11.5KB) — config editor + permission surface
- `component/dialog-image-preview.tsx` (2.7KB)
- `component/dialog-shell-output.tsx` (5.9KB)
- `component/session-tabs.tsx` + `session-tabs-rail.tsx` (79KB) — multi-tab sessions
- Also missing: `dialog-integration.tsx`, `dialog-open.tsx`, `dialog-workspaces.tsx`,
  `dialog-worktree-name.tsx`, `session-frame.tsx`, `terminal-pane.tsx`,
  `command-palette.tsx`, `devtools-bar.tsx`, `patch-diff.tsx`;
  top-level dirs `devtools/`, `mini/`, `simulation/` and `model-preference.ts`.
- Navi-only (keep): `dialog-move-session.tsx`, `dialog-workspace-create/list.tsx`,
  `dialog-console-org.tsx`, `dialog-buddy.tsx`, `bg-pulse.*` (logo.tsx forked: 29KB vs 2KB).

## 2. Shadow → `packages/tui` duplication map

| shadow `cli/cmd/tui/` | canonical `packages/tui/src/` |
|---|---|
| `app.tsx` (32KB) | `app.tsx` (39KB; upstream 54KB) |
| `component/*` (e.g. `dialog-model.tsx`) | `component/*` (same basenames, relative imports) |
| `routes/home.tsx` (+`routes/session/`) | `routes/home.tsx` (+`routes/{home,session}/`) |
| `ui/`, `util/`, `config/`, `context/`, `feature-plugins/`, `plugin/` | same dirs under `packages/tui/src/` |
| `thread.ts`, `event.ts`, `attach.ts`, `keymap.tsx`, `worker.ts`, `win32.ts` | CLI-side only (keep); rest maps to root `keymap.tsx`, `runtime.tsx`, `terminal-win32.ts` |

## 3. Three-step collapse proposal

1. **Freeze**: no new components in `cli/cmd/tui/`; all TUI work goes to `packages/tui/src`.
2. **Re-export**: convert shadow files to `export * from "@tui/…"` shims (alias already
   used), deleting duplicated logic file-by-file starting with `component/` dialogs.
3. **Delete**: remove the shadow tree once `bun typecheck` + TUI smoke pass; keep only
   genuinely CLI-side wiring (`attach.ts`, `event.ts`, `worker.ts`, `validate-session.ts`).
