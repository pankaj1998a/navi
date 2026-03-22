import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { Global } from "../global"
import { lazy } from "../util/lazy"
import { $ } from "bun"
import { Database } from "bun:sqlite"
import { NamedError } from "@navi-ai/sdk/util/error"
import z from "zod"

export namespace Storage {
    const log = Log.create({ service: "storage" })

    type Migration = (dir: string) => Promise<void>

    export const NotFoundError = NamedError.create(
        "NotFoundError",
        z.object({
            message: z.string(),
        }),
    )

    const MIGRATIONS: Migration[] = [
        async (dir) => {
            const project = path.resolve(dir, "../project")
            const info = await fs.stat(project).catch(() => undefined)
            if (!info?.isDirectory()) return
            for await (const projectDir of new Bun.Glob("*").scan({
                cwd: project,
                onlyFiles: false,
            })) {
                log.info(`migrating project ${projectDir}`)
                let projectID = projectDir
                const fullProjectDir = path.join(project, projectDir)
                let worktree = "/"

                if (projectID !== "global") {
                    for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
                        cwd: path.join(project, projectDir),
                        absolute: true,
                    })) {
                        const json = await Bun.file(msgFile).json()
                        worktree = json.path?.root
                        if (worktree) break
                    }
                    if (!worktree) continue
                    const wtInfo = await fs.stat(worktree).catch(() => undefined)
                    if (!wtInfo?.isDirectory()) continue
                    const [id] = await $`git rev-list --max-parents=0 --all`
                        .quiet()
                        .nothrow()
                        .cwd(worktree)
                        .text()
                        .then((x) =>
                            x
                                .split("\n")
                                .filter(Boolean)
                                .map((x) => x.trim())
                                .toSorted(),
                        )
                    if (!id) continue
                    projectID = id

                    await Bun.write(
                        path.join(dir, "project", projectID + ".json"),
                        JSON.stringify({
                            id,
                            vcs: "git",
                            worktree,
                            time: {
                                created: Date.now(),
                                initialized: Date.now(),
                            },
                        }),
                    )

                    log.info(`migrating sessions for project ${projectID}`)
                    for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
                        cwd: fullProjectDir,
                        absolute: true,
                    })) {
                        const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
                        log.info("copying", {
                            sessionFile,
                            dest,
                        })
                        const session = await Bun.file(sessionFile).json()
                        await Bun.write(dest, JSON.stringify(session))
                        log.info(`migrating messages for session ${session.id}`)
                        for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
                            cwd: fullProjectDir,
                            absolute: true,
                        })) {
                            const dest = path.join(dir, "message", session.id, path.basename(msgFile))
                            log.info("copying", {
                                msgFile,
                                dest,
                            })
                            const message = await Bun.file(msgFile).json()
                            await Bun.write(dest, JSON.stringify(message))

                            log.info(`migrating parts for message ${message.id}`)
                            for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                                {
                                    cwd: fullProjectDir,
                                    absolute: true,
                                },
                            )) {
                                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                                const part = await Bun.file(partFile).json()
                                log.info("copying", {
                                    partFile,
                                    dest,
                                })
                                await Bun.write(dest, JSON.stringify(part))
                            }
                        }
                    }
                }
            }
        },
        async (dir) => {
            for await (const item of new Bun.Glob("session/*/*.json").scan({
                cwd: dir,
                absolute: true,
            })) {
                const session = await Bun.file(item).json()
                if (!session.projectID) continue
                if (!session.summary?.diffs) continue
                const { diffs } = session.summary
                await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
                await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
                    JSON.stringify({
                        ...session,
                        summary: {
                            additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
                            deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
                        },
                    }),
                )
            }
        },
        // Migration 3: Import existing JSON files into SQLite
        async (dir) => {
            const dbPath = path.join(dir, "navi.db")
            // Only migrate if there are JSON files but no database yet
            const dbExists = await fs.stat(dbPath).catch(() => undefined)
            if (dbExists) return

            const db = new Database(dbPath)
            db.exec("PRAGMA journal_mode=WAL")
            db.exec("PRAGMA busy_timeout = 30000")
            db.exec("PRAGMA synchronous=NORMAL")
            db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

            const insertStmt = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
            const glob = new Bun.Glob("**/*.json")

            let count = 0
            const transaction = db.transaction(() => {
                // We'll collect entries first, then batch insert
            })

            const entries: [string, string][] = []

            for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
                // Skip migration file and the db itself
                if (file === "migration" || file.endsWith(".db")) continue
                try {
                    const fullPath = path.join(dir, file)
                    const content = await Bun.file(fullPath).text()
                    // Convert file path to key: remove .json extension, use '/' separator
                    const key = file.slice(0, -5).split(path.sep).join("/")
                    entries.push([key, content])
                    count++
                } catch {
                    // Skip files that can't be read
                }
            }

            // Batch insert in a transaction
            if (entries.length > 0) {
                db.transaction(() => {
                    for (const [key, value] of entries) {
                        insertStmt.run(key, value)
                    }
                })()
            }

            db.close()
            log.info("SQLite migration complete", { count })
        },
    ]

    // SQLite database instance
    let db: Database | null = null
    let lockFilePath: string | null = null

    function getDb(dir: string): Database {
        if (!db) {
            const dbPath = path.join(dir, "navi.db")
            db = new Database(dbPath)
            // Use WAL mode for better concurrency - allows multiple readers with one writer
            db.exec("PRAGMA journal_mode=WAL")
            // Increase busy_timeout to 30 seconds to wait for locks
            db.exec("PRAGMA busy_timeout = 30000")
            db.exec("PRAGMA synchronous=NORMAL")
            db.exec("PRAGMA cache_size=-8000") // 8MB cache
            db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

            // Store lock file path for cross-process locking
            lockFilePath = path.join(dir, "navi.db.lock")
        }
        return db
    }

    // Prepared statements (lazily initialized)
    let stmts: {
        read: ReturnType<Database["prepare"]>
        write: ReturnType<Database["prepare"]>
        remove: ReturnType<Database["prepare"]>
        list: ReturnType<Database["prepare"]>
    } | null = null

    function getStmts(database: Database) {
        if (!stmts) {
            stmts = {
                read: database.prepare("SELECT value FROM kv WHERE key = ?"),
                write: database.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)"),
                remove: database.prepare("DELETE FROM kv WHERE key = ?"),
                list: database.prepare("SELECT key FROM kv WHERE key LIKE ? ORDER BY key"),
            }
        }
        return stmts
    }

    /**
     * Cross-process file lock using lock file with exclusive creation
     * This works on Windows, Linux, and macOS
     */
    async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
        if (!lockFilePath) {
            throw new Error("Database not initialized")
        }

        // Ensure lock directory exists
        await fs.mkdir(path.dirname(lockFilePath), { recursive: true })

        let lockFd: fsSync.promises.FileHandle | null = null
        let retries = 0
        const maxRetries = 50 // 5 seconds max
        const retryDelay = 100

        while (retries < maxRetries) {
            try {
                // Try to create lock file exclusively (fails if exists)
                // Using 'wx' flag for exclusive creation
                lockFd = await fs.open(lockFilePath, "wx")

                // We got the lock, execute the function
                try {
                    const result = await fn()
                    return result
                } finally {
                    // Release the lock
                    await lockFd.close()
                    await fs.unlink(lockFilePath).catch(() => { })
                }
            } catch (e: any) {
                if (e.code === "EEXIST") {
                    // Lock file exists, wait and retry
                    retries++
                    if (retries >= maxRetries) {
                        throw new Error("Failed to acquire database lock after 5 seconds")
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay))
                } else if (e.code === "EPERM" || e.code === "EACCES") {
                    // Permission error on Windows, might mean file is locked
                    retries++
                    if (retries >= maxRetries) {
                        throw new Error("Failed to acquire database lock after 5 seconds")
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay))
                } else {
                    throw e
                }
            }
        }

        throw new Error("Failed to acquire database lock")
    }

    /**
     * Retry a database operation with exponential backoff
     */
    async function withRetry<T>(
        operation: () => T,
        options: {
            maxRetries?: number
            baseDelay?: number
            maxDelay?: number
            operationName?: string
        } = {}
    ): Promise<T> {
        const {
            maxRetries = 5,
            baseDelay = 100,
            maxDelay = 5000,
            operationName = "database operation"
        } = options

        let lastError: Error | null = null

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return operation()
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e))

                // Check if it's a SQLite busy/lock error
                const isBusyError =
                    lastError.message?.includes("SQLITE_BUSY") ||
                    lastError.message?.includes("database is locked") ||
                    lastError.message?.includes("SQLITE_LOCKED")

                if (!isBusyError || attempt === maxRetries) {
                    throw lastError
                }

                // Exponential backoff with jitter
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt) + Math.random() * 100,
                    maxDelay
                )

                log.warn("SQLite busy, retrying...", {
                    attempt: attempt + 1,
                    delay: Math.round(delay),
                    operation: operationName
                })

                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }

        throw lastError
    }

    const state = lazy(async () => {
        const dir = path.join(Global.Path.data, "storage")
        const migration = await Bun.file(path.join(dir, "migration"))
            .json()
            .then((x) => parseInt(x))
            .catch(() => 0)

        // Ensure directories exist before migration
        await fs.mkdir(path.join(dir, "project"), { recursive: true })
        await fs.mkdir(path.join(dir, "session"), { recursive: true })
        await fs.mkdir(path.join(dir, "session_diff"), { recursive: true })

        for (let index = migration; index < MIGRATIONS.length; index++) {
            log.info("running migration", { index })
            const migration = MIGRATIONS[index]
            await migration(dir).catch((err) => {
                log.error("failed to run migration", { index, error: err })
                throw err
            })
            await Bun.write(path.join(dir, "migration"), (index + 1).toString())
        }

        // Initialize SQLite
        const database = getDb(dir)
        log.info("SQLite storage initialized", { path: path.join(dir, "navi.db") })

        return {
            dir,
            db: database,
        }
    })

    export async function remove(key: string[]) {
        const { db: database } = await state()
        const keyStr = key.join("/")
        return withErrorHandling(async () => {
            return withFileLock(async () =>
                withRetry(
                    () => getStmts(database).remove.run(keyStr),
                    { operationName: `remove(${keyStr})` }
                )
            )
        })
    }

    export async function read<T>(key: string[]) {
        const { db: database } = await state()
        const keyStr = key.join("/")
        return withErrorHandling(async () => {
            // Read operations don't need file lock in WAL mode
            // SQLite handles concurrent reads
            return withRetry(
                () => {
                    const row = getStmts(database).read.get(keyStr) as { value: string } | null
                    if (!row) {
                        throw new NotFoundError({ message: `Resource not found: ${keyStr}` })
                    }
                    return JSON.parse(row.value) as T
                },
                { operationName: `read(${keyStr})` }
            )
        })
    }

    export async function update<T>(key: string[], fn: (draft: T) => void) {
        const { db: database } = await state()
        const keyStr = key.join("/")
        return withErrorHandling(async () => {
            // Use file lock for cross-process synchronization during update
            return withFileLock(async () => {
                return withRetry(
                    () => {
                        const row = getStmts(database).read.get(keyStr) as { value: string } | null
                        if (!row) {
                            throw new NotFoundError({ message: `Resource not found: ${keyStr}` })
                        }
                        const content = JSON.parse(row.value)
                        fn(content)
                        getStmts(database).write.run(keyStr, JSON.stringify(content))
                        return content as T
                    },
                    { operationName: `update(${keyStr})` }
                )
            })
        })
    }

    export async function write<T>(key: string[], content: T) {
        const { db: database } = await state()
        const keyStr = key.join("/")
        return withErrorHandling(async () => {
            return withFileLock(async () =>
                withRetry(
                    () => getStmts(database).write.run(keyStr, JSON.stringify(content)),
                    { operationName: `write(${keyStr})` }
                )
            )
        })
    }

    async function withErrorHandling<T>(body: () => Promise<T>) {
        return body().catch((e) => {
            if (e instanceof NotFoundError) throw e
            if (!(e instanceof Error)) throw e
            const errnoException = e as NodeJS.ErrnoException
            if (errnoException.code === "ENOENT") {
                throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
            }
            throw e
        })
    }

    export async function list(prefix: string[]) {
        const { db: database } = await state()
        const keyPrefix = prefix.join("/")
        try {
            // Read operations don't need file lock in WAL mode
            return withRetry(
                () => {
                    const rows = getStmts(database).list.all(keyPrefix + "/%") as { key: string }[]
                    return rows.map((row) => row.key.split("/"))
                },
                { operationName: `list(${keyPrefix})` }
            )
        } catch {
            return []
        }
    }

    /**
     * Reset the storage state (for testing)
     */
    export function reset() {
        if (db) {
            db.close()
            db = null
        }
        stmts = null
        state.reset()
    }
}
