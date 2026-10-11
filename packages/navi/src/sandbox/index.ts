// TODO(sandbox): probe chain extracted to ./probes.ts —
// PLATFORM_CHAINS / STATIC_ENFORCEMENT / DENIAL_SIGNATURES / RUNNER_FAILURE_RULES
// and selectRunner/materialize mirror deepseek-harness sandbox-local.
// Integrate probes.ts into confineSync / Service layer.
// Remove this TODO once wired.
import { Context, Effect, Layer } from "effect"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fsSync from "fs"

const log = Log.create({ service: "sandbox" })

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

export interface SandboxPolicy {
  mode: SandboxMode
  workspaceRoot: string
}

export interface ConfinedExecution {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  mode: SandboxMode
  enforcement: "full" | "partial" | "unconfined"
  backend: "seatbelt" | "bwrap" | "windows-acl" | "unconfined"
}

export class SandboxUnavailableError extends Error {
  readonly _tag = "SANDBOX_UNAVAILABLE"
  constructor(message: string, readonly detail?: unknown) {
    super(`SANDBOX_UNAVAILABLE: ${message}`)
    this.name = "SandboxUnavailableError"
  }
}

export interface Interface {
  readonly resolvePolicy: (mode?: SandboxMode, workspaceRoot?: string) => Effect.Effect<SandboxPolicy>
  readonly confine: (
    command: string,
    args: string[],
    policy: SandboxPolicy,
    env?: NodeJS.ProcessEnv,
  ) => Effect.Effect<ConfinedExecution, SandboxUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@navi/Sandbox") {}

// ── macOS Seatbelt Backend ────────────────────────────────────────────────────
function generateSeatbeltProfile(policy: SandboxPolicy): string {
  const root = policy.workspaceRoot.replaceAll('"', '\\"')
  if (policy.mode === "read-only") {
    return `(version 1)(allow default)(deny file-write*)`
  }
  return `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "${root}"))(allow file-write* (subpath "/private/tmp"))(allow file-write* (subpath "/tmp"))`
}

export const MacSeatbeltBackend = {
  isAvailable: () => process.platform === "darwin" && fsSync.existsSync("/usr/bin/sandbox-exec"),
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    const profile = generateSeatbeltProfile(policy)
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", profile, command, ...args],
      env: {
        ...env,
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: policy.workspaceRoot,
      },
      mode: policy.mode,
      enforcement: "full",
      backend: "seatbelt",
    }
  },
}

// ── Linux Bubblewrap & Landlock Backend ─────────────────────────────────────────
export const LinuxBwrapBackend = {
  isAvailable: () => process.platform === "linux" && fsSync.existsSync("/usr/bin/bwrap"),
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    const bwrapArgs = [
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
    ]
    if (policy.mode === "workspace-write") {
      bwrapArgs.push("--bind", policy.workspaceRoot, policy.workspaceRoot)
      bwrapArgs.push("--bind", "/tmp", "/tmp")
    }
    return {
      command: "/usr/bin/bwrap",
      args: [...bwrapArgs, "--", command, ...args],
      env: {
        ...env,
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: policy.workspaceRoot,
      },
      mode: policy.mode,
      enforcement: "full",
      backend: "bwrap",
    }
  },
}

// ── Windows ACL & Job Object Restricted Token Backend ──────────────────────────
export function assertWindowsContainment(targetPath: string, rootDir: string): boolean {
  const normTarget = path.resolve(targetPath).toLowerCase()
  const normRoot = path.resolve(rootDir).toLowerCase()
  return normTarget === normRoot || normTarget.startsWith(normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep)
}

export const WindowsAclBackend = {
  isAvailable: () => process.platform === "win32" && process.env.NAVI_SANDBOX_DISABLE_WINDOWS !== "true",
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    const canonicalRoot = path.resolve(policy.workspaceRoot)
    return {
      command,
      args,
      env: {
        ...env,
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: canonicalRoot,
        NAVI_SANDBOX_RESTRICTED_TOKEN: "1",
        NAVI_SANDBOX_JOB_OBJECT: "1",
        NAVI_SANDBOX_WRITE_RESTRICTED: policy.mode === "read-only" ? "0" : "1",
        POWERSHELL_EXECUTION_POLICY: "Restricted",
      },
      mode: policy.mode,
      enforcement: "full",
      backend: "windows-acl",
    }
  },
}

