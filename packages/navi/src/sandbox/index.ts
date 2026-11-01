// Confinement is selected by the functional probe chain in ./probes.ts:
// PLATFORM_CHAINS / STATIC_ENFORCEMENT / DENIAL_SIGNATURES / RUNNER_FAILURE_RULES
// and selectRunner/materialize mirror deepseek-harness sandbox-local.
//
// Enforcement is reported honestly per platform:
// - darwin: seatbelt profiles (`full`) when /usr/bin/sandbox-exec is present.
// - linux: bubblewrap bind mounts (`full`) when bwrap passes its probe.
// - win32: no OS-level confinement is applied without native DACL / restricted
//   token / Job Object support, so the backend reports `partial` and relies on
//   the pre-exec scanner, path containment, and environment scrubbing.
import { Context, Effect, Layer } from "effect"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fsSync from "fs"
import * as Probes from "./probes"
import { scan, scanPowerShell } from "./scan"

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
  backend: "seatbelt" | "bwrap" | "landlock" | "windows-acl" | "unconfined"
}

export class SandboxUnavailableError extends Error {
  readonly _tag = "SANDBOX_UNAVAILABLE"
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
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

// ── Environment Scrubbing ────────────────────────────────────────────────────
// Loader and startup hooks can run attacker-controlled code before the wrapped
// command starts, which would defeat a partial (tool-layer) sandbox.
const SCRUBBED_ENV = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "PS4",
])

export function scrubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(env)) {
    if (SCRUBBED_ENV.has(key.toUpperCase())) continue
    out[key] = env[key]
  }
  return out
}

function tempRoot() {
  return path.resolve(process.env.TEMP || process.env.TMP || "/tmp")
}

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
        NAVI_SANDBOX_ENFORCEMENT: "full",
      },
      mode: policy.mode,
      enforcement: "full",
      backend: "seatbelt",
    }
  },
}

// ── Linux Bubblewrap & Landlock Backend ─────────────────────────────────────────
function resolveBwrap(): string | undefined {
  const candidates = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]
  const found = candidates.find((file) => fsSync.existsSync(file))
  if (found) return found
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    const file = path.join(dir, "bwrap")
    if (fsSync.existsSync(file)) return file
  }
  return undefined
}

export const LinuxBwrapBackend = {
  isAvailable: () => process.platform === "linux" && resolveBwrap() !== undefined,
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    const bwrapArgs = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"]
    if (policy.mode === "workspace-write") {
      bwrapArgs.push("--bind", policy.workspaceRoot, policy.workspaceRoot)
      bwrapArgs.push("--bind", "/tmp", "/tmp")
    }
    return {
      command: resolveBwrap() ?? "/usr/bin/bwrap",
      args: [...bwrapArgs, "--", command, ...args],
      env: {
        ...env,
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: policy.workspaceRoot,
        NAVI_SANDBOX_ENFORCEMENT: "full",
      },
      mode: policy.mode,
      enforcement: "full",
      backend: "bwrap",
    }
  },
}

// ── Windows Tool-Layer Guard Backend ──────────────────────────────────────────
// Navi does not ship a native DACL / restricted-token / Job Object helper, so no
// OS-level isolation is applied on Windows. We do NOT set markers that claim a
// restricted token or Job Object exists. What is actually applied:
//   - a pre-exec scan of the command line (assertCommandContained),
//   - case-insensitive workspace path containment for cwd and write targets,
//   - scrubbing of loader/startup environment hooks.
// The backend is therefore reported as `partial`, never `full`.
export function assertWindowsContainment(targetPath: string, rootDir: string): boolean {
  return isPathContained(rootDir, targetPath)
}

