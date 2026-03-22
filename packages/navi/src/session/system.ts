import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"

import { Instance } from "../project/instance"
import path from "path"
import os from "os"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_CODEX_INSTRUCTIONS from "./prompt/codex_header.txt"
import type { Provider } from "@/provider/provider"
import { Flag } from "@/flag/flag"
import { ProviderHealth } from "@/provider/health"
import { getVerificationProfile } from "@/eval/catalog"

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function instructions() {
    return PROMPT_CODEX_INSTRUCTIONS.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment() {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${project.vcs === "git" && false
          ? await Ripgrep.tree({
            cwd: Instance.directory,
            limit: 200,
          })
          : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  const LOCAL_RULE_FILES = [
    "NAVI.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "CONTEXT.md", // deprecated
  ]
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.NAVI_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  if (Flag.NAVI_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.NAVI_CONFIG_DIR, "AGENTS.md"))
  }

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    for (const localRuleFile of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((path) => paths.add(path))
        break
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    const urls: string[] = []
    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
          continue
        }
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        let matches: string[] = []
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const foundFiles = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    const foundUrls = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )
    return Promise.all([...foundFiles, ...foundUrls]).then((result) => result.filter(Boolean))
  }

  export async function specs() {
    // Read flat file structure (new style)
    const flatFiles = [
      "specs/requirements.md",
      "specs/design.md",
      "specs/research.md",
      "specs/tasks.md",
      "specs/state.md",
      "specs/session.json",
      "specs/patterns.md"
    ]

    // Read legacy structure (for backward compatibility)
    const legacyFiles = ["specs/PROJECT.md", "specs/ROADMAP.md", "specs/STATE.md"]

    const results: string[] = []

    // Try flat files first
    for (const file of flatFiles) {
      const filepath = path.join(Instance.worktree, file)
      const content = await Bun.file(filepath).text().catch(() => undefined)
      if (content) {
        results.push(`Project Spec (${file}):\n${content}`)
      }
    }

    // Fall back to legacy files if no flat files found
    if (results.length === 0) {
      for (const file of legacyFiles) {
        const filepath = path.join(Instance.worktree, file)
        const content = await Bun.file(filepath).text().catch(() => undefined)
        if (content) {
          results.push(`Project Spec (${file}):\n${content}`)
        }
      }
    }

    return results
  }
  export async function awareness() {
    const { Awareness } = await import("../agent/awareness")
    const status = await Awareness.status()
    const providerHealth = await ProviderHealth.list()
    return [
      `<awareness>`,
      `  Active Models: ${status.active}`,
      `  Providers: ${Object.keys(status.providers).join(", ")}`,
      `  Favorite Models: ${status.favorites.length ? status.favorites.join(", ") : "None"}`,
      `  Provider Health: ${providerHealth.map((item) => `${item.providerID}=${item.status}:${item.score}`).join(", ") || "None"}`,
      `</awareness>`,
    ]
  }

  export async function pinned(sessionID: string) {
    const { SessionPin } = await import("./pin")
    const files = await SessionPin.list(sessionID)
    if (files.length === 0) return []

    const contents = await Promise.all(files.map(async f => {
      const text = await Bun.file(path.join(Instance.worktree, f)).text().catch(() => "Error reading file")
      return `<pinned_file path="${f}">\n${text}\n</pinned_file>`
    }))

    return [
      `<pinned_context>`,
      ...contents,
      `</pinned_context>`
    ]
  }

  export function verification(agentName: string) {
    const profile = getVerificationProfile(agentName)
    if (!profile) return []

    return [
      [
        `<verification_profile mode="${profile.mode}">`,
        `You must satisfy these verification gates before finalizing unless the user explicitly narrows scope or a blocker prevents verification:`,
        ...profile.gates.map((gate) => `- [${gate.required ? "required" : "optional"}] ${gate.id}: ${gate.description}`),
        `If a required gate cannot be satisfied, say so explicitly in the final answer and explain why.`,
        `</verification_profile>`,
      ].join("\n"),
    ]
  }

  export function orchestration(agentName: string) {
    if (agentName !== "vibemode") return []

    return [
      [
        `<orchestration_profile mode="vibemode">`,
        `You are acting as an orchestrator, not a direct implementer.`,
        `Follow this execution order unless the user explicitly narrows scope:`,
        `1. Plan the next chunk of work before delegating.`,
        `2. Delegate implementation or research to subagents with narrow scopes.`,
        `3. Run a reviewer or QA pass before finalizing a task chunk.`,
        `4. If verification fails, retry with clearer delegation or escalate with a blocker.`,
        `5. Stop when the requested outcome is verified, or when a blocker is explicit and actionable.`,
        `Do not keep delegating without improving the plan, the evidence, or the verification state.`,
        `If subagents are thrashing, summarize the blocker and ask the user for steering instead of looping.`,
        `</orchestration_profile>`,
      ].join("\n"),
    ]
  }
}
