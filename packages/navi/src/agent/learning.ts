/**
 * Continuous Learning System
 * 
 * Records successful patterns and improves future task execution.
 * Ported from navi-tsy prototype.
 */

import { Log } from '../util/log'
import fs from 'fs/promises'
import path from 'path'
import { Global } from '../global'

const log = Log.create({ service: 'learning' })

export interface LearningRecord {
    id: string
    taskType: string
    taskDescription: string
    approach: string
    solution: string
    success: boolean
    duration: number
    tokensUsed: number
    timestamp: string
    projectContext?: string
}

export interface LearnedPattern {
    taskType: string
    pattern: string
    successRate: number
    usageCount: number
    lastUsed: string
    avgDuration: number
    exampleApproaches: string[]
}

export interface LearningStats {
    totalRecords: number
    successfulRecords: number
    successRate: number
    patternsLearned: number
    avgTaskDuration: number
}

export class LearningSystem {
    private storagePath: string
    private records: LearningRecord[] = []

    constructor(storagePath?: string) {
        this.storagePath = storagePath || path.join(Global.Path.state, 'learning.json')
    }

    private initialized = false

    async initialize(): Promise<void> {
        if (this.initialized) return

        try {
            const content = await fs.readFile(this.storagePath, 'utf-8')
            this.records = JSON.parse(content)
            log.info(`Loaded ${this.records.length} learning records`)
        } catch {
            this.records = []
            await this.persist()
        }
        this.initialized = true
    }

    async recordAttempt(record: Omit<LearningRecord, 'id' | 'timestamp'>): Promise<void> {
        const fullRecord: LearningRecord = {
            ...record,
            id: this.generateId(),
            timestamp: new Date().toISOString()
        }

        this.records.push(fullRecord)
        await this.persist()

        log.info(`Recorded: ${record.taskType} - ${record.success ? 'SUCCESS' : 'FAILED'}`)
    }

    async getOptimizedPrompt(
        taskType: string,
        taskDescription: string,
        basePrompt: string
    ): Promise<string> {
        const relevantRecords = this.records
            .filter(r => r.taskType === taskType && r.success)
            .slice(-10)

        if (relevantRecords.length === 0) {
            return basePrompt
        }

        const patterns = relevantRecords.map(r => r.approach).filter(Boolean)

        return `
## Learned Patterns for ${taskType}
Based on ${relevantRecords.length} successful completions:

${patterns.slice(0, 3).map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Current Task
${taskDescription}

## Original Prompt
${basePrompt}

## Suggested Approach
Consider applying pattern: ${patterns[0] || 'standard approach'}
    `.trim()
    }

    async getBestApproach(taskType: string): Promise<string | null> {
        const successfulRecords = this.records
            .filter(r => r.taskType === taskType && r.success)

        if (successfulRecords.length === 0) {
            return null
        }

        const approachScores = new Map<string, { count: number; totalDuration: number }>()

        for (const record of successfulRecords) {
            const key = record.approach
            const current = approachScores.get(key) || { count: 0, totalDuration: 0 }
            approachScores.set(key, {
                count: current.count + 1,
                totalDuration: current.totalDuration + record.duration
            })
        }

        let bestApproach: string | null = null
        let bestScore = -1

        for (const [approach, data] of approachScores) {
            const score = data.count / (Math.max(1, data.totalDuration) / 1000)
            if (score > bestScore) {
                bestScore = score
                bestApproach = approach
            }
        }

        return bestApproach
    }

