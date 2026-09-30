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
export const WindowsAclBackend = {
  isAvailable: () => process.platform === "win32" && process.env.NAVI_SANDBOX_DISABLE_WINDOWS !== "true",
  confine: (command: string, args: string[], policy: SandboxPolicy, env: NodeJS.ProcessEnv): ConfinedExecution => {
    return {
      command,
      args,
      env: {
        ...env,
        NAVI_SANDBOX_MODE: policy.mode,
        NAVI_SANDBOX_ROOT: policy.workspaceRoot,
        NAVI_SANDBOX_RESTRICTED_TOKEN: "1",
        NAVI_SANDBOX_JOB_OBJECT: "1",
        NAVI_SANDBOX_WRITE_RESTRICTED: policy.mode === "read-only" ? "0" : "1",
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

export const defaultLayer = Layer.succeed(Service, {
  resolvePolicy: (mode = "workspace-write", workspaceRoot = process.cwd()) =>
    Effect.succeed({
      mode,
      workspaceRoot: path.resolve(workspaceRoot),
    }),

  confine: (command, args, policy, env = process.env) =>
    Effect.try({
      try: () => confineSync(command, args, policy, env),
      catch: (e) => (e instanceof SandboxUnavailableError ? e : new SandboxUnavailableError(String(e), e)),
    }),
})

export * as Sandbox from "./index"
