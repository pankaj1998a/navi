/**
 * Sanitizes environment variables before passing them to child processes
 * (shell tools, PTY sessions, local MCP servers).
 * Prevents credential leakage of NAVI_AUTH_CONTENT, NAVI_SERVER_PASSWORD,
 * and internal auth tokens to untrusted child environments.
 */
export const SENSITIVE_ENV_KEYS = new Set([
  "NAVI_AUTH_CONTENT",
  "NAVI_SERVER_PASSWORD",
  "NAVI_SHARE_SECRET",
  "NAVI_SESSION_TOKEN",
])

export function sanitizeChildProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_KEYS.has(key)) continue
    clean[key] = value
  }
  return clean
}
