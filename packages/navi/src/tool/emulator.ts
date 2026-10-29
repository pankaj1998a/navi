/**
 * Tool Emulation Engine for Small / Local Models
 * Inspired by Goose (crates/goose-local-inference/src/tool_emulation.rs).
 * 
 * Allows tiny local models (e.g. 1B-8B parameter models in Ollama/vLLM) that
 * do not have native JSON tool calling to reliably execute commands via:
 *   - `$ <shell command>` on a new line
 *   - ```execute_tool {"tool": "...", "input": {...}}```
 *   - ```bash ... ``` or ```sh ... ``` code blocks
 */

export interface EmulatedToolCall {
  toolName: string
  input: Record<string, any>
  rawMatch: string
}

export class ToolEmulator {
  /**
   * Generates prompt instructions explaining how the model can execute tools without native function calling.
   */
  static buildPromptInstructions(availableTools: string[]): string {
    return [
      "",
      "# Tool Execution Instructions (Local Emulation Mode)",
      "You have access to the following system tools: " + availableTools.join(", "),
      "",
      "To execute a command or run a tool, you can use any of these two formats:",
      "1. Quick Shell Execution: Start a new line with `$ ` followed by the command, e.g.:",
      "   $ git status",
      "",
      "2. Explicit Tool Invocation: Wrap tool JSON in an `execute_tool` code fence, e.g.:",
      "   ```execute_tool",
      '   { "tool": "read_file", "input": { "path": "package.json" } }',
      "   ```",
      "",
      "The tool output will be returned to you in the next turn.",
      "",
    ].join("\n")
  }

  /**
   * Parses text output from a non-toolcall model and extracts any emulated tool requests.
   */
  static parse(text: string): EmulatedToolCall[] {
    if (!text || typeof text !== "string") return []

    const calls: EmulatedToolCall[] = []

    // 1. Look for ```execute_tool ... ``` blocks
    const toolBlockRegex = /```(?:execute_tool|tool_call|call_tool)\s*([\s\S]*?)```/gi
    let match: RegExpExecArray | null
    while ((match = toolBlockRegex.exec(text)) !== null) {
      const raw = match[0]
      const jsonStr = (match[1] ?? "").trim()
      if (!jsonStr) continue
      try {
        const parsed = JSON.parse(jsonStr)
        if (parsed && typeof parsed === "object" && parsed.tool) {
          calls.push({
            toolName: parsed.tool,
            input: parsed.input || parsed.arguments || {},
            rawMatch: raw,
          })
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    // 2. Look for lines starting with `$ <command>` (outside of general markdown text)
    const lines = text.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("$ ") && trimmed.length > 3) {
        const cmd = trimmed.slice(2).trim()
        // Ensure it's not a documentation comment or example
        if (!cmd.startsWith("#") && !cmd.startsWith("//") && !calls.some((c) => c.input && c.input["command"] === cmd)) {
          calls.push({
            toolName: "shell",
            input: { command: cmd },
            rawMatch: line,
          })
        }
      }
    }

    return calls
  }
}
