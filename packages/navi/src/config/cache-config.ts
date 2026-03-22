import { LRUCache } from "../util/lru-cache"

export const CacheConfig = {
    webSearch: { maxSize: 100, ttl: 300000 }, // 5 mins
    webFetch: { maxSize: 200, ttl: 300000 }, // 5 mins
    mcpTools: { maxSize: 50, ttl: 3600000 }, // 1 hour
    agentMemory: { maxSize: 1000, ttl: 1800000 }, // 30 mins
    fileInfo: { maxSize: 5000, ttl: 60000 }, // 1 min (for git status etc)
}

export class CacheManager {
    private static instance: CacheManager
    private caches: Map<string, LRUCache<any, any>> = new Map()

    private constructor() { }

    static getInstance(): CacheManager {
        if (!CacheManager.instance) {
            CacheManager.instance = new CacheManager()
        }
        return CacheManager.instance
    }

    getCache<K = string, V = any>(name: keyof typeof CacheConfig): LRUCache<K, V> {
        if (!this.caches.has(name)) {
            const config = CacheConfig[name]
            this.caches.set(name, new LRUCache<K, V>(config))
        }
        return this.caches.get(name)! as LRUCache<K, V>
    }

    getCustomCache<K, V>(name: string, config: { maxSize: number; ttl: number }): LRUCache<K, V> {
        if (!this.caches.has(name)) {
            this.caches.set(name, new LRUCache<K, V>(config))
        }
        return this.caches.get(name)! as LRUCache<K, V>
    }

    clearAll(): void {
        for (const cache of this.caches.values()) {
            cache.clear()
        }
    }

    getStats(): Record<string, { size: number; maxSize: number }> {
        const stats: Record<string, any> = {}
        for (const [name, cache] of this.caches.entries()) {
            stats[name] = cache.getStats()
        }
        return stats
    }
}
