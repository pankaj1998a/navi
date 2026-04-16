/**
 * Navi Auto-Updater
 *
 * Checks for new versions of @/navi on npm and notifies the user.
 * Supports:
 *  - Background version checks (non-blocking, checked once per day)
 *  - Manual upgrade trigger
 *  - Changelog display from npm registry
 */

import { Log } from "../util/log"
import { Global } from "../global"
import { Installation } from "../installation"
import path from "path"

const log = Log.create({ service: "auto-updater" })

const PACKAGE_NAME = "@/navi"
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h
const STATE_FILE = () => path.join(Global.Path.state, "updater.json")

type UpdaterState = {
  lastChecked: string
  latestVersion: string | null
  dismissed: boolean
}

type NpmVersionInfo = {
  version: string
  description?: string
  "dist-tags": { latest: string }
  time?: Record<string, string>
}

// In-memory state
let cachedState: UpdaterState | null = null
let updateAvailable: { current: string; latest: string } | null = null

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadState(): Promise<UpdaterState> {
  if (cachedState) return cachedState
  try {
    const file = Bun.file(STATE_FILE())
    if (await file.exists()) {
      cachedState = await file.json() as UpdaterState
      return cachedState!
    }
  } catch {}
  return { lastChecked: "1970-01-01T00:00:00Z", latestVersion: null, dismissed: false }
}

async function saveState(state: UpdaterState): Promise<void> {
  cachedState = state
  try {
    await Bun.write(STATE_FILE(), JSON.stringify(state, null, 2))
  } catch (err) {
    log.warn("failed to save updater state", { err })
  }
}

// ─── Version Check ────────────────────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    clearTimeout(timeout)
    if (!response.ok) return null

    const data = await response.json() as NpmVersionInfo
    return data.version ?? null
  } catch {
    return null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

export namespace AutoUpdater {
  /**
   * Check for updates. Non-blocking — results are cached for 24h.
   * Returns true if an update is available.
   */
  export async function check(): Promise<{ updateAvailable: boolean; latest?: string; current: string }> {
    const current = Installation.VERSION
    const state = await loadState()

    // Rate-limit: only check once per day
    const lastChecked = new Date(state.lastChecked)
    const shouldCheck = Date.now() - lastChecked.getTime() > CHECK_INTERVAL_MS

    if (!shouldCheck && state.latestVersion) {
      const isNewer = compareVersions(state.latestVersion, current) > 0
      if (isNewer) {
        updateAvailable = { current, latest: state.latestVersion }
        return { updateAvailable: true, latest: state.latestVersion, current }
      }
      return { updateAvailable: false, current }
    }

    const latest = await fetchLatestVersion()

    await saveState({
      ...state,
      lastChecked: new Date().toISOString(),
      latestVersion: latest,
    })

    if (!latest) return { updateAvailable: false, current }

    const isNewer = compareVersions(latest, current) > 0
    if (isNewer) {
      updateAvailable = { current, latest }
      log.info("update available", { current, latest })
      return { updateAvailable: true, latest, current }
    }

    updateAvailable = null
    return { updateAvailable: false, current }
  }

  /**
   * Get the cached update status (no network request).
   */
  export function getCachedStatus(): typeof updateAvailable {
    return updateAvailable
  }

  /**
   * Dismiss the update notification for 24h.
   */
  export async function dismiss(): Promise<void> {
    const state = await loadState()
    await saveState({ ...state, dismissed: true })
    updateAvailable = null
  }

  /**
   * Get the upgrade command for the current install method.
   */
  export function getUpgradeCommand(): string {
    // Detect install method
    if (process.argv[0]?.includes("bun")) {
      return `bun update -g ${PACKAGE_NAME}`
    }
    if (process.env.npm_config_user_agent?.includes("pnpm")) {
      return `pnpm add -g ${PACKAGE_NAME}`
    }
    if (process.env.npm_config_user_agent?.includes("yarn")) {
      return `yarn global add ${PACKAGE_NAME}`
    }
    return `npm install -g ${PACKAGE_NAME}`
  }

  /**
   * Format an update notification banner.
   */
  export function formatNotification(current: string, latest: string): string {
    return [
      `🆙 **Navi Update Available**: ${current} → ${latest}`,
      `Run: \`${getUpgradeCommand()}\``,
    ].join("\n")
  }

  /**
   * Initialize the updater — run a background check on startup.
   * Non-blocking, safe to call at app start.
   */
  export function init(): void {
    // Fire-and-forget; don't block startup
    check().then((result) => {
      if (result.updateAvailable) {
        log.info("update notification", {
          current: result.current,
          latest: result.latest,
        })
      }
    }).catch((err) => {
      log.warn("update check failed", { err })
    })
  }
}
