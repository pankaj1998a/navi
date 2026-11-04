import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { spawn } from "child_process"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "native.web-runner" })

export interface NativeWebInstance {
  port: number
  hostname: string
  password?: string
  username?: string
  url: string
  authenticatedUrl: string
  engine: string
  stop: () => Promise<void>
}

let cachedBinPath: string | null | undefined = undefined

export function getNativeWebBinaryPath(): string | null {
  if (cachedBinPath !== undefined) {
    return cachedBinPath
  }

  const binaryName = process.platform === "win32" ? "navi-web.exe" : "navi-web"
  const homeBin = path.join(os.homedir(), ".navi", "bin", binaryName)
  const candidates = [
    homeBin,
    path.resolve(process.cwd(), "native/navi-web/target/release", binaryName),
    path.resolve(process.cwd(), "../../native/navi-web/target/release", binaryName),
    path.resolve(process.cwd(), "native/navi-web/target/debug", binaryName),
    path.resolve(process.cwd(), "../../native/navi-web/target/debug", binaryName),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      log.info("Found navi-web binary", { path: candidate })
      cachedBinPath = candidate
      return candidate
    }
  }

  cachedBinPath = null
  return null
}

export function isNativeWebAvailable(): boolean {
  return getNativeWebBinaryPath() !== null
}

export interface StartNativeWebOptions {
  port: number
  hostname: string
  password?: string
  noAuth?: boolean
  distDir?: string
}

export function startNativeWebServer(opts: StartNativeWebOptions): Promise<NativeWebInstance> {
  const bin = getNativeWebBinaryPath()
  if (!bin) {
    return Promise.reject(new Error("navi-web binary not found"))
  }

  return new Promise((resolve, reject) => {
    const args = ["--json", "--port", String(opts.port), "--hostname", opts.hostname]
    if (opts.noAuth) {
      args.push("--no-auth")
    } else if (opts.password) {
      args.push("--password", opts.password)
    }

    if (opts.distDir) {
      args.push("--dist-dir", opts.distDir)
    }

    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    let resolved = false
    let outputBuf = ""

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        child.kill()
        reject(new Error("Timeout waiting for native navi-web to start"))
      }
    }, 10000)

    child.stdout.on("data", (chunk: Buffer) => {
      outputBuf += chunk.toString("utf8")
      const lines = outputBuf.split(/\r?\n/)
      outputBuf = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith("{") && trimmed.includes('"status":"listening"')) {
          try {
            const data = JSON.parse(trimmed)
            resolved = true
            clearTimeout(timeout)

            const instance: NativeWebInstance = {
              port: data.port,
              hostname: data.hostname,
              password: data.password ?? undefined,
              username: data.username ?? undefined,
              url: data.url,
              authenticatedUrl: data.authenticated_url,
              engine: data.engine || "navi-web-rust",
              stop: () => {
                return new Promise((res) => {
                  child.once("exit", () => res())
                  child.kill()
                  setTimeout(() => res(), 1000)
                })
              },
            }
            resolve(instance)
            return
          } catch {
            // Ignore parse errors on intermediate lines
          }
        }
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      log.warn("navi-web stderr", { msg: chunk.toString("utf8") })
    })

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`navi-web exited prematurely with code ${code}`))
      }
    })
  })
}

