import { Effect, Layer, ServiceMap, Option } from "effect"
import { AppFileSystem } from "@/filesystem"
import { MemoryRecord, MemoryMetadata, MemoryType } from "./schema"
import path from "path"
import matter from "gray-matter"
import { InstanceState } from "@/effect/instance-state"
import { Log } from "@/util/log"

export namespace MemoryService {
    const log = Log.create({ service: "agent.memory" })

    export interface Interface {
        readonly save: (record: Omit<MemoryRecord, "filepath" | "mtimeMs">) => Effect.Effect<void, never, never>
        readonly findRelevant: (query: string, limit?: number) => Effect.Effect<MemoryRecord[], never, never>
    }

    export class Service extends ServiceMap.Service<Service, Interface>()("@navi/Memory") {}

    export const layer = Layer.effect(
        Service,
        Effect.gen(function* () {
            const fs = yield* AppFileSystem.Service
            const ctx = yield* InstanceState.context

            const memoryDir = path.join(ctx.worktree, ".Navi", "memory")

            const scan = Effect.gen(function* () {
                if (!(yield* fs.existsSafe(memoryDir))) return []
                const files = yield* fs.glob("*.md", { cwd: memoryDir, absolute: true, dot: true })
                
                const records: MemoryRecord[] = []
                for (const file of files) {
                    try {
                        const content = yield* fs.readFileString(file)
                        const stats = yield* fs.stat(file)
                        const { data, content: body } = matter(content)
                        
                        const mtime: Date = Option.getOrElse(stats.mtime, () => new Date())
                        
                        records.push({
                            ...(data as MemoryMetadata),
                            content: body.trim(),
                            filepath: file,
                            mtimeMs: mtime.getTime(),
                        })
                    } catch (e) {
                        log.warn("Failed to parse memory file", { file, error: e })
                    }
                }
                return records
            })

            const save = (record: Omit<MemoryRecord, "filepath" | "mtimeMs">) => 
                Effect.gen(function* () {
                    yield* fs.ensureDir(memoryDir)
                    const filename = `${record.type}_${record.name.toLowerCase().replace(/\s+/g, "_")}.md`
                    const filepath = path.join(memoryDir, filename)

                    const frontmatter: MemoryMetadata = {
                        name: record.name,
                        description: record.description,
                        type: record.type,
                        scope: record.scope,
                    }

                    const content = matter.stringify(record.content, frontmatter)
                    yield* fs.writeFileString(filepath, content)
                    log.info("Saved memory", { filepath, type: record.type })
                }).pipe(
                    Effect.catch((error) => {
                        log.error("Failed to save memory", { error })
                        return Effect.void
                    })
                )

            const findRelevant = (query: string, limit: number = 5) => 
                Effect.gen(function* () {
                    const all = yield* scan
                    if (all.length === 0) return []

                    // Simple recall for now: most recently updated
                    return all
                        .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
                        .slice(0, limit)
                }).pipe(
                    Effect.catch((error) => {
                        log.error("Failed to find memories", { error })
                        return Effect.succeed([] as MemoryRecord[])
                    })
                )

            return Service.of({ save, findRelevant })
        })
    )
}
