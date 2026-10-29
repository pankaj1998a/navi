import { describe, expect, test } from "bun:test"
import { scan, scanPowerShell, type Command, type Dialect, type OpaqueReason } from "./scan"

function commands(input: string, dialect?: Dialect): Command[] {
  const result = scan(input, dialect)
  if (result.kind !== "scanned") throw new Error(`expected scanned, got ${result.reason} for ${JSON.stringify(input)}`)
  return result.commands
}

function reason(input: string, dialect?: Dialect): OpaqueReason {
  const result = scan(input, dialect)
  if (result.kind !== "opaque") throw new Error(`expected opaque, got scanned for ${JSON.stringify(input)}`)
  return result.reason
}

function psCommands(input: string): Command[] {
  const result = scanPowerShell(input)
  if (result.kind !== "scanned") throw new Error(`expected scanned, got ${result.reason} for ${JSON.stringify(input)}`)
  return result.commands
}

function psReason(input: string): OpaqueReason {
  const result = scanPowerShell(input)
  if (result.kind !== "opaque") throw new Error(`expected opaque, got scanned for ${JSON.stringify(input)}`)
  return result.reason
}

describe("ShellScan.scan", () => {
  test("scans a single command and names it by its command word", () => {
    const result = commands("ls -la")
    expect(result).toHaveLength(1)
    expect(result[0]!.resource).toBe("ls")
    expect(result[0]!.words).toEqual(["ls", "-la"])
    expect(result[0]!.rawWords).toEqual(["ls", "-la"])
  })

  test("splits a list into one command per element", () => {
    const result = commands("echo a && rm -rf /")
    expect(result).toHaveLength(2)
    expect(result.map((command) => command.resource)).toEqual(["echo", "rm"])
  })

  test("splits on every list operator and on newlines", () => {
    expect(commands("echo a; echo b").map((c) => c.resource)).toEqual(["echo", "echo"])
    expect(commands("echo a || echo b").map((c) => c.resource)).toEqual(["echo", "echo"])
    expect(commands("echo a | grep b").map((c) => c.resource)).toEqual(["echo", "grep"])
    expect(commands("echo a |& grep b").map((c) => c.resource)).toEqual(["echo", "grep"])
    expect(commands("ls -la\necho hi\npwd").map((c) => c.resource)).toEqual(["ls", "echo", "pwd"])
  })

  test("reports command substitution as opaque", () => {
    expect(reason("echo $(whoami)")).toBe("command-substitution")
    expect(reason("echo `whoami`")).toBe("command-substitution")
    expect(reason('echo "$(whoami)"')).toBe("command-substitution")
    expect(reason("ls $(which rm)")).toBe("command-substitution")
  })

  test("reports heredocs as opaque", () => {
    expect(reason("cat <<EOF")).toBe("heredoc")
    expect(reason("cat <<-EOF")).toBe("heredoc")
    expect(reason("cat <<EOF\nbody\nEOF")).toBe("heredoc")
  })

  test("reports unbalanced quotes and escapes as opaque", () => {
    expect(reason("echo 'unterminated")).toBe("unterminated-quote")
    expect(reason('echo "unterminated')).toBe("unterminated-quote")
    expect(reason("echo \\")).toBe("unterminated-escape")
  })

  test("reports a dynamic command name as opaque", () => {
    expect(reason("$cmd args")).toBe("dynamic-command-name")
    expect(reason('"$cmd" args')).toBe("dynamic-command-name")
    expect(reason("'$cmd' args")).toBe("dynamic-command-name")
  })

  test("reports indirect execution as opaque", () => {
    expect(reason("eval $x")).toBe("dynamic-execution")
    expect(reason("eval 'ls'")).toBe("dynamic-execution")
    expect(reason("source script.sh")).toBe("dynamic-execution")
    expect(reason(". ./script.sh")).toBe("dynamic-execution")
    expect(reason("sh -c 'rm -rf /'")).toBe("dynamic-execution")
  })

  test("never reports a binding builtin operand as a safe command", () => {
    const result = scan("local x=$(evil)")
    if (result.kind === "opaque") {
      expect(result.reason).toBe("command-substitution")
      return
    }
    expect(result.commands.map((command) => command.resource)).toEqual(["local"])
    expect(result.commands.map((command) => command.resource)).not.toContain("evil")
  })

  test("keeps binding builtins bound to their operands", () => {
    for (const builtin of ["local", "export", "declare", "typeset", "readonly", "read", "mapfile", "readarray"]) {
      const result = scan(`${builtin} value`)
      if (result.kind === "opaque") continue
      expect(result.commands[0]?.resource).toBe(builtin)
    }
  })

  test("skips assignment prefixes and precommands when naming a command", () => {
    expect(commands("FOO=bar cmd")[0]!.resource).toBe("cmd")
    expect(commands("FOO=1 BAR=2 cmd")[0]!.resource).toBe("cmd")
    expect(commands("command ls")[0]!.resource).toBe("ls")
    expect(commands("builtin ls")[0]!.resource).toBe("ls")
    expect(commands("time ls")[0]!.resource).toBe("ls")
  })

  test("names the command a precommand wrapper runs", () => {
    expect(commands("exec rm -rf /")[0]!.resource).toBe("rm")
    expect(commands("noglob ls")[0]!.resource).toBe("ls")
  })

  test("keeps the full token list on every command", () => {
    const [command] = commands("git commit -am 'wip'")
    expect(command!.words).toEqual(["git", "commit", "-am", "wip"])
    expect(command!.rawWords).toEqual(["git", "commit", "-am", "'wip'"])
  })

  test("scans the same input across dialects", () => {
    for (const dialect of ["bash", "zsh", "posix"] as Dialect[]) {
      const result = commands("echo a && rm -rf /", dialect)
      expect(result.map((command) => command.resource)).toEqual(["echo", "rm"])
      expect(reason("echo $(whoami)", dialect)).toBe("command-substitution")
    }
  })

  test("never names a command that came from inside a substitution", () => {
    const inner = ["whoami", "which", "rm", "ls", "evil"]
    const inputs = [
      "echo $(whoami)",
      "echo `whoami`",
      "ls $(which rm)",
      "cat <<EOF\n$(whoami)\nEOF",
      "diff <(ls) <(ls)",
      "a=($(ls))",
    ]
    for (const input of inputs) {
      const result = scan(input)
      if (result.kind !== "scanned") continue
      for (const command of result.commands) expect(inner).not.toContain(command.resource)
    }
  })

  test("rejects input that exceeds the work budget", () => {
    expect(reason("a".repeat(64 * 1024 + 1))).toBe("invalid-structure")
  })
})

