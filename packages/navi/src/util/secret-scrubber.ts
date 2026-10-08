export interface SecretScrubResult {
  text: string
  scrubbedCount: number
}

import { scrubSecretsNative } from "@/native/native-runner"

const REDACTED_URL_VALUE = "redacted"

const SENSITIVE_QUERY_PARAMS = new Set([
  "access_token",
  "api_key",
  "assertion",
  "auth",
  "client_secret",
  "code",
  "code_verifier",
  "id_token",
  "key",
  "password",
  "refresh_token",
  "requested_token",
  "session_id",
  "state",
  "subject_token",
  "token",
])

const SECRET_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: "PEM Private Key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    name: "xAI API Key",
    pattern: /\bxai-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED XAI KEY]",
  },
  {
    name: "Anthropic API Key",
    pattern: /\bsk-ant-api\d{2}-[a-zA-Z0-9_-]{32,}\b/g,
    replacement: "[REDACTED ANTHROPIC KEY]",
  },
  {
    name: "OpenAI API Key",
    pattern: /\bsk-(?:proj-|admin-|[a-zA-Z0-9]{20,})[a-zA-Z0-9_-]{12,}\b/g,
    replacement: "[REDACTED OPENAI KEY]",
  },
  {
    name: "AWS Access Key ID",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED AWS ACCESS KEY]",
  },
  {
    name: "AWS Secret Access Key Assignment",
    pattern: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
    replacement: "AWS_SECRET_ACCESS_KEY: [REDACTED AWS SECRET]",
  },
  {
    name: "GitHub Token",
    pattern: /\b(?:gh[opusr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
    replacement: "[REDACTED GITHUB TOKEN]",
  },
  {
    name: "Google API Key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "[REDACTED GOOGLE KEY]",
  },
  {
    name: "GitLab Token",
    pattern: /\bglpat-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED GITLAB TOKEN]",
  },
  {
    name: "Slack Token",
    pattern: /\b(?:xox[abp]-|xapp-)[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED SLACK TOKEN]",
  },
  {
    name: "Bearer Token",
    pattern: /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/gi,
    replacement: "Bearer [REDACTED TOKEN]",
  },
  {
    name: "Bare JWT Token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[REDACTED JWT]",
  },
  {
    name: "GitHub Token Env Assignment",
    pattern: /\bGITHUB_TOKEN\s*[:=]\s*["']?(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}["']?/gi,
    replacement: "GITHUB_TOKEN: [REDACTED GITHUB TOKEN]",
  },
  {
    name: "OpenAI Env Key",
    pattern: /\bOPENAI_API_KEY\s*[:=]\s*["']?sk-(?:proj-|admin-)?[a-zA-Z0-9_-]{20,}["']?/gi,
    replacement: "OPENAI_API_KEY: [REDACTED OPENAI KEY]",
  },
  {
    name: "Anthropic Env Key",
    pattern: /\bANTHROPIC_API_KEY\s*[:=]\s*["']?sk-ant-[a-zA-Z0-9_-]{20,}["']?/gi,
    replacement: "ANTHROPIC_API_KEY: [REDACTED ANTHROPIC KEY]",
  },
  {
    name: "Private Key Assignment",
    pattern: /\bPRIVATE_KEY\s*[:=]\s*["']?-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----["']?/gi,
    replacement: "PRIVATE_KEY: [REDACTED PRIVATE KEY]",
  },
  {
    name: "Generic Secret Assignment",
    pattern: /\b(api[_-]?key|(?:access|refresh|id)[_-]token|token|secret|client[_-]secret|password)\b(\s*[:=]\s*)(["']?)(?!(?:redacted|\[REDACTED))[^\s"',&]{8,}\b/gi,
    replacement: "$1$2$3[REDACTED SECRET]",
  },
]

const URL_REGEX = /https?:\/\/[^\s"'<>(){}[\];,`]+/g

function redactUrls(input: string): { text: string; scrubbedCount: number } {
  let count = 0
  const text = input.replace(URL_REGEX, (url) => {
    try {
      const parsed = new URL(url)
      let modified = false
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
          parsed.searchParams.set(key, REDACTED_URL_VALUE)
          modified = true
          count++
        }
      }
      return modified ? parsed.toString() : url
    } catch {
      return url
    }
  })
  return { text, scrubbedCount: count }
}

/**
 * Fast check to detect whether text might contain any sensitive pattern before full regex scan.
 */
const QUICK_CHECK_REGEX = /(?:sk[-_]|xai-|AKIA|ASIA|gh[opusr]_|github_pat_|glpat-|xox[abp]-|xapp-|AIza|eyJ|Bearer|PRIVATE KEY|api[_-]?key|secret|password|https?:\/\/)/i

/**
 * Scrubs sensitive patterns from text input to prevent leaking secrets to LLM providers or logs.
 * Ported from SpaceXAI Grok Build (xai-grok-secrets sanitizer.rs).
 */
export function scrubSecrets(input: string): SecretScrubResult {
  if (!input) return { text: input, scrubbedCount: 0 }
  if (!QUICK_CHECK_REGEX.test(input)) {
    return { text: input, scrubbedCount: 0 }
  }

  // Fast-path: offload large inputs (>10KB) to native Rust DFA regex engine to avoid V8 GC churn
  if (input.length > 10_000) {
    const nativeScrubbed = scrubSecretsNative(input)
    if (nativeScrubbed !== null) {
      return {
        text: nativeScrubbed,
        scrubbedCount: nativeScrubbed === input ? 0 : 1,
      }
    }
  }

  let current = input
  let count = 0

  const urlResult = redactUrls(current)
  current = urlResult.text
  count += urlResult.scrubbedCount

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    const matches = current.match(pattern)
    if (matches) {
      count += matches.length
      current = current.replace(pattern, (match) => {
        if (replacement.includes("$1")) {
          return match.replace(pattern, replacement)
        }
        return replacement
      })
    }
  }

  return { text: current, scrubbedCount: count }
}

/**
 * Recursively scrubs string values in JSON or objects.
 */
export function scrubSecretsInObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return scrubSecrets(obj).text as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => scrubSecretsInObject(item)) as unknown as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = scrubSecretsInObject(value)
    }
    return result as unknown as T
  }
  return obj
}
