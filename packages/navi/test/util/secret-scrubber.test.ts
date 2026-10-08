import { describe, expect, it } from "bun:test"
import { scrubSecrets, scrubSecretsInObject } from "../../src/util/secret-scrubber"

describe("secret-scrubber", () => {
  it("scrubs OpenAI API keys", () => {
    const text = "My OpenAI key is sk-proj-1234567890abcdef1234567890abcdef12345678"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED OPENAI KEY]")
    expect(result.text).not.toContain("sk-proj-")
  })

  it("scrubs Anthropic API keys", () => {
    const text = "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz01234567890123456789 for claude"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED ANTHROPIC KEY]")
  })

  it("scrubs xAI Grok API keys", () => {
    const text = "Grok key: xai-1234567890abcdef1234567890abcdef"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED XAI KEY]")
    expect(result.text).not.toContain("xai-123456")
  })

  it("scrubs Google API keys", () => {
    const text = "Gemini key: AIzaSyA1234567890abcdefghijk-ABCDEFG123"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED GOOGLE KEY]")
  })

  it("scrubs GitLab and Slack tokens", () => {
    const text = "Gitlab glpat-abcdef1234567890 and Slack xoxb-1234567890-abcdefghij"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(2)
    expect(result.text).toContain("[REDACTED GITLAB TOKEN]")
    expect(result.text).toContain("[REDACTED SLACK TOKEN]")
  })

  it("scrubs bare JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    const text = `Auth JWT: ${jwt}`
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED JWT]")
    expect(result.text).not.toContain("eyJhbGci")
  })

  it("scrubs sensitive URL query parameters", () => {
    const url = "https://api.example.com/v1/webhook?access_token=super_secret_token_123&user=pankaj&api_key=my_key_456"
    const result = scrubSecrets(url)
    expect(result.scrubbedCount).toBe(2)
    expect(result.text).toContain("access_token=redacted")
    expect(result.text).toContain("api_key=redacted")
    expect(result.text).toContain("user=pankaj")
  })

  it("scrubs AWS Access Keys", () => {
    const text = "AWS credentials: AKIAIOSFODNN7EXAMPLE"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED AWS ACCESS KEY]")
  })

  it("scrubs GitHub Personal Access Tokens", () => {
    const text = "GitHub token ghp_1234567890abcdefghijklmnopqrstuvwxyz123456"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toContain("[REDACTED GITHUB TOKEN]")
  })

  it("scrubs PEM Private Keys", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3v...
-----END RSA PRIVATE KEY-----`
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(1)
    expect(result.text).toBe("[REDACTED PRIVATE KEY]")
  })

  it("recursively scrubs secrets in objects", () => {
    const data = {
      config: {
        apiKey: "xai-1234567890abcdef1234567890abcdef",
        url: "https://service.com?token=secret123",
      },
      tags: ["clean", "ghp_1234567890abcdefghijklmnopqrstuvwxyz123456"],
    }
    const scrubbed = scrubSecretsInObject(data)
    expect(scrubbed.config.apiKey).toBe("[REDACTED XAI KEY]")
    expect(scrubbed.config.url).toContain("token=redacted")
    expect(scrubbed.tags[1]).toBe("[REDACTED GITHUB TOKEN]")
  })

  it("leaves clean text untouched", () => {
    const text = "Here is normal code: const x = 42; console.log(x);"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(0)
    expect(result.text).toBe(text)
  })
})
