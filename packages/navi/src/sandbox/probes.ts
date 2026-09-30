import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Runner = "bwrap" | "landlock" | "seatbelt" | "windows-acl"
type Enforcement = "full" | "partial" | "unusable"
type RunnerFailureRule = {
  readonly fatalSignatures: readonly string[]
  readonly allowedExitCodes?: readonly number[]
  readonly informationalLines?: readonly string[]
}

export const PLATFORM_CHAINS: Record<string, readonly Runner[]> = {
  linux: ["bwrap", "landlock"],
  darwin: ["seatbelt"],
  win32: ["windows-acl"],
}

export const STATIC_ENFORCEMENT: Record<Runner, Enforcement> = {
  bwrap: "full",
  landlock: "full",
  seatbelt: "full",
  "windows-acl": "partial",
}

export const DENIAL_SIGNATURES = {
  bwrap: ["read-only file system"],
  landlock: ["permission denied"],
  seatbelt: ["operation not permitted"],
  "windows-acl": ["access is denied", "access to the path", "permission denied"],
  runnerCommand: ["read-only file system", "permission denied"],
} as const satisfies Record<Runner | "runnerCommand", readonly string[]>

const WINDOWS_ACL_RUNNER_FAILURE_EXIT = 127
const LAUNCHER_BIN = "landlock-run"
const LAUNCHER_FAILURE_EXIT = 125

export const RUNNER_FAILURE_RULES = {
  bwrap: [{ fatalSignatures: ["bwrap: "] }],
  landlock: [
    {
      allowedExitCodes: [LAUNCHER_FAILURE_EXIT],
      fatalSignatures: [`${LAUNCHER_BIN}: `],
      informationalLines: [`${LAUNCHER_BIN}: partial enforcement (older Landlock ABI)`],
    },
  ],
  seatbelt: [{ fatalSignatures: ["sandbox-exec: "] }],
  "windows-acl": [{ allowedExitCodes: [WINDOWS_ACL_RUNNER_FAILURE_EXIT], fatalSignatures: ["windows-acl-run: "] }],
} as const satisfies Record<Runner, readonly RunnerFailureRule[]>

export const probeBwrap = (launcher?: string): Enforcement => {
  void launcher
  const proc = Bun.spawnSync(["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent", "--", "true"], {
    timeout: 5000,
    stderr: "ignore",
    stdout: "ignore",
  })
  if (proc.exitCode === 0) return "full"
  return "unusable"
}

export const probeSeatbelt = (seatbeltExec = "sandbox-exec"): Enforcement => {
  const proc = Bun.spawnSync([seatbeltExec, "-p", "(version 1)(allow default)(deny file-write*)", "--", "true"], {
    timeout: 5000,
    stderr: "ignore",
    stdout: "ignore",
  })
  if (proc.exitCode === 0) return "full"
  return "unusable"
}

export const probeLandlock = (launcher: string): Enforcement => {
  const proc = Bun.spawnSync([launcher, "--help"], {
    timeout: 5000,
    stderr: "pipe",
    stdout: "ignore",
  })
  if (proc.exitCode === 0) return "full"
  const stderr = proc.stderr.toString().toLowerCase()
  if (stderr.includes("partial")) return "partial"
  return "unusable"
}

export const probeWindowsAcl = (launcher?: string): Enforcement => {
  const program = launcher ?? "navi-windows-acl-runner"
  const proc = Bun.spawnSync([program, "--workspace", tmpdir(), "--temp", tmpdir(), "--mode", "read-only", "--", "cmd", "/c", "exit", "0"], {
    timeout: 5000,
    stderr: "ignore",
    stdout: "ignore",
  })
  if (proc.exitCode === 0) return "partial"
  return "unusable"
}

const probeRunner = (runner: Runner): Enforcement => {
  if (runner === "bwrap") return probeBwrap()
  if (runner === "seatbelt") return probeSeatbelt()
  if (runner === "landlock") return probeLandlock(LAUNCHER_BIN)
  if (runner === "windows-acl") return probeWindowsAcl()
  return "unusable"
}

export const selectRunner = (platform: string): { runner: Runner; enforcement: Enforcement } | null => {
  const chain = PLATFORM_CHAINS[platform]
  if (chain === undefined) return null
  if (chain.length === 0) return null
  if (chain.length === 1) {
    const sole = chain[0] as Runner
    return { runner: sole, enforcement: STATIC_ENFORCEMENT[sole] }
  }
  for (const runner of chain) {
    const enforcement = probeRunner(runner as Runner)
    if (enforcement !== "unusable") return { runner: runner as Runner, enforcement }
  }
  return null
}

const workspaceGrants = new Map<string, string>()
const tempCapabilities = new Map<string, { dir: string; writeSid: string; grant: string }>()

export const materialize = (workspaceRoot: string, sessionId: string): { dir: string; writeSid: string } => {
  const writeSid = `sid-${workspaceRoot}`
  if (!workspaceGrants.has(workspaceRoot)) workspaceGrants.set(workspaceRoot, writeSid)
  const key = JSON.stringify([sessionId, workspaceRoot])
  const existing = tempCapabilities.get(key)
  if (existing !== undefined) return existing
  const dir = mkdtempSync(join(tmpdir(), "navi-"))
  const tempSid = `sid-${dir}`
  const cap = { dir, writeSid: tempSid, grant: tempSid }
  tempCapabilities.set(key, cap)
  return cap
}

export const revokeTempCapabilities = (): void => {
  for (const cap of tempCapabilities.values()) {
    try {
      rmSync(cap.dir, { recursive: true, force: true })
    } catch {
      continue
    }
  }
  tempCapabilities.clear()
}

export const clearWorkspaceGrants = (): void => {
  workspaceGrants.clear()
}

export * as Probes from "./probes"