export const WindowsAclBackend = {
  isAvailable: () => process.platform === "win32" && process.env.NAVI_SANDBOX_DISABLE_WINDOWS !== "true",
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    const canonicalRoot = path.resolve(policy.workspaceRoot)
    return {
      command,
      args,
      env: {
        ...scrubEnvironment(env),
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: canonicalRoot,
        NAVI_SANDBOX_ENFORCEMENT: "partial",
        // Writes are restricted in both partial modes: denied in read-only and
        // contained to the workspace in workspace-write.
        NAVI_SANDBOX_WRITE_RESTRICTED: "1",
        NAVI_SANDBOX_GUARD: "scan+path-containment+env-scrub",
      },
      mode: policy.mode,
      enforcement: "partial",
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
  const canonical: SandboxPolicy = { mode: policy.mode, workspaceRoot: path.resolve(policy.workspaceRoot) }

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

  // Select the runner through the functional probe chain instead of a hardcoded
  // platform switch. Unknown platforms and exhausted chains fail closed.
  const selection = Probes.selectRunner(process.platform)
  if (!selection) {
    throw new SandboxUnavailableError(`No usable sandbox runner for ${process.platform}; refusing to run unconfined.`, {
      platform: process.platform,
      chain: Probes.PLATFORM_CHAINS[process.platform],
    })
  }

  if (selection.runner === "seatbelt") {
    if (!MacSeatbeltBackend.isAvailable()) {
      throw new SandboxUnavailableError("macOS sandbox-exec unavailable on host")
    }
    return MacSeatbeltBackend.confine(command, args, canonical, env)
  }

  if (selection.runner === "bwrap") {
    if (!LinuxBwrapBackend.isAvailable()) {
      throw new SandboxUnavailableError("Linux bwrap unavailable on host")
    }
    return LinuxBwrapBackend.confine(command, args, canonical, env)
  }

  if (selection.runner === "windows-acl") {
    if (!WindowsAclBackend.isAvailable()) {
      throw new SandboxUnavailableError(
        "Windows tool-layer sandbox is disabled on this host (NAVI_SANDBOX_DISABLE_WINDOWS=true). Use workspace path containment and command safety checks, or run in an isolated container.",
      )
    }
    return WindowsAclBackend.confine(command, args, canonical, env)
  }

  // Landlock is selected only when the launcher probe succeeds, but navi does not
  // package a launcher yet (native/landlock-run is a stub), so we cannot build
  // grant argv. Fail closed rather than silently running unconfined.
  throw new SandboxUnavailableError(
    "Landlock runner selected but no navi landlock launcher is packaged; refusing to run unconfined.",
    { runner: selection.runner },
  )
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
  {
    name: "Generic Secret Key",
    regex:
      /(?:api[_-]?key|client[_-]?secret|auth[_-]?token|secret[_-]?key|x-access-token|access[_-]?token)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{20,}["']?/gi,
  },
  {
    name: "Private Key",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
]

export const SecretScrubber = {
  scrub(text: string): string {
    let result = text
    for (const { name, regex } of SECRET_PATTERNS) {
      result = result.replace(regex, `[REDACTED_${name.toUpperCase().replace(/\s+/g, "_")}]`)
    }

    // Entropy-based detection for high-randomness tokens (hex, base64, random keys >= 24 chars)
    result = result.replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, (token, offset, fullText) => {
      // Don't redact already redacted tokens or standard words
      if (token.startsWith("[REDACTED_") || token.endsWith("]")) return token

      // Preserve standard git commit SHAs in git context (commit, tree, parent, refs)
      const prefix = fullText.slice(Math.max(0, offset - 30), offset).toLowerCase()
      const isGitContext =
        prefix.includes("commit ") ||
        prefix.includes("tree ") ||
        prefix.includes("parent ") ||
        prefix.includes("refs/") ||
        prefix.includes("git ")
      if (/^[0-9a-f]{32,64}$/i.test(token) && isGitContext) {
        return token
      }

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

// ── Path Normalization & Containment ────────────────────────────────────────
// Containment must not depend on how a path was spelled: `C:/repo` and
// `c:\repo` name the same directory on Windows, a path may arrive with either
// separator or with an 8.3 short name, and a symlink or junction can resolve
// somewhere other than its lexical form suggests. Every check therefore
// resolves the longest existing ancestor (so writes to files that do not exist
// yet are still covered) and compares separator- and case-normalized paths.
// Resolution results are memoized per check: a single command line repeats the
// same roots and directories many times, and realpath is a syscall per miss.
type PathCache = Map<string, string | undefined>
type StatCache = Map<string, fsSync.Stats | null>

const WINDOWS_PATHS = process.platform === "win32"
// An unquoted path containing spaces is split into one word per space; the run
// that is rejoined is bounded so a long argument list stays linear.
const MAX_PATH_WORDS = 8

function resolveRealpath(file: string): string | undefined {
  try {
    return fsSync.realpathSync.native(file)
  } catch {
    return undefined
  }
}

function realpath(file: string, cache: PathCache): string | undefined {
  if (cache.has(file)) return cache.get(file)
  const resolved = resolveRealpath(file)
  cache.set(file, resolved)
  return resolved
}

function lstat(file: string, cache: StatCache): fsSync.Stats | null {
  if (cache.has(file)) return cache.get(file) ?? null
  let info: fsSync.Stats | null = null
  try {
    info = fsSync.lstatSync(file)
  } catch {
    info = null
  }
  cache.set(file, info)
  return info
}

/**
 * Resolve a path through the filesystem so symlinks, junctions, and Windows 8.3
 * short names cannot be used to escape a lexically-contained path. The target
 * may not exist yet (a write), so the longest existing ancestor is resolved and
 * the remaining components are appended verbatim. Network shares are compared
 * lexically: Windows does not follow reparse points across a share, and probing
 * an unreachable server would block for the SMB timeout.
 */
export function canonicalPath(file: string, cache: PathCache = new Map()): string {
  const resolved = path.resolve(file)
  if (isNetworkPath(resolved)) return resolved
  let current = resolved
  const suffix: string[] = []
  while (true) {
    const real = realpath(current, cache)
    if (real !== undefined) return suffix.length === 0 ? real : path.join(real, ...suffix.reverse())
    const parent = path.dirname(current)
    if (parent === current) return resolved
    suffix.push(path.basename(current))
    current = parent
  }
}

// `\\?\UNC\server\share` and `\\server\share` are remote; `\\?\C:\` is local.
function isNetworkPath(file: string): boolean {
  const plain = stripExtendedPrefix(file)
  return plain.startsWith("\\\\") && !plain.startsWith("\\\\?\\")
}

// `realpath` returns extended-length paths (`\\?\C:\...`) for some volumes and
// for paths built from a long-name prefix; strip it so both spellings compare.
function stripExtendedPrefix(file: string): string {
  if (file.startsWith("\\\\?\\UNC\\")) return `\\\\${file.slice(8)}`
  if (file.startsWith("\\\\?\\")) return file.slice(4)
  return file
}

/** Separator- and case-normalized form used to compare resolved paths. */
function comparableName(file: string): string {
  const unified = WINDOWS_PATHS ? stripExtendedPrefix(file.replaceAll("/", "\\")) : file
  const trimmed = unified.length > 1 && /[\\/]$/.test(unified) ? unified.slice(0, -1) : unified
  return WINDOWS_PATHS ? trimmed.toLowerCase() : trimmed
}

function isContainedName(root: string, target: string): boolean {
  if (root === target) return true
  return target.startsWith(/[\\/]$/.test(root) ? root : root + (WINDOWS_PATHS ? "\\" : "/"))
}

/**
 * Resolve the target without a full upward realpath walk. A path that exists
 * resolves in one syscall; a path that does not exist only needs its existing
 * prefix, found by walking down from the canonical root and stopping at the
 * first missing component (nothing below it can redirect the write through a
 * symlink). Returns undefined when the target is not lexically below the root.
 */
function resolveExistingPrefix(root: string, target: string, cache: PathCache, stats: StatCache): string | undefined {
  const relative = path.relative(root, target)
  if (!relative) return root
  if (path.isAbsolute(relative) || relative.startsWith("..")) return undefined
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const info = lstat(current, stats)
    if (!info) return current
    // A symlink can point anywhere, so fall back to a real resolution.
    if (info.isSymbolicLink()) return canonicalPath(target, cache)
  }
  // Every component exists and none is a link, so the root is canonical and
  // joining the components below it is the target's canonical form.
  return current
}

/** Containment predicate for one or more canonical roots. */
function containedBy(roots: string[], cache: PathCache, stats: StatCache): (target: string) => boolean {
  const names = roots.map(comparableName)
  return (target) => {
    const resolved = path.resolve(target)
    const network = isNetworkPath(resolved)
    for (let index = 0; index < roots.length; index++) {
      // A network share is compared by spelling only: a stat on an unreachable
      // server blocks, and Windows does not follow reparse points across a share.
      if (network || isNetworkPath(roots[index]!)) {
        if (isContainedName(names[index]!, comparableName(resolved))) return true
        continue
      }
      const prefix = resolveExistingPrefix(roots[index]!, resolved, cache, stats)
      if (prefix === undefined) continue
      if (isContainedName(names[index]!, comparableName(prefix))) return true
    }
    if (network) return false
    // Not lexically below a root (or resolved somewhere else through a
    // symlink): a full resolution decides whether it still points inside. The
    // same path also covers a target spelled with an 8.3 short name, whose
    // lexical form does not match the canonical root.
    const name = comparableName(canonicalPath(resolved, cache))
    return names.some((root) => isContainedName(root, name))
  }
}

export function isPathContained(parentDir: string, targetPath: string): boolean {
  const cache: PathCache = new Map()
  return containedBy([canonicalPath(parentDir, cache)], cache, new Map())(targetPath)
}

type Containment = {
  workspaceRoot: string
  cache: PathCache
  contains: (target: string) => boolean
}

/** Containment against the workspace root and the permitted temp root. */
function containment(policy: SandboxPolicy): Containment {
  const cache: PathCache = new Map()
  return {
    workspaceRoot: policy.workspaceRoot,
    cache,
    contains: containedBy(
      [canonicalPath(policy.workspaceRoot, cache), canonicalPath(tempRoot(), cache)],
      cache,
      new Map(),
    ),
  }
}

export type PathWordCandidate = { text: string; path: string; consumed: number }

/**
 * Rejoin a path that the shell split at spaces because it was not quoted
 * (`rm C:\Users\A B\file`): the run grows one word at a time so a caller can
 * accept the first candidate contained in an allowed root without accepting a
 * truncated, escaping prefix on its own. Flags and expansion markers end the
 * run.
 */
export function pathWordCandidates(words: readonly string[], index: number, cwd: string): PathWordCandidate[] {
  const first = words[index] ?? ""
  const candidates: PathWordCandidate[] = [{ text: first, path: path.resolve(cwd, first), consumed: 1 }]
  let joined = first
  for (let extra = 1; extra < MAX_PATH_WORDS && index + extra < words.length; extra++) {
    const next = words[index + extra] ?? ""
    if (!next || next.startsWith("-") || dynamicWord(next)) break
    joined = `${joined} ${next}`
    candidates.push({ text: joined, path: path.resolve(cwd, joined), consumed: extra + 1 })
  }
  return candidates
}

// ── Claude-Inspired Filesystem Restriction Guard ────────────────────────────
const SENSITIVE_PATH_PATTERNS = [
  /[\\/]\.ssh(?:[\\/]|$)/i,
  /[\\/]\.aws(?:[\\/]|$)/i,
  /[\\/]\.gnupg(?:[\\/]|$)/i,
  /[\\/]\.kube(?:[\\/]|$)/i,
  /[\\/]\.env(?:\.[\w.-]+)?$/i,
  /\.(?:pem|key|pfx|p12|pkcs12)$/i,
  /[\\/](?:Google[\\/]Chrome|Microsoft[\\/]Edge|Mozilla[\\/]Firefox)[\\/].*?[\\/](?:Cookies|Login Data|key4\.db)/i,
  /[\\/]etc[\\/](?:shadow|passwd|sudoers)/i,
  /^[a-zA-Z]:[\\/]Windows[\\/]System32[\\/]config/i,
  /[\\/]auth\.json$/i,
  /[\\/]navi(?:-[^\\/]+)?\.db(?:-(?:wal|shm))?$/i,
  /[\\/]\.navi[\\/](?:auth\.json|navi.*\.db)/i,
]

// Writes into version-control internals can rewrite hooks and index state that a
// later git invocation will execute, so they are fenced separately from reads.
const WRITE_ONLY_SENSITIVE_PATH_PATTERNS = [/[\\/]\.git(?:[\\/]|$)/i, /[\\/]\.hg(?:[\\/]|$)/i, /[\\/]\.svn(?:[\\/]|$)/i]

export const SandboxPathGuard = {
  assertPathAllowed(targetPath: string, policy: SandboxPolicy, isWrite = false): void {
    if (policy.mode === "danger-full-access") return

    // Canonicalize so a symlink/junction inside the workspace cannot be used to
    // reach a sensitive path that the lexical name does not reveal.
    const guard = containment(policy)
    const resolved = canonicalPath(targetPath, guard.cache)

    // Check sensitive system paths
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(resolved)) {
        throw new Error(`SANDBOX_VIOLATION: Access denied to sensitive credential/system path: ${resolved}`)
      }
    }

    if (!isWrite) return

    for (const pattern of WRITE_ONLY_SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(resolved)) {
        throw new Error(`SANDBOX_VIOLATION: Write denied to version-control internals: ${resolved}`)
      }
    }

    if (policy.mode === "read-only") {
      throw new Error(`SANDBOX_VIOLATION: Write denied in read-only sandbox mode: ${resolved}`)
    }

    if (guard.contains(resolved)) return

    throw new Error(
      `SANDBOX_VIOLATION: Write denied outside workspace root (${path.resolve(policy.workspaceRoot)}): ${resolved}`,
    )
  },
}

// ── Destructive Command Guardrail ───────────────────────────────────────────
// Flags and targets stay bounded on both sides: a non-greedy `.*?` between them
// rescans the rest of the line for every `rm` in a long command list, which made
// the guard quadratic on large command lines.
// Repeated flag groups so `rm -f -r`, `rm -rf`, and `rm --recursive --force`
// all reach the target matcher; a single-flag-only group let `rm -f -r /home`
// slip past.
const RM_FLAGS = String.raw`(?:-[a-zA-Z]{0,8}[rf][a-zA-Z]{0,8}\s+|--(?:recursive|force|no-preserve-root)\s+|--\s+)+`
const ROOT_TARGET = String.raw`(?:\/\*?|~(?:[^\s;&|]*\/)?|\/[^\s;&|]*\/|\/[^\s;&|\/]+)`

const DESTRUCTIVE_COMMAND_PATTERNS = [
  new RegExp(String.raw`\brm\s+${RM_FLAGS}${ROOT_TARGET}(?=\s|$|[;&|])`, "i"),
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
  /\b(?:powershell|pwsh)(?:\.exe)?\s+.*?(?:-[eE](?:nc(?:odedcommand)?)?)\s+[a-zA-Z0-9+/=]{20,}/i,
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

// ── Policy Resolution ───────────────────────────────────────────────────────
const SANDBOX_MODES: ReadonlySet<string> = new Set(["read-only", "workspace-write", "danger-full-access"])

/**
 * Map the active permission tier (or an explicit NAVI_SANDBOX_MODE override) to
 * a sandbox mode. Only `full_access` disables confinement; every approval-gated
 * tier still confines writes to the workspace.
 */
export function resolveMode(permissionMode?: string, override?: string): SandboxMode {
  if (override !== undefined && SANDBOX_MODES.has(override)) return override as SandboxMode
  return permissionMode === "full_access" ? "danger-full-access" : "workspace-write"
}

// ── Tool-Layer Containment Guards ───────────────────────────────────────────
// These guards compensate for partial backends (Windows) and reject obviously
// escaping invocations before spawn. They are best-effort: an opaque command
// line (command substitution, heredoc, dynamic name) cannot be decomposed, so
// it is left to the OS backend where one exists.
const ELEVATION_COMMANDS = new Set(["sudo", "doas", "su", "runas", "gsudo"])
const CWD_COMMANDS = new Set(["cd", "chdir", "pushd", "popd", "push-location", "set-location"])
const WRITE_TARGETS: Record<string, "all" | "last" | "first"> = {
  rm: "all",
  rmdir: "all",
  rd: "all",
  del: "all",
  erase: "all",
  touch: "all",
  mkdir: "all",
  md: "all",
  tee: "all",
  mv: "all",
  move: "all",
  ren: "all",
  rename: "all",
  chmod: "all",
  chown: "all",
  cp: "last",
  copy: "last",
  install: "last",
  ln: "last",
  // mklink takes the link path first (`mklink Link Target`), unlike POSIX ln.
  mklink: "first",
  truncate: "all",
  unlink: "all",
  shred: "all",
  "remove-item": "all",
  "move-item": "all",
  "copy-item": "last",
  "rename-item": "all",
  "new-item": "all",
  "set-item": "first",
  "clear-content": "first",
  // cmd.exe copy tools. `xcopy src dst` and `certutil -decode in out` write
  // their final operand; robocopy writes its second operand (see
  // WRITE_POSITION), since later operands are file filters.
  xcopy: "last",
  certutil: "last",
  robocopy: "last",
  // Content writers take the path positionally before the value, so the first
  // positional operand is the file and the remaining one is data (which may
  // legitimately name an absolute path, e.g. a PATH value).
  "set-content": "first",
  "add-content": "first",
  "out-file": "first",
  "tee-object": "first",
  "export-csv": "first",
}

export type CommandGuardOptions = {
  cwd?: string
  shell?: "bash" | "powershell" | "cmd"
  /**
   * @internal Deny every line the scanner cannot decompose. Set when the line is
   * itself embedded execution (`bash -c`, a command substitution), where an
   * unmodelled command would run unseen.
   */
  strict?: boolean
  /**
   * @internal Reuse the containment built by an enclosing call. Each resolution
   * may touch the filesystem, and a line can hold many recursive checks.
   */
  containment?: Containment
}

// Commands whose operands are a different position than the table above models.
const WRITE_POSITION: Record<string, number> = { robocopy: 1 }

// Commands that name their write destination with an option instead of a bare
// operand. Best-effort: aliases and combined short flags are not modelled.
const WRITE_OPTION_TARGETS: Record<string, readonly string[]> = {
  curl: ["-o", "--output"],
  wget: ["-O", "--output-document", "-P", "--directory-prefix"],
  tar: ["-C", "--directory"],
  unzip: ["-d"],
  sort: ["-o", "--output"],
  cp: ["-t", "--target-directory"],
  copy: ["-t", "--target-directory"],
  install: ["-t", "--target-directory"],
  mv: ["-t", "--target-directory"],
  move: ["-t", "--target-directory"],
  ln: ["-t", "--target-directory"],
}

function optionWriteTargets(name: string, words: string[]): string[] {
  if (name === "dd") {
    return words.filter((word) => word.toLowerCase().startsWith("of=")).map((word) => word.slice(3))
  }
  const flags = WRITE_OPTION_TARGETS[name]
  if (!flags) return []
  return words.flatMap((word, index) => {
    const flag = flags.find((candidate) => word === candidate || word.startsWith(`${candidate}=`))
    if (!flag) return []
    if (word.includes("=")) return [word.slice(word.indexOf("=") + 1)]
    return [words[index + 1] ?? ""]
  })
}

/**
 * File operands that `sed -i` rewrites. The edit script is the first operand
 * unless `-e`/`-f` (or their long forms) supplies it, and the script is not a
 * write target — checking it would wrongly reject expressions that mention an
 * absolute path. Everything after it is a file.
 */
function sedInPlaceTargets(words: string[]): string[] {
  const files: string[] = []
  let scriptSeen = false
  let hasScriptOption = false
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!
    if (word === "-e" || word === "--expression" || word === "-f" || word === "--file") {
      hasScriptOption = true
      index++
      continue
    }
    if (word.startsWith("--expression=") || word.startsWith("--file=")) {
      hasScriptOption = true
      continue
    }
    if (word.startsWith("-") && word !== "-") {
      // A combined short flag ending in e/f consumes the next word as its value.
      if (/^-[a-zA-Z]*[ef]$/.test(word)) {
        hasScriptOption = true
        index++
      }
      continue
    }
    if (!hasScriptOption && !scriptSeen) {
      scriptSeen = true
      continue
    }
    files.push(word)
  }
  return files
}

// A command may be invoked through its absolute path (`/bin/rm`,
// `C:\Windows\System32\del.exe`) or module-qualified in PowerShell
// (`Microsoft.PowerShell.Management\Set-Content`), so the write/elevation
// tables are keyed by the base name, not the whole resource word.
function commandName(resource: string) {
  const base = resource.slice(Math.max(resource.lastIndexOf("/"), resource.lastIndexOf("\\")) + 1)
  return base.toLowerCase().replace(/\.exe$/, "")
}

function pathWord(word: string) {
  if (!word || word.startsWith("-") || word.includes("$") || word.includes("%")) return false
  if (word.startsWith("~")) return true
  // A drive-absolute `C:\x` or drive-relative `C:foo`; the latter is rejected by
  // assertWithinWorkspace because it resolves against the drive's own cwd.
  if (/^[A-Za-z]:/.test(word)) return true
  if (word.startsWith("/") || word.startsWith("./") || word.startsWith("../")) return true
  if (word === "." || word === "..") return true
  return word.includes("/") || word.includes("\\")
}

function dynamicWord(word: string) {
  return /[$%]/.test(word) || word.startsWith("~")
}

// `env VAR=value cmd` runs `cmd`, so the wrapper must not become the command
// name: `env FOO=1 rm -rf /etc/x` would otherwise name no table entry.
function unwrapEnv(words: readonly string[]): string[] {
  if (commandName(words[0] ?? "") !== "env") return words as string[]
  let index = 1
  while (index < words.length) {
    const word = words[index]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index++
      continue
    }
    // Options that take a separate operand.
    if (/^(?:-u|--unset|-C|--chdir|-S|--split-string)$/.test(word)) {
      index += 2
      continue
    }
    if (word === "--") {
      index++
      break
    }
    if (word.startsWith("-")) {
      index++
      continue
    }
    break
  }
  return words.slice(index) as string[]
}

// ── Opaque Execution ────────────────────────────────────────────────────────
// Command substitution, backticks, and process substitution run a command line
// that the scanner never sees. The inner line is checked recursively, and the
// outer line is only accepted when the substitution cannot be the command name
// or the operand a shell or interpreter runs. Anything still unverifiable is
// refused rather than passed to a partial backend.
export type SubstitutionSpan = {
  start: number
  end: number
  text: string
  kind: "command" | "backtick" | "process"
  // An unterminated substitution truncates the line, so its text is not the
  // command the shell would have run.
  closed: boolean
}

// One pass over the line, before the scanner: this is the fast rejection test.
const SUBSTITUTION_PROBE_POSIX = /\$\(|`|[<>]\(/
const SUBSTITUTION_PROBE_POWERSHELL = /\$\(/
const SUBSTITUTION_PLACEHOLDER = "$__navi_substitution__"
// Every span costs a recursive check; a line with this many is not something a
// human wrote, and verifying it would let one command line burn the guard.
const MAX_SUBSTITUTIONS = 256

/**
 * Locate the substitutions a shell expands before it runs the line. Only the
 * outer spans are returned; nested substitutions belong to the parent's text
 * and are found when that text is checked. Quoting is honoured, so a single
 * quoted `$(...)` is literal text.
 */
export function substitutionSpans(
  input: string,
  dialect: "posix" | "powershell" = "posix",
): SubstitutionSpan[] {
  const spans: SubstitutionSpan[] = []
  let mode: "plain" | "single" | "double" = "plain"
  let index = 0
  while (index < input.length) {
    const char = input[index]!
    if (mode === "single") {
      if (char === "'") mode = "plain"
      index++
      continue
    }
    if (char === "\\" && dialect === "posix") {
      index += 2
      continue
    }
    if (char === "`" && dialect === "powershell") {
      index += 2
      continue
    }
    if (char === "'" && mode !== "double") {
      mode = "single"
      index++
      continue
    }
    if (char === '"') {
      mode = mode === "double" ? "plain" : "double"
      index++
      continue
    }
    if (char === "`" && dialect === "posix") {
      const close = substitutionBacktickEnd(input, index)
      spans.push({
        start: index,
        end: close < 0 ? input.length - 1 : close,
        text: input.slice(index + 1, close < 0 ? input.length : close),
        kind: "backtick",
        closed: close >= 0,
      })
      index = close < 0 ? input.length : close + 1
      continue
    }
    const open = substitutionOpen(input, index, dialect)
    if (open) {
      const close = substitutionClose(input, open.start, dialect)
      spans.push({
        start: index,
        end: close < 0 ? input.length - 1 : close,
        text: input.slice(open.start, close < 0 ? input.length : close),
        kind: open.kind,
        closed: close >= 0,
      })
      index = close < 0 ? input.length : close + 1
      continue
    }
    index++
  }
  return spans
}

