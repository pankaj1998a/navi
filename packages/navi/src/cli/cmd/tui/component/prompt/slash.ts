export type SlashCommandAction =
  | {
      type: "mode_switch"
      mode: "plan" | "build"
      toastMessage: string
    }
  | {
      type: "server_command"
      command: string
      arguments: string
      mode?: "plan" | "build"
    }
  | {
      type: "client_slash"
      command: string
    }
  | {
      type: "none"
    }

export interface ClientSlash {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}

export interface ServerCommand {
  name: string
  description?: string
  source?: string
}

export interface AutocompleteCommandOption {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}

export function buildAutocompleteCommands(params: {
  clientSlashes: readonly ClientSlash[]
  serverCommands: readonly ServerCommand[]
  onSelectServerCommand: (cmdName: string) => void
}): AutocompleteCommandOption[] {
  const { clientSlashes, serverCommands, onSelectServerCommand } = params
  const results: AutocompleteCommandOption[] = [...clientSlashes]

  for (const serverCommand of serverCommands) {
    if (results.some((r) => r.display.trim() === `/${serverCommand.name}`)) continue
    const label = serverCommand.source === "mcp" ? ":mcp" : serverCommand.source === "skill" ? ":skill" : ""
    results.push({
      display: "/" + serverCommand.name + label,
      description: serverCommand.description,
      onSelect: () => onSelectServerCommand(serverCommand.name),
    })
  }

  results.sort((a, b) => a.display.localeCompare(b.display))
  return results
}

export function parseSlashInput(inputText: string): {
  cmdName: string
  args: string
} {
  const firstLineEnd = inputText.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
  const cmdName = firstLine.match(/^\/(\S+)/)?.[1] ?? ""
  const firstLineArgs = firstLine.replace(/^\/\S+\s*/, "")
  const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
  const args = firstLineArgs + (restOfInput ? (firstLineArgs ? "\n" : "") + restOfInput : "")
  return { cmdName, args }
}

export function resolveSlashCommandAction(params: {
  inputText: string
  serverCommands: readonly ServerCommand[]
  clientSlashes: readonly ClientSlash[]
}): SlashCommandAction {
  const { inputText, serverCommands, clientSlashes } = params
  if (!inputText.startsWith("/")) return { type: "none" }

  const { cmdName, args } = parseSlashInput(inputText)
  if (!cmdName) return { type: "none" }

  const isServerCommand = serverCommands.some((x) => x.name === cmdName)
  if (isServerCommand) {
    if (cmdName === "plan") {
      if (!args.trim()) {
        return {
          type: "mode_switch",
          mode: "plan",
          toastMessage: "Switched to Plan mode (Read-only)",
        }
      }
      return {
        type: "server_command",
        command: "plan",
        arguments: args,
        mode: "plan",
      }
    }

    if (cmdName === "build") {
      if (!args.trim()) {
        return {
          type: "mode_switch",
          mode: "build",
          toastMessage: "Switched to Build mode (Read/Write)",
        }
      }
      return {
        type: "server_command",
        command: "build",
        arguments: args,
        mode: "build",
      }
    }

    return {
      type: "server_command",
      command: cmdName,
      arguments: args,
    }
  }

  const firstLine = inputText.split("\n")[0] ?? ""
  const firstWord = firstLine.split(" ")[0]?.toLowerCase() ?? ""
  const clientMatch = clientSlashes.find(
    (s) => s.display.trim() === firstWord || s.aliases?.some((a) => a.trim() === firstWord),
  )
  if (clientMatch) {
    return {
      type: "client_slash",
      command: clientMatch.display,
    }
  }

  return { type: "none" }
}
