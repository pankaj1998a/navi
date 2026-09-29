# landlock-run — future Linux confinement for navi

> Stub for upcoming Landlock integration. See upstream design in
> `V:\pankaj\deepseek-harness\native\landlock-run\README.md` and
> `V:\pankaj\deepseek-harness\native\landlock-run\docs/cli-contract.md`.

## Goal

Bring the deepseek-harness **Landlock self-restrict-then-exec launcher** (`landlock-run`)
to navi so untrusted commands run under a filesystem allow-list without confining
the harness process itself. The launcher installs a Landlock ruleset on itself and
`exec`s the wrapped command; the ruleset is inherited across `execve`, so the
command and every child it spawns stay confined while `navi` stays unrestricted.
Fail-closed: if the kernel cannot enforce, it exits without running the command.

Upstream properties we will preserve:
- ~300 lines of C11 over the raw kernel UAPI, statically linked against musl.
- No libraries beyond libc; kernel UAPI definitions vendored verbatim.
- No environment-variable overrides for binary resolution — test injection is by function parameter only.
- No install-time build fallback: hosts without a matching platform package resolve to a non-existent path, `probe()` reports `unusable`, and callers fall closed.

## Upstream API (to be wrapped)

From `@deepseek-ai/node-addon-landlock-run` (see `V:\pankaj\deepseek-harness\native\landlock-run\README.md`):

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'

const launcher = launcherPath() // absolute host path, may not exist — probe is the signal
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'] }), '--', 'bash', '-c', command]
  // spawn argv with your process runner
}
```

Public surface we will mirror:
- `launcherPath(): string` — absolute launcher path (unchecked)
- `probe(launcher?, { timeoutMs? }): 'full' | 'partial' | 'unusable'` — functional enforcement probe
- `grantArgs({ readOnly?, readWrite? }): string[]` — grant argv; everything not granted is denied
- `LAUNCHER_BIN` and `LAUNCHER_FAILURE_EXIT = 125` — binary contract constants

Full binary contract (argv grammar, exit codes, report lines) is pinned in upstream `docs/cli-contract.md`.

## Support matrix (inherited)

- `linux-x64` and `linux-arm64` with Landlock enabled (kernel 5.13+; ABI level decides `full` vs `partial` enforcement — see `docs/support-matrix.md` upstream).
- Other platforms deliberately have no package: consumers run different backends there (Seatbelt on macOS, Restricted Token on Windows).

## Integration plan for navi

1. **Workspace wiring** — add `native/landlock-run` as a pnpm workspace member (mirroring `V:\pankaj\deepseek-harness\pnpm-workspace.yaml`'s `native/landlock-run` entries) and vendor the entry + per-platform packages.
2. **Confinement backend** — keep `packages/shell` / `packages/fs` semantics, but route `shell.run`/`fs` mutations through `landlock-run` grants derived from the per-call `SandboxExecutionPolicy` (same writable-root set that `FsPolicy.isAllowedUnderRoots` checks).
3. **Fail-closed probe** — on startup, probe the launcher; if `unusable`, disable escalation and surface `[sandbox: ...]` markers without spawning unconfined commands.
4. **No musl cross-build** — each architecture builds its own static binary on its own runner; CI is builder of record, tarballs gated by `verify-launcher-binary.mjs`.

## References

- Upstream README: `V:\pankaj\deepseek-harness\native\landlock-run\README.md`
- AGENTS: `V:\pankaj\deepseek-harness\native\landlock-run\AGENTS.md`
- Docs: `docs/architecture.md`, `docs/cli-contract.md`, `docs/support-matrix.md` under that package
- Package family: `packages/entry` (JS API + C source) + `packages/linux-*` (prebuilt musl binary)

> This file is a placeholder until the binary and JS entry package are vendored. It exists so `native/landlock-run` resolves in workspace tooling and so policy code can import future `grantArgs`/`probe` helpers.
