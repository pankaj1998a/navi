import * as path from "path"
import * as fs from "fs"
import { spawn, spawnSync } from "child_process"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "bridge.runner" })

let cachedBridgeBinPath: string | null | undefined = undefined

export function getBridgeBinaryPath(): string | null {
  if (cachedBridgeBinPath !== undefined) {
    return cachedBridgeBinPath
  }

  const binaryName = process.platform === "win32" ? "navi-bridge.exe" : "navi-bridge"
  const execDir = path.dirname(process.execPath)
  const homeDir = process.env.USERPROFILE || process.env.HOME || ""

  const candidates = [
    path.resolve(execDir, binaryName),
    path.resolve(execDir, "bin", binaryName),
    path.resolve(homeDir, ".navi/bin", binaryName),
    path.resolve(process.cwd(), "native/navi-bridge/target/release", binaryName),
    path.resolve(process.cwd(), "../../native/navi-bridge/target/release", binaryName),
    path.resolve(process.cwd(), "native/navi-bridge/target/debug", binaryName),
    path.resolve(process.cwd(), "../../native/navi-bridge/target/debug", binaryName),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      log.info("Found navi-bridge binary", { path: candidate })
      cachedBridgeBinPath = candidate
      return candidate
    }
  }

  cachedBridgeBinPath = null
  return null
}

export async function isBridgeDaemonOnline(port = 10086): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const data = await res.json()
      return !!data.ok
    }
  } catch {}
  return false
}

export async function ensureBridgeDaemonRunning(port = 10086): Promise<boolean> {
  if (await isBridgeDaemonOnline(port)) {
    return true
  }

  const bin = getBridgeBinaryPath()
  if (!bin) {
    log.warn("Cannot auto-start bridge daemon: navi-bridge binary not found")
    return false
  }

  log.info("Spawning background navi-bridge daemon...", { bin, port })
  try {
    const child = spawn(bin, ["serve", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()

    // Poll up to 3 seconds for readiness
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200))
      if (await isBridgeDaemonOnline(port)) {
        log.info("navi-bridge daemon started successfully")
        return true
      }
    }
  } catch (err) {
    log.error("Failed to spawn navi-bridge daemon", { error: String(err) })
  }

  return false
}

export async function queryBridge(prompt: string, provider = "chatgpt", timeoutSecs = 60): Promise<string> {
  const bin = getBridgeBinaryPath()
  if (!bin) {
    throw new Error("navi-bridge binary not found. Please build or install navi-bridge.")
  }

  await ensureBridgeDaemonRunning()

  const result = spawnSync(bin, ["ask", prompt, "--provider", provider, "--timeout", String(timeoutSecs)], {
    encoding: "utf8",
    windowsHide: true,
    timeout: (timeoutSecs + 10) * 1000,
  })

  if (result.status !== 0) {
    const err = result.stderr?.trim() || result.stdout?.trim() || `Exit code ${result.status}`
    throw new Error(`NaviBridge query failed: ${err}`)
  }

  return result.stdout.trim()
}
