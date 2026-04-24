/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shared memory store for cross-agent coordination.
 * Enables agents to share context and coordinate on complex tasks.
 */

import { debugLogger } from '../util/debugLogger.ts';

/** Value with metadata for the shared memory store */
interface MemoryEntry<T = unknown> {
    value: T;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    ttlMs?: number;
}

/**
 * Shared memory store for cross-agent coordination.
 * Provides a thread-safe key-value store that agents can use
 * to share context and coordinate actions.
 */
export class AgentMemory {
    private static instance: AgentMemory;
    private store = new Map<string, MemoryEntry>();

    private constructor() { }

    /**
     * Gets the singleton instance of AgentMemory.
     */
    static getInstance(): AgentMemory {
        if (!AgentMemory.instance) {
            AgentMemory.instance = new AgentMemory();
        }
        return AgentMemory.instance;
    }

    /**
     * Resets the singleton instance. Only for testing.
     * @internal
     */
    static resetForTesting(): void {
        AgentMemory.instance = new AgentMemory();
    }

    /**
     * Sets a value in shared memory.
     * 
     * @param key The key to store the value under
     * @param value The value to store
     * @param agentName The name of the agent setting the value
     * @param ttlMs Optional TTL in milliseconds
     */
    set<T>(key: string, value: T, agentName: string, ttlMs?: number): void {
        const now = Date.now();
        const existing = this.store.get(key);

        this.store.set(key, {
            value,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            createdBy: agentName,
            ttlMs,
        });

        debugLogger.debug(`[AgentMemory] Set '${key}' by ${agentName}`);
    }

    /**
     * Gets a value from shared memory.
     * 
     * @param key The key to retrieve
     * @returns The value or undefined if not found or expired
     */
    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        // Check TTL
        if (entry.ttlMs && Date.now() - entry.updatedAt > entry.ttlMs) {
            this.store.delete(key);
            debugLogger.debug(`[AgentMemory] Key '${key}' expired`);
            return undefined;
        }

        return entry.value as T;
    }

    /**
     * Checks if a key exists in shared memory.
     */
    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    /**
     * Deletes a key from shared memory.
     */
    delete(key: string): boolean {
        return this.store.delete(key);
    }

    /**
     * Clears all entries from shared memory.
     */
    clear(): void {
        this.store.clear();
        debugLogger.debug('[AgentMemory] Cleared all entries');
    }

    /**
     * Gets all keys in shared memory.
     */
    keys(): string[] {
        // Clean up expired entries first
        this.cleanupExpired();
        return Array.from(this.store.keys());
    }

    /**
     * Gets the metadata for a key.
     */
    getMetadata(key: string): Omit<MemoryEntry, 'value'> | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        const { value: _value, ...metadata } = entry;
        return metadata;
    }

    /**
     * Appends to an array value in shared memory.
     * Creates the array if it doesn't exist.
     */
    append<T>(key: string, value: T, agentName: string): void {
        const existing = this.get<T[]>(key);
        const array = Array.isArray(existing) ? existing : [];
        array.push(value);
        this.set(key, array, agentName);
    }

    /**
     * Increments a numeric value in shared memory.
     * Initializes to 0 if doesn't exist.
     */
    increment(key: string, agentName: string, amount = 1): number {
        const existing = this.get<number>(key);
        const newValue = (existing ?? 0) + amount;
        this.set(key, newValue, agentName);
        return newValue;
    }

    /**
     * Cleans up expired entries.
     */
    private cleanupExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (entry.ttlMs && now - entry.updatedAt > entry.ttlMs) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Gets statistics about the memory store.
     */
    getStats(): { size: number; keys: string[] } {
        this.cleanupExpired();
        return {
            size: this.store.size,
            keys: Array.from(this.store.keys()),
        };
    }
}

