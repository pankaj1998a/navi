/**
 * Config File Watcher
 *
 * Watches for changes to config files and triggers callbacks.
 * Enables hot-reloading of permissions, sources, skills, and statuses.
 */

import { watch } from "fs";
import { Log } from "../util/log";
import { validateConfigFile } from "./validators";
import { permissionsConfigCache } from "../permission/permissions-config";

const log = Log.create({ service: "config-watcher" });

/**
 * Callbacks for config file changes
 */
export interface ConfigWatcherCallbacks {
    onPermissionsChange?: () => void;
    onSkillsChange?: () => void;
    onStatusesChange?: () => void;
    onSourcesChange?: () => void;
    onValidationError?: (file: string, errors: string[]) => void;
    onError?: (file: string, error: Error) => void;
}

/**
 * Config file watcher
 */
export class ConfigWatcher {
    private workspaceRootPath: string;
    private callbacks: ConfigWatcherCallbacks;
    private watcher: ReturnType<typeof watch> | null = null;
    private isRunning = false;

    constructor(workspaceRootPath: string, callbacks: ConfigWatcherCallbacks) {
        this.workspaceRootPath = workspaceRootPath;
        this.callbacks = callbacks;
    }

    /**
     * Start watching for config changes
     */
    start(): void {
        if (this.isRunning) {
            return;
        }

        try {
            this.watcher = watch(this.workspaceRootPath, { recursive: true }, (eventType, filename) => {
                if (!filename) return;

                const filePath = `${this.workspaceRootPath}/${filename}`;
                this.handleFileChange(filePath, eventType);
            });

            this.isRunning = true;
            log.info(`Config watcher started for: ${this.workspaceRootPath}`);
        } catch (error) {
            log.error("Failed to start config watcher:", { error });
            if (this.callbacks.onError) {
                this.callbacks.onError(this.workspaceRootPath, error as Error);
            }
        }
    }

    /**
     * Stop watching for config changes
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.isRunning = false;
        log.info("Config watcher stopped");
    }

    /**
     * Handle file change event
     */
    private handleFileChange(filePath: string, eventType: string): void {
        log.debug(`File changed: ${filePath} (${eventType})`);

        // Validate the file
        const validationResult = validateConfigFile(filePath, this.workspaceRootPath);

        if (validationResult && !validationResult.includes("✓")) {
            // Validation failed
            const errors = validationResult.split("\n").slice(1); // Skip the first line
            log.warn(`Config validation failed for ${filePath}:`, errors);

            if (this.callbacks.onValidationError) {
                this.callbacks.onValidationError(filePath, errors);
            }
            return;
        }

        // Determine which config changed and trigger appropriate callback
        if (filePath.endsWith("permissions.json")) {
            log.info("Permissions config changed");
            permissionsConfigCache.invalidateWorkspace(this.workspaceRootPath);
            if (this.callbacks.onPermissionsChange) {
                this.callbacks.onPermissionsChange();
            }
        } else if (filePath.includes("/skills/")) {
            log.info("Skills config changed");
            if (this.callbacks.onSkillsChange) {
                this.callbacks.onSkillsChange();
            }
        } else if (filePath.endsWith("statuses/config.json")) {
            log.info("Statuses config changed");
            if (this.callbacks.onStatusesChange) {
                this.callbacks.onStatusesChange();
            }
        } else if (filePath.includes("/sources/")) {
            log.info("Sources config changed");
            if (this.callbacks.onSourcesChange) {
                this.callbacks.onSourcesChange();
            }
        }
    }

    /**
     * Check if watcher is running
     */
    isWatching(): boolean {
        return this.isRunning;
    }
}

/**
 * Create a new config watcher
 */
export function createConfigWatcher(
    workspaceRootPath: string,
    callbacks: ConfigWatcherCallbacks
): ConfigWatcher {
    const watcher = new ConfigWatcher(workspaceRootPath, callbacks);
    watcher.start();
    return watcher;
}