// Where the command line of a substitution starts, and what form it takes.
type SubstitutionOpener = { start: number; kind: SubstitutionSpan["kind"] }

function substitutionOpen(
  input: string,
  index: number,
  dialect: "posix" | "powershell",
): SubstitutionOpener | undefined {
  const char = input[index]
  const next = input[index + 1]
  if (char === "$" && next === "(") {
    // `$((` is arithmetic: it names no command, and an expansion inside it is
    // still reached by this scan because the parentheses are not skipped.
    return input[index + 2] === "(" ? undefined : { start: index + 2, kind: "command" }
  }
  if (dialect === "posix" && (char === "<" || char === ">") && next === "(")
    return { start: index + 2, kind: "process" }
  return undefined
}

// Matches the closing parenthesis of a substitution, honouring nested
// parentheses, quotes, and escapes. Returns -1 when the span never closes.
function substitutionClose(input: string, start: number, dialect: "posix" | "powershell"): number {
  let depth = 1
  let mode: "plain" | "single" | "double" = "plain"
  for (let index = start; index < input.length; index++) {
    const char = input[index]!
    if (mode === "single") {
      if (char === "'") mode = "plain"
      continue
    }
    if (char === "\\" && dialect === "posix") {
      index++
      continue
    }
    if (char === "`" && dialect === "powershell") {
      index++
      continue
    }
    if (char === "'" && mode !== "double") {
      mode = "single"
      continue
    }
    if (char === '"') {
      mode = mode === "double" ? "plain" : "double"
      continue
    }
    if (char === "(") depth++
    else if (char === ")" && --depth === 0) return index
  }
  return -1
}

