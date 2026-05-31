declare global {
  const NAVI_VERSION: string
  const NAVI_CHANNEL: string
}

export const InstallationVersion = typeof NAVI_VERSION === "string" ? NAVI_VERSION : "local"
export const InstallationChannel = typeof NAVI_CHANNEL === "string" ? NAVI_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
