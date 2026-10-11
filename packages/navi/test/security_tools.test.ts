import { describe, expect, it } from "bun:test"
import { scanSourceFile, checksecBinary, auditJwt, auditSecurityHeaders } from "../src/security"
import * as fs from "node:fs"
import * as path from "node:path"

describe("Cybersecurity Suite - SAST", () => {
  it("detects SQL injection vulnerabilities (CWE-89)", () => {
    const code = `
      function getUser(id) {
        const query = "SELECT * FROM users WHERE id = '" + id + "'"
        return db.query(query)
      }
    `
    const findings = scanSourceFile("src/db.js", code)
    const sqli = findings.filter((f) => f.cwe === "CWE-89")
    expect(sqli.length).toBeGreaterThan(0)
    expect(sqli[0]?.severity).toBe("critical")
  })

  it("detects Command Injection vulnerabilities (CWE-78)", () => {
    const code = `
      import { exec } from "child_process"
      function pingHost(host) {
        exec("ping " + host)
      }
    `
    const findings = scanSourceFile("src/ping.ts", code)
    const rce = findings.filter((f) => f.cwe === "CWE-78")
    expect(rce.length).toBeGreaterThan(0)
    expect(rce[0]?.severity).toBe("critical")
  })

  it("detects Hardcoded Secrets & API Keys (CWE-798)", () => {
    const code = `
      const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwxyz1234567890abcdef"
      const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
    `
    const findings = scanSourceFile("src/secrets.ts", code)
    const secrets = findings.filter((f) => f.cwe === "CWE-798")
    expect(secrets.length).toBeGreaterThanOrEqual(1)
    expect(secrets[0]?.severity).toBe("high")
  })

  it("detects Path Traversal (CWE-22)", () => {
    const code = `
      const fs = require('fs')
      function readFile(userPath) {
        return fs.readFileSync("../public/" + userPath)
      }
    `
    const findings = scanSourceFile("src/file.js", code)
    const traversal = findings.filter((f) => f.cwe === "CWE-22")
    expect(traversal.length).toBeGreaterThan(0)
  })

  it("returns zero findings for benign code", () => {
    const cleanCode = `
      export function add(a: number, b: number): number {
        return a + b
      }
    `
    const findings = scanSourceFile("src/math.ts", cleanCode)
    expect(findings.length).toBe(0)
  })
})

describe("Cybersecurity Suite - Checksec Binary Auditor", () => {
  it("audits Windows PE binaries correctly", () => {
    const nativeExe = path.resolve(__dirname, "../../native/navi-native/target/release/navi-native.exe")
    if (fs.existsSync(nativeExe)) {
      const audit = checksecBinary(nativeExe)
      expect(audit.format).toBe("pe")
      expect(audit.nx).toBe(true) // DEP / NX enabled by Rust/MSVC
      expect(audit.pie).toBe(true) // ASLR enabled by default
      expect(audit.securityScore).toBeGreaterThanOrEqual(50)
    }
  })

  it("fails gracefully on invalid or empty binary files", () => {
    const tempFile = path.resolve(__dirname, "temp_dummy.bin")
    fs.writeFileSync(tempFile, Buffer.from("NOT_A_VALID_BINARY_HEADER"))
    try {
      expect(() => checksecBinary(tempFile)).toThrow()
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    }
  })
})

describe("Cybersecurity Suite - Web & JWT Security", () => {
  it("flags 'alg: none' vulnerability in JWT as CRITICAL", () => {
    // Header: {"alg":"none","typ":"JWT"} -> eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0
    // Payload: {"sub":"admin","role":"root"} -> eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJyb290In0
    const unsignedJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJyb290In0."
    const audit = auditJwt(unsignedJwt)

    expect(audit.validStructure).toBe(true)
    const algNone = audit.vulnerabilities.find((v) => v.title.includes("'none'"))
    expect(algNone).toBeDefined()
    expect(algNone?.severity).toBe("critical")
  })

  it("flags expired tokens and missing expiry claims", () => {
    // Header: {"alg":"HS256","typ":"JWT"} -> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    // Payload: {"sub":"user123","exp":1500000000} -> eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjoxNTAwMDAwMDAwfQ
    const expiredJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjoxNTAwMDAwMDAwfQ.signature"
    const audit = auditJwt(expiredJwt)

    expect(audit.validStructure).toBe(true)
    expect(audit.claims.isExpired).toBe(true)
    const expiredVuln = audit.vulnerabilities.find((v) => v.title.includes("Expired"))
    expect(expiredVuln).toBeDefined()
  })

  it("audits missing security headers and calculates security score", () => {
    const insecureHeaders = {
      "content-type": "text/html",
      "server": "Apache/2.4.41 (Ubuntu)",
      "x-powered-by": "PHP/7.4.3",
    }

    const audit = auditSecurityHeaders("http://insecure-example.local", insecureHeaders)
    expect(audit.score).toBeLessThan(50)
    expect(audit.missingHeaders).toContain("Content-Security-Policy")
    expect(audit.missingHeaders).toContain("Strict-Transport-Security")
    expect(audit.missingHeaders).toContain("X-Frame-Options")

    const infoDisclosure = audit.vulnerabilities.filter((v) => v.title.includes("Information Disclosure"))
    expect(infoDisclosure.length).toBeGreaterThanOrEqual(1)
  })

  it("recognizes hardened security headers", () => {
    const hardenedHeaders = {
      "content-security-policy": "default-src 'self'",
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    }

    const audit = auditSecurityHeaders("https://secure.example.com", hardenedHeaders)
    expect(audit.score).toBe(100)
    expect(audit.missingHeaders.length).toBe(0)
    expect(audit.vulnerabilities.length).toBe(0)
  })
})