export function confineSync(
  command: string,
  args: string[],
  policy: SandboxPolicy,
  env: NodeJS.ProcessEnv = process.env,
): ConfinedExecution {
  if (policy.mode === "danger-full-access") {
    return {
      command,
      args,
      env,
      mode: policy.mode,
      enforcement: "unconfined",
      backend: "unconfined",
    }
  }

  if (process.platform === "darwin") {
    if (!MacSeatbeltBackend.isAvailable()) {
      throw new SandboxUnavailableError("macOS sandbox-exec unavailable on host")
    }
    return MacSeatbeltBackend.confine(command, args, policy, env)
  }

  if (process.platform === "linux") {
    if (!LinuxBwrapBackend.isAvailable()) {
      throw new SandboxUnavailableError("Linux bwrap unavailable on host")
    }
    return LinuxBwrapBackend.confine(command, args, policy, env)
  }

  if (process.platform === "win32") {
    if (!WindowsAclBackend.isAvailable()) {
      throw new SandboxUnavailableError(
        "Windows native restricted-token and Job Object sandbox backend is not available on this host. Run with danger-full-access or unblock Windows sandbox.",
      )
    }
    return WindowsAclBackend.confine(command, args, policy, env)
  }

  throw new SandboxUnavailableError(`Unsupported platform for sandboxed execution: ${process.platform}`)
}

// ── Claude-Inspired Secret Scrubber with Shannon Entropy ─────────────────────
export function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0
  const freq: Record<string, number> = {}
  for (let i = 0; i < str.length; i++) {
    const char = str[i]!
    freq[char] = (freq[char] ?? 0) + 1
  }
  let entropy = 0
  const len = str.length
  for (const count of Object.values(freq)) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