// Returns the index of the closing backtick, or -1 when the span never closes.
function substitutionBacktickEnd(input: string, start: number) {
  for (let index = start + 1; index < input.length; index++) {
    if (input[index] === "\\") {
      index++
      continue
    }
    if (input[index] === "`") return index
  }
  return -1
}

function maskSubstitutions(input: string, spans: readonly SubstitutionSpan[]): string {
  let masked = ""
  let cursor = 0
  for (const span of spans) {
    masked += input.slice(cursor, span.start) + SUBSTITUTION_PLACEHOLDER
    cursor = span.end + 1
  }
  return masked + input.slice(cursor)
}

// ── Inline Interpreter Code ─────────────────────────────────────────────────
// `python -c`, `node -e`, `perl -e`, and an awk program are executed as given,
// so the command line never names the file they write. The code is scanned for
// write and delete indicators: a hit makes the line unverifiable, a miss is
// still only a heuristic.
const INTERPRETER_FLAGS: Record<string, readonly string[]> = {
  python: ["-c"],
  python2: ["-c"],
  python3: ["-c"],
  pypy: ["-c"],
  pypy3: ["-c"],
  node: ["-e", "--eval", "-p", "--print"],
  nodejs: ["-e", "--eval", "-p", "--print"],
  bun: ["-e", "--eval", "-p", "--print"],
  perl: ["-e", "-E"],
  ruby: ["-e"],
  php: ["-r"],
  lua: ["-e"],
  luajit: ["-e"],
  rscript: ["-e"],
  osascript: ["-e"],
  tclsh: ["-e"],
  wish: ["-e"],
  pwsh: ["-c", "-command", "-encodedcommand"],
  powershell: ["-c", "-command", "-encodedcommand"],
}
const AWK_PROGRAMS = new Set(["awk", "gawk", "mawk", "nawk"])
// Programs that execute a script operand, or read one from standard input when
// no operand is given.
const INTERPRETER_NAMES = new Set([...Object.keys(INTERPRETER_FLAGS), ...AWK_PROGRAMS, "deno"])

