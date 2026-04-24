import z from "zod"
import { Tool } from "./tool"
import path from "path"

type NotebookCell = {
  cell_type: "code" | "markdown" | "raw"
  metadata: Record<string, unknown>
  source: string[] | string
  execution_count?: number | null
  outputs?: unknown[]
}

type Notebook = {
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
  cells: NotebookCell[]
}

/**
 * NotebookEditTool — Read and edit Jupyter Notebook (.ipynb) files.
 * Provides a structured way to view, add, modify, and delete cells
 * without risking JSON parsing errors from treating it as a raw text file.
 */
export const NotebookEditTool = Tool.define("notebook_edit", {
  description: `Read and modify Jupyter Notebook (.ipynb) files cell by cell.
Since notebooks are complex JSON files, standard text editing tools often break them.
Use this tool to safely interact with notebooks.

Commands:
- 'view': Read the cells of a notebook. If no cell_index is provided, lists all cells.
- 'add': Insert a new cell.
- 'edit': Replace the contents of an existing cell.
- 'delete': Remove a cell.`,

  parameters: z.object({
    command: z.enum(["view", "add", "edit", "delete"]).describe("The operation to perform"),
    filepath: z.string().describe("Path to the .ipynb file"),
    cell_index: z.number().optional().describe("0-based index of the cell to view, edit, delete, or insert at (add inserts at end if omitted)"),
    cell_type: z.enum(["code", "markdown", "raw"]).optional().describe("Type of the cell (required for 'add', optional for 'edit')"),
    source: z.string().optional().describe("The source code or markdown content for 'add' and 'edit' commands"),
  }),

  async execute(params, ctx) {
    const absPath = path.resolve(process.cwd(), params.filepath)
    
    // Check if file exists, if not and command is 'add', maybe create a new skeletal one?
    // Let's require the file to exist for now, or create an empty one if 'add' is used on missing file.
    let notebook: Notebook = {
      metadata: {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3"
        },
        "language_info": {
            "name": "python",
            "version": "3.8"
        }
      },
      nbformat: 4,
      nbformat_minor: 4,
      cells: []
    }

    const exists = await Bun.file(absPath).exists()

    if (exists) {
      try {
        const content = await Bun.file(absPath).text()
        notebook = JSON.parse(content)
      } catch (err) {
        throw new Error(`Failed to parse ${params.filepath} as a valid Jupyter notebook: ${err}`)
      }
    } else {
      if (params.command !== "add") {
        throw new Error(`File not found: ${params.filepath}`)
      }
    }

    if (!Array.isArray(notebook.cells)) {
      notebook.cells = []
    }

    const { command, cell_index, cell_type, source } = params

    if (command === "view") {
      if (cell_index !== undefined) {
        if (cell_index < 0 || cell_index >= notebook.cells.length) {
          throw new Error(`Cell index ${cell_index} out of bounds (0 to ${notebook.cells.length - 1})`)
        }
        const cell = notebook.cells[cell_index]
        return {
          title: `Notebook View - Cell ${cell_index}`,
          metadata: {},
          output: `## Cell ${cell_index} (${cell.cell_type})\n\n\`\`\`${cell.cell_type === "code" ? "python" : "markdown"}\n${Array.isArray(cell.source) ? cell.source.join("") : cell.source}\n\`\`\``
        }
      }

      // View all cells summary
      const lines = [`## Notebook: ${params.filepath} (${notebook.cells.length} cells)\n`]
      for (let i = 0; i < notebook.cells.length; i++) {
        const cell = notebook.cells[i]
        const src = Array.isArray(cell.source) ? cell.source.join("") : cell.source
        const preview = src.split('\n').slice(0, 3).join('\n') + (src.split('\n').length > 3 ? '\n...' : '')
        lines.push(`### [${i}] ${cell.cell_type}${cell.cell_type === 'code' && cell.execution_count ? ` (Executed: [${cell.execution_count}])` : ''}`)
        lines.push(`\`\`\`${cell.cell_type === "code" ? "python" : "markdown"}\n${preview}\n\`\`\`\n`)
      }
      return {
        title: `Notebook View - ${params.filepath}`,
        metadata: {},
        output: lines.join("\n") || "No cells found."
      }
    }

    if (command === "add") {
      if (!cell_type) throw new Error("cell_type is required for 'add'")
      if (source === undefined) throw new Error("source is required for 'add'")

      const newCell: NotebookCell = {
        cell_type,
        metadata: {},
        source: source.endsWith("\n") ? source : source + "\n"
      }

      if (cell_type === "code") {
        newCell.execution_count = null
        newCell.outputs = []
      }

      let insertedAt = notebook.cells.length
      if (cell_index !== undefined && cell_index >= 0 && cell_index <= notebook.cells.length) {
        notebook.cells.splice(cell_index, 0, newCell)
        insertedAt = cell_index
      } else {
        notebook.cells.push(newCell)
      }

      await Bun.write(absPath, JSON.stringify(notebook, null, 1) + "\n")
      return {
        title: `Added Cell ${insertedAt}`,
        metadata: {},
        output: `✅ Added new ${cell_type} cell at index ${insertedAt}.`
      }
    }

    if (command === "edit") {
      if (cell_index === undefined) throw new Error("cell_index is required for 'edit'")
      if (cell_index < 0 || cell_index >= notebook.cells.length) {
        throw new Error(`Cell index ${cell_index} out of bounds (0 to ${notebook.cells.length - 1})`)
      }
      if (source === undefined) throw new Error("source is required for 'edit'")
      
      const cell = notebook.cells[cell_index]
      if (cell_type) cell.cell_type = cell_type
      cell.source = source.endsWith("\n") ? source : source + "\n"
      
      await Bun.write(absPath, JSON.stringify(notebook, null, 1) + "\n")
      return {
        title: `Edited Cell ${cell_index}`,
        metadata: {},
        output: `✅ Edited cell at index ${cell_index}.`
      }
    }

    if (command === "delete") {
      if (cell_index === undefined) throw new Error("cell_index is required for 'delete'")
      if (cell_index < 0 || cell_index >= notebook.cells.length) {
        throw new Error(`Cell index ${cell_index} out of bounds (0 to ${notebook.cells.length - 1})`)
      }

      notebook.cells.splice(cell_index, 1)
      await Bun.write(absPath, JSON.stringify(notebook, null, 1) + "\n")
      return {
        title: `Deleted Cell ${cell_index}`,
        metadata: {},
        output: `✅ Deleted cell at index ${cell_index}.`
      }
    }

    throw new Error(`Unknown command: ${command}`)
  },
})
