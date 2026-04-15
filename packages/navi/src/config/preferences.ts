/**
 * User Preferences
 *
 * Persistent user preferences for personalization.
 * Stored at ~/.navi/preferences.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { Log } from "../util/log";
import { Global } from "@/global"

const log = Log.create({ service: "preferences" });

/**
 * User location information
 */
export interface UserLocation {
    city?: string;
    region?: string;
    country?: string;
}

/**
 * Thinking pattern for adaptive thinking
 */
export interface ThinkingPattern {
    /** Average task completion time (ms) */
    avgCompletionTime: number;
    /** Preferred thinking level */
    preferredLevel: string;
    /** Success rates by thinking level */
    successRates: Record<string, number>;
    /** Cost sensitivity (0-1, higher = more cost-conscious) */
    costSensitivity: number;
    /** Task history */
    taskHistory?: Array<{
        level: string;
        success: boolean;
        duration: number;
        timestamp: number;
    }>;
}

/**
 * Learning pattern
 */
export interface LearningPattern {
    id: string;
    type: string;
    pattern: string;
    confidence: number;
    usageCount: number;
    successRate: number;
    lastUsed: number;
}

/**
 * User preferences
 */
export interface UserPreferences {
    /** User's preferred name */
    name?: string;
    /** User's timezone in IANA format */
    timezone?: string;
    /** User's location */
    location?: UserLocation;
    /** User's preferred language */
    language?: string;
    /** Additional notes about the user */
    notes?: string;
    /** Thinking pattern for adaptive thinking */
    thinkingPattern?: ThinkingPattern;
    /** Learned patterns from feedback */
    learningPatterns?: LearningPattern[];
    /** Custom models for specific agents (e.g., {"build": "openai/o1"}) */
    agentModels?: Record<string, string>;
}

/**
 * Get path to preferences file
 */
export function getPreferencesPath(): string {
    return join(Global.Path.config, "preferences.json");
}

/**
 * Load user preferences from disk
 */
export function loadPreferences(): UserPreferences {
    const path = getPreferencesPath();

    if (!existsSync(path)) {
        return {};
    }

    try {
        const content = readFileSync(path, "utf-8");
        const parsed = JSON.parse(content);
        log.info("Loaded user preferences");
        return parsed;
    } catch (error) {
        log.error("Error loading preferences:", { error });
        return {};
    }
}

/**
 * Save user preferences to disk
 */
export function savePreferences(preferences: UserPreferences): void {
    const configDir = Global.Path.config;

    // Ensure config directory exists
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }

    const path = getPreferencesPath();

    try {
        writeFileSync(path, JSON.stringify(preferences, null, 2), "utf-8");
        log.info("Saved user preferences");
    } catch (error) {
        log.error("Error saving preferences:", { error });
    }
}

/**
 * Update user preferences (merges with existing)
 */
export function updatePreferences(updates: Partial<UserPreferences>): void {
    const current = loadPreferences();
    const merged = { ...current, ...updates };

    // Handle location updates specially
    if (updates.location) {
        merged.location = { ...current.location, ...updates.location };
    }

    savePreferences(merged);
}

/**
 * Format preferences for display in system prompt
 */
export function formatPreferencesForPrompt(): string {
    const prefs = loadPreferences();
    const parts: string[] = [];

    if (prefs.name) {
        parts.push(`User name: ${prefs.name}`);
    }

    if (prefs.timezone) {
        parts.push(`User timezone: ${prefs.timezone}`);
    }

    if (prefs.location) {
        const locParts: string[] = [];
        if (prefs.location.city) locParts.push(prefs.location.city);
        if (prefs.location.region) locParts.push(prefs.location.region);
        if (prefs.location.country) locParts.push(prefs.location.country);
        if (locParts.length > 0) {
            parts.push(`User location: ${locParts.join(", ")}`);
        }
    }

    if (prefs.language) {
        parts.push(`User language: ${prefs.language}`);
    }

    if (prefs.notes) {
        parts.push(`User notes: ${prefs.notes}`);
    }

    return parts.join("\n");
}

/**
 * Clear all user preferences
 */
export function clearPreferences(): void {
    const path = getPreferencesPath();
    if (existsSync(path)) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require("fs").unlinkSync(path);
            log.info("Cleared user preferences");
        } catch (error) {
            log.error("Error clearing preferences:", { error });
        }
    }
}



