/**
 * Memory Manager
 * 
 * Central orchestrator for tiered agent memory enabling 24-hour continuous operation.
 * 
 * Tiers:
 * - Short-term: In-context working memory (session-scoped)
 * - Medium-term: Disk-backed summaries and checkpoints (24h TTL)
 * - Long-term: Indexed, searchable persistent memory (indefinite)
 */

import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Token } from "../util/token"

const log = Log.create({ service: "memory-manager" })

export namespace MemoryManager {
    export type MemoryTier = "short" | "medium" | "long"

    export interface MemoryEntry {
        id: string
        tier: MemoryTier
        content: string
        importance: number       // 0-1, higher = more important
        accessCount: number
        createdAt: number
        lastAccessed: number
        expiresAt?: number       // undefined = never expires
        tags: string[]
        metadata: Record<string, any>
    }

    export interface StoreOptions {
        tier?: MemoryTier
        importance?: number
        tags?: string[]
        ttlMs?: number
        metadata?: Record<string, any>
    }

    export interface RecallOptions {
        tier?: MemoryTier
        limit?: number
        minImportance?: number
        tags?: string[]
        includeExpired?: boolean
    }

    // Configuration
    const CONFIG = {
        SHORT_TERM_MAX_TOKENS: 40_000,
        MEDIUM_TERM_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
        MEDIUM_TERM_MAX_ENTRIES: 1000,
        LONG_TERM_PROMOTION_THRESHOLD: 0.7,
        CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
    }

    // In-memory cache for short-term
    const shortTermCache = new Map<string, MemoryEntry>()
    let shortTermTokens = 0

    /**
     * Store a memory entry
     */
    export async function store(
        content: string,
        options: StoreOptions = {}
    ): Promise<MemoryEntry> {
        const tier = options.tier ?? "short"
        const now = Date.now()

        const entry: MemoryEntry = {
            id: generateId(),
            tier,
            content,
            importance: options.importance ?? 0.5,
            accessCount: 0,
            createdAt: now,
            lastAccessed: now,
            expiresAt: options.ttlMs ? now + options.ttlMs : undefined,
            tags: options.tags ?? [],
            metadata: options.metadata ?? {},
        }

        if (tier === "short") {
            await storeShortTerm(entry)
        } else if (tier === "medium") {
            entry.expiresAt = entry.expiresAt ?? now + CONFIG.MEDIUM_TERM_TTL_MS
            await storeMediumTerm(entry)
        } else {
            entry.expiresAt = undefined // Long-term never expires
            await storeLongTerm(entry)
        }

        log.info("stored memory", { id: entry.id, tier, importance: entry.importance })
        return entry
    }

    /**
     * Recall memories matching criteria
     */
    export async function recall(options: RecallOptions = {}): Promise<MemoryEntry[]> {
        const results: MemoryEntry[] = []
        const limit = options.limit ?? 10
        const now = Date.now()

        if (!options.tier || options.tier === "short") {
            for (const entry of shortTermCache.values()) {
                if (matchesFilters(entry, options, now)) {
                    results.push(entry)
                }
            }
        }

        if (!options.tier || options.tier === "medium") {
            const mediumEntries = await loadMediumTerm()
            for (const entry of mediumEntries) {
                if (matchesFilters(entry, options, now)) {
                    results.push(entry)
                }
            }
        }

        // Only load long-term if explicitly requested, as it's expensive
        if (options.tier === "long") {
            const longEntries = await loadLongTerm()
            for (const entry of longEntries) {
                if (matchesFilters(entry, options, now)) {
                    results.push(entry)
                }
            }
        }

        // Sort by importance and recency
        results.sort((a, b) => {
            const scoreA = a.importance * 0.7 + (a.lastAccessed / now) * 0.3
            const scoreB = b.importance * 0.7 + (b.lastAccessed / now) * 0.3
            return scoreB - scoreA
        })

        // Update access counts for returned entries
        const limited = results.slice(0, limit)
        for (const entry of limited) {
            await touch(entry.id)
        }

        return limited
    }