const INLINE_WRITE_INDICATORS =
  /\b(?:open|openSync|write|writeSync|writelines|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|unlinkSync|rmdir|rmdirSync|rmSync|remove|removedirs|rmtree|rename|renames|truncate|truncateSync|chmod|chmodSync|chown|mkdir|makedirs|mkdirSync|system|popen|spawn|spawnSync|execSync|execFile|execFileSync|symlink|copyFile|copyfile|WriteAllText|WriteAllBytes|OpenWrite|Delete)\b|(?:subprocess|child_process|os\.system|shutil|pathlib|fs\.write|fs\.append|require\s*\(\s*['"](?:fs|child_process)['"]|from\s+['"](?:fs|child_process)['"])|(?:\brm\s+-|\bsudo\b|\bsh\s+-c|\bcmd\s+\/c)/i
// An awk program redirects with `print > "file"` or pipes into a command.
const AWK_WRITE_INDICATORS = /(?:system\s*\(|\|\s*"|>\s*"|printf?[^;\n]*[|>]|\bclose\s*\(|\bpipe\b|getline\s+\w+\s*<)/
// Writing to standard output is not a file write, and it is the ordinary way a
// one-liner prints. Strip it before looking for write indicators.
const INLINE_STDOUT_WRITE = /(?:(?:process|sys|os)\.)?std(?:out|err)\.(?:write|writelines?)\(|console\.\w+\(/gi

/** Whether the command runs inline code with a write or delete indicator. */
function inlineExecutionWrites(name: string, argv: readonly string[]): boolean {
  const program = inlineProgram(name, argv)
  if (program === undefined) return false
  if (AWK_PROGRAMS.has(name)) return AWK_WRITE_INDICATORS.test(program)
  return INLINE_WRITE_INDICATORS.test(program.replace(INLINE_STDOUT_WRITE, "print("))
}
function inlineProgram(name: string, argv: readonly string[]): string | undefined {
  if (AWK_PROGRAMS.has(name)) {
    for (let index = 1; index < argv.length; index++) {
      const word = argv[index]!
      if (word === "--") return argv[index + 1]
      // `-f file` reads the program from a file, so nothing is inline.
      if (word === "-f" || /^-f./.test(word) || word === "--file" || word.startsWith("--file=")) return undefined
      if (word.startsWith("-")) {
        // -F, -v, and their long forms take a separate operand.
        if (word === "-F" || word === "-v" || word === "--field-separator" || word === "--assign") index++
        continue
      }
      return word
    }
    return undefined
  }
  if (name === "deno") return argv[1] === "eval" ? argv[2] : undefined
  const flags = INTERPRETER_FLAGS[name]
  if (!flags) return undefined
  for (let index = 1; index < argv.length; index++) {
    const word = argv[index]!
    if (word === "--") return undefined
    if (!word.startsWith("-")) return undefined
    const flag = flags.find(
      (candidate) =>
        word === candidate ||
        word.startsWith(`${candidate}=`) ||
        (candidate.length === 2 && /^-[A-Za-z]+$/.test(word) && word.endsWith(candidate[1]!)),
    )
    if (flag === undefined) continue
    if (word.includes("=")) return word.slice(word.indexOf("=") + 1)
    return argv[index + 1]
  }
  return undefined
}

// ── Tools whose write targets are decided at runtime ────────────────────────
const DESTRUCTIVE_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "rd",
  "del",
  "erase",
  "unlink",
  "shred",
  "mv",
  "move",
  "cp",
  "copy",
  "install",
  "truncate",
  "tee",
  "chmod",
  "chown",
  "chgrp",
  "dd",
  "mkfs",
  "format",
  "sed",
  "find",
  "xargs",
  "ln",
  "touch",
  "mkdir",
  "attrib",
  "icacls",
  "takeown",
  "robocopy",
  "xcopy",
  "certutil",
])

/** Roots `find` deletes from, when it deletes at all; undefined otherwise. */
function findWriteRoots(words: readonly string[]): string[] | undefined {
  let destructive = words.some((word) => word === "-delete")
  if (!destructive) {
    for (let index = 0; index < words.length && !destructive; index++) {
      const word = words[index]!
      if (word !== "-exec" && word !== "-execdir" && word !== "-ok" && word !== "-okdir") continue
      destructive = DESTRUCTIVE_PROGRAMS.has(commandName(words[index + 1] ?? ""))
    }
  }
  if (!destructive) return undefined
  const roots = words
    .slice(1)
    .filter(
      (word) =>
        !word.startsWith("-") &&
        word !== "(" &&
        word !== ")" &&
        word !== "!" &&
        word !== "{}" &&
        !word.includes("="),
    )
  return roots.length ? roots : ["."]
}

/** The command `xargs` runs, or undefined when it runs none. */
function xargsCommand(words: readonly string[]): string | undefined {
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!
    if (word === "--") return words[index + 1]
    if (word.startsWith("-")) {
      if (/^-[A-Za-z]$/.test(word)) index++
      continue
    }
    return word
  }
  return undefined
}

/**
 * Path operands `git` rewrites or deletes. `git clean` only acts with a force
 * flag; checkout and restore rewrite the working tree. Branch names are not
 * paths, so they resolve inside the workspace and pass. `-C`, `--work-tree`,
 * and `--git-dir` relocate the repository, so they are targets as well.
 */
function gitWriteTargets(argv: readonly string[]): { subcommand: string; targets: string[] } | undefined {
  let index = 1
  const roots: string[] = []
  while (index < argv.length) {
    const word = argv[index]!
    if (word === "-C" || word === "--git-dir" || word === "--work-tree") {
      if (argv[index + 1] !== undefined) roots.push(argv[index + 1]!)
      index += 2
      continue
    }
    if (word === "-c") {
      index += 2
      continue
    }
    if (word.startsWith("-")) {
      index++
      continue
    }
    break
  }
  const subcommand = (argv[index] ?? "").toLowerCase()
  const args = argv.slice(index + 1)
  const operands = args.filter((word) => !word.startsWith("-"))
  if (subcommand === "clean") {
    const forced = args.some((word) => word === "--force" || /^-[a-z]*f/.test(word))
    return forced ? { subcommand, targets: [...roots, ...operands] } : undefined
  }
  if (subcommand === "checkout") {
    // `--` separates paths; `-b`, `-B`, and a lone branch name are not paths.
    const split = args.indexOf("--")
    return { subcommand, targets: [...roots, ...(split >= 0 ? args.slice(split + 1) : [])] }
  }
  if (subcommand === "restore") return { subcommand, targets: [...roots, ...operands] }
  return undefined
}

// A here document fed to a shell or interpreter is a script body.
const HEREDOC_SHELL_RE =
  /(?:^|[\s;&|(])(?:[\w.-]+[\\/])?(?:bash|sh|zsh|dash|ksh|mksh|ash|python\d?|perl|ruby|node|bun|deno|php)\b[^\n]*<</i

// Shell redirections are the most common way to write a file and do not show up
// as a command word, so they are extracted separately from the scanner output.
// This is a lexer for `>` / `>>` / `&>` / `*>`, not a shell parser: quoted text
// is skipped and fd duplications (`2>&1`, `>&-`) are ignored.
const PSEUDO_WRITE_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "con", "$null", "$null:"])

export function extractRedirectTargets(input: string, dialect: "posix" | "powershell" | "cmd" = "posix"): string[] {
  const targets: string[] = []
  let quote: string | undefined
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (quote) {
      if (char === quote) quote = undefined
      else if (char === "\\" && quote === '"' && dialect === "posix") index++
      continue
    }
    // cmd.exe does not treat single quotes as quoting; PowerShell uses a
    // backtick escape instead of a backslash.
    if (char === '"' || (char === "'" && dialect !== "cmd")) {
      quote = char
      continue
    }
    if (char === "\\" && dialect === "posix") {
      index++
      continue
    }
    if (char === "`" && dialect === "powershell") {
      index++
      continue
    }
    if (char !== ">") continue

    let cursor = index + 1
    if (input[cursor] === ">" || input[cursor] === "|") cursor++
    while (input[cursor] === " " || input[cursor] === "\t") cursor++
    if (input[cursor] === "-") {
      index = cursor
      continue
    }
    if (input[cursor] === "&" && /[\d-]/.test(input[cursor + 1] ?? "")) {
      index = cursor
      continue
    }

    let target = ""
    const delimiter = input[cursor]
    if (delimiter === "'" || delimiter === '"') {
      for (cursor++; cursor < input.length && input[cursor] !== delimiter; cursor++) {
        if (input[cursor] === "\\" && delimiter === '"') cursor++
        target += input[cursor]
      }
      index = cursor
    } else {
      for (; cursor < input.length && !/[\s;&|<>]/.test(input[cursor]!); cursor++) target += input[cursor]
      index = cursor - 1
    }
    if (target) targets.push(target)
  }
  return targets
}

function assertRedirectTargets(
  input: string,
  cwd: string,
  policy: SandboxPolicy,
  dialect: "posix" | "powershell" | "cmd",
  guard: Containment,
) {
  for (const target of extractRedirectTargets(input, dialect)) {
    if (PSEUDO_WRITE_TARGETS.has(target.toLowerCase())) continue
    if (dynamicWord(target)) {
      throw new Error(`SANDBOX_VIOLATION: Dynamic redirect target cannot be verified: ${target}`)
    }
    if (policy.mode === "read-only") {
      throw new Error(`SANDBOX_VIOLATION: Shell redirection writes are not allowed in read-only mode: ${target}`)
    }
    assertWithinWorkspace([target], 0, cwd, "Write", guard)
  }
}

const NESTED_SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "ash",
  "busybox",
  "powershell",
  "pwsh",
  "cmd",
])

