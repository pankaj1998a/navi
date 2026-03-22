import type { CommandModule } from "yargs"
import { EvalFramework } from "../../eval/framework"
import { DEFAULT_VERIFICATION_PROFILES, getVerificationProfile } from "../../eval/catalog"

type Args = {
  list?: boolean
  summary?: boolean
  benchmark?: string
  agent?: string
  taskClass?: string
  verification?: string
  format?: "table" | "json"
}

export const EvalCommand = {
  command: "eval",
  describe: "Inspect evaluation benchmarks, verification gates, and recorded turn samples",
  builder: (yargs) =>
    yargs
      .option("list", {
        type: "boolean",
        describe: "list benchmark cases and verification profiles",
      })
      .option("summary", {
        type: "boolean",
        describe: "summarize recorded evaluation turns",
      })
      .option("benchmark", {
        type: "string",
        describe: "filter summary to a benchmark id",
      })
      .option("agent", {
        type: "string",
        describe: "filter summary to an agent name",
      })
      .option("taskClass", {
        type: "string",
        describe: "filter summary to a task class",
      })
      .option("verification", {
        type: "string",
        describe: "show the verification profile for a mode or agent",
      })
      .option("format", {
        type: "string",
        choices: ["table", "json"],
        default: "table",
        describe: "output format",
      }),
  handler: async (args: Args) => {
    if (args.list) {
      const data = {
        benchmarks: EvalFramework.benchmarks(),
        verificationProfiles: DEFAULT_VERIFICATION_PROFILES,
      }
      if (args.format === "json") {
        console.log(JSON.stringify(data, null, 2))
        return
      }

      console.log("Benchmarks:")
      for (const benchmark of data.benchmarks) {
        console.log(`- ${benchmark.id} [${benchmark.mode}] ${benchmark.description}`)
      }
      console.log("")
      console.log("Verification Profiles:")
      for (const profile of data.verificationProfiles) {
        console.log(`- ${profile.mode}: ${profile.description}`)
      }
      return
    }

    if (args.verification) {
      const profile = getVerificationProfile(args.verification)
      if (!profile) {
        console.error(`No verification profile found for ${args.verification}`)
        process.exitCode = 1
        return
      }

      if (args.format === "json") {
        console.log(JSON.stringify(profile, null, 2))
        return
      }

      console.log(`${profile.mode}: ${profile.description}`)
      for (const gate of profile.gates) {
        console.log(`- [${gate.required ? "required" : "optional"}] ${gate.id}: ${gate.description}`)
      }
      return
    }

    const turns = await EvalFramework.readTurns()
    const summary = EvalFramework.summarizeTurns(turns, {
      agent: args.agent,
      benchmarkID: args.benchmark,
      taskClass: args.taskClass,
    })

    if (args.format === "json") {
      console.log(JSON.stringify({ summary, turns: turns.length }, null, 2))
      return
    }

    console.log("Evaluation Summary:")
    console.log(`- turns: ${summary.count}`)
    console.log(`- completed: ${summary.completed}`)
    console.log(`- failed: ${summary.failed}`)
    console.log(`- pass rate: ${(summary.passRate * 100).toFixed(1)}%`)
    console.log(`- score: ${summary.score.toFixed(1)}/100`)
    console.log(`- avg cost: ${summary.avgCost.toFixed(4)}`)
    console.log(`- avg tool calls: ${summary.avgToolCalls.toFixed(1)}`)
    console.log(`- avg questions: ${summary.avgQuestions.toFixed(1)}`)
  },
} satisfies CommandModule
