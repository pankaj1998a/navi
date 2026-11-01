import type { Argv, CommandModule } from "yargs"

interface DeferredCommandInput<T, U> {
  /** Same command string the real module registers (positionals must match). */
  command: string
  /** Same describe string (or false to stay hidden). Shown in top-level `--help`. */
  describe: string | false
  aliases?: string | readonly string[]
  /** Lazily imports the real command module. Called at builder/handler time only. */
  load: () => Promise<CommandModule<T, U>>
  /**
   * Set for modules that import `AppRuntime` directly instead of going through
   * `effectCmd`, so shutdown knows the runtime may need disposing.
   */
  usesAppRuntimeDirectly?: boolean
}

let loadedRuntimeConsumer = false

/** True when a lazily loaded command module imports AppRuntime itself. */
export const commandUsesAppRuntimeDirectly = () => loadedRuntimeConsumer

/**
 * Registers a command's name/describe/aliases eagerly, but defers importing its
 * implementation module until yargs actually needs it.
 *
 * yargs resolves builders lazily (only for the matched command) and awaits
 * promise-returning builders (`lib/command.js`), so help/option output for
 * `navi <cmd> --help` stays byte-identical to the real module's builder while
 * top-level `--help` never loads the module graph at all.
 */
export function deferredCommand<T = {}, U = {}>(input: DeferredCommandInput<T, U>): CommandModule<T, U> {
  const load = async () => {
    const module = await input.load()
    if (input.usesAppRuntimeDirectly) loadedRuntimeConsumer = true
    return module
  }
  return {
    command: input.command,
    describe: input.describe,
    aliases: input.aliases,
    builder: (async (yargs: Argv) => {
      const builder = (await load()).builder
      if (typeof builder === "function") return builder(yargs as never)
      if (builder) {
        for (const key of Object.keys(builder)) yargs.option(key, builder[key] as never)
      }
      return yargs
    }) as never,
    handler: (async (args: never) => (await load()).handler(args)) as never,
  }
}
