/**
 * Privacy strip — redacts secrets before they reach durable storage.
 * Direct TypeScript/Bun port of ai-memory's sanitize.rs.
 */

export const OBSERVATION_BODY_MAX_BYTES = 16 * 1024

const ESCAPE_SEQUENCES =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

// C0/C1 non-printable controls (excluding \t \n \r), DEL, and Unicode bidi overrides
const STRIPPED_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g

interface PatternEntry {
  regex: RegExp
  label: string
}

const BUILTIN_PATTERNS: PatternEntry[] = [
  // Bearer-style tokens
  { regex: /bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, label: "bearer_token" },
  // Vendor-prefixed API keys (OpenAI / Anthropic / OpenRouter)
  { regex: /sk-[A-Za-z0-9_\-]{16,}/g, label: "api_key" },
  // Stripe live secret and restricted keys
  { regex: /(?:sk|rk)_live_[A-Za-z0-9_\-]{16,}/g, label: "stripe_key" },
  // GitHub tokens (all prefixes)
  { regex: /gh[pousr]_[A-Za-z0-9]{20,}/g, label: "github_token" },
  { regex: /github_pat_[A-Za-z0-9_]{20,}/g, label: "github_token" },
  // AWS access key IDs (AKIA & ASIA exactly 20 chars with word boundaries)
  { regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: "aws_key" },
  // Google / Gemini API keys
  { regex: /AIza[A-Za-z0-9_\-]{30,}/g, label: "google_api_key" },
  { regex: /AQ\.Ab[A-Za-z0-9_\-]{30,}/g, label: "google_api_key" },
  // Google OAuth refresh tokens
  { regex: /1\/\/[0-9A-Za-z_\-]{20,}/g, label: "google_oauth" },
  // Meta / Facebook Graph tokens
  { regex: /EAA[A-Za-z0-9]{20,}/g, label: "meta_token" },
  // Telegram bot tokens
  { regex: /\b\d{6,10}:(?:AA[A-Za-z0-9_\-]{30,}|[A-Za-z0-9_\-]{34,35})\b/g, label: "telegram_token" },
  // GoHighLevel Private Integration Tokens
  { regex: /pit-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, label: "ghl_token" },
  // Slack tokens
  { regex: /xox[abprs]-[A-Za-z0-9\-]{10,}/g, label: "slack_token" },
  { regex: /xapp-[A-Za-z0-9\-]{10,}/g, label: "slack_token" },
  // JWT tokens (three base64url segments)
  { regex: /eyJ[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}/g, label: "jwt" },
  // Base64 JSON tokens (e.g. Cloudflare tunnel tokens)
  { regex: /eyJ[A-Za-z0-9_\-+/]{40,}={0,2}/g, label: "base64_json_token" },
  // PEM private keys
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "private_key" },
  // URL-embedded credentials
  { regex: /[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^:/\s]+:[^@\s]+@[^\s]+/g, label: "url_credentials" },
  // Auth headers
  {
    regex: /\b[A-Za-z0-9_-]*(?:authentication|authorization|credentials?|password|passwd|apikey|accountkey|authtoken|[a-z0-9]*(?:api|auth|access|secret|security|private|session|refresh|client|consumer|subscription|app|bearer)-(?:key|token))"?\s*[=:]\s*(?:(?:basic|bearer|digest|token|apikey)\s+)?"?[A-Za-z0-9._~+/=-]{8,}/gi,
    label: "auth_header",
  },
  // Known provider env vars
  {
    regex: /(ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|VOYAGE_API_KEY|MISTRAL_API_KEY|GROQ_API_KEY|HF_TOKEN|HUGGINGFACE_TOKEN|AWS_(SECRET_)?ACCESS_KEY[A-Z_]*|GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|GOOGLE_API_KEY|GEMINI_API_KEY|OLLAMA_API_KEY)"?\s*[=:]\s*[^\[\s]\S*/gi,
    label: "env_secret",
  },
  // Generic env-var secrets: *_KEY, *_TOKEN, etc.
  {
    regex: /\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|PRIVATE_KEY)"?\s*[=:]\s*[^\[\s]\S*/gi,
    label: "env_secret",
  },
  // Suffixes: *_KEY_ID, *_PASSPHRASE, *_SIGNING_KEY, *_PEPPER, *_SALT
  {
    regex: /\b[A-Z][A-Z0-9_]*_(KEY_ID|PASSPHRASE|SIGNING_KEY|PEPPER|SALT)"?\s*[=:]\s*[^\[\s]\S*/g,
    label: "env_secret",
  },
  // Filesystem paths that commonly contain credentials
  { regex: /(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.ssh(?:[\\/][^\s]+)?/gi, label: "credential_path" },
  { regex: /(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.aws(?:[\\/][^\s]+)?/gi, label: "credential_path" },
  { regex: /(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.kube(?:[\\/][^\s]+)?/gi, label: "credential_path" },
  { regex: /(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.config[\\/]gcloud(?:[\\/][^\s]+)?/gi, label: "credential_path" },
  { regex: /(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.gnupg(?:[\\/][^\s]+)?/gi, label: "credential_path" },
]

export interface SanitizeConfig {
  extraPatterns?: Array<{ regex: RegExp | string; label?: string }>
  allowlist?: string[]
}

export class Sanitizer {
  private patterns: PatternEntry[] = []
  private allowlist: string[] = []

  constructor(cfg?: SanitizeConfig) {
    this.patterns = [...BUILTIN_PATTERNS]
    if (cfg?.extraPatterns) {
      for (const p of cfg.extraPatterns) {
        const source = typeof p.regex === "string" ? p.regex.slice(0, 1024) : p.regex.source.slice(0, 1024)
        try {
          const regex = typeof p.regex === "string" ? new RegExp(source, "g") : new RegExp(source, p.regex.flags)
          this.patterns.push({ regex, label: p.label ?? "custom" })
        } catch {
          continue
        }
      }
    }
    if (cfg?.allowlist) {
      this.allowlist = [...cfg.allowlist]
    }
  }

  public stripControl(input: string): string {
    return input.replace(ESCAPE_SEQUENCES, "").replace(STRIPPED_CONTROLS, "")
  }

  public scrub(input: string): string {
    let out = this.stripControl(input)
    for (const { regex, label } of this.patterns) {
      // Re-create RegExp with 'g' flag if not present to ensure replaceAll semantics
      const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g"
      const rx = new RegExp(regex.source, flags)
      out = out.replace(rx, (matched) => {
        if (this.allowlist.some((a) => matched.includes(a))) {
          return matched
        }
        return `[REDACTED:${label}]`
      })
    }
    return out
  }
}

import { native } from "./native"

export const defaultSanitizer = new Sanitizer()

export function sanitizeText(text: string, config?: SanitizeConfig): string {
  if (!config) {
    if (native.isAvailable && native.sanitizeText) {
      return native.sanitizeText(text)
    }
    return defaultSanitizer.scrub(text)
  }
  return new Sanitizer(config).scrub(text)
}

export function truncateForTitle(text: string, maxChars = 80): string {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  return chars.slice(0, maxChars - 1).join("") + "…"
}

export function truncateHeadTail(input: string, maxBytes = OBSERVATION_BODY_MAX_BYTES): string {
  const buf = Buffer.from(input, "utf8")
  if (buf.length <= maxBytes) return input

  if (maxBytes < 64) {
    return buf.subarray(0, maxBytes).toString("utf8") + "…"
  }

  const markerReserve = 48
  const usable = Math.max(0, maxBytes - markerReserve)
  const half = Math.floor(usable / 2)

  const head = buf.subarray(0, half).toString("utf8")
  const tail = buf.subarray(buf.length - half).toString("utf8")
  const omitted = buf.length - (half * 2)

  return `${head}\n...[truncated ${omitted} bytes]...\n${tail}`
}
