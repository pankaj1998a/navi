# Changelog

Release notes for Navi, newest first. Navi tracks upstream OpenCode V2; upstream
entries are summarized from the synced base, Navi-only work is listed under
"Navi divergences".

## Base: OpenCode v2.0.28 — 2026-10-13

Navi `sync/navi-upgrades-2026-10-14` is synced against upstream OpenCode
**v2.0.28**. Upstream highlights in the base (see upstream `CHANGELOG.md` for
full entries):

- **Per-Project Auto-Accept**: per-project permission override plus `mod+shift+a`.
- **Release Highlights in the TUI**: post-update highlights dialog and `/highlights`.
- **Native Windows ARM64 Support** and official WinGet packages.
- **Continuous Gemini Responses** via provider continuation tokens.

## Navi divergences

Navi-only features on top of the upstream base:

- **LSP tooling**: `packages/navi/src/tool/lsp.ts` plus `packages/navi/src/lsp/fallback.ts`.
- **60+ tools**: expanded tool surface under `packages/navi/src/tool/` (trash,
  memory, browser automation actions, bridge, hashline-edit, agentation/visual
  feedback, github upload, tool-search, sandbox-confined shell, and more).
- **164 skills**: full catalog under `packages/navi/skills/` with validator,
  cross-agent synchronizer, and docs indexer.
- **Rust native engine**: `native/navi-native` (AST structure, BPE token
  counter, binary inspector, Codex/Grok build engine, secret scrubbing) plus
  `native/landlock-run` confinement.
- **Sandbox**: `packages/navi/src/sandbox/index.ts` with path containment and
  deepscan hardening.
- **Free models**: `packages/navi/src/provider/free-models.json` with
  Antigravity/OpenCode provider adapters.
