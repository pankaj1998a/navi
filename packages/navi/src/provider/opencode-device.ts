export const OPENCODE_CONSOLE_SERVER = "https://opencode.ai/console"
export const OPENCODE_CLIENT_ID = "opencode-cli"

export interface DeviceResponse {
  device_code: string
  user_code: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  org_id?: string | null
}

export interface ConsoleUser {
  id: string
  email: string
}

export interface ConsoleOrg {
  id: string
  name: string
}

export type FetchFn = typeof fetch

export interface PollOptions {
  signal?: AbortSignal
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function normalizeConsoleServer(input?: string): string {
  const raw = (input ?? OPENCODE_CONSOLE_SERVER).trim() || OPENCODE_CONSOLE_SERVER
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S) console server")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asDevice(value: unknown): DeviceResponse {
  if (!isRecord(value)) throw new Error("invalid device code response")
  const device_code = value.device_code
  const user_code = value.user_code
  const verification_uri_complete = value.verification_uri_complete
  const expires_in = value.expires_in
  const interval = value.interval
  if (typeof device_code !== "string") throw new Error("invalid device code response")
  if (typeof user_code !== "string") throw new Error("invalid device code response")
  if (typeof verification_uri_complete !== "string") throw new Error("invalid device code response")
  if (typeof expires_in !== "number") throw new Error("invalid device code response")
  if (typeof interval !== "number") throw new Error("invalid device code response")
  return { device_code, user_code, verification_uri_complete, expires_in, interval }
}

function asToken(value: unknown): TokenResponse {
  if (!isRecord(value)) throw new Error("invalid token response")
  const access_token = value.access_token
  const refresh_token = value.refresh_token
  const expires_in = value.expires_in
  if (typeof access_token !== "string") throw new Error("invalid token response")
  if (typeof refresh_token !== "string") throw new Error("invalid token response")
  if (typeof expires_in !== "number") throw new Error("invalid token response")
  const org_id = value.org_id
  if (org_id !== undefined && org_id !== null && typeof org_id !== "string") throw new Error("invalid token response")
  return { access_token, refresh_token, expires_in, org_id: (org_id as string | null | undefined) ?? null }
}

function tokenError(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.error === "string" && !("access_token" in value)) return value.error
  return undefined
}

async function postJson(fetchFn: FetchFn, url: string, body: Record<string, string | boolean>): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`console request failed (${res.status}): ${url}`)
  return res.json()
}

async function getJson(fetchFn: FetchFn, url: string, token: string): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`console request failed (${res.status}): ${url}`)
  return res.json()
}

export async function requestDeviceCode(fetchFn: FetchFn, server: string): Promise<DeviceResponse> {
  const base = normalizeConsoleServer(server)
  return asDevice(await postJson(fetchFn, `${base}/auth/device/code`, { client_id: OPENCODE_CLIENT_ID, supports_org_scope: true }))
}

export function deviceVerificationUrl(server: string, device: DeviceResponse): string {
  const base = normalizeConsoleServer(server)
  const url = new URL(device.verification_uri_complete, `${base}/`)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid device verification URL")
  return url.href
}

export async function pollDeviceToken(
  fetchFn: FetchFn,
  server: string,
  device: DeviceResponse,
  opts: PollOptions = {},
): Promise<TokenResponse> {
  const base = normalizeConsoleServer(server)
  const sleep = opts.sleep ?? defaultSleep
  const maxAttempts = opts.maxAttempts ?? Math.max(1, Math.min(360, Math.ceil(device.expires_in / Math.max(1, device.interval))))
  let waitMs = Math.max(0, device.interval * 1000)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    opts.signal?.throwIfAborted()
    await sleep(waitMs)
    opts.signal?.throwIfAborted()
    const raw = await postJson(fetchFn, `${base}/auth/device/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: OPENCODE_CLIENT_ID,
    })
    const pending = tokenError(raw)
    if (pending === undefined) return asToken(raw)
    if (pending === "authorization_pending") continue
    if (pending === "slow_down") {
      waitMs += 5000
      continue
    }
    throw new Error(`Device authorization failed: ${pending}`)
  }
  throw new Error("Device authorization timed out")
}

export async function fetchConsoleUser(fetchFn: FetchFn, server: string, token: string): Promise<ConsoleUser> {
  const base = normalizeConsoleServer(server)
  const raw = await getJson(fetchFn, `${base}/api/user`, token)
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.email !== "string") throw new Error("invalid user response")
  return { id: raw.id, email: raw.email }
}

export async function fetchConsoleOrgs(fetchFn: FetchFn, server: string, token: string): Promise<ConsoleOrg[]> {
  const base = normalizeConsoleServer(server)
  const raw = await getJson(fetchFn, `${base}/api/orgs`, token)
  if (!Array.isArray(raw)) throw new Error("invalid orgs response")
  return raw.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") throw new Error("invalid orgs response")
    return { id: item.id, name: item.name }
  })
}

export function resolveLoginOrg(orgs: ConsoleOrg[], orgID?: string | null): ConsoleOrg | undefined {
  if (orgID != null) return orgs.find((org) => org.id === orgID)
  return orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
}

export interface DeviceLogin {
  refresh: string
  access: string
  expires: number
  accountId: string
  enterpriseUrl: string
  metadata: Record<string, string>
}

export async function loginWithDeviceFlow(
  fetchFn: FetchFn,
  server: string,
  device: DeviceResponse,
  opts: PollOptions = {},
): Promise<DeviceLogin> {
  const base = normalizeConsoleServer(server)
  const token = await pollDeviceToken(fetchFn, base, device, opts)
  const [user, orgs] = await Promise.all([fetchConsoleUser(fetchFn, base, token.access_token), fetchConsoleOrgs(fetchFn, base, token.access_token)])
  const org = resolveLoginOrg(orgs, token.org_id)
  if (token.org_id != null && !org) throw new Error(`OpenCode organization not found: ${token.org_id}`)
  return {
    refresh: token.refresh_token,
    access: token.access_token,
    expires: Date.now() + token.expires_in * 1000,
    accountId: user.id,
    enterpriseUrl: base,
    metadata: {
      email: user.email,
      ...(org ? { orgID: org.id, orgName: org.name } : {}),
    },
  }
}

export async function refreshOAuthToken(fetchFn: FetchFn, server: string, refreshToken: string): Promise<TokenResponse> {
  const base = normalizeConsoleServer(server)
  const raw = await postJson(fetchFn, `${base}/auth/device/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OPENCODE_CLIENT_ID,
  })
  const pending = tokenError(raw)
  if (pending !== undefined) throw new Error(`OpenCode session expired, log in again (navi auth login)`)
  return asToken(raw)
}
