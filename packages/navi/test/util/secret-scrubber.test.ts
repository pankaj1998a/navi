import { describe, expect, it } from "bun:test"
import { scrubSecrets } from "../../src/util/secret-scrubber"

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

  it("leaves clean text untouched", () => {
    const text = "Here is normal code: const x = 42; console.log(x);"
    const result = scrubSecrets(text)
    expect(result.scrubbedCount).toBe(0)
    expect(result.text).toBe(text)
  })
})
