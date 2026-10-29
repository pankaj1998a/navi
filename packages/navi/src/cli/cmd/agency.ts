import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import {
  loadAgencyCatalog,
  searchAgents,
  getAgentPrompt,
  listDivisions,
} from "@/agent/agency"

export const AgencyCommand = effectCmd({
  command: "agency [action] [arg]",
  describe: "Interact with The Agency's 282 AI specialists and NEXUS multi-agent pipeline",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action: 'list' (list agents), 'search' (search agents), 'info' (view agent details), 'divisions' (view divisions), 'nexus' (orchestration)",
        choices: ["list", "search", "info", "divisions", "nexus"] as const,
        default: "divisions",
      })
      .positional("arg", {
        describe: "Query for search, agent ID for info, or division name for list",
        type: "string",
      })
      .option("division", {
        alias: "d",
        describe: "Filter list or search by division (e.g. engineering, design, testing, security)",
        type: "string",
      })
      .option("limit", {
        alias: "l",
        describe: "Maximum results to display",
        type: "number",
        default: 20,
      }),
  handler: Effect.fn("Cli.agency")(function* (args) {
    const action = args.action || "divisions"
    const arg = args.arg ? String(args.arg) : ""

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  🎭 The Agency — 282 AI Specialists Roster & NEXUS Doctrine")
    UI.empty()

    if (action === "divisions") {
      const divs = listDivisions()
      const total = divs.reduce((acc, d) => acc + d.agentCount, 0)
      UI.println(UI.Style.TEXT_NORMAL + `  Total Divisions: ${divs.length} | Total Agents: ${total}\n`)
      UI.println(UI.Style.TEXT_DIM + "  DIVISIONS:")
      for (const d of divs) {
        UI.println(`    • ${d.label.padEnd(22)} [${d.id.padEnd(20)}] ${d.agentCount.toString().padStart(3)} agents`)
      }
      UI.println(UI.Style.TEXT_DIM + `\n  Explore a division: navi agency list <division-name>`)
      UI.println(UI.Style.TEXT_DIM + `  Search all agents:  navi agency search <keywords>`)
      return
    }

    if (action === "list") {
      const division = arg || args.division
      const catalog = loadAgencyCatalog()
      const filtered = division
        ? catalog.filter((a) => a.division.toLowerCase() === division.toLowerCase())
        : catalog

      if (filtered.length === 0) {
        UI.println(UI.Style.TEXT_WARNING + `  No agents found${division ? ` in division '${division}'` : ""}.`)
        return
      }

      UI.println(
        UI.Style.TEXT_NORMAL +
          `  Agents${division ? ` in [${division.toUpperCase()}]` : ""}: ${filtered.length} found (showing up to ${args.limit}):\n`,
      )

      for (const a of filtered.slice(0, args.limit)) {
        UI.println(`  ${a.emoji} ${UI.Style.TEXT_INFO_BOLD}${a.name}${UI.Style.TEXT_NORMAL} (\`${a.id}\`)`)
        if (a.vibe) {
          UI.println(`     ${UI.Style.TEXT_DIM}Vibe: ${a.vibe}`)
        } else if (a.description) {
          UI.println(`     ${UI.Style.TEXT_DIM}${a.description.slice(0, 90)}...`)
        }
      }

      if (filtered.length > args.limit) {
        UI.println(UI.Style.TEXT_DIM + `\n  ...and ${filtered.length - args.limit} more agents.`)
      }
      UI.println(UI.Style.TEXT_DIM + `\n  View details: navi agency info <agent-id>`)
      return
    }

    if (action === "search") {
      const query = arg || ""
      const division = args.division
      const results = searchAgents(query, division, args.limit)

      if (results.length === 0) {
        UI.println(UI.Style.TEXT_WARNING + `  No matching agents found for "${query}".`)
        return
      }

      UI.println(
        UI.Style.TEXT_NORMAL +
          `  Found ${results.length} matching agents for "${query}" (Rust search accelerator):\n`,
      )

      for (const r of results) {
        const a = r.agent
        UI.println(`  ${a.emoji} ${UI.Style.TEXT_INFO_BOLD}${a.name}${UI.Style.TEXT_NORMAL} [${a.division}] (\`${a.id}\`)`)
        if (a.vibe) {
          UI.println(`     ${UI.Style.TEXT_DIM}${a.vibe}`)
        } else if (a.description) {
          UI.println(`     ${UI.Style.TEXT_DIM}${a.description.slice(0, 100)}...`)
        }
      }

      UI.println(UI.Style.TEXT_DIM + `\n  Inspect agent: navi agency info <agent-id>`)
      return
    }

    if (action === "info") {
      if (!arg) {
        UI.println(UI.Style.TEXT_DANGER + "  Please specify an agent ID or name: navi agency info <agent-id>")
        return
      }

      const catalog = loadAgencyCatalog()
      const searchKey = arg.toLowerCase()
      const agent = catalog.find(
        (a) =>
          a.id.toLowerCase() === searchKey ||
          a.name.toLowerCase() === searchKey ||
          a.id.toLowerCase().endsWith("-" + searchKey) ||
          a.name.toLowerCase().replace(/\s+/g, "-") === searchKey,
      )

      if (!agent) {
        UI.println(UI.Style.TEXT_DANGER + `  Agent '${arg}' not found in catalog. Run 'navi agency search ${arg}'`)
        return
      }

      UI.println(`  ${agent.emoji} ${UI.Style.TEXT_INFO_BOLD}${agent.name}${UI.Style.TEXT_NORMAL}`)
      UI.println(`  • ID:          \`${agent.id}\``)
      UI.println(`  • Division:    ${agent.division}`)
      UI.println(`  • Color:       ${agent.color}`)
      if (agent.vibe) {
        UI.println(`  • Vibe:        "${agent.vibe}"`)
      }
      if (agent.description) {
        UI.println(`  • Description: ${agent.description}`)
      }

      const prompt = getAgentPrompt(agent.id)
      if (prompt) {
        UI.println(UI.Style.TEXT_DIM + `\n  --- SYSTEM INSTRUCTIONS PREVIEW ---`)
        const preview = prompt.split("\n").filter((l) => !l.startsWith("---")).slice(0, 20).join("\n")
        UI.println(preview)
        UI.println(UI.Style.TEXT_DIM + `  ...(run with subagent mode to activate full instructions)`)
      }
      return
    }

    if (action === "nexus") {
      UI.println(UI.Style.TEXT_INFO_BOLD + "  🌐 NEXUS — Network of EXperts, Unified in Strategy")
      UI.println("  The Agency's complete operational doctrine for multi-agent execution:\n")
      UI.println("  • Phase 0: Intelligence & Discovery  (Trend Researcher, UX Researcher)")
      UI.println("  • Phase 1: Strategy & Architecture   (Software Architect, UX Architect)")
      UI.println("  • Phase 2: Foundation & Scaffolding  (DevOps Automator, Brand Guardian)")
      UI.println("  • Phase 3: Build & Iterate           (Frontend Developer, Backend Architect)")
      UI.println("  • Phase 4: Quality & Hardening       (Evidence Collector, API Tester, Reality Checker)")
      UI.println("  • Phase 5: Launch & Growth           (Growth Hacker, Content Creator)")
      UI.println("  • Phase 6: Operate & Evolve          (SRE, Analytics Reporter)\n")
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "  🔄 Dev ↔ QA Feedback Loop Protocol:")
      UI.println("    Developer implements task → Evidence Collector tests → PASS/FAIL decision")
      UI.println("    Max 3 retries per task before escalation.\n")
      UI.println(UI.Style.TEXT_DIM + "  Activate subagent in chat:")
      UI.println(UI.Style.TEXT_DIM + "    \"Hey Navi, activate Frontend Developer mode and build this component\"")
    }
  }),
})
