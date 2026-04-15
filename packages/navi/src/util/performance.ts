import { Log } from "./log"

export interface PerformanceMetrics {
    tokensUsed: number
    responseTime: number
    contextSize: number
    cacheHits: number
    cacheMisses: number
    agentSpawnTime?: number
    toolExecutionTime?: number
    validationTime?: number
    totalCost?: number
}

export class PerformanceTracker {
    private static metrics: PerformanceMetrics[] = []
    private static log = Log.create({ service: "performance" })

    static record(metric: Partial<PerformanceMetrics>) {
        const fullMetric: PerformanceMetrics = {
            tokensUsed: 0,
            responseTime: 0,
            contextSize: 0,
            cacheHits: 0,
            cacheMisses: 0,
            ...metric,
        }
        this.metrics.push(fullMetric)
        this.log.info("metric recorded", fullMetric)
    }

    static getSummary() {
        return {
            totalTokens: this.metrics.reduce((acc, m) => acc + m.tokensUsed, 0),
            avgResponseTime: this.metrics.length > 0
                ? this.metrics.reduce((acc, m) => acc + m.responseTime, 0) / this.metrics.length
                : 0,
            totalCost: this.metrics.reduce((acc, m) => acc + (m.totalCost ?? 0), 0),
        }
    }

    static exportResults(): string {
        return JSON.stringify(this.metrics, null, 2)
    }
}

// Compatibility layer for existing Performance usage
export const Performance = {
    profiler: {
        profile: async (name: string, fn: () => Promise<any>, metadata?: any) => {
            const start = Date.now()
            const result = await fn()
            const duration = Date.now() - start
            PerformanceTracker.record({ responseTime: duration })
            return result
        },
        getProfilingResult: (name: string) => {
            return {
                totalDuration: 0,
                avgDuration: 0,
                metrics: {}
            }
        }
    },
    runWithTimeout: async (fn: () => Promise<any>, timeoutMs: number, name?: string) => {
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout: ${name || 'Operation'} exceeded ${timeoutMs}ms`)), timeoutMs)
        })
        return Promise.race([fn(), timeout])
    }
}