    /**
     * Search memories by content similarity
     */
    export async function search(
        query: string,
        options: RecallOptions = {}
    ): Promise<MemoryEntry[]> {
        const allEntries = await recall({ ...options, limit: 1000 })
        const queryLower = query.toLowerCase()

        // Simple keyword matching (TODO: replace with embeddings)
        const scored = allEntries.map(entry => {
            const contentLower = entry.content.toLowerCase()
            let score = 0

            // Exact substring match
            if (contentLower.includes(queryLower)) {
                score += 1.0
            }

            // Word overlap
            const queryWords = queryLower.split(/\s+/)
            const contentWords = new Set(contentLower.split(/\s+/))
            const overlap = queryWords.filter(w => contentWords.has(w)).length
            score += overlap / queryWords.length * 0.5

            // Tag match
            for (const tag of entry.tags) {
                if (queryLower.includes(tag.toLowerCase())) {
                    score += 0.3
                }
            }

            return { entry, score }
        })

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, options.limit ?? 10)
            .map(s => s.entry)
    }

    /**
     * Promote a memory to a higher tier
     */
    export async function promote(id: string): Promise<MemoryEntry | null> {
        // Find entry in any tier
        let entry = shortTermCache.get(id)
        if (entry) {
            await remove(id)
            entry.tier = "medium"
            await storeMediumTerm(entry)
            log.info("promoted memory", { id, from: "short", to: "medium" })
            return entry
        }

        const mediumEntries = await loadMediumTerm()
        entry = mediumEntries.find(e => e.id === id)
        if (entry) {
            await remove(id)
            entry.tier = "long"
            entry.expiresAt = undefined
            await storeLongTerm(entry)
            log.info("promoted memory", { id, from: "medium", to: "long" })
            return entry
        }

        return null
    }

    /**
     * Remove a memory entry
     */
    export async function remove(id: string): Promise<boolean> {
        // Try short-term
        if (shortTermCache.has(id)) {
            const entry = shortTermCache.get(id)!
            shortTermTokens -= Token.estimate(entry.content)
            shortTermCache.delete(id)
            return true
        }

        // Try medium-term
        try {
            const entries = await loadMediumTerm()
            const filtered = entries.filter(e => e.id !== id)
            if (filtered.length < entries.length) {
                await saveMediumTerm(filtered)
                return true
            }
        } catch { }

        // Try long-term
        try {
            await Storage.remove(["memory", "long", id])
            return true
        } catch { }

        return false
    }

    /**
     * Get memory usage statistics
     */
    export async function stats(): Promise<{
        shortTerm: { count: number; tokens: number; maxTokens: number }
        mediumTerm: { count: number; maxEntries: number }
        longTerm: { count: number }
    }> {
        const mediumEntries = await loadMediumTerm().catch(() => [])
        const longKeys = await Storage.list(["memory", "long"]).catch(() => [])

        return {
            shortTerm: {
                count: shortTermCache.size,
                tokens: shortTermTokens,
                maxTokens: CONFIG.SHORT_TERM_MAX_TOKENS,
            },
            mediumTerm: {
                count: mediumEntries.length,
                maxEntries: CONFIG.MEDIUM_TERM_MAX_ENTRIES,
            },
            longTerm: {
                count: longKeys.length,
            },
        }
    }

    /**
     * Evict entries to free up space
     */
    export async function evict(options: {
        tier?: MemoryTier
        targetTokens?: number
        targetCount?: number
    } = {}): Promise<number> {
        let evicted = 0

        if (!options.tier || options.tier === "short") {
            const targetTokens = options.targetTokens ?? CONFIG.SHORT_TERM_MAX_TOKENS * 0.5
            while (shortTermTokens > targetTokens && shortTermCache.size > 0) {
                // Find lowest importance entry
                let lowest: MemoryEntry | null = null
                for (const entry of shortTermCache.values()) {
                    if (!lowest || entry.importance < lowest.importance) {
                        lowest = entry
                    }
                }
                if (lowest) {
                    await remove(lowest.id)
                    evicted++
                }
            }
        }

        if (!options.tier || options.tier === "medium") {
            const entries = await loadMediumTerm()
            const targetCount = options.targetCount ?? CONFIG.MEDIUM_TERM_MAX_ENTRIES * 0.5
            if (entries.length > targetCount) {
                // Sort by importance (ascending) and remove lowest
                entries.sort((a, b) => a.importance - b.importance)
                const toRemove = entries.slice(0, entries.length - targetCount)
                const remaining = entries.slice(entries.length - targetCount)
                await saveMediumTerm(remaining)
                evicted += toRemove.length
            }
        }

        log.info("evicted memories", { count: evicted })
        return evicted
    }

    /**
     * Cleanup expired entries
     */
    export async function cleanup(): Promise<number> {
        const now = Date.now()
        let cleaned = 0

        // Short-term: check expiry
        for (const [id, entry] of shortTermCache) {
            if (entry.expiresAt && entry.expiresAt < now) {
                await remove(id)
                cleaned++
            }
        }

        // Medium-term: check expiry
        const mediumEntries = await loadMediumTerm()
        const validMedium = mediumEntries.filter(e => !e.expiresAt || e.expiresAt >= now)
        if (validMedium.length < mediumEntries.length) {
            cleaned += mediumEntries.length - validMedium.length
            await saveMediumTerm(validMedium)
        }

        // Auto-promote high-importance medium-term to long-term
        for (const entry of validMedium) {
            if (entry.importance >= CONFIG.LONG_TERM_PROMOTION_THRESHOLD && entry.accessCount >= 3) {
                await promote(entry.id)
            }
        }

        if (cleaned > 0) {
            log.info("cleaned up expired memories", { count: cleaned })
        }

        return cleaned
    }

    /**
     * Reset the memory manager (for testing)
     */
    export function reset(): void {
        shortTermCache.clear()
        shortTermTokens = 0
        log.info("reset memory manager")
    }

    // --- Private helpers ---

    function generateId(): string {
        return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    }

    function matchesFilters(entry: MemoryEntry, options: RecallOptions, now: number): boolean {
        if (!options.includeExpired && entry.expiresAt && entry.expiresAt < now) {
            return false
        }
        if (options.minImportance !== undefined && entry.importance < options.minImportance) {
            return false
        }
        if (options.tags && options.tags.length > 0) {
            const hasTag = options.tags.some(t => entry.tags.includes(t))
            if (!hasTag) return false
        }
        return true
    }

    async function touch(id: string): Promise<void> {
        const entry = shortTermCache.get(id)
        if (entry) {
            entry.accessCount++
            entry.lastAccessed = Date.now()
            return
        }

        // For disk-backed tiers, update is more expensive
        // Only update if accessed multiple times
    }

    async function storeShortTerm(entry: MemoryEntry): Promise<void> {
        const tokens = Token.estimate(entry.content)

        // Evict if over limit
        while (shortTermTokens + tokens > CONFIG.SHORT_TERM_MAX_TOKENS && shortTermCache.size > 0) {
            let oldest: MemoryEntry | null = null
            for (const e of shortTermCache.values()) {
                if (!oldest || e.lastAccessed < oldest.lastAccessed) {
                    oldest = e
                }
            }
            if (oldest) {
                // Promote to medium-term before evicting if important
                if (oldest.importance >= 0.6) {
                    await promote(oldest.id)
                } else {
                    await remove(oldest.id)
                }
            }
        }

        shortTermCache.set(entry.id, entry)
        shortTermTokens += tokens
    }

    async function storeMediumTerm(entry: MemoryEntry): Promise<void> {
        const entries = await loadMediumTerm()
        entries.push(entry)

        // Enforce max entries
        if (entries.length > CONFIG.MEDIUM_TERM_MAX_ENTRIES) {
            entries.sort((a, b) => a.importance - b.importance)
            entries.splice(0, entries.length - CONFIG.MEDIUM_TERM_MAX_ENTRIES)
        }

        await saveMediumTerm(entries)
    }

    async function storeLongTerm(entry: MemoryEntry): Promise<void> {
        await Storage.write(["memory", "long", entry.id], entry)
    }

    async function loadMediumTerm(): Promise<MemoryEntry[]> {
        return await Storage.read<MemoryEntry[]>(["memory", "medium", "entries"]).catch(() => [])
    }

    async function saveMediumTerm(entries: MemoryEntry[]): Promise<void> {
        await Storage.write(["memory", "medium", "entries"], entries)
    }

    async function loadLongTerm(): Promise<MemoryEntry[]> {
        const keys = await Storage.list(["memory", "long"]).catch(() => [])
        const entries: MemoryEntry[] = []
        for (const key of keys) {
            try {
                const entry = await Storage.read<MemoryEntry>(key)
                entries.push(entry)
            } catch { }
        }
        return entries
    }

    // Start background cleanup
    let cleanupInterval: ReturnType<typeof setInterval> | null = null

    export function startBackgroundCleanup(): void {
        if (cleanupInterval) return
        cleanupInterval = setInterval(() => {
            cleanup().catch(e => log.error("cleanup failed", { error: e }))
        }, CONFIG.CLEANUP_INTERVAL_MS)
    }

    export function stopBackgroundCleanup(): void {
        if (cleanupInterval) {
            clearInterval(cleanupInterval)
            cleanupInterval = null
        }
    }
}


