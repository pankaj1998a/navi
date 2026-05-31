import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { FileWatcher } from "../file/watcher"
import { Log } from "@navi-ai/core/util/log"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import { $ } from "bun"
import z from "zod"

/**
 * Autonomous Sentry Service
 * Monitors file changes and runs verification commands in the background.
 */
export class SentryService {
  private static log = Log.create({ service: "sentry" })
  private static debounceTimer: Timer | null = null
  private static isVerifying = false

  static async initialize() {
    this.log.info("Initializing Sentry Service...")
    
    // Subscribe to file changes
    Bus.subscribe(FileWatcher.Event.Updated, (event) => {
      this.handleFileChange(event.properties.file)
    })
  }

  private static async handleFileChange(file: string) {
    this.log.debug("File change detected", { file })
    
    const cfg = await Config.get()
    const debounceMs = cfg.sentry?.debounceMs ?? 2000

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.runVerification(file)
    }, debounceMs).unref?.()
  }

  private static async runVerification(file: string) {
    if (this.isVerifying) {
      this.log.warn("Verification already in progress, skipping...")
      return
    }

    const cfg = await Config.get()
    if (cfg.sentry?.enabled === false) return

    this.isVerifying = true
    Bus.publish(BusEvent.define("sentry.active", z.object({ active: z.boolean() }) as any), { active: true })
    this.log.info("Starting background verification...")

    try {
      const root = Instance.worktree
      if (!root) throw new Error("No worktree directory found.")

      const commands = cfg.sentry?.commands ?? ["npm run typecheck", "npm run lint"]
      
      for (const command of commands) {
        this.log.info("Running verification", { command })
        const result = await $`sh -c ${command}`.cwd(root).nothrow().quiet()
        
        if (result.exitCode !== 0) {
          const errorMsg = `Verification failed: ${command}\nOutput: ${result.stderr.toString()}`
          this.log.error(errorMsg)

          if (cfg.sentry?.autoFix) {
            this.log.info("Triggering Sentry-Fixer agent...")
            const { Orchestrator } = await import("../agent/orchestrator")
            const orchestrator = new Orchestrator()
            
            try {
              // Spawn a fixer agent specifically for this error
              // We use the generatorWorkflow with the error as the goal
              const fixGoal = `Fix this error in the codebase:\n${errorMsg}`
              const fixer = orchestrator.generatorWorkflow(fixGoal, root)
              
              for await (const step of fixer) {
                this.log.debug("Sentry fixer step", { step })
              }
              
              Bus.publish(BusEvent.define("sentry.fix.completed", z.object({
                file: z.string(),
                command: z.string(),
                error: z.string(),
              }) as any), {
                file,
                command,
                error: errorMsg,
              })
            } finally {
              orchestrator.stop()
            }
          }
        } else {
          this.log.info(`Verification passed: ${command}`)
        }
      }

    } catch (e) {
      this.log.error("Verification error", { error: String(e) })
    } finally {
      this.isVerifying = false
      Bus.publish(BusEvent.define("sentry.active", z.object({ active: z.boolean() }) as any), { active: false })
    }
  }
}

