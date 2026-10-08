---
name: create-cli
description: "CLI UX specification: args, flags, subcommands, help, stdin/stdout contracts, exit codes, dry-run safety."
---

# Create CLI

Design command-line interfaces that are human-friendly and script-ready, adhering to industry standards.

## Principles

1. **Hierarchy & Ergonomics**:
   - Primary operations should be concise subcommands: `tool <command> [args] [flags]`.
   - Global flags: `-h, --help`, `-v, --version`, `-q, --quiet`, `--json`, `--no-color`.

2. **I/O Separation**:
   - Write structured primary data to `stdout`.
   - Write diagnostic status, logs, and spinners to `stderr`.
   - Support `--json` for automation and machine consumption.

3. **Destructive Operations & Safety**:
   - Dangerous operations (delete, reset, prune) must require confirmation when interactive, or `--force` / `--yes` in headless/CI environments.
   - Support `--dry-run` to preview state changes without modifying disks or remote APIs.

4. **Exit Codes**:
   - `0`: Success.
   - `1`: General error or operation failure.
   - `2`: Misuse of shell arguments / flag parse error.
