import { describe, expect, it } from "bun:test"
import { CronScheduler } from "@/scheduler/runner"
import { parseCronExpression, cronToHuman, isValidCron } from "@/scheduler/cron"
import { validateSyntax } from "@/tool/edit"
import { detectFramework, buildCommand } from "@/tool/test-runner"
import PROMPT_GOAL from "@/command/template/goal.txt"
import PROMPT_SCHEDULE from "@/command/template/schedule.txt"
import PROMPT_GRILL_ME from "@/command/template/grill_me.txt"
import PROMPT_LEARN from "@/command/template/learn.txt"
import PROMPT_REVIEWER from "@/agent/prompt/reviewer.txt"
import PROMPT_TDD from "@/agent/prompt/tdd.txt"
import PROMPT_BRIDGE from "@/agent/prompt/bridge.txt"

describe("new agent tools and features", () => {
  describe("cron and scheduler", () => {
    it("parses valid 5-field cron expressions", () => {
      expect(isValidCron("*/5 * * * *")).toBe(true)
      expect(isValidCron("0 12 * * 1-5")).toBe(true)
      expect(isValidCron("invalid cron")).toBe(false)
      expect(isValidCron("* * *")).toBe(false)
    })

    it("converts cron expressions to human-readable strings", () => {
      expect(cronToHuman("*/5 * * * *")).toBe("Every 5 minutes")
      expect(cronToHuman("0 * * * *")).toBe("Every hour")
      expect(cronToHuman("0 0 * * *")).toContain("Every day")
    })

    it("schedules, lists, and removes cron jobs via CronScheduler", async () => {
      const job = await CronScheduler.add({
        name: "test-health-check",
        description: "Test health check",
        expression: "*/10 * * * *",
        command: "echo 'ok'",
      })

      expect(job.id).toBeDefined()
      expect(job.name).toBe("test-health-check")
      expect(job.enabled).toBe(true)

      const jobs = CronScheduler.list()
      expect(jobs.some((j) => j.id === job.id)).toBe(true)

      await CronScheduler.remove(job.id)
      const afterJobs = CronScheduler.list()
      expect(afterJobs.some((j) => j.id === job.id)).toBe(false)
    })
  })

  describe("slash command templates", () => {
    it("loads /goal template", () => {
      expect(PROMPT_GOAL).toContain("$ARGUMENTS")
      expect(PROMPT_GOAL).toContain("autonomous goal")
    })

    it("loads /schedule template", () => {
      expect(PROMPT_SCHEDULE).toContain("$ARGUMENTS")
      expect(PROMPT_SCHEDULE).toContain("cron")
    })

    it("loads /grill-me template", () => {
      expect(PROMPT_GRILL_ME).toContain("$ARGUMENTS")
      expect(PROMPT_GRILL_ME).toContain("architect")
    })

    it("loads /learn template", () => {
      expect(PROMPT_LEARN).toContain("$ARGUMENTS")
      expect(PROMPT_LEARN).toContain("AGENTS.md")
    })
  })

  describe("syntax validation hook", () => {
    it("validates valid JSON", () => {
      expect(validateSyntax("config.json", '{"name": "navi", "version": 2}')).toBeNull()
    })

    it("catches invalid JSON syntax", () => {
      const err = validateSyntax("config.json", '{"name": "navi", invalid}')
      expect(err).not.toBeNull()
      expect(err).toContain("JSON Syntax Error")
    })

    it("validates valid TypeScript/JavaScript", () => {
      expect(validateSyntax("app.ts", "const x: number = 42;\nexport default x;")).toBeNull()
    })

    it("catches TypeScript syntax error", () => {
      const err = validateSyntax("app.ts", "const x: = ;")
      expect(err).not.toBeNull()
      expect(err).toContain("Syntax Error")
    })
  })

  describe("test runner framework detection & commands", () => {
    it("builds correct bun test command", () => {
      const { display } = buildCommand("bun", "test/auth.test.ts", "login")
      expect(display).toBe("bun test test/auth.test.ts --test-name-pattern login")
    })

    it("builds correct vitest command", () => {
      const { display } = buildCommand("vitest", "src/auth.test.ts")
      expect(display).toBe("npx vitest run src/auth.test.ts")
    })

    it("builds correct pytest command", () => {
      const { display } = buildCommand("pytest", "tests/test_api.py", "test_auth")
      expect(display).toBe("pytest tests/test_api.py -k test_auth")
    })
  })

  describe("subagent prompts (@reviewer, @tdd, @bridge)", () => {
    it("loads reviewer prompt with security and correctness audits", () => {
      expect(PROMPT_REVIEWER).toContain("Navi Reviewer")
      expect(PROMPT_REVIEWER).toContain("Security Audit")
      expect(PROMPT_REVIEWER).toContain("AGENTS.md")
    })

    it("loads tdd prompt with Red-Green-Refactor protocol", () => {
      expect(PROMPT_TDD).toContain("Navi TDD")
      expect(PROMPT_TDD).toContain("RED")
      expect(PROMPT_TDD).toContain("GREEN")
      expect(PROMPT_TDD).toContain("REFACTOR")
    })

    it("loads bridge prompt with strict 1-site-at-a-time and page closure rules", () => {
      expect(PROMPT_BRIDGE).toContain("Navi Bridge")
      expect(PROMPT_BRIDGE).toContain("One Website at a Time")
      expect(PROMPT_BRIDGE).toContain("Mandatory Page Closure")
    })
  })
})
