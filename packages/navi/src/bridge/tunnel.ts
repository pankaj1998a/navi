import { spawn, execSync, type ChildProcess } from "child_process"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "bridge.tunnel" })

export type TunnelType = "cloudflare" | "ngrok" | "local"

export interface TunnelResult {
  type: TunnelType
  publicUrl: string
  stop: () => Promise<void>
}

function hasCommand(cmd: string): boolean {
  try {
    const testCmd = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`
    execSync(testCmd, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Spawns a Cloudflare Quick Tunnel (cloudflared or via untun)
 */
async function startCloudflareTunnel(port: number): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    log.info("starting Cloudflare tunnel", { port })

    let proc: ChildProcess
    const hasCloudflared = hasCommand("cloudflared")

    if (hasCloudflared) {
      log.info("using installed cloudflared binary")
      proc = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      })
    } else {
      const runner = hasCommand("bunx") ? "bunx" : "npx"
      const args = runner === "bunx" ? ["untun", "tunnel", String(port)] : ["-y", "untun", "tunnel", String(port)]
      log.info(`cloudflared not in PATH, launching via ${runner} untun`, { runner, args })
      proc = spawn(runner, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      })
    }

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        try {
          proc.kill()
        } catch {
          // Ignore cleanup failures if the process already exited
        }
        reject(new Error("Timeout waiting for Cloudflare tunnel URL to be assigned (30s)."))
      }
    }, 30000)

    const onData = (data: Buffer) => {
      const text = data.toString()
      // Match trycloudflare.com URL
      const match =
        text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/) ||
        text.match(/https:\/\/[a-zA-Z0-9-]+\.untun\.dev/) ||
        text.match(/https:\/\/[a-zA-Z0-9-]+\.loca\.lt/)

      if (match && !resolved) {
        resolved = true
        clearTimeout(timeout)
        const publicUrl = match[0]
        log.info("tunnel established", { publicUrl })
        resolve({
          type: "cloudflare",
          publicUrl,
          stop: async () => {
            try {
              if (process.platform === "win32" && proc.pid) {
                execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" })
              } else {
                proc.kill("SIGKILL")
              }
            } catch {
              // Ignore cleanup failures if the process already exited
            }
          },
        })
      }
    }

    proc.stdout?.on("data", onData)
    proc.stderr?.on("data", onData)
    proc.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

/**
 * Spawns an Ngrok tunnel if authtoken or client is configured
 */
async function startNgrokTunnel(port: number, authtoken?: string): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    log.info("starting Ngrok tunnel", { port })
    const args = ["http", String(port)]
    if (authtoken) {
      args.push("--authtoken", authtoken)
    }

    const proc = spawn("ngrok", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    })

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error("Timeout waiting for Ngrok tunnel URL. Ensure 'ngrok' is installed and authenticated."))
      }
    }, 12000)

    const checkNgrokApi = async () => {
      try {
        const res = await fetch("http://127.0.0.1:4040/api/tunnels")
        if (res.ok) {
          const json = (await res.json()) as { tunnels?: Array<{ public_url: string; proto: string }> }
          const httpsTunnel = json.tunnels?.find((t) => t.proto === "https") || json.tunnels?.[0]
          if (httpsTunnel?.public_url && !resolved) {
            resolved = true
            clearTimeout(timeout)
            resolve({
              type: "ngrok",
              publicUrl: httpsTunnel.public_url,
              stop: async () => {
                try {
                  proc.kill()
                } catch {
                  // Ignore cleanup failures if the process already exited
                }
              },
            })
            return
          }
        }
      } catch {
        // Ignore transient polling failures; the retry below re-checks the API
      }

      if (!resolved) {
        setTimeout(checkNgrokApi, 500)
      }
    }

    setTimeout(checkNgrokApi, 1000)

    proc.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

/**
 * Main Tunnel launcher
 */
export async function startTunnel(options: {
  port: number
  tunnelType: TunnelType
  ngrokToken?: string
}): Promise<TunnelResult> {
  const { port, tunnelType, ngrokToken } = options

  if (tunnelType === "local") {
    return {
      type: "local",
      publicUrl: `http://localhost:${port}`,
      stop: async () => {},
    }
  }

  if (tunnelType === "ngrok") {
    return startNgrokTunnel(port, ngrokToken)
  }

  // Default: Cloudflare Quick Tunnel
  try {
    return await startCloudflareTunnel(port)
  } catch (err) {
    log.warn("Cloudflare tunnel failed, falling back to local address", { error: String(err) })
    return {
      type: "local",
      publicUrl: `http://localhost:${port}`,
      stop: async () => {},
    }
  }
}
