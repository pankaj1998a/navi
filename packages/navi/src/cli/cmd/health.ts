import type { CommandModule } from "yargs"
import path from "path"
import { scanRepoHealth } from "../../util/repo-health"
import { UI } from "../ui"

type Args = {
  dir?: string
  json?: boolean
}

export const HealthCommand = {
  command: "health",
  describe: "Run a fast static repo health scan",
  builder: (yargs) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "repository root (defaults to current working directory)",
      })
      .option("json", {
        type: "boolean",
        describe: "output JSON report",
        default: false,
      }),
  handler: async (args: Args) => {
    const root = args.dir ? path.resolve(args.dir) : process.cwd()
    const report = await scanRepoHealth(root)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.summary.errors > 0) process.exitCode = 1
      return
    }

    const { errors, warnings, infos } = report.summary
    const total = report.issues.length
    if (total === 0) {
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Repo health: OK" + UI.Style.TEXT_NORMAL)
      return
    }

    UI.println(
      UI.Style.TEXT_WARNING_BOLD +
        `Repo health: ${total} issue${total === 1 ? "" : "s"}` +
        UI.Style.TEXT_NORMAL,
    )
    UI.println(
      UI.Style.TEXT_DIM +
        `errors=${errors} warnings=${warnings} info=${infos}` +
        UI.Style.TEXT_NORMAL,
    )

    for (const issue of report.issues) {
      const label =
        issue.severity === "error"
          ? UI.Style.TEXT_DANGER_BOLD + "error"
          : issue.severity === "warn"
            ? UI.Style.TEXT_WARNING_BOLD + "warn"
            : UI.Style.TEXT_INFO_BOLD + "info"
      UI.println(`${label}${UI.Style.TEXT_NORMAL} ${issue.title}`)
      if (issue.detail) UI.println(UI.Style.TEXT_DIM + `  ${issue.detail}` + UI.Style.TEXT_NORMAL)
      if (issue.files && issue.files.length > 0) {
        const display = issue.files.slice(0, 3).map((f) => path.relative(root, f))
        UI.println(UI.Style.TEXT_DIM + `  files: ${display.join(", ")}` + UI.Style.TEXT_NORMAL)
      }
    }

    if (errors > 0) process.exitCode = 1
  },
} satisfies CommandModule



