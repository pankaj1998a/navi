import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_PLAN from "./prompt/plan.txt"
import PROMPT_CODING from "./prompt/coding.txt"
import PROMPT_ARCHITECT from "./prompt/architect.txt"
import PROMPT_ASK from "./prompt/ask.txt"
import PROMPT_DEBUG from "./prompt/debug.txt"
import PROMPT_TESTER from "./prompt/tester.txt"
import PROMPT_REFACTOR from "./prompt/refactor.txt"
import PROMPT_REVIEW from "./prompt/review.txt"
import PROMPT_ORGANIZER from "./prompt/organizer.txt"
import PROMPT_ROUTER from "./prompt/router.txt"
import PROMPT_FRONTEND from "./prompt/frontend.txt"
import PROMPT_MULTIMODAL from "./prompt/multimodal.txt"
import PROMPT_RESEARCHER from "./prompt/researcher.txt"
import PROMPT_INVESTIGATOR from "./prompt/investigator.txt"
import PROMPT_BACKEND from "./prompt/backend.txt"
import PROMPT_DEVOPS from "./prompt/devops.txt"
import PROMPT_SECURITY from "./prompt/security.txt"
import PROMPT_PENTESTER from "./prompt/pentester.txt"
import PROMPT_QA from "./prompt/qa.txt"
import PROMPT_DOCUMENTATION from "./prompt/documentation.txt"
import PROMPT_DATABASE from "./prompt/database.txt"
import PROMPT_MOBILE from "./prompt/mobile.txt"
import PROMPT_SISYPHUS from "./prompt/sisyphus.txt"
import PROMPT_SALES from "./prompt/sales.txt"
import PROMPT_PRODUCT from "./prompt/product.txt"
import PROMPT_SUPPORT from "./prompt/support.txt"
import PROMPT_ANALYST from "./prompt/analyst.txt"
import PROMPT_LEAD_GENERATOR from "./prompt/lead-generator.txt"
import PROMPT_CONTENT_CREATOR from "./prompt/content-creator.txt"
import PROMPT_YOUTUBE_AGENT from "./prompt/youtube-agent.txt"
import PROMPT_TRAVEL_AGENT from "./prompt/travel-agent.txt"
import PROMPT_REAL_ESTATE from "./prompt/real-estate.txt"
import PROMPT_UX_RESEARCHER from "./prompt/ux-researcher.txt"
import PROMPT_VISUAL_STORYTELLER from "./prompt/visual-storyteller.txt"
import PROMPT_FINANCE from "./prompt/finance.txt"
import PROMPT_LEGAL from "./prompt/legal.txt"
import PROMPT_PERFORMANCE from "./prompt/performance.txt"
import PROMPT_COACH from "./prompt/coach.txt"
import PROMPT_AUTOMATOR from "./prompt/automator.txt"
import PROMPT_MARKETING from "./prompt/marketing.txt"
import PROMPT_SOCIAL from "./prompt/social.txt"
import PROMPT_SURFER from "./prompt/surfer.txt"
import PROMPT_RALPH from "./prompt/ralph.txt"
import PROMPT_SPECS from "./prompt/specs.txt"
import PROMPT_RALPH_PHILOSOPHY from "./prompt/ralph_philosophy.txt"
import PROMPT_VIBEMODE from "./prompt/vibemode.txt"
import PROMPT_PLAN_CEO_REVIEW from "./prompt/plan-ceo-review.txt"
import PROMPT_PLAN_ENG_REVIEW from "./prompt/plan-eng-review.txt"
import PROMPT_BROWSE from "./prompt/browse.txt"
import PROMPT_QA_ONLY from "./prompt/qa-only.txt"
import PROMPT_SHIP from "./prompt/ship.txt"
import PROMPT_RETRO from "./prompt/retro.txt"
import PROMPT_SETUP_BROWSER_COOKIES from "./prompt/setup-browser-cookies.txt"
import PROMPT_INTERACTION_PROTOCOL from "./prompt/interaction-protocol.txt"
import PROMPT_AUTORESEARCH_PROTOCOL from "./prompt/autoresearch-protocol.txt"
import PROMPT_AUTORESEARCH_AGENT from "./prompt/autoresearch-agent.txt"
import { buildAgentContract, renderSubagentContractSection } from "./contract"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy } from "remeda"
import { SkillManager } from "../skill/manager"
import { Global } from "../global"
import path from "path"
import { AgentStore } from "./store"
import { Awareness } from "./awareness"
import { AgentPolicy } from "./policy"

