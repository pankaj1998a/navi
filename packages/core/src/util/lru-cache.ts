/**
 * LRU Cache Implementation
 * 
 * A generic Least Recently Used (LRU) cache with Time-To-Live (TTL) support.
 */

export class LRUCache<K, V> {
    private cache: Map<K, V>
    private maxSize: number
    private ttl: number
    private timestamps: Map<K, number>

    constructor(options: { maxSize: number; ttl: number }) {
        this.cache = new Map()
        this.timestamps = new Map()
        this.maxSize = options.maxSize
        this.ttl = options.ttl
    }

    get(key: K): V | undefined {
        if (!this.cache.has(key)) return undefined

        // Check TTL
        const timestamp = this.timestamps.get(key)!
        if (Date.now() - timestamp > this.ttl) {
            this.delete(key)
            return undefined
        }

        // Move to end (most recently used)
        const value = this.cache.get(key)!
        this.cache.delete(key)
        this.cache.set(key, value)
        return value
    }

    set(key: K, value: V): void {
        // updates existing items to refresh their position and timestamp
        if (this.cache.has(key)) {
            this.delete(key)
        }
        // Evict oldest if at capacity
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value
            if (firstKey !== undefined) {
                this.delete(firstKey)
            }
        }

        this.cache.set(key, value)
        this.timestamps.set(key, Date.now())
    }

    delete(key: K): void {
        this.cache.delete(key)
        this.timestamps.delete(key)
    }

    clear(): void {
        this.cache.clear()
        this.timestamps.clear()
    }

    has(key: K): boolean {
        if (!this.cache.has(key)) return false
        const timestamp = this.timestamps.get(key)!
        if (Date.now() - timestamp > this.ttl) {
            this.delete(key)
            return false
        }
        return true
    }

    getStats(): { size: number; maxSize: number } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        }
    }
}