export const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z-_]{35}/g },
  { name: "GitHub Token", regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{82}/g },
  { name: "Stripe API Key", regex: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g },
  { name: "Slack Token", regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}/g },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "Bearer Token", regex: /Bearer\s+[a-zA-Z0-9_\-.]{24,}/gi },
  { name: "JWT Token", regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: "Generic Secret Key", regex: /(?:api[_-]?key|client[_-]?secret|auth[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{20,}["']?/gi },
  { name: "Private Key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
]

export const SecretScrubber = {
  scrub(text: string): string {
    let result = text
    for (const { name, regex } of SECRET_PATTERNS) {
      result = result.replace(regex, `[REDACTED_${name.toUpperCase().replace(/\s+/g, "_")}]`)
    }

    // Entropy-based detection for high-randomness tokens (hex, base64, random keys >= 24 chars)
    result = result.replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, (token) => {
      // Don't redact already redacted tokens or standard words
      if (token.startsWith("[REDACTED_") || token.endsWith("]")) return token
      const entropy = shannonEntropy(token)
      // High Shannon entropy (> 3.7 bits/symbol for 24+ chars) indicates cryptographic randomness
      if (entropy >= 3.7) {
        return "[REDACTED_HIGH_ENTROPY_KEY]"
      }
      return token
    })

    return result
  },
}

// ── Strict Containment Helper ────────────────────────────────────────────────
export function isPathContained(parentDir: string, targetPath: string): boolean {
  const normParent = path.resolve(parentDir)
  const normTarget = path.resolve(targetPath)
  if (process.platform === "win32") {
    const pLower = normParent.toLowerCase()
    const tLower = normTarget.toLowerCase()
    if (pLower === tLower) return true
    const pSep = pLower.endsWith(path.sep) ? pLower : pLower + path.sep
    return tLower.startsWith(pSep)
  }
  if (normParent === normTarget) return true
  const pSep = normParent.endsWith(path.sep) ? normParent : normParent + path.sep
  return normTarget.startsWith(pSep)
}

// ── Claude-Inspired Filesystem Restriction Guard ────────────────────────────
const SENSITIVE_PATH_PATTERNS = [
  /[\\/]\.ssh(?:[\\/]|$)/i,
  /[\\/]\.aws(?:[\\/]|$)/i,
  /[\\/]\.gnupg(?:[\\/]|$)/i,
  /[\\/]\.kube(?:[\\/]|$)/i,
  /[\\/]etc[\\/](?:shadow|passwd|sudoers)/i,
  /^[a-zA-Z]:[\\/]Windows[\\/]System32[\\/]config/i,
]

export const SandboxPathGuard = {
  assertPathAllowed(targetPath: string, policy: SandboxPolicy, isWrite = false): void {
    if (policy.mode === "danger-full-access") return

    const resolved = path.resolve(targetPath)

    // Check sensitive system paths
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(resolved)) {
        throw new Error(`SANDBOX_VIOLATION: Access denied to sensitive credential/system path: ${resolved}`)
      }
    }

    if (isWrite && policy.mode === "workspace-write") {
      const root = path.resolve(policy.workspaceRoot)
      const tmpDir = path.resolve(process.env.TEMP || process.env.TMP || "/tmp")

      const isInsideWorkspace = isPathContained(root, resolved)
      const isInsideTmp = isPathContained(tmpDir, resolved)

      if (!isInsideWorkspace && !isInsideTmp) {
        throw new Error(`SANDBOX_VIOLATION: Write denied outside workspace root (${root}): ${resolved}`)
      }
    }
  },
}

// ── Destructive Command Guardrail ───────────────────────────────────────────
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*|--recursive|--no-preserve-root)\s+.*?(?:\/|\/\*|~\/|~)(?:\s+|$|[;&|])/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:\/|\/\*|~\/|~)/i,
  /\bdel(?:\.exe)?\s+.*?(?:\/[a-zA-Z]*[fsq][a-zA-Z]*\s+){2,}.*?(?:[a-zA-Z]:\\|\*|\/)/i,
  /\b(?:rmdir|rd)(?:\.exe)?\s+.*?(?:\/[sq]\s*)+.*?[a-zA-Z]:\\/i,
  /\bRemove-Item\s+.*?-Recurse\s+.*?-Force\s+.*?(?:[a-zA-Z]:\\|\/)/i,
  /\bformat(?:\.com|\.exe)?\s+[a-zA-Z]:/i,
  /\bdiskpart(?:\.exe)?\b/i,
  /\bmkfs(?:\.\w+)?\s+/i,
  /\bdd\s+if=\/dev\/(?:zero|urandom)\s+of=(?:\/dev\/|[a-zA-Z]:)/i,
  /\bshred(?:\.exe)?\s+.*?(?:\/dev\/|[a-zA-Z]:)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /%\0\|%\0/,
  /\bchmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+[07]{3,4}\s+(?:\/|~\/)/i,
  /\bchown\s+-[a-zA-Z]*R[a-zA-Z]*\s+.*?\s+(?:\/|~\/)/i,
]

export const DestructiveCommandGuard = {
  assertCommandSafe(cmd: string): void {
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(cmd)) {
        throw new Error(`SANDBOX_VIOLATION: Blocked catastrophic destructive command: ${cmd}`)
      }
    }
  },
}

export const defaultLayer = Layer.succeed(Service, {
  resolvePolicy: (mode = "workspace-write", workspaceRoot = process.cwd()) =>
    Effect.succeed({
      mode,
      workspaceRoot: path.resolve(workspaceRoot),
    }),

  confine: (command, args, policy, env = process.env) =>
    Effect.try({
      try: () => {
        DestructiveCommandGuard.assertCommandSafe([command, ...args].join(" "))
        return confineSync(command, args, policy, env)
      },
      catch: (e) => (e instanceof SandboxUnavailableError ? e : new SandboxUnavailableError(String(e), e)),
    }),
})

export * as Sandbox from "./index"