import { EditorAgent } from "./definitions/editor"

import { AgentInfo } from "./info"

export namespace Agent {
  export const skillManager = new SkillManager(path.join(Global.Path.state, "skills"))
  export const Info = AgentInfo
  export type Info = z.infer<typeof Info>

  const DEFAULT_SKILLS = ["verification-before-completion"]
  const AGENT_SKILLS: Record<string, string[]> = {
    plan: [...DEFAULT_SKILLS, "writing-plans", "executing-plans"],
    build: [...DEFAULT_SKILLS, "feature-dev", "subagent-driven-development", "using-git-worktrees", "executing-plans"],
    autoresearch: [...DEFAULT_SKILLS, "brainstorming", "writing-plans"],
    specs: [...DEFAULT_SKILLS, "writing-plans", "executing-plans"],
    ask: [...DEFAULT_SKILLS, "receiving-code-review", "requesting-code-review"],
    vibemode: [...DEFAULT_SKILLS, "executing-plans", "subagent-driven-development", "writing-plans", "using-superpowers"],
    general: [...DEFAULT_SKILLS, "subagent-driven-development", "executing-plans", "writing-plans"],
    explore: [...DEFAULT_SKILLS, "brainstorming"],
    debug: [...DEFAULT_SKILLS, "systematic-debugging", "test-driven-development"],
    researcher: [...DEFAULT_SKILLS, "brainstorming", "writing-plans"],
    investigator: [...DEFAULT_SKILLS, "brainstorming", "writing-plans", "executing-plans", "verification-before-completion"],
    tester: [...DEFAULT_SKILLS, "test-driven-development"],
    refactor: [...DEFAULT_SKILLS, "using-git-worktrees", "finishing-a-development-branch"],
    review: [...DEFAULT_SKILLS, "pr-review", "receiving-code-review"],
    critic: [...DEFAULT_SKILLS, "receiving-code-review", "verification-before-completion"],
    "factual-verifier": [...DEFAULT_SKILLS, "receiving-code-review", "verification-before-completion"],
    "regression-verifier": [...DEFAULT_SKILLS, "test-driven-development", "verification-before-completion"],
    "ui-verifier": [...DEFAULT_SKILLS, "verification-before-completion", "canvas-design"],
    "security-verifier": [...DEFAULT_SKILLS, "pr-review", "verification-before-completion"],
    organizer: [...DEFAULT_SKILLS, "executing-plans", "writing-plans"],
    coding: [...DEFAULT_SKILLS, "feature-dev", "subagent-driven-development", "using-git-worktrees", "test-driven-development"],
    frontend: [...DEFAULT_SKILLS, "feature-dev", "canvas-design", "verification-before-completion"],
    backend: [...DEFAULT_SKILLS, "feature-dev", "executing-plans"],
    devops: [...DEFAULT_SKILLS, "executing-plans", "using-git-worktrees"],
    security: [...DEFAULT_SKILLS, "pr-review", "receiving-code-review"],
    pentester: [...DEFAULT_SKILLS, "pr-review", "qa"],
    qa: [...DEFAULT_SKILLS, "test-driven-development"],
    documentation: [...DEFAULT_SKILLS, "content-research-writer"],
    database: [...DEFAULT_SKILLS, "executing-plans"],
    mobile: [...DEFAULT_SKILLS, "feature-dev"],
    multimodal: [...DEFAULT_SKILLS, "verification-before-completion"],
    performance: [...DEFAULT_SKILLS, "verification-before-completion"],
    coach: [...DEFAULT_SKILLS, "writing-plans", "executing-plans"],
    automator: [...DEFAULT_SKILLS, "using-superpowers"],
    "lead-generator": [...DEFAULT_SKILLS, "lead-research-assistant"],
    "content-creator": [...DEFAULT_SKILLS, "content-research-writer"],
    "youtube-agent": [...DEFAULT_SKILLS, "content-research-writer"],
    "travel-agent": [...DEFAULT_SKILLS, "brainstorming"],
    "real-estate": [...DEFAULT_SKILLS, "brainstorming"],
    "ux-researcher": [...DEFAULT_SKILLS, "brainstorming", "canvas-design"],
    "visual-storyteller": [...DEFAULT_SKILLS, "canvas-design"],
    finance: [...DEFAULT_SKILLS, "brainstorming"],
    legal: [...DEFAULT_SKILLS, "verification-before-completion"],
    sales: [...DEFAULT_SKILLS, "brainstorming"],
    support: [...DEFAULT_SKILLS, "brainstorming"],
    analyst: [...DEFAULT_SKILLS, "brainstorming"],
    marketing: [...DEFAULT_SKILLS, "brainstorming"],
    social: [...DEFAULT_SKILLS, "brainstorming"],
    surfer: [...DEFAULT_SKILLS, "brainstorming"],
    ralph: [...DEFAULT_SKILLS, "subagent-driven-development", "executing-plans", "using-superpowers"],
  }

