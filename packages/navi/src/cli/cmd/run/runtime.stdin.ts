import fs from "fs"
import * as tty from "node:tty"

export const INTERACTIVE_INPUT_ERROR = "--interactive requires a controlling terminal for input"

type InteractiveStdin = {
  stdin: NodeJS.ReadStream
  cleanup?: () => void
}

function openTerminalStdin(path: string): NodeJS.ReadStream {
  return new tty.ReadStream(fs.openSync(path, "r"))
}

export function resolveInteractiveStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  open: (path: string) => NodeJS.ReadStream = openTerminalStdin,
  platform = process.platform,
): InteractiveStdin {
  if (stdin.isTTY) {
    process.stderr.write("DEBUG: Using process.stdin (isTTY=true)\n")
    return { stdin }
  }

  const file = platform === "win32" ? "CONIN$" : "/dev/tty"
  process.stderr.write(`DEBUG: Opening terminal stdin: ${file}\n`)

  try {
    const stream = open(file)
    process.stderr.write(`DEBUG: Opened terminal stdin: ${file}\n`)
    return {
      stdin: stream,
      cleanup: () => {
        stream.destroy()
      },
    }
  } catch (error) {
    process.stderr.write(`DEBUG: Failed to open terminal stdin: ${file}. Error: ${error}\n`)
    throw new Error(INTERACTIVE_INPUT_ERROR, { cause: error })
  }
}
