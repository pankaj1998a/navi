export interface SecretScrubResult {
  text: string
  scrubbedCount: number
}

const SECRET_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: "PEM Private Key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
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
    pattern: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED AWS ACCESS KEY]",
  },
  {
    name: "AWS Secret Access Key Assignment",
    pattern: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
    replacement: "AWS_SECRET_ACCESS_KEY: [REDACTED AWS SECRET]",
  },
  {
    name: "GitHub Token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,82}\b/g,
    replacement: "[REDACTED GITHUB TOKEN]",
  },
  {
    name: "GitHub Token Env Assignment",
    pattern: /\bGITHUB_TOKEN\s*[:=]\s*["']?(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,82}["']?/gi,
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
    name: "Bearer Token",
    pattern: /\bBearer\s+[a-zA-Z0-9_\-.]{30,}\b/gi,
    replacement: "Bearer [REDACTED TOKEN]",
  },
  {
    name: "Generic Secret Assignment",
    pattern: /(?:api[_-]?key|secret|access[_-]?token|password|auth[_-]?token)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    replacement: "$1: [REDACTED SECRET]",
  },
]

/**
 * Scrubs sensitive patterns from text input to prevent leaking secrets to LLM providers or logs.
 */
export function scrubSecrets(input: string): SecretScrubResult {
  if (!input) return { text: input, scrubbedCount: 0 }

  let current = input
  let count = 0

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    const matches = current.match(pattern)
    if (matches) {
      count += matches.length
      current = current.replace(pattern, (match) => {
        if (replacement.includes("$1")) {
          const keyName = match.split(/[:=]/)[0]
          return `${keyName}: "[REDACTED SECRET]"`
        }
        return replacement
      })
    }
  }

  return { text: current, scrubbedCount: count }
}