// Informational flags need no script operand; they do not run stdin.
const SHELL_INFORMATIONAL = /^(?:--?(?:h|help|version|norc|noprofile|v)|--(?:test|check))$/i

// Anchored, allocation-free probe for the cases `nestedShellCommand` accepts.
// It keeps a long command line from being tokenized a second time unless it can
// actually start with a nested shell.
const NESTED_SHELL_PROBE =
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)?["']?(?:\S*[\\/])?(?:busybox|powershell|dash|bash|zsh|ksh|mksh|ash|sh|pwsh|cmd)(?:\.exe)?["']?(?=\s|$)/

type ShellWord = { value: string; raw: string }

function splitWords(input: string): ShellWord[] | undefined {
  const words: ShellWord[] = []
  let value = ""
  let started = false
  let start = 0
  let quote: string | undefined
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (!started) {
      if (/\s/.test(char)) continue
      started = true
      start = index
    }
    if (quote) {
      if (char === quote) quote = undefined
      // Preserve Windows path separators; only an escaped quote/backslash is a
      // shell escape inside a double-quoted string.
      else if (char === "\\" && quote === '"' && (input[index + 1] === '"' || input[index + 1] === "\\"))
        value += input[++index]
      else value += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      words.push({ value, raw: input.slice(start, index) })
      value = ""
      started = false
      continue
    }
    value += char
  }
  if (quote) return undefined
  if (started) words.push({ value, raw: input.slice(start) })
  return words
}

/**
 * Detect a nested shell invocation (`bash -c`, `powershell -Command`,
 * `cmd /c`, optionally behind `env VAR=...`) so its embedded command line is
 * scanned instead of being treated as an opaque blob. The inner line is
 * reconstructed from the original quoted words, so a literal `>` inside a
 * quoted argument is not mistaken for a redirection. Command substitutions are
 * still opaque; a real OS backend has to cover those.
 */
export function nestedShellCommand(input: string): { inner: string; shell: "bash" | "powershell" | "cmd" } | undefined {
  const words = splitWords(input.trim())
  if (!words || words.length < 2) return undefined
  let start = 0
  while (start < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]!.value)) start++
  if ((words[start]?.value ?? "").toLowerCase() === "env") {
    start++
    while (start < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]!.value)) start++
  }
  const name = path.basename((words[start]?.value ?? "").toLowerCase()).replace(/\.exe$/, "")
  if (!NESTED_SHELLS.has(name)) return undefined
  const flag = words.findIndex(
    (word, index) => index > start && /^(?:-[a-z]*c|--?command(?:=.*)?|\/c|\/k)$/i.test(word.value),
  )
  if (flag < 0 || flag === words.length - 1) return undefined
  const inner = words
    .slice(flag + 1)
    // The `-c`/`-Command` argument is one shell word; the shell strips its
    // outer quoting before executing it, so strip exactly one layer.
    .map((word) => unwrapOuterQuotes(word.raw))
    .join(" ")
  if (!inner.trim()) return undefined
  return { inner, shell: name === "cmd" ? "cmd" : name === "powershell" || name === "pwsh" ? "powershell" : "bash" }
}

function unwrapOuterQuotes(raw: string): string {
  const first = raw[0]
  if (raw.length >= 2 && (first === "'" || first === '"') && raw[raw.length - 1] === first) return raw.slice(1, -1)
  return raw
}

/**
 * Minimal cmd.exe tokenizer: double quotes group one word, `^` escapes the next
 * character, and `&`/`|`/newline end a command. scan.ts does not model cmd.exe
 * (its `/flag` operands would read as absolute paths), so the tool-layer guard
 * only recovers the command word and its operands to apply the same
 * write/elevation tables that cover POSIX shells.
 */
function cmdSegments(input: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word = ""
  let started = false
  let quoted = false
  const endWord = () => {
    if (!started) return
    words.push(word)
    word = ""
    started = false
  }
  const endSegment = () => {
    endWord()
    if (words.length) segments.push(words)
    words = []
  }
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (quoted) {
      if (char === '"') quoted = false
      else word += char
      started = true
      continue
    }
    if (char === '"') {
      quoted = true
      started = true
      continue
    }
    if (char === "^") {
      if (index + 1 < input.length) word += input[++index]
      started = true
      continue
    }
    if (char === "&" || char === "|" || char === "\n" || char === "\r") {
      endSegment()
      continue
    }
    if (/\s/.test(char)) {
      endWord()
      continue
    }
    word += char
    started = true
  }
  endSegment()
  return segments
}

const CMD_SHELL_FLAG = /^(?:\/c|\/k|-c|--?command(?:=.*)?)$/i
// cmd.exe control flow: the command that writes is the tail after the keyword,
// condition, and loop header.
const CMD_CONTROL = new Set(["if", "for", "start", "call"])

/**
 * The command line a cmd.exe control keyword runs, or undefined when the tail
 * is empty. `if exist <path> del <path>` runs `del <path>`; `for … do <cmd>`
 * runs `<cmd>`; `start "title" /d <dir> <cmd>` runs `<cmd>`.
 */
