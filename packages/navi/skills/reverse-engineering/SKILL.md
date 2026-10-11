---
name: reverse-engineering
description: "Reverse-engineer binaries, apps, and captures with inbuilt static analysis: JS/Electron/ASAR, .NET, APK, EVM, firmware, ELF/Mach-O/PE, Apple bundles, HAR/source-maps, plus engine doctor for Hopper/Ghidra/IDA."
---

# Reverse engineering

Inbuilt static analysis lives in the `reverse_*` tools. Analysis is local and
read-only: targets are never executed, ambient credentials are never persisted,
and every conclusion ships with its evidence or its unknowns.

## Tool map

- `reverse_analyze_javascript` — app directory, single file, or `.asar`
- `reverse_analyze_managed` — .NET assembly identity and metadata tables
- `reverse_analyze_apk` — manifest, dex counts, signatures
- `reverse_analyze_evm` — selectors, payable heuristic, compiler metadata
- `reverse_analyze_firmware` — magics, strings, entropy hotspots
- `reverse_analyze_native` — ELF / Mach-O (fat) / PE imports, exports, notes
- `reverse_analyze_apple` — bundle plist, executable arch, signature
- `reverse_analyze_web` — HAR summary or source-map inventory
- `reverse_doctor` — BYO engine availability (Hopper, Ghidra, IDA, JADX,
  binwalk, unblob, pwntools, Wakaru, mitmproxy, LLDB)

## Workflow

1. Run `reverse_doctor` when the target needs a disassembler, decompiler, or
   extractor; report missing engines with their install hints instead of
   guessing.
2. Start with the cheapest static tool that matches the file type. Prefer an
   extracted directory over an archive; `.asar` is read directly.
3. Distinguish observations (bytes seen, with digests), derivations (parsed
   structures), inferences (heuristics, marked as such), and unknowns (explicit
   gaps with next steps).
4. When a managed CLR directory appears in a PE, switch to
   `reverse_analyze_managed`. When an Apple executable appears, confirm arch
   with `reverse_analyze_native` if needed.
5. For behavioral questions (feature tracing, runtime values), say so: static
   tools cannot observe execution. Point at the engine bridges under
   `src/reverse/bridges/` for follow-up dynamic work.
