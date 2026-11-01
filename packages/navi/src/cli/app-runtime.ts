import type * as AppRuntimeModule from "@/effect/app-runtime"

let loading: Promise<typeof AppRuntimeModule> | undefined

/**
 * Imports the heavy service-layer runtime (55 services, every @ai-sdk provider,
 * drizzle, puppeteer, ...) once, on first use. Shared by every `effectCmd`
 * handler so `--help`, `--version`, and light commands never pay for it.
 */
export function loadAppRuntime() {
  return (loading ??= import("@/effect/app-runtime"))
}

/** True once a command handler actually loaded the runtime (so shutdown must dispose it). */
export function appRuntimeLoaded() {
  return loading !== undefined
}
