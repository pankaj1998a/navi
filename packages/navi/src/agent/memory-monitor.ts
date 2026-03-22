/**
 * Memory Monitor
 * 
 * Background monitor for agent memory system.
 * Handles automatic cleanup, eviction under pressure, and usage reporting.
 */

import { MemoryManager } from "./memory-manager"
import { MemoryFacts } from "./memory-facts"
import { Log } from "../util/log"

const log = Log.create({ service: "memory-monitor" })

export namespace MemoryMonitor {
    // Thresholds
    const SHORT_TERM_WARNING_THRESHOLD = 0.8  // 80% usage
    const SHORT_TERM_CRITICAL_THRESHOLD = 0.95 // 95% usage triggers eviction

    let interval: ReturnType<typeof setInterval> | null = null

    /**
     * Start the memory monitor
     */
    export function start(checkIntervalMs: number = 60_000): void {
        if (interval) return

        // Start MemoryManager background cleanup as well
        MemoryManager.startBackgroundCleanup()

        interval = setInterval(async () => {
            try {
                await check()
            } catch (e) {
                log.error("memory monitor check failed", { error: e })
            }
        }, checkIntervalMs)

        log.info("memory monitor started")
    }

    /**
     * Stop the memory monitor
     */
    export function stop(): void {
        if (interval) {
            clearInterval(interval)
            interval = null
        }
        MemoryManager.stopBackgroundCleanup()
        log.info("memory monitor stopped")
    }

    /**
     * Perform a memory pressure check and take action if needed
     */
    export async function check(): Promise<void> {
        const stats = await MemoryManager.stats()
        const shortTermUsage = stats.shortTerm.tokens / stats.shortTerm.maxTokens

        if (shortTermUsage > SHORT_TERM_CRITICAL_THRESHOLD) {
            log.warn("critical memory pressure detected, evicting", { usage: shortTermUsage })
            await MemoryManager.evict({ tier: "short" })
        } else if (shortTermUsage > SHORT_TERM_WARNING_THRESHOLD) {
            log.info("high memory usage detected", { usage: shortTermUsage })
        }

        // Check medium-term count
        if (stats.mediumTerm.count > 0.9 * stats.mediumTerm.maxEntries) {
            log.info("high medium-term entry count, evicting", { count: stats.mediumTerm.count })
            await MemoryManager.evict({ tier: "medium" })
        }

        const hygiene = await MemoryFacts.cleanupAllProjectFacts({ maxPerKind: 4 })
        if (hygiene.removed > 0) {
            log.info("memory hygiene cleaned project facts", hygiene)
        }
    }
}
