import { cmd } from "./cmd"
import { AgentStore } from "../../agent/store"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import { Instance } from "../../project/instance"
import { EOL } from "os"
import type { Argv } from "yargs"
import { AgentScorecard } from "../../agent/scorecard"
import { buildAgentContract, renderSubagentContractSection } from "../../agent/contract"

type AgentMode = "all" | "primary" | "subagent"

const AVAILABLE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "list",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "todoread",
]

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const cliPath = args.path
        const cliDescription = args.description
        const cliMode = args.mode as AgentMode | undefined
        const cliTools = args.tools

        const isFullyNonInteractive = cliPath && cliDescription && cliMode && cliTools !== undefined

        if (!isFullyNonInteractive) {
          UI.empty()
          prompts.intro("Create agent")
        }

        const project = Instance.project

        // Determine scope/path
        let targetPath: string
        if (cliPath) {
          targetPath = path.join(cliPath, "agent")
        } else {
          let scope: "global" | "project" = "global"
          if (project.vcs === "git") {
            const scopeResult = await prompts.select({
              message: "Location",
              options: [
                {
                  label: "Current project",
                  value: "project" as const,
                  hint: Instance.worktree,
                },
                {
                  label: "Global",
                  value: "global" as const,
                  hint: Global.Path.config,
                },
              ],
            })
            if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
            scope = scopeResult
          }
          targetPath = path.join(
            scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".navi"),
            "agent",
          )
        }

        // Get description
        let description: string
        if (cliDescription) {
          description = cliDescription
        } else {
          const query = await prompts.text({
            message: "Description",
            placeholder: "What should this agent do?",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(query)) throw new UI.CancelledError()
          description = query
        }

        // Generate agent
        const spinner = prompts.spinner()
        spinner.start("Generating agent configuration...")
        const model = args.model ? Provider.parseModel(args.model) : undefined
        const generated = await Agent.generate({ description, model }).catch((error) => {
          spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
          if (isFullyNonInteractive) process.exit(1)
          throw new UI.CancelledError()
        })
        spinner.stop(`Agent ${generated.identifier} generated`)

        // Select tools
        let selectedTools: string[]
        if (cliTools !== undefined) {
          selectedTools = cliTools ? cliTools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
        } else {
          const result = await prompts.multiselect({
            message: "Select tools to enable",
            options: AVAILABLE_TOOLS.map((tool) => ({
              label: tool,
              value: tool,
            })),
            initialValues: AVAILABLE_TOOLS,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          selectedTools = result
        }

        // Get mode
        let mode: AgentMode
        if (cliMode) {
          mode = cliMode
        } else {
          const modeResult = await prompts.select({
            message: "Agent mode",
            options: [
              {
                label: "All",
                value: "all" as const,
                hint: "Can function in both primary and subagent roles",
              },
              {
                label: "Primary",
                value: "primary" as const,
                hint: "Acts as a primary/main agent",
              },
              {
                label: "Subagent",
                value: "subagent" as const,
                hint: "Can be used as a subagent by other agents",
              },
            ],
            initialValue: "all" as const,
          })
          if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
          mode = modeResult
        }

        // Build tools config
        const tools: Record<string, boolean> = {}
        for (const tool of AVAILABLE_TOOLS) {
          if (!selectedTools.includes(tool)) {
            tools[tool] = false
          }
        }

        // Build frontmatter
        const frontmatter: {
          description: string
          mode: AgentMode
          tools?: Record<string, boolean>
        } = {
          description: generated.whenToUse,
          mode,
        }
        if (Object.keys(tools).length > 0) {
          frontmatter.tools = tools
        }

        // Write file
        const content = matter.stringify(generated.systemPrompt, frontmatter)
        const filePath = path.join(targetPath, `${generated.identifier}.md`)

        await fs.mkdir(targetPath, { recursive: true })

        const file = Bun.file(filePath)
        if (await file.exists()) {
          if (isFullyNonInteractive) {
            console.error(`Error: Agent file already exists: ${filePath}`)
            process.exit(1)
          }
          prompts.log.error(`Agent file already exists: ${filePath}`)
          throw new UI.CancelledError()
        }

        await Bun.write(filePath, content)

        if (isFullyNonInteractive) {
          console.log(filePath)
        } else {
          prompts.log.success(`Agent created: ${filePath}`)
          prompts.outro("Done")
        }
      },
    })
  },
})

