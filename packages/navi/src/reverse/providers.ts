import fs from "node:fs"
import path from "node:path"
import { Schema } from "effect"

export const EngineSpec = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  purpose: Schema.String,
  binaries: Schema.Array(Schema.String),
  versionArgs: Schema.Array(Schema.String),
  installHint: Schema.String,
  bridge: Schema.optional(Schema.String),
})

export type EngineSpec = Schema.Schema.Type<typeof EngineSpec>

export const EngineStatus = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  present: Schema.Boolean,
  path: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  installHint: Schema.String,
})

export type EngineStatus = Schema.Schema.Type<typeof EngineStatus>

const BRIDGES = new URL("./bridges/", import.meta.url).pathname

export const bridgePath = (rel: string): string => path.join(BRIDGES, rel)

export const ENGINE_SPECS: EngineSpec[] = [
  {
    id: "hopper",
    label: "Hopper",
    purpose: "macOS/Linux disassembler + decompiler (primary native provider)",
    binaries: ["hopper", "hopperv4"],
    versionArgs: ["--version"],
    installHint: "Install Hopper v4+ (https://hopperapp.com); `rea setup` can install it with approval.",
    bridge: "hopper_bridge.py",
  },
  {
    id: "ghidra",
    label: "Ghidra",
    purpose: "Headless ephemeral analysis (no GUI control, no byte mutation)",
    binaries: ["ghidraRun", "analyzeHeadless"],
    versionArgs: [],
    installHint: "Install Ghidra 11+ with a full JDK (https://ghidra-sre.org); set GHIDRA_INSTALL_DIR.",
    bridge: "ghidra/ReaGhidraBridge.java",
  },
  {
    id: "ida",
    label: "IDA",
    purpose: "Read-only analysis of an attached GUI database or owned headless DB",
    binaries: ["ida64", "idat64", "ida"],
    versionArgs: [],
    installHint: "Install IDA Pro 9+ with the ida-pro-mcp GUI proxy for live binding.",
  },
  {
    id: "jadx",
    label: "JADX",
    purpose: "Android dex-to-Java decompilation (headless, owned SDK stdio)",
    binaries: ["jadx"],
    versionArgs: ["--version"],
    installHint: "Install JADX with a full JDK (https://github.com/skylot/jadx).",
    bridge: "android/ReaJadxBridge.java",
  },
  {
    id: "binwalk",
    label: "binwalk",
    purpose: "Firmware signature scan + extraction",
    binaries: ["binwalk"],
    versionArgs: ["--version"],
    installHint: "pip install binwalk or your system package manager.",
  },
  {
    id: "unblob",
    label: "unblob",
    purpose: "Firmware extraction fallback",
    binaries: ["unblob"],
    versionArgs: ["--version"],
    installHint: "pip install unblob (needs an extraction sandbox).",
  },
  {
    id: "pwntools",
    label: "pwntools",
    purpose: "Offline ELF layout + decoder runtime + recorded crashes",
    binaries: ["python3"],
    versionArgs: ["-c", "import pwn, sys; sys.stdout.write(pwn.__version__)"],
    installHint: "Python 3 with pwntools>=4.15, pyelftools, unicorn (REA_PWNTOOLS_PYTHON).",
    bridge: "pwntools/layout.py",
  },
  {
    id: "gdb-pwndbg",
    label: "GDB + pwndbg",
    purpose: "Core-dump context for recorded crashes (optional)",
    binaries: ["gdb"],
    versionArgs: ["--version"],
    installHint: "Install GDB with pwndbg for core-only analysis.",
    bridge: "pwndbg/launch.py",
  },
  {
    id: "wakaru",
    label: "Wakaru",
    purpose: "JavaScript deobfuscation + unminification",
    binaries: ["wakaru"],
    versionArgs: ["--version"],
    installHint: "npm install -g wakaru (version-pinned check at runtime).",
  },
  {
    id: "mitmproxy",
    label: "mitmproxy",
    purpose: "Web runtime traffic capture",
    binaries: ["mitmdump", "mitmproxy"],
    versionArgs: ["--version"],
    installHint: "pip install mitmproxy.",
    bridge: "mitmproxy/capture.py",
  },
  {
    id: "lldb",
    label: "LLDB",
    purpose: "Native call tracing on macOS/Linux",
    binaries: ["lldb"],
    versionArgs: ["--version"],
    installHint: "Ships with Xcode / llvm package.",
    bridge: "rea_lldb_tracer.py",
  },
  {
    id: "java",
    label: "Java (JDK)",
    purpose: "Required by Ghidra and JADX bridges",
    binaries: ["java"],
    versionArgs: ["-version"],
    installHint: "Install a full JDK 17+ (not JRE).",
  },
]

const MAC_APP_PATHS: Record<string, string[]> = {
  hopper: ["/Applications/Hopper Disassembler v4.app", "/Applications/Hopper.app"],
}

export const detectEngines = (): { id: string; present: boolean; path?: string }[] =>
  ENGINE_SPECS.map((spec) => {
    for (const bin of spec.binaries) {
      const found = Bun.which(bin)
      if (found) return { id: spec.id, present: true, path: found }
    }
    for (const appPath of MAC_APP_PATHS[spec.id] ?? []) {
      if (fs.existsSync(appPath)) return { id: spec.id, present: true, path: appPath }
    }
    if (spec.id === "ghidra" && process.env["GHIDRA_INSTALL_DIR"]) {
      const dir = process.env["GHIDRA_INSTALL_DIR"]
      const candidate = path.join(dir, "support", "analyzeHeadless")
      if (fs.existsSync(candidate) || fs.existsSync(`${candidate}.bat`)) {
        return { id: spec.id, present: true, path: candidate }
      }
    }
    return { id: spec.id, present: false }
  })

export * as ReverseProviders from "./providers"
