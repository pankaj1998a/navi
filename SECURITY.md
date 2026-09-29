# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

Navi is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

Navi does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run Navi inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `NAVI_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**      | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/anomalyco/navi/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply to your report, the security team will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Escalation

If you do not receive an acknowledgement of your report within 6 business days, you may send an email to security@anoma.ly

---

## Supply chain / LSP downloads

LSP auto-downloads in `packages/navi/src/lsp/server.ts` follow these rules:

- `githubFetch` / `downloadFetch` send `Authorization: Bearer $GITHUB_TOKEN` when set
  (avoids rate-limit failures) and abort after 30s (`AbortSignal.timeout(30_000)`).
- Pin versions with `NAVI_LSP_VERSION_<ID>` (e.g. `NAVI_LSP_VERSION_CLANGD=19.1.2`).
  Mismatches throw `LSP version pin mismatch`.
- Pin hashes with `NAVI_LSP_SHA256_<ID>` (lowercase hex). Mismatches throw
  `LSP sha256 mismatch`. When unset, the download logs
  `WARN no pinned sha256 for LSP download, skipping verification` and continues —
  set the pin in CI/release environments to make verification enforced.
- Disable network installs with `NAVI_DISABLE_LSP_DOWNLOAD=1`.
- `<ID>` is the upper-snake form of the LSP id (`clangd`, `zls`,
  `lua-language-server`, `kotlin-lsp`, `vscode-eslint`, `elixir-ls`).

Dependency hygiene: Renovate/Dependabot config lives in `.github/dependabot.yml`.
Run `bun audit` (or `bun pm audit`) before release; `bun.lock` is the source of truth.