function cmdControlTail(words: readonly string[], name: string): string | undefined {
  let index = 1
  if (name === "if") {
    while (index < words.length && /^\/[a-z]$/i.test(words[index]!)) index++
    if ((words[index] ?? "").toLowerCase() === "not") index++
    const condition = (words[index] ?? "").toLowerCase()
    // `exist`, `defined`, `errorlevel`, and `cmdextversion` take one operand; a
    // string comparison and a parenthesized condition are one word.
    index += /^(?:exist|defined|errorlevel|cmdextversion)$/.test(condition) ? 2 : 1
    while (words[index] === "(" || words[index] === ")") index++
  } else if (name === "for") {
    const doIndex = words.findIndex((word, at) => at > 0 && word.toLowerCase() === "do")
    index = doIndex >= 0 ? doIndex + 1 : -1
  } else {
    // start: an (empty) title, then switches; /d, /node, and /affinity take an operand.
    while (index < words.length) {
      const word = words[index]!
      if (word === "") {
        index++
        continue
      }
      if (/^\/(?:d|node|affinity)$/i.test(word)) {
        index += 2
        continue
      }
      if (/^\/[a-z]$/i.test(word)) {
        index++
        continue
      }
      break
    }
  }
  if (index <= 0 || index >= words.length) return undefined
  // A parenthesized body (`if a==b (del x)`) is still a command line.
  return words
    .slice(index)
    .join(" ")
    .replace(/^\(+/, "")
    .replace(/\)+$/, "")
}

/**
 * Operand check for cmd.exe command lines. `/flag` words are cmd switches, not
 * paths, so they are dropped; only drive-qualified, rooted, or dot-relative
 * operands reach the containment predicate, which keeps reads such as
 * `type C:\Windows\win.ini` from being mistaken for writes. Control flow
 * (`if`, `for`, `start`) and copy tools that are not in WRITE_TARGETS are not
 * decomposed — a partial backend cannot model every cmd.exe program.
 */
function assertCmdContained(
  input: string,
  policy: SandboxPolicy,
  cwd: string,
  guard: Containment,
  depth: number,
): void {
  let currentCwd = cwd
  for (const words of cmdSegments(input)) {
    // `@` suppresses echo for the command that follows it.
    const first = words[0]?.replace(/^@+/, "") ?? ""
    const name = commandName(first)
    if (!name) continue

    if (ELEVATION_COMMANDS.has(name)) {
      throw new Error(`SANDBOX_VIOLATION: Privilege escalation is not allowed inside the sandbox: ${first}`)
    }

    if (depth < 4 && NESTED_SHELLS.has(name)) {
      const flag = words.findIndex((word, index) => index > 0 && CMD_SHELL_FLAG.test(word))
      if (flag >= 0 && flag < words.length - 1) {
        const inner = words.slice(flag + 1).join(" ")
        assertCommandContained(
          inner,
          policy,
          {
            cwd: currentCwd,
            shell: name === "cmd" ? "cmd" : name === "powershell" || name === "pwsh" ? "powershell" : "bash",
            strict: true,
            containment: guard,
          },
          depth + 1,
        )
        continue
      }
    }

    if (CMD_CONTROL.has(name) && depth < 8) {
      const inner = cmdControlTail(words, name)
      if (inner) assertCmdContained(inner, policy, currentCwd, guard, depth + 1)
      continue
    }

    if (CWD_COMMANDS.has(name)) {
      const targets = words.slice(1).filter((word) => !word.startsWith("/"))
      if (targets.length === 0) continue
      for (const target of targets) {
        if (dynamicWord(target)) {
          throw new Error(`SANDBOX_VIOLATION: Dynamic directory change cannot be verified: ${target}`)
        }
      }
      currentCwd = assertWithinWorkspace(targets, 0, currentCwd, "Directory change", guard).path
      continue
    }

    const kind = WRITE_TARGETS[name]
    if (!kind) continue
    if (policy.mode === "read-only") {
      throw new Error(`SANDBOX_VIOLATION: Write command '${words[0]}' is not allowed in read-only mode`)
    }
    const operands = words.slice(1).filter((word) => !word.startsWith("/") && !word.startsWith("-"))
    const position = WRITE_POSITION[name]
    const targets =
      position !== undefined
        ? operands.slice(position, position + 1)
        : kind === "last"
          ? operands.slice(-1)
          : kind === "first"
            ? operands.slice(0, 1)
            : operands
    assertOperandsContained(targets, currentCwd, guard)
  }
}

// Returns the contained resolution and how many words it consumed, so a path
// that a shell split at spaces (`C:\Users\A B\file`) is checked as a whole.
function assertWithinWorkspace(
  words: readonly string[],
  index: number,
  cwd: string,
  action: string,
  guard: Containment,
): { path: string; consumed: number } {
  const word = words[index] ?? ""
  if (word.startsWith("~")) {
    throw new Error(`SANDBOX_VIOLATION: ${action} escapes the sandbox workspace: ${word}`)
  }
  // `C:foo` resolves against the drive's current directory, which may be
  // anywhere; it cannot be resolved lexically against the workspace.
  if (WINDOWS_PATHS && /^[A-Za-z]:(?![/\\])/.test(word)) {
    throw new Error(`SANDBOX_VIOLATION: Drive-relative path cannot be verified: ${word}`)
  }
  for (const candidate of pathWordCandidates(words, index, cwd)) {
    if (guard.contains(candidate.path)) return { path: candidate.path, consumed: candidate.consumed }
  }
  throw new Error(
    `SANDBOX_VIOLATION: ${action} escapes the sandbox workspace (${path.resolve(guard.workspaceRoot)}): ${word}`,
  )
}

/** Reject dynamic or escaping operands of a write command. */
function assertOperandsContained(targets: readonly string[], cwd: string, guard: Containment): void {
  for (const target of targets) {
    if (dynamicWord(target)) {
      throw new Error(`SANDBOX_VIOLATION: Dynamic write target cannot be verified: ${target}`)
    }
  }
  for (let index = 0; index < targets.length; ) {
    if (!pathWord(targets[index]!)) {
      index++
      continue
    }
    index += assertWithinWorkspace(targets, index, cwd, "Write", guard).consumed
  }
}

/** Reject a command that writes when the sandbox is read-only. */
function assertWriteAllowed(label: string, policy: SandboxPolicy): void {
  if (policy.mode === "read-only")
    throw new Error(`SANDBOX_VIOLATION: Write command '${label}' is not allowed in read-only mode`)
}

/** Reject a working directory outside the workspace (temp is permitted). */
export function assertCwdContained(cwd: string, policy: SandboxPolicy): void {
  if (policy.mode === "danger-full-access") return
  const resolved = path.resolve(cwd)
  if (containment(policy).contains(resolved)) return
  throw new Error(
    `SANDBOX_VIOLATION: Working directory is outside the sandbox workspace (${path.resolve(policy.workspaceRoot)}): ${resolved}`,
  )
}

