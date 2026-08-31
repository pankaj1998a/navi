/**
 * Secure browser launcher for OAuth flows.
 * 
 * Ported from Gemini CLI core.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { platform } from "node:os"
import { URL } from "node:url"

const execFileAsync = promisify(execFile)

/**
 * Validates that a URL is safe to open in a browser.
 */
function validateUrl(url: string): void {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsafe protocol: ${parsedUrl.protocol}. Only HTTP and HTTPS are allowed.`)
  }

  if (/[\r\n\x00-\x1f]/.test(url)) {
    throw new Error("URL contains invalid characters")
  }
}

/**
 * Opens a URL in the default browser using platform-specific commands.
 */
export async function openBrowserSecurely(url: string): Promise<void> {
  validateUrl(url)

  const platformName = platform()
  let command: string
  let args: string[]

  switch (platformName) {
    case "darwin":
      command = "open"
      args = [url]
      break

    case "win32":
      command = "powershell.exe"
      args = [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Start-Process '${url.replace(/'/g, "''")}'`,
      ]
      break

    case "linux":
    case "freebsd":
    case "openbsd":
      command = "xdg-open"
      args = [url]
      break

    default:
      throw new Error(`Unsupported platform: ${platformName}`)
  }

  const options: any = {
    env: {
      ...process.env,
      SHELL: undefined,
    },
    detached: true,
    stdio: "ignore",
  }

  try {
    await execFileAsync(command, args, options)
  } catch (error) {
    if (
      (platformName === "linux" || platformName === "freebsd" || platformName === "openbsd") &&
      command === "xdg-open"
    ) {
      const fallbackCommands = ["gnome-open", "kde-open", "firefox", "chromium", "google-chrome"]

      for (const fallbackCommand of fallbackCommands) {
        try {
          await execFileAsync(fallbackCommand, [url], options)
          return
        } catch {
          continue
        }
      }
    }

    throw new Error(`Failed to open browser: ${error instanceof Error ? error.message : "Unknown error"}`, { cause: error })
  }
}

/**
 * Checks if the current environment should attempt to launch a browser.
 */
export function shouldLaunchBrowser(): boolean {
  if (process.env["NO_BROWSER"] === "1" || process.env["NO_BROWSER"] === "true") {
      return false
  }

  const browserBlocklist = ["www-browser"]
  const browserEnv = process.env["BROWSER"]
  if (browserEnv && browserBlocklist.includes(browserEnv)) {
    return false
  }

  if (process.env["CI"] || process.env["DEBIAN_FRONTEND"] === "noninteractive") {
    return false
  }

  const isSSH = !!process.env["SSH_CONNECTION"]

  if (platform() === "linux") {
    const displayVariables = ["DISPLAY", "WAYLAND_DISPLAY", "MIR_SOCKET"]
    const hasDisplay = displayVariables.some((v) => !!process.env[v])
    if (!hasDisplay) {
      return false
    }
  }

  if (isSSH && platform() !== "linux") {
    return false
  }

  return true
}