const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const agents = await Agent.list()
        const sortedAgents = agents.sort((a, b) => {
          if (a.native !== b.native) {
            return a.native ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        for (const agent of sortedAgents) {
          process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
          process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
        }
      },
    })
  },
})

const AgentScorecardsCommand = cmd({
  command: "scorecards [task]",
  describe: "show agent scorecards grouped by task class",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "print scorecards as JSON",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const taskClass = typeof args.task === "string" ? args.task : undefined
        const scorecards = await AgentScorecard.list(taskClass)

        if (args.json) {
          process.stdout.write(JSON.stringify(scorecards, null, 2) + EOL)
          return
        }

        if (!scorecards.length) {
          process.stdout.write("No agent scorecards recorded yet." + EOL)
          return
        }

        let currentTaskClass: string | undefined
        for (const scorecard of scorecards) {
          if (scorecard.taskClass !== currentTaskClass) {
            currentTaskClass = scorecard.taskClass
            process.stdout.write(EOL + currentTaskClass + EOL)
          }

          process.stdout.write(
            `  ${scorecard.agentName}  score=${scorecard.score.toFixed(1)}  success=${(scorecard.successRate * 100).toFixed(1)}%  samples=${scorecard.samples}` +
              EOL,
          )
          process.stdout.write(
            `    latency=${Math.round(scorecard.avgLatencyMs)}ms  cost=${scorecard.avgCost.toFixed(4)}  toolCalls=${scorecard.avgToolCalls.toFixed(1)}  questions=${scorecard.avgQuestions.toFixed(1)}` +
              EOL,
          )
        }
      },
    })
  },
})

const AgentContractCommand = cmd({
  command: "contract [name]",
  describe: "show explicit subagent contracts",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "print contracts as JSON",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const name = typeof args.name === "string" ? args.name : undefined
        const agents = name ? [await Agent.get(name)] : (await Agent.list()).filter((agent) => agent.mode === "subagent")
        const contracts = agents.flatMap((agent) =>
          agent
            ? [{
                name: agent.name,
                contract: agent.contract ?? buildAgentContract(agent),
              }]
            : [],
        )

        if (args.json) {
          process.stdout.write(JSON.stringify(contracts, null, 2) + EOL)
          return
        }

        if (!contracts.length) {
          process.stdout.write("No subagent contracts found." + EOL)
          return
        }

        for (const entry of contracts) {
          process.stdout.write(renderSubagentContractSection(entry.name, entry.contract) + EOL)
        }
      },
    })
  },
})

const AgentStoreCommand = cmd({
  command: "store",
  describe: "browse agent store",
  builder: (yargs) =>
    yargs
      .command({
        command: "list",
        describe: "list available agents in the registry",
        handler: async () => {
          console.log("Available agents (mock):")
          console.log("- navi/demo (A helpful demo agent)")
        },
      })
      .command({
        command: "search <query>",
        describe: "search for agents",
        handler: async (args: any) => {
          console.log(`Searching for "${args.query}"...`)
          if ("navi/demo".includes(args.query)) {
            console.log("- navi/demo (A helpful demo agent)")
          } else {
            console.log("No agents found.")
          }
        }
      }),
  async handler() { },
})

const AgentInstallCommand = cmd({
  command: "install <source>",
  describe: "install an agent from store or URL",
  async handler(args) {
    const spinner = prompts.spinner()
    spinner.start(`Fetching agent from ${args.source}...`)
    try {
      const manifest = await AgentStore.fetch(args.source as string)
      await AgentStore.install(manifest)
      spinner.stop(`Successfully installed ${manifest.name} v${manifest.version}`)
    } catch (e: any) {
      spinner.stop(`Failed to install: ${e.message}`, 1)
      process.exit(1)
    }
  },
})

const AgentUninstallCommand = cmd({
  command: "uninstall <name>",
  describe: "uninstall an agent",
  async handler(args) {
    const spinner = prompts.spinner()
    spinner.start(`Uninstalling ${args.name}...`)
    const success = await AgentStore.uninstall(args.name as string)
    if (success) {
      spinner.stop(`Uninstalled ${args.name}`)
    } else {
      spinner.stop(`Agent ${args.name} not found`, 1)
      process.exit(1)
    }
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) =>
    yargs
      .command(AgentCreateCommand)
      .command(AgentListCommand)
      .command(AgentScorecardsCommand)
      .command(AgentContractCommand)
      .command(AgentStoreCommand)
      .command(AgentInstallCommand)
      .command(AgentUninstallCommand)
      .demandCommand(),
  async handler() { },
})