/** Reject command lines that obviously escape or mutate outside the sandbox. */
export function assertCommandContained(
  input: string,
  policy: SandboxPolicy,
  options: CommandGuardOptions = {},
  depth = 0,
): void {
  if (policy.mode === "danger-full-access") return

  DestructiveCommandGuard.assertCommandSafe(input)

  const cwd = options.cwd ?? path.resolve(policy.workspaceRoot)
  const guard = options.containment ?? containment(policy)

  // Redirections are checked for every shell dialect (including cmd.exe, which
  // the scanner does not model) because `echo x > file` is the simplest way to
  // write outside the workspace.
  const dialect = options.shell === "cmd" ? "cmd" : options.shell === "powershell" ? "powershell" : "posix"
  assertRedirectTargets(input, cwd, policy, dialect, guard)

  // A nested shell hides its command line from the scanner. Recursively check
  // the embedded line instead of treating the wrapper as opaque. The embedded
  // line is execution the outer line does not show, so it must be provable.
  const nested = depth < 4 && NESTED_SHELL_PROBE.test(input) ? nestedShellCommand(input) : undefined
  if (nested) {
    assertCommandContained(
      nested.inner,
      policy,
      { ...options, shell: nested.shell, cwd, strict: true, containment: guard },
      depth + 1,
    )
    return
  }

  // scan.ts only models POSIX shells and PowerShell. cmd.exe syntax (e.g. `/f`
  // flags) would be misread as absolute paths, so cmd lines get the tokenizer
  // in assertCmdContained instead of the scanner.
  if (options.shell === "cmd") {
    assertCmdContained(input, policy, cwd, guard, depth)
    return
  }
  // Normalize Windows separators before scanning so `rm C:\x` yields a path word
  // instead of a backslash-escaped literal.
  let source = process.platform === "win32" ? input.replaceAll("\\", "/") : input
  const strict = options.strict === true
  // Command substitution, backticks, and process substitution run a command
  // line the scanner never sees. Each inner line is checked as its own command
  // list, then the outer line is masked and scanned, so a substitution can
  // never name the command or supply the operand a shell runs.
  const powershell = dialect === "powershell"
  if (depth < 4 && (powershell ? SUBSTITUTION_PROBE_POWERSHELL : SUBSTITUTION_PROBE_POSIX).test(source)) {
    const spans = substitutionSpans(source, powershell ? "powershell" : "posix")
    if (spans.length > MAX_SUBSTITUTIONS)
      throw new Error(`SANDBOX_VIOLATION: Too many command substitutions to verify: ${spans.length}`)
    for (const span of spans)
      if (!span.closed)
        throw new Error(`SANDBOX_VIOLATION: Unterminated command substitution cannot be verified: ${input}`)
    // Read-only stays fail-closed: a substitution is unverifiable by
    // construction, so even a provably read-only inner command is refused.
    if (policy.mode === "read-only" && spans.length)
      throw new Error(
        `SANDBOX_VIOLATION: Command cannot be verified in ${policy.mode} mode (command-substitution): ${input}`,
      )
    for (const span of spans)
      assertCommandContained(
        span.text,
        policy,
        { shell: powershell ? "powershell" : "bash", cwd, strict: true, containment: guard },
        depth + 1,
      )
    if (spans.length) source = maskSubstitutions(source, spans)
  }
  const result = powershell ? scanPowerShell(source) : scan(source)
  if (result.kind !== "scanned") {
    // Read-only is a strict, explicitly opted-in mode: refuse lines the scanner
    // cannot model (eval, command substitution, heredocs) rather than let them
    // slip past the tool-layer guard on partial backends such as Windows.
    // Dynamic execution (`eval`, `source`, wrapper-launched shells), a line
    // embedded in a substitution or `-c`, and a command name or here document
    // the line does not show are refused in workspace-write as well.
    if (
      policy.mode === "read-only" ||
      strict ||
      result.reason === "dynamic-execution" ||
      (result.reason === "dynamic-command-name" && source.includes(SUBSTITUTION_PLACEHOLDER)) ||
      (result.reason === "heredoc" && HEREDOC_SHELL_RE.test(source))
    ) {
      throw new Error(
        `SANDBOX_VIOLATION: Command cannot be verified in ${policy.mode} mode (${result.reason}): ${input}`,
      )
    }
    return
  }

  // Track directory changes so relative write targets are resolved against the
  // directory the later command actually runs in, not the original cwd.
  let currentCwd = cwd

  for (const command of result.commands) {
    // `env VAR=value cmd` runs `cmd`, so the wrapper must not be the name that
    // is looked up in the write and elevation tables.
    const argv = unwrapEnv(command.words)
    const name = commandName(argv[0] ?? command.resource)

    // `cmd /c ...` in the middle of a POSIX list is just another command word,
    // so the anchored top-level probe never sees it; unwrap it from the scanned
    // command's own tokens and check the embedded line.
    if (depth < 4 && NESTED_SHELLS.has(name)) {
      const embedded = nestedShellCommand(command.rawWords.join(" "))
      if (embedded) {
        assertCommandContained(
          embedded.inner,
          policy,
          { ...options, shell: embedded.shell, cwd: currentCwd, strict: true, containment: guard },
          depth + 1,
        )
        continue
      }
    }

    if (ELEVATION_COMMANDS.has(name)) {
      throw new Error(`SANDBOX_VIOLATION: Privilege escalation is not allowed inside the sandbox: ${command.resource}`)
    }

    // A shell or interpreter with no script operand reads its program from
    // standard input, which the line never shows (`base64 -d payload | sh`).
    if (
      (NESTED_SHELLS.has(name) || INTERPRETER_NAMES.has(name)) &&
      !argv.slice(1).some((word) => !word.startsWith("-") || SHELL_INFORMATIONAL.test(word))
    )
      throw new Error(`SANDBOX_VIOLATION: A program reading its script from stdin cannot be verified: ${argv[0]}`)

    // A shell or interpreter whose script operand came from a substitution runs
    // text the line never shows (`bash <(curl …)`).
    if (
      (NESTED_SHELLS.has(name) || INTERPRETER_NAMES.has(name)) &&
      argv.some((word) => word.includes(SUBSTITUTION_PLACEHOLDER))
    )
      throw new Error(
        `SANDBOX_VIOLATION: A shell operand from a command substitution cannot be verified: ${argv[0]}`,
      )

    // Inline interpreter code (`python -c`, `node -e`, a bare awk program) is
    // executed as given, so the file it writes never appears as an operand.
    if (inlineExecutionWrites(name, argv))
      throw new Error(`SANDBOX_VIOLATION: Inline ${name} code cannot be verified: ${argv[0]}`)

    // `xargs` supplies its operands at runtime from its own stdin.
    if (name === "xargs") {
      const inner = commandName(xargsCommand(argv) ?? "")
      if (DESTRUCTIVE_PROGRAMS.has(inner) || NESTED_SHELLS.has(inner))
        throw new Error(`SANDBOX_VIOLATION: xargs ${inner} operates on paths the line does not show`)
    }

    // `find -delete` and `find -exec rm` delete below the roots the line names.
    if (name === "find") {
      const roots = findWriteRoots(argv)
      if (roots) {
        assertWriteAllowed(`find -delete`, policy)
        assertOperandsContained(roots, currentCwd, guard)
      }
    }

    // git clean, checkout, and restore rewrite or delete working-tree paths.
    if (name === "git") {
      const write = gitWriteTargets(argv)
      if (write) {
        assertWriteAllowed(`git ${write.subcommand}`, policy)
        assertOperandsContained(write.targets, currentCwd, guard)
      }
    }

    if (CWD_COMMANDS.has(name)) {
      // A lone `cd`/`Set-Location` cannot mutate anything before its process
      // exits, and the shell tool spawns a fresh shell per call. Keep external
      // directory jumps working for the permission-approved single-command case;
      // a chained list (`cd .. && rm x`) is checked because it can write.
      if (result.commands.length === 1) continue
      const targets = argv.slice(1).filter((word) => !word.startsWith("-"))
      if (targets.length === 0) {
        throw new Error(`SANDBOX_VIOLATION: '${command.resource}' without a target would leave the sandbox workspace`)
      }
      for (const target of targets) {
        if (dynamicWord(target)) {
          throw new Error(`SANDBOX_VIOLATION: Dynamic directory change cannot be verified: ${target}`)
        }
      }
      for (let target = 0; target < targets.length; ) {
        const next = assertWithinWorkspace(targets, target, currentCwd, "Directory change", guard)
        currentCwd = next.path
        target += next.consumed
      }
      continue
    }

    const kind = WRITE_TARGETS[name]
    const optionTargets = optionWriteTargets(name, argv)
    const sedInPlace =
      name === "sed" &&
      argv
        .slice(1)
        .some((word) => /^-[a-zA-Z]*i/.test(word) || word === "--in-place" || word.startsWith("--in-place="))
    if (!kind && !sedInPlace && optionTargets.length === 0) continue

    assertWriteAllowed(argv[0] ?? command.resource, policy)

    const operands = argv.slice(1).filter((word) => !word.startsWith("-"))
    const position = WRITE_POSITION[name]
    // For cp/copy only the destination is written; checking the source would
    // reject legitimate reads from outside the workspace. `sed -i` rewrites
    // its file operands (the edit script is not a target).
    const targets = sedInPlace
      ? [...sedInPlaceTargets(argv), ...optionTargets]
      : kind === undefined
        ? [...optionTargets]
        : position !== undefined
          ? [...operands.slice(position, position + 1), ...optionTargets]
          : kind === "last"
            ? [...operands.slice(-1), ...optionTargets]
            : kind === "first"
              ? [...operands.slice(0, 1), ...optionTargets]
              : [...operands, ...optionTargets]
    assertOperandsContained(targets, currentCwd, guard)
  }
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
