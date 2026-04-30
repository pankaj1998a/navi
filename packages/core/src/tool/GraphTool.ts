import z from "zod"
import { Tool } from "./tool"
import { IndexService } from "@/codebase/index-service"
import * as path from "path"
import { Instance } from "../project/instance"

const GraphParams = z.object({
  symbolName: z.string().describe("The name of the symbol (function, class, interface) to analyze."),
  action: z.enum(["impact_analysis", "find_callers", "get_dependencies"]).default("impact_analysis").describe("The type of graph analysis to perform."),
})

export interface GraphMetadata extends Tool.Metadata {
  symbolName: string
  action: string
  count: number
  impactedFiles?: string[]
}

export const GraphTool = Tool.define<typeof GraphParams, GraphMetadata>("graph", {
  description: "Perform deep architectural analysis using the Symbolic Knowledge Graph. Identify impacted files, callers, and dependencies for a given symbol.",
  parameters: GraphParams,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: GraphMetadata }> {
    const { symbolName, action } = params

    // Ensure index is initialized before use
    await IndexService.initialize()
    const graph = IndexService.getGraph()
    
    if (action === "impact_analysis" || action === "find_callers") {
      const impactedFiles = graph.getImpactedFiles(symbolName)
      
      if (impactedFiles.length === 0) {
        return {
          title: `Graph: ${symbolName}`,
          output: `No direct usages found for \`${symbolName}\` in the current project graph.`,
          metadata: { symbolName, action, count: 0, impactedFiles: undefined },
        }
      }

      const relativePaths = impactedFiles.map((f: string) => path.relative(Instance.worktree, f))
      const output = `### Impact Analysis for \`${symbolName}\`
The following files contain calls or references to \`${symbolName}\` and may be impacted by changes:

${relativePaths.map((p: string) => `- \`${p}\``).join("\n")}

**Total Impacted Files**: ${relativePaths.length}`

      return {
        title: `Impact: ${symbolName}`,
        output,
        metadata: {
          symbolName,
          action,
          impactedFiles: relativePaths,
          count: relativePaths.length
        }
      }
    }

    return {
      title: `Graph: ${symbolName}`,
      output: `Action \`${action}\` is not yet fully implemented in the native core.`,
      metadata: { symbolName, action, count: 0, impactedFiles: undefined }
    }
  },
})