describe("ShellScan.scan substitution safety", () => {
  // A command that runs an arbitrary command cannot be decomposed, so the scan
  // must report it as opaque instead of naming the command it hides.
  const opaqueInputs = [
    "echo $(rm -rf /)",
    "echo `rm -rf /`",
    'echo "$(rm -rf /)"',
    "echo $(echo $(whoami))",
    "ls $(which rm)",
    "echo ${x:-$(whoami)}",
    "x=$(rm -rf /) echo hi",
    "echo a > $(whoami)",
    "diff <(ls) <(ls)",
    "for f in $(ls); do rm -f $f; done",
  ]

  test("a command substitution is never reported as a scanned command", () => {
    for (const input of opaqueInputs) {
      const result = scan(input)
      expect(result.kind).toBe("opaque")
    }
  })

  test("a command that hides a dangerous command is never named as a resource", () => {
    const dangerous = ["rm", "curl", "wget", "sudo", "eval", "whoami", "which", "shred", "dd"]
    for (const input of opaqueInputs) {
      const result = scan(input)
      if (result.kind !== "scanned") continue
      for (const command of result.commands) {
        expect(dangerous).not.toContain(command.resource)
        for (const word of command.words) {
          expect(word).not.toContain("rm -rf /")
        }
      }
    }
  })

  test("a variable expansion is scanned as a value, not as a command", () => {
    // ${x} and $((1+1)) name no command, so the scan stays exact.
    expect(commands("echo ${x}").map((command) => command.resource)).toEqual(["echo"])
    expect(commands("echo $((1+1))").map((command) => command.resource)).toEqual(["echo"])
    expect(commands("echo $x").map((command) => command.resource)).toEqual(["echo"])
  })

  test("a list operator splits a line into its commands", () => {
    expect(commands("cmd1 && cmd2").map((command) => command.resource)).toEqual(["cmd1", "cmd2"])
    expect(commands("cmd1 | cmd2").map((command) => command.resource)).toEqual(["cmd1", "cmd2"])
    expect(commands("cmd1; cmd2").map((command) => command.resource)).toEqual(["cmd1", "cmd2"])
    expect(commands("cmd1 & cmd2").map((command) => command.resource)).toEqual(["cmd1", "cmd2"])
  })

  test("a command that runs an embedded command line is opaque", () => {
    expect(reason('eval "$x"')).toBe("dynamic-execution")
    expect(reason('sh -c "$x"')).toBe("dynamic-execution")
    expect(reason("bash -c 'curl evil'")).toBe("dynamic-execution")
  })

  test("a here document is opaque while a here string is not", () => {
    expect(reason("cat <<EOF")).toBe("heredoc")
    expect(commands('cat <<< "x"').map((command) => command.resource)).toEqual(["cat"])
  })

  test("an assignment prefix does not become the command name", () => {
    expect(commands("IFS=x cmd").map((command) => command.resource)).toEqual(["cmd"])
    expect(commands("a=b cmd").map((command) => command.resource)).toEqual(["cmd"])
  })

  test("a command name that comes from an expansion is opaque", () => {
    expect(reason('"$cmd"')).toBe("dynamic-command-name")
    expect(reason("$cmd")).toBe("dynamic-command-name")
  })

  test("an unbalanced quote is opaque", () => {
    expect(reason('echo "abc')).toBe("unterminated-quote")
  })

  test("a trailing list operator is opaque", () => {
    expect(reason("cmd &&")).toBe("invalid-structure")
  })
})