    async getLearnedPatterns(): Promise<LearnedPattern[]> {
        const patterns = new Map<string, LearnedPattern>()

        for (const record of this.records) {
            const existing = patterns.get(record.taskType)

            if (existing) {
                existing.usageCount++
                if (record.success) {
                    const newRate = (existing.successRate * (existing.usageCount - 1) + 100) / existing.usageCount
                    existing.successRate = newRate
                }
                if (record.duration < existing.avgDuration) {
                    existing.avgDuration = record.duration
                }
                if (!existing.exampleApproaches.includes(record.approach)) {
                    existing.exampleApproaches.push(record.approach)
                }
            } else {
                patterns.set(record.taskType, {
                    taskType: record.taskType,
                    pattern: record.approach,
                    successRate: record.success ? 100 : 0,
                    usageCount: 1,
                    lastUsed: record.timestamp,
                    avgDuration: record.duration,
                    exampleApproaches: [record.approach]
                })
            }
        }

        return Array.from(patterns.values())
    }

    async getStats(): Promise<LearningStats> {
        const successful = this.records.filter(r => r.success)
        const avgDuration = this.records.length > 0
            ? this.records.reduce((sum, r) => sum + r.duration, 0) / this.records.length
            : 0

        return {
            totalRecords: this.records.length,
            successfulRecords: successful.length,
            successRate: this.records.length > 0
                ? (successful.length / this.records.length) * 100
                : 0,
            patternsLearned: new Set(this.records.map(r => r.taskType)).size,
            avgTaskDuration: avgDuration
        }
    }

    categorizeTask(taskDescription: string): string {
        const lower = taskDescription.toLowerCase()

        const categories: Record<string, string[]> = {
            'authentication': ['auth', 'login', 'register', 'jwt', 'oauth', 'password'],
            'api-development': ['api', 'endpoint', 'route', 'rest', 'graphql', 'controller'],
            'database': ['database', 'db', 'migration', 'query', 'schema', 'model'],
            'frontend': ['component', 'ui', 'react', 'vue', 'frontend', 'render'],
            'testing': ['test', 'spec', 'unit', 'integration', 'e2e', 'jest'],
            'error-handling': ['error', 'exception', 'try-catch', 'catch', 'handle'],
            'performance': ['optimize', 'performance', 'slow', 'fast', 'cache'],
            'security': ['security', 'vulnerability', 'sql injection', 'xss', 'csrf'],
            'refactoring': ['refactor', 'rewrite', 'improve', 'clean', 'restructure'],
            'documentation': ['doc', 'readme', 'comment', 'explain', 'document']
        }

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(kw => lower.includes(kw))) {
                return category
            }
        }

        return 'general'
    }

    private async persist(): Promise<void> {
        const dir = path.dirname(this.storagePath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(this.storagePath, JSON.stringify(this.records, null, 2))
    }

    private generateId(): string {
        return `lr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    }
}

export const Learning = new LearningSystem()

export async function generateLearningSummary(): Promise<string> {
    await Learning.initialize()
    const stats = await Learning.getStats()
    const patterns = await Learning.getLearnedPatterns()

    return `
Learning Summary:
- Total Records: ${stats.totalRecords}
- Success Rate: ${stats.successRate.toFixed(1)}%
- Patterns Learned: ${patterns.length}

Top Patterns:
${patterns.slice(0, 5).map((p, i) => `${i + 1}. ${p.taskType}: ${p.successRate.toFixed(0)}% success rate`).join('\n')}
  `.trim()
}

export async function suggestToolFromLearning(task: string): Promise<string> {
    await Learning.initialize()

    const taskType = Learning.categorizeTask(task)
    const bestApproach = await Learning.getBestApproach(taskType)

    if (bestApproach) {
        return `Based on your learning history, for "${taskType}" tasks, consider: ${bestApproach}`
    }

    return `No specific pattern found for "${task}". Try general-purpose tools.`
}

export async function learnFromTaskCompletion(
    task: string,
    toolUsed: string,
    success: boolean,
    feedback?: string
): Promise<void> {
    await Learning.initialize()

    const taskType = Learning.categorizeTask(task)

    await Learning.recordAttempt({
        taskType,
        taskDescription: task,
        approach: toolUsed,
        solution: feedback || toolUsed,
        success,
        duration: 0,
        tokensUsed: 0
    })
}


