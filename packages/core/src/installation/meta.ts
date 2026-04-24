declare global {
  const NAVI_VERSION: string
  const NAVI_CHANNEL: string
}

export const VERSION = typeof NAVI_VERSION === "string" ? NAVI_VERSION : "local"
export const CHANNEL = typeof NAVI_CHANNEL === "string" ? NAVI_CHANNEL : "local"

