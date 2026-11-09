import { describe, expect, test } from "bun:test"
import {
  parseSlashInput,
  resolveSlashCommandAction,
  buildAutocompleteCommands,
  type ClientSlash,
  type ServerCommand,
} from "../../../../src/cli/cmd/tui/component/prompt/slash"

describe("parseSlashInput", () => {
  test("parses command without arguments", () => {
    expect(parseSlashInput("/plan")).toEqual({
      cmdName: "plan",
      args: "",
    })
  })

  test("parses command with single-line arguments", () => {
    expect(parseSlashInput("/plan investigate memory leak in session loop")).toEqual({
      cmdName: "plan",
      args: "investigate memory leak in session loop",
    })
  })

  test("preserves multi-line arguments intact", () => {
    const input = "/plan first line of guidance\nsecond line of context\nthird line"
    expect(parseSlashInput(input)).toEqual({
      cmdName: "plan",
      args: "first line of guidance\nsecond line of context\nthird line",
    })
  })

  test("handles extra spaces cleanly", () => {
    expect(parseSlashInput("/build   refactor   core/util")).toEqual({
      cmdName: "build",
      args: "refactor   core/util",
    })
  })
})

describe("resolveSlashCommandAction", () => {
  const serverCommands: ServerCommand[] = [
    { name: "plan", description: "Switch to and run in Plan mode" },
    { name: "build", description: "Switch to and run in Build mode" },
    { name: "compact", description: "Compact session context" },
    { name: "permissions", description: "Configure permission mode" },
  ]

  const clientSlashes: ClientSlash[] = [
    { display: "/agents", aliases: ["/switch-agent"], onSelect: () => {} },
    { display: "/mcps", aliases: ["/mcp"], onSelect: () => {} },
  ]

  test("/plan with no arguments switches to Plan mode without server command dispatch", () => {
    const action = resolveSlashCommandAction({
      inputText: "/plan",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "mode_switch",
      mode: "plan",
      toastMessage: "Switched to Plan mode (Read-only)",
    })
  })

  test("/plan with whitespace only switches to Plan mode without server command dispatch", () => {
    const action = resolveSlashCommandAction({
      inputText: "/plan    ",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "mode_switch",
      mode: "plan",
      toastMessage: "Switched to Plan mode (Read-only)",
    })
  })

  test("/plan with arguments preserves prompt text and marks mode switch", () => {
    const action = resolveSlashCommandAction({
      inputText: "/plan review authentication architecture",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "server_command",
      command: "plan",
      arguments: "review authentication architecture",
      mode: "plan",
    })
  })

  test("/build with no arguments switches to Build mode without server command dispatch", () => {
    const action = resolveSlashCommandAction({
      inputText: "/build",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "mode_switch",
      mode: "build",
      toastMessage: "Switched to Build mode (Read/Write)",
    })
  })

  test("/build with arguments preserves prompt text and marks mode switch", () => {
    const action = resolveSlashCommandAction({
      inputText: "/build implement the database migration",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "server_command",
      command: "build",
      arguments: "implement the database migration",
      mode: "build",
    })
  })

  test("regular server commands dispatch with arguments", () => {
    const action = resolveSlashCommandAction({
      inputText: "/permissions auto",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "server_command",
      command: "permissions",
      arguments: "auto",
    })
  })

  test("client palette slashes resolve when not matching server commands", () => {
    const action = resolveSlashCommandAction({
      inputText: "/agents",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "client_slash",
      command: "/agents",
    })
  })

  test("client palette slash aliases resolve properly", () => {
    const action = resolveSlashCommandAction({
      inputText: "/switch-agent",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({
      type: "client_slash",
      command: "/agents",
    })
  })

  test("non-slash inputs return none", () => {
    const action = resolveSlashCommandAction({
      inputText: "hello world, please help me code",
      serverCommands,
      clientSlashes,
    })
    expect(action).toEqual({ type: "none" })
  })
})

describe("buildAutocompleteCommands & selection behavior", () => {
  const serverCommands: ServerCommand[] = [
    { name: "plan", description: "Switch to and run in Plan mode" },
    { name: "build", description: "Switch to and run in Build mode" },
    { name: "context", description: "Fetch context", source: "mcp" },
    { name: "review", description: "Review diff", source: "skill" },
  ]

  const clientSlashes: ClientSlash[] = [
    { display: "/agents", description: "Manage agents", onSelect: () => {} },
    { display: "/mcps", description: "Manage MCPs", onSelect: () => {} },
  ]

  test("builds combined sorted options with server command labels intact", () => {
    const options = buildAutocompleteCommands({
      clientSlashes,
      serverCommands,
      onSelectServerCommand: () => {},
    })

    const displays = options.map((o) => o.display)
    expect(displays).toEqual([
      "/agents",
      "/build",
      "/context:mcp",
      "/mcps",
      "/plan",
      "/review:skill",
    ])
  })

  test("server commands plan and build are not suppressed by client slashes", () => {
    const options = buildAutocompleteCommands({
      clientSlashes,
      serverCommands,
      onSelectServerCommand: () => {},
    })

    const planOption = options.find((o) => o.display === "/plan")
    const buildOption = options.find((o) => o.display === "/build")
    expect(planOption).toBeDefined()
    expect(buildOption).toBeDefined()
    expect(planOption?.description).toBe("Switch to and run in Plan mode")
    expect(buildOption?.description).toBe("Switch to and run in Build mode")
  })

  test("selecting an autocomplete server command modifies the terminal input controller", () => {
    let selectedCommand = ""
    let inputBuffer = "/pla"
    let cursorOffset = 4

    const mockInput = {
      logicalCursor: { row: 0, col: 4 },
      cursorOffset,
      deleteRange(startRow: number, startCol: number, endRow: number, endCol: number) {
        inputBuffer = ""
      },
      insertText(text: string) {
        inputBuffer = text
      },
    }

    const options = buildAutocompleteCommands({
      clientSlashes,
      serverCommands,
      onSelectServerCommand: (cmdName) => {
        selectedCommand = cmdName
        const newText = "/" + cmdName + " "
        mockInput.deleteRange(0, 0, mockInput.logicalCursor.row, mockInput.logicalCursor.col)
        mockInput.insertText(newText)
        mockInput.cursorOffset = newText.length
      },
    })

    const planOption = options.find((o) => o.display === "/plan")
    expect(planOption).toBeDefined()

    // Simulate user selecting the autocomplete option:
    planOption!.onSelect()

    expect(selectedCommand).toBe("plan")
    expect(inputBuffer).toBe("/plan ")
    expect(mockInput.cursorOffset).toBe(6)

    // Now verify subsequent submission without arguments switches mode
    const actionWithoutArgs = resolveSlashCommandAction({
      inputText: inputBuffer,
      serverCommands,
      clientSlashes,
    })
    expect(actionWithoutArgs).toEqual({
      type: "mode_switch",
      mode: "plan",
      toastMessage: "Switched to Plan mode (Read-only)",
    })

    // Now verify subsequent submission with user typing arguments
    const actionWithArgs = resolveSlashCommandAction({
      inputText: inputBuffer + "audit all sql injection points",
      serverCommands,
      clientSlashes,
    })
    expect(actionWithArgs).toEqual({
      type: "server_command",
      command: "plan",
      arguments: "audit all sql injection points",
      mode: "plan",
    })
  })

  test("prompt clearing behavior on submission", () => {
    // Simulates the prompt component's state store
    let promptStore = {
      input: "/plan refactor session queue",
      parts: [{ type: "file", path: "src/session.ts" }],
    }

    const clearPrompt = () => {
      promptStore = {
        input: "",
        parts: [],
      }
    }

    const action = resolveSlashCommandAction({
      inputText: promptStore.input,
      serverCommands,
      clientSlashes,
    })

    if (action.type === "server_command" || action.type === "mode_switch") {
      clearPrompt()
    }

    expect(action.type).toBe("server_command")
    expect(promptStore.input).toBe("")
    expect(promptStore.parts).toEqual([])
  })
})

