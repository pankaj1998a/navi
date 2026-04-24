import z from "zod"
import { Tool } from "./tool"
import { Scan } from "../codebase/scan"
import * as path from "path"
import DESCRIPTION from "./map.txt"
import { Instance } from "../project/instance"

export const MapTool = Tool.define("map", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The absolute path to the file to map."),
  }),
  async execute(params, ctx): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
    const filePath = path.resolve(Instance.directory ?? process.cwd(), params.path)
    const tags = await Scan.file(filePath)

    if (tags.length === 0) {
      return {
        title: path.basename(filePath),
        output: "No structural tags found (language might not be supported or file is empty).",
        metadata: {},
      }
    }

    const output = tags.map((t) => `L${t.line}: [${t.type}] ${t.name}`).join("\n")

    return {
      title: path.basename(filePath),
      metadata: {
        tagCount: tags.length,
      },
      output: `Structure of ${path.basename(filePath)}:\n\n${output}`,
    }
  },
})