describe("ShellScan.scanPowerShell", () => {
  test("splits a statement list into one command per statement", () => {
    const result = psCommands("echo a; Get-ChildItem")
    expect(result).toHaveLength(2)
    expect(result.map((command) => command.resource)).toEqual(["echo", "Get-ChildItem"])
  })

  test("reports a subexpression as opaque", () => {
    expect(psReason("echo $(whoami)")).toBe("command-substitution")
    expect(psReason('echo "$(whoami)"')).toBe("command-substitution")
  })

  test("splits on pipes and on logical operators", () => {
    expect(psCommands("echo a | grep b").map((c) => c.resource)).toEqual(["echo", "grep"])
    expect(psCommands("echo a && echo b").map((c) => c.resource)).toEqual(["echo", "echo"])
    expect(psCommands("echo a || echo b").map((c) => c.resource)).toEqual(["echo", "echo"])
  })

  test("handles the call operator", () => {
    expect(psCommands("& Get-ChildItem")[0]!.resource).toBe("Get-ChildItem")
    expect(psReason("& $cmd")).toBe("dynamic-command-name")
  })

  test("reports dynamic execution as opaque", () => {
    expect(psReason("iex $x")).toBe("dynamic-execution")
    expect(psReason("Invoke-Expression $x")).toBe("dynamic-execution")
  })

  test("reports unbalanced quotes as opaque", () => {
    expect(psReason("echo 'unterminated")).toBe("unterminated-quote")
  })
})