  const INTERACTION_PROTOCOL_MARKER = "## Shared Interaction Protocol"
  const AUTORESEARCH_PROTOCOL_MARKER = "## AutoResearch Protocol"
  const SUBAGENT_CONTRACT_MARKER = "## Subagent Contract"
  const RESEARCH_PROTOCOL_AGENTS = new Set([
    "ask",
    "specs",
    "vibemode",
    "researcher",
    "autoresearch",
    "surfer",
    "browse",
    "explore",
    "investigator",
    "analyst",
    "documentation",
    "product",
    "ux-researcher",
  ])

  function appendPromptSection(prompt: string | undefined, section: string, marker: string) {
    if (!prompt) return section
    if (prompt.includes(marker)) return prompt
    return [prompt, section].filter(Boolean).join("\n\n")
  }

  const state = Instance.state(async () => {

    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})
    const storedAgents = await AgentStore.list().catch(() => {
      return []
    })
    const providerMap = await Provider.list().catch(() => ({} as Record<string, Provider.Info>))
    const vibemodeModelGuide = Awareness.buildVibemodeModelGuide(Object.values(providerMap))

    const result: Record<string, Info> = {
      build: {
        name: "build",
        mode: "primary",
        native: true,
        options: {},
        description: "World-class senior software engineer for production-ready code. Can orchestrate parallel agents and swarms for complex tasks.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            state_tracker: "allow",
            quick_task: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
            gsd_todo: "allow",
            map_codebase: "allow",
          }),
          user,
        ),
        prompt: PROMPT_CODING + "\n\n" + PROMPT_RALPH_PHILOSOPHY,
      },
      specs: {
        name: "specs",
        mode: "primary",
        native: true,
        options: {},
        description: "VIBEMODE v3.1 — AI-Swarm orchestrator with 6-agent discussions, 3-layer quality gates, auto-fix pipeline, and code minimalism for building complete projects.",
        prompt: PROMPT_SPECS + "\n\n" + PROMPT_RALPH_PHILOSOPHY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            websearch: "allow",
            webfetch: "allow",
            codesearch: "allow",
            write: "allow",
            edit: "allow",
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            state_tracker: "allow",
            quick_task: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
            gsd_todo: "allow",
            map_codebase: "allow",
            browser_action: "allow",
          }),
          user,
        ),
      },
      "plan-ceo-review": {
        name: "plan-ceo-review",
        mode: "subagent",
        native: true,
        options: {},
        description: "Product-level reviewer that reframes the request, challenges assumptions, and defines the strongest small version before coding.",
        prompt: PROMPT_PLAN_CEO_REVIEW,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            map_codebase: "allow",
            websearch: "allow",
            webfetch: "allow",
          }),
          user,
        ),
      },
      "plan-eng-review": {
        name: "plan-eng-review",
        mode: "subagent",
        native: true,
        options: {},
        description: "Technical architecture reviewer that validates the plan, risks, edge cases, and test strategy.",
        prompt: PROMPT_PLAN_ENG_REVIEW,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            map_codebase: "allow",
            websearch: "allow",
            webfetch: "allow",
          }),
          user,
        ),
      },
      browse: {
        name: "browse",
        mode: "subagent",
        native: true,
        options: {},
        description: "Browser validation specialist that checks the real UI, interaction flow, and visible regressions.",
        prompt: PROMPT_BROWSE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            browser_action: "allow",
          }),
          user,
        ),
      },
      "qa-only": {
        name: "qa-only",
        mode: "subagent",
        native: true,
        options: {},
        description: "Read-only QA specialist that reports bugs without editing code.",
        prompt: PROMPT_QA_ONLY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            browser_action: "allow",
            edit: "deny",
            write: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      ship: {
        name: "ship",
        mode: "subagent",
        native: true,
        options: {},
        description: "Release-focused agent that syncs, verifies, resolves blockers, and prepares a branch for shipping.",
        prompt: PROMPT_SHIP,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            write: "allow",
            edit: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
          }),
          user,
        ),
      },
      retro: {
        name: "retro",
        mode: "subagent",
        native: true,
        options: {},
        description: "Retrospective facilitator that turns completed work into process improvements.",
        prompt: PROMPT_RETRO,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            websearch: "allow",
          }),
          user,
        ),
      },
      "setup-browser-cookies": {
        name: "setup-browser-cookies",
        mode: "subagent",
        native: true,
        options: {},
        description: "Session setup agent for authenticated browser testing and cookie import.",
        prompt: PROMPT_SETUP_BROWSER_COOKIES,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            browser_action: "allow",
          }),
          user,
        ),
      },

      general: {
        name: "general",
        mode: "subagent",
        native: true,
        options: {},
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        prompt: PROMPT_SISYPHUS,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
            map_codebase: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
          }),
          user,
        ),
      },
      explore: {
        name: "explore",
        mode: "subagent",
        native: true,
        options: {},
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
      },
      investigator: {
        name: "investigator",
        mode: "subagent",
        native: true,
        options: {},
        description: "Large-codebase analysis and mapping specialist that builds phone-directory style symbol indexes, traces module relationships, and localizes issues quickly.",
        prompt: PROMPT_INVESTIGATOR,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            map_codebase: "allow",
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            codesearch: "allow",
            investigate: "allow",
            ast_grep: "allow",
            bash: "allow",
            websearch: "allow",
            webfetch: "allow",
          }),
          user,
        ),
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
      ask: {
        name: "ask",
        mode: "primary",
        native: true,
        options: {},
        description: "Expert at understanding and explaining codebases. Can orchestrate parallel agents for research and analysis. File modifications require explicit user permission.",
        prompt: PROMPT_ASK + "\n\n" + PROMPT_RALPH_PHILOSOPHY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            write: "ask",
            edit: "ask",
            bash: "ask",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            state_tracker: "allow",
            quick_task: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
            gsd_todo: "allow",
            map_codebase: "allow",
          }),
          user,
        ),
      },
      plan: {
        name: "plan",
        mode: "primary",
        native: true,
        options: {},
        description: "Strategic planner that turns complex requests into durable markdown plans under .navi/plan.",
        prompt: PROMPT_PLAN,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            state_tracker: "allow",
            quick_task: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
            gsd_todo: "allow",
            map_codebase: "allow",
            write: {
              "*": "deny",
              ".navi/plan/*": "allow",
            },
            edit: {
              "*": "deny",
              ".navi/plan/*": "allow",
            },
            bash: "deny",
          }),
          user,
        ),
      },
      vibemode: {
        name: "vibemode",
        mode: "primary",
        native: true,
        options: {},
        description: "👑 Avni — VibeMode Manager. Model-aware orchestrator that picks a Loop Lead and Gate Reviewer from active providers, then delegates execution to sub-agents. Never codes directly.",
        prompt: PROMPT_VIBEMODE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            // Communication & orchestration — ALL ALLOWED (Avni manages every sub-agent)
            question: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            state_tracker: "allow",
            quick_task: "allow",
            plan_phase: "allow",
            execute_phase: "allow",
            gsd_todo: "allow",
            // Research — ALLOWED (manager can research via swarm)
            websearch: "allow",
            webfetch: "allow",
            browser_action: "allow",
            // Project mapping — ALLOWED (manager needs project context)
            map_codebase: "allow",
            // Direct code/file operations — DENIED (except for .vibemode/ and .planning/ state)
            write: {
              "*": "deny",
              ".planning/*": "allow",
              ".vibemode/*": "allow",
            },
            edit: "deny",
            bash: "deny",
            read: {
              "*": "deny",
              ".planning/*": "allow",
              ".vibemode/*": "allow",
              "package.json": "allow",
              "README.md": "allow",
            },
            list: {
              "*": "deny",
              ".planning/*": "allow",
              ".vibemode/*": "allow",
            },
            glob: "deny",
            grep: "deny",
            codesearch: "deny",
          }),
          user,
        ),
      },
      debug: {
        name: "debug",
        mode: "subagent",
        native: true,
        options: {},
        description: "Assists in identifying and fixing issues within the code.",
        prompt: PROMPT_DEBUG,
        permission: PermissionNext.merge(defaults, user),
      },
      researcher: {
        name: "researcher",
        mode: "subagent",
        native: true,
        options: {},
        description: "Deep research orchestrator that uses iterative evidence loops and parallel sub-agents.",
        prompt: PROMPT_RESEARCHER,
        permission: PermissionNext.merge(defaults, user),
      },
      autoresearch: {
        name: "autoresearch",
        mode: "subagent",
        native: true,
        options: {},
        description: "Iterative research strategist that turns broad questions into evidence-backed conclusions through short experimental loops.",
        prompt: PROMPT_AUTORESEARCH_AGENT,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            browser_action: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
          }),
          user,
        ),
      },
      tester: {
        name: "tester",
        mode: "subagent",
        native: true,
        options: {},
        description: "Focused on writing tests, analyzing coverage, and ensuring code reliability.",
        prompt: PROMPT_TESTER,
        permission: PermissionNext.merge(defaults, user),
      },
      refactor: {
        name: "refactor",
        mode: "subagent",
        native: true,
        options: {},
        description: "Specialized in improving code structure without changing its behavior.",
        prompt: PROMPT_REFACTOR,
        permission: PermissionNext.merge(defaults, user),
      },
      review: {
        name: "review",
        mode: "subagent",
        native: true,
        options: {},
        description: "Expert at code review, quality assurance, and identifying potential issues.",
        prompt: PROMPT_REVIEW,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            edit: "deny",
            write: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      critic: {
        name: "critic",
        mode: "subagent",
        native: true,
        options: {},
        description: "High-signal adjudicator that compares competing proposals and resolves disagreements with evidence.",
        prompt: PROMPT_REVIEW + "\n\n## Adjudication Focus\nSynthesize multiple candidate answers, compare tradeoffs, identify the strongest option, and call out any unresolved risk before finalizing.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            agent: "allow",
            parallel: "allow",
            subagent: "allow",
            swarm: "allow",
            consensus: "allow",
            edit: "deny",
            write: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      "factual-verifier": {
        name: "factual-verifier",
        mode: "subagent",
        native: true,
        options: {},
        description: "Read-only fact checker that validates claims, source quality, and contradictions.",
        prompt:
          PROMPT_REVIEW +
          "\n\n## Verification Focus\nCheck factual claims against the codebase or sources, flag unsupported statements, and report contradictions with concise evidence.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            edit: "deny",
            write: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      "regression-verifier": {
        name: "regression-verifier",
        mode: "subagent",
        native: true,
        options: {},
        description: "Read-only regression checker that validates tests, reproducibility, and behavioral risk.",
        prompt:
          PROMPT_TESTER +
          "\n\n## Verification Focus\nFocus on regression risk, reproducibility, failing tests, coverage gaps, and clear pass/fail evidence.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: "deny",
            write: "deny",
          }),
          user,
        ),
      },
      "ui-verifier": {
        name: "ui-verifier",
        mode: "subagent",
        native: true,
        options: {},
        description: "Browser-first verifier for UI flow, layout, and interaction regressions.",
        prompt:
          PROMPT_BROWSE +
          "\n\n## Verification Focus\nInspect browser-visible output, interaction flow, responsive behavior, and screenshot-level regressions.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            browser_action: "allow",
            edit: "deny",
            write: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      "security-verifier": {
        name: "security-verifier",
        mode: "subagent",
        native: true,
        options: {},
        description: "Security verifier that checks for secrets, injection risk, and unsafe trust boundaries.",
        prompt:
          PROMPT_SECURITY +
          "\n\n## Verification Focus\nPrioritize secrets, auth boundaries, injection, data exposure, and exploitability. Return evidence-backed findings only.",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            bash: "allow",
            edit: "deny",
            write: "deny",
          }),
          user,
        ),
      },
      organizer: {
        name: "organizer",
        mode: "subagent",
        native: true,
        options: {},
        description: "Project Lead & Scrum Master. Coordinates the agent swarm for complex software projects.",
        prompt: PROMPT_ORGANIZER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
      },
      coding: {
        name: "coding",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior software engineer for high-quality implementation, refactoring, and bug fixes.",
        prompt: PROMPT_CODING,
        color: "#3b82f6",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            bash: "allow",
            write: "allow",
            edit: "allow",
          }),
          user,
        ),
      },
      frontend: {
        name: "frontend",
        mode: "subagent",
        native: true,
        options: {},
        description:
          "A designer-turned-developer who crafts stunning UI/UX even without design mockups. Specializes in visual changes: styling, layout, animation, responsive design. The visual output is always fire.",
        prompt: PROMPT_FRONTEND,
        permission: PermissionNext.merge(defaults, user),
      },
      backend: {
        name: "backend",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior backend engineer specialized in server-side logic, APIs, and databases.",
        prompt: PROMPT_BACKEND,
        permission: PermissionNext.merge(defaults, user),
      },
      devops: {
        name: "devops",
        mode: "subagent",
        native: true,
        options: {},
        description: "Infrastructure and deployment expert. Manages CI/CD and cloud resources.",
        prompt: PROMPT_DEVOPS,
        permission: PermissionNext.merge(defaults, user),
      },
      security: {
        name: "security",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior security engineer specialized in vulnerability research and auditing. Strictly read-only.",
        prompt: PROMPT_SECURITY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: "deny",
            bash: "allow",
          }),
          user,
        ),
      },
      pentester: {
        name: "pentester",
        mode: "subagent",
        native: true,
        options: {},
        description: "Ethical hacker and penetration tester. Finds vulnerabilities, data leaks, and security weaknesses. Use for pre-production security audits, OWASP testing, and local server pentesting.",
        prompt: PROMPT_PENTESTER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: "deny",
            write: "deny",
            bash: "allow",
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            websearch: "allow",
            webfetch: "allow",
            browser_action: "allow",
          }),
          user,
        ),
      },
      qa: {
        name: "qa",
        mode: "subagent",
        native: true,
        options: {},
        description: "Quality assurance and testing expert. Focused on coverage and reliability.",
        prompt: PROMPT_QA,
        permission: PermissionNext.merge(defaults, user),
      },
      documentation: {
        name: "documentation",
        mode: "subagent",
        native: true,
        options: {},
        description: "Technical writer specialized in clear, accurate, and structured documentation.",
        prompt: PROMPT_DOCUMENTATION,
        permission: PermissionNext.merge(defaults, user),
      },
      database: {
        name: "database",
        mode: "subagent",
        native: true,
        options: {},
        description: "Database administrator and optimization expert. Manages schemas and migrations.",
        prompt: PROMPT_DATABASE,
        permission: PermissionNext.merge(defaults, user),
      },
      mobile: {
        name: "mobile",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior mobile developer specialized in iOS/Android (React Native, Flutter).",
        prompt: PROMPT_MOBILE,
        permission: PermissionNext.merge(defaults, user),
      },
      multimodal: {
        name: "multimodal",
        mode: "subagent",
        native: true,
        options: {},
        temperature: 0.1,
        description:
          "Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. Extracts specific information or summaries from documents, describes visual content. Use when you need analyzed/extracted data rather than literal file contents.",
        prompt: PROMPT_MULTIMODAL,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            list: "allow",
            glob: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
      },
      sales: {
        name: "sales",
        mode: "subagent",
        native: true,
        options: {},
        description: "Sales intelligence, lead qualification, and outreach.",
        prompt: PROMPT_SALES,
        permission: PermissionNext.merge(defaults, user),
      },
      product: {
        name: "product",
        mode: "subagent",
        native: true,
        options: {},
        description: "Product management, user story definition, and roadmap planning.",
        prompt: PROMPT_PRODUCT,
        permission: PermissionNext.merge(defaults, user),
      },
      support: {
        name: "support",
        mode: "subagent",
        native: true,
        options: {},
        description: "Customer support, FAQ generation, and issue resolution.",
        prompt: PROMPT_SUPPORT,
        permission: PermissionNext.merge(defaults, user),
      },
      analyst: {
        name: "analyst",
        mode: "subagent",
        native: true,
        options: {},
        description: "Data analysis, visualization, and reporting.",
        prompt: PROMPT_ANALYST,
        permission: PermissionNext.merge(defaults, user),
      },
      "lead-generator": {
        name: "lead-generator",
        mode: "subagent",
        native: true,
        options: {},
        description: "Sales lead generation and data enrichment.",
        prompt: PROMPT_LEAD_GENERATOR,
        permission: PermissionNext.merge(defaults, user),
      },
      "content-creator": {
        name: "content-creator",
        mode: "subagent",
        native: true,
        options: {},
        description: "Cross-platform content generation specialist.",
        prompt: PROMPT_CONTENT_CREATOR,
        permission: PermissionNext.merge(defaults, user),
      },
      "youtube-agent": {
        name: "youtube-agent",
        mode: "subagent",
        native: true,
        options: {},
        description: "YouTube content strategy, scriptwriting, and analysis.",
        prompt: PROMPT_YOUTUBE_AGENT,
        permission: PermissionNext.merge(defaults, user),
      },
      "travel-agent": {
        name: "travel-agent",
        mode: "subagent",
        native: true,
        options: {},
        description: "Travel planning, itinerary creation, and logistics.",
        prompt: PROMPT_TRAVEL_AGENT,
        permission: PermissionNext.merge(defaults, user),
      },
      "real-estate": {
        name: "real-estate",
        mode: "subagent",
        native: true,
        options: {},
        description: "Real estate market analysis, property search, and investment insights.",
        prompt: PROMPT_REAL_ESTATE,
        permission: PermissionNext.merge(defaults, user),
      },
      "ux-researcher": {
        name: "ux-researcher",
        mode: "subagent",
        native: true,
        options: {},
        description: "User experience research, persona creation, and usability testing.",
        prompt: PROMPT_UX_RESEARCHER,
        permission: PermissionNext.merge(defaults, user),
      },
      "visual-storyteller": {
        name: "visual-storyteller",
        mode: "subagent",
        native: true,
        options: {},
        description: "Visual narrative creation, presentation design, and branding.",
        prompt: PROMPT_VISUAL_STORYTELLER,
        permission: PermissionNext.merge(defaults, user),
      },
      finance: {
        name: "finance",
        mode: "subagent",
        native: true,
        options: {},
        description: "Financial planning, budget tracking, and analysis.",
        prompt: PROMPT_FINANCE,
        permission: PermissionNext.merge(defaults, user),
      },
      legal: {
        name: "legal",
        mode: "subagent",
        native: true,
        options: {},
        description: "Legal compliance checking, agreement review, and research.",
        prompt: PROMPT_LEGAL,
        permission: PermissionNext.merge(defaults, user),
      },
      performance: {
        name: "performance",
        mode: "subagent",
        native: true,
        options: {},
        description: "System performance benchmarking, optimization, and analysis.",
        prompt: PROMPT_PERFORMANCE,
        permission: PermissionNext.merge(defaults, user),
      },
      coach: {
        name: "coach",
        mode: "subagent",
        native: true,
        options: {},
        description: "Team alignment, process improvement, and agile coaching.",
        prompt: PROMPT_COACH,
        permission: PermissionNext.merge(defaults, user),
      },
      automator: {
        name: "automator",
        mode: "subagent",
        native: true,
        options: {},
        description: "General purpose scripting and workflow automation.",
        prompt: PROMPT_AUTOMATOR,
        permission: PermissionNext.merge(defaults, user),
      },
      title: {
        name: "title",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        temperature: 0.5,
        prompt: PROMPT_TITLE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
      summary: {
        name: "summary",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        prompt: PROMPT_SUMMARY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
      item.categories = value.categories
      item.skills = value.skills ?? item.skills
      item.spawnableAgents = value.spawnableAgents ?? item.spawnableAgents
      item.executionPolicy = mergeDeep(item.executionPolicy ?? {}, value.executionPolicy ?? {})
    }

    // Merge stored agents
    for (const manifest of storedAgents) {
      const shortName = manifest.name.split("/").pop() || manifest.name
      // Don't overwrite config-defined agents
      if (result[shortName]) continue

      result[shortName] = {
        ...manifest.config,
        name: shortName,
        mode: manifest.config.mode || "primary",
        permission: PermissionNext.merge(defaults, PermissionNext.fromConfig(manifest.config.permission ?? {})),
        native: false,
        options: manifest.config.options || {},
      } as any
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    for (const [name, agent] of Object.entries(result)) {
      if (agent.skills?.length) continue
      agent.skills = AGENT_SKILLS[name] ?? DEFAULT_SKILLS
    }

    for (const agent of Object.values(result)) {
      agent.executionPolicy = AgentPolicy.resolve(agent.name, agent.executionPolicy)
      if (agent.hidden) continue
      agent.prompt = appendPromptSection(agent.prompt, PROMPT_INTERACTION_PROTOCOL, INTERACTION_PROTOCOL_MARKER)
      if (RESEARCH_PROTOCOL_AGENTS.has(agent.name)) {
        agent.prompt = appendPromptSection(agent.prompt, PROMPT_AUTORESEARCH_PROTOCOL, AUTORESEARCH_PROTOCOL_MARKER)
      }
      if (agent.mode === "subagent") {
        agent.contract = buildAgentContract(agent)
        agent.prompt = appendPromptSection(agent.prompt, renderSubagentContractSection(agent.name, agent.contract), SUBAGENT_CONTRACT_MARKER)
      }
      if (agent.name === "vibemode") {
        agent.prompt = appendPromptSection(agent.prompt, vibemodeModelGuide, "## Live model awareness")
      }
    }

    const vibemode = result.vibemode
    if (vibemode) {
      if (cfg.agent?.vibemode?.spawnableAgents === undefined) {
        vibemode.spawnableAgents = Array.from(
          new Set(
            Object.values(result)
              .filter((agent) => agent.mode === "subagent" && !agent.hidden)
              .map((agent) => agent.name),
          ),
        )
      }
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list(): Promise<Info[]> {
    const cfg = await Config.get()
    const agents = await state()
    return pipe(
      Object.values(agents),
      sortBy([(x: Info) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    ) as Info[]
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      // Fallback if config points to invalid agent
      if (agent && agent.mode !== "subagent" && !agent.hidden) {
        return agent.name
      }
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) return Object.keys(agents)[0]
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const result = await generateObject({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }

  export async function activateSkill(skillName: string): Promise<string> {
    const skill = skillManager.getSkill(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    return skill.instructions
  }
}
