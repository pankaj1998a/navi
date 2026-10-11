# Reverse bridges (vendored)

Out-of-process analysis bridges, vendored from REA (`morluto/rea`, MIT) so
`reverse_*` engine tools work without an MCP round-trip.

- `hopper_bridge.py` — runs inside Hopper, serves disassembly over a Unix socket.
- `ghidra/` — headless Ghidra bridge (bring-your-own Ghidra + JDK).
- `android/` — headless JADX bridge (bring-your-own JADX + JDK).
- `pwntools/`, `pwndbg/` — offline ELF layout, decoder runtime, recorded-crash
  analysis (bring-your-own Python with `pwntools`, optional `pwndbg`).
- `mitmproxy/capture.py` — traffic capture helper for web runtime observation.
- `rea_lldb_tracer.py` — LLDB call tracer for native observation.

Engines are never auto-installed. `reverse_doctor` reports what is present.
