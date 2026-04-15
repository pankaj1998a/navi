import { Log } from "../util/log"
import { Orchestrator, AgentTask } from "./orchestrator"
import { ulid } from "ulid"
import { Bus } from "@/bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { $ } from "bun"
import path from "path"

const log = Log.create({ service: "sentry" })

/**
 * SentryService handles autonomous background healing.
 * It monitors for lint and type errors and proactively spawns
 * fixer agents to resolve them without user intervention.
 */
export class SentryService {
    private static INTERVAL_MS = 45000 // Check every 45 seconds to be conservative
    private timer?: any
    private orchestrator: Orchestrator
    private isWorking: boolean = false

    constructor(orchestrator: Orchestrator) {
        this.orchestrator = orchestrator
    }

    start() {
        if (this.timer) return
        this.timer = setInterval(() => this.checkAndFix(), SentryService.INTERVAL_MS)
        log.info("Sentry service started")
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }

    private async checkAndFix() {
        if (this.isWorking) return
        this.isWorking = true
        
        try {
            // 1. Proactive Diagnostics
            // We run a quiet type-check to catch regression errors
            const res = await $`bun x tsc --noEmit`.nothrow().quiet()
            
            if (res.exitCode !== 0) {
               const output = res.stderr.toString() || res.stdout.toString()
               const errors = this.parseErrors(output)
               
               if (errors.length > 0) {
                  log.info("Sentry detected failures. Activating repair loop...", { 
                      count: errors.length 
                  })
                  
                  Bus.publish(TuiEvent.SentryActive, { active: true })
                  
                  for (const err of errors) {
                      await this.applyFix(err)
                  }
                  
                  Bus.publish(TuiEvent.SentryActive, { active: false })
               }
            }
        } catch (error) {
            log.error("Sentry loop failed", { error })
        } finally {
            this.isWorking = false
        }
    }

    private parseErrors(output: string) {
        const lines = output.split('\n')
        const errors: { file: string; message: string }[] = []
        
        for (const line of lines) {
            // Match TSC format: "src/file.ts(1,2): error TS123: message"
            const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+: .+)$/)
            if (match) {
                const filePath = match[1]
                // Only fix files in the current workspace
                if (filePath.includes('node_modules')) continue
                
                errors.push({ file: filePath, message: match[4] })
            }
        }
        // Limit to 3 fixes per loop to prevent runaway cycles
        return errors.slice(0, 3)
    }

    private async applyFix(error: { file: string; message: string }) {
        log.info("Sentry attempting autonomous fix", { file: error.file })
        
        const task: AgentTask = {
            id: ulid(),
            type: 'fixer' as any,
            description: `Fix the following TypeScript error in ${error.file}: ${error.message}`,
            context: { file: error.file, error: error.message }
        }

        const result = await this.orchestrator.spawnAgent('fixer' as any, task, { autoVerify: true })
        
        if (result.success) {
            Bus.publish(TuiEvent.SentryFixCompleted, {
                file: error.file,
                error: error.message,
                command: 'sentry-fixer'
            })
            log.info("Sentry fix successful", { file: error.file })
        } else {
            log.warn("Sentry fix attempt failed", { file: error.file, error: result.error })
        }
    }
}


