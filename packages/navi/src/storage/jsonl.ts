import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Flock } from "../util/flock"
import { Filesystem } from "../util/filesystem"
import { isEnoent } from "../util/error"

export namespace JsonlStorage {
  const root = path.join(Global.Path.data, "jsonl")

  async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true })
  }

  export async function append(collection: string, id: string, item: any) {
    const dir = path.join(root, collection)
    await ensureDir(dir)
    const file = path.join(dir, `${id}.jsonl`)
    
    await Flock.withLock(file, async () => {
      await fs.appendFile(file, JSON.stringify(item) + "\n")
    })
  }

  export async function readLog(collection: string, id: string): Promise<any[]> {
    const file = path.join(root, collection, `${id}.jsonl`)
    try {
      const content = await fs.readFile(file, "utf8")
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    } catch (err) {
      if (isEnoent(err)) return []
      throw err
    }
  }

  export async function writeItem(collection: string, id: string, item: any) {
    const dir = path.join(root, collection)
    await ensureDir(dir)
    const file = path.join(dir, `${id}.json`)
    
    await Flock.withLock(file, async () => {
      await Filesystem.writeJson(file, item)
    })
  }

  export async function readItem<T>(collection: string, id: string): Promise<T | undefined> {
    const file = path.join(root, collection, `${id}.json`)
    try {
      return await Filesystem.readJson(file) as T
    } catch (err) {
      if (isEnoent(err)) return undefined
      throw err
    }
  }

  export async function listItems<T>(collection: string): Promise<T[]> {
    const dir = path.join(root, collection)
    try {
      const files = await fs.readdir(dir)
      const jsonFiles = files.filter(f => f.endsWith(".json"))
      const tasks = jsonFiles.map(f => Filesystem.readJson(path.join(dir, f)))
      const results = await Promise.all(tasks)
      return results as T[]
    } catch (err) {
      if (isEnoent(err)) return []
      throw err
    }
  }

  export function readLogSync(collection: string, id: string): any[] {
    const file = path.join(root, collection, `${id}.jsonl`)
    try {
      const content = require("fs").readFileSync(file, "utf8")
      return content
        .split("\n")
        .filter((line: string) => line.trim())
        .map((line: string) => JSON.parse(line))
    } catch (err) {
      if (isEnoent(err)) return []
      throw err
    }
  }

  export function readItemSync<T>(collection: string, id: string): T | undefined {
    const file = path.join(root, collection, `${id}.json`)
    try {
      const content = require("fs").readFileSync(file, "utf8")
      return JSON.parse(content) as T
    } catch (err) {
      if ((err as any).code === "ENOENT") return undefined
      throw err
    }
  }

  export async function deleteItem(collection: string, id: string) {
    const file = path.join(root, collection, `${id}.json`)
    await fs.rm(file, { force: true })
  }

  export function listItemsSync<T>(collection: string): T[] {
    const dir = path.join(root, collection)
    try {
      const fsSync = require("fs")
      const files = fsSync.readdirSync(dir)
      const jsonFiles = files.filter((f: string) => f.endsWith(".json"))
      return jsonFiles.map((f: string) => {
        const content = fsSync.readFileSync(path.join(dir, f), "utf8")
        return JSON.parse(content) as T
      })
    } catch (err) {
      if ((err as any).code === "ENOENT") return []
      throw err
    }
  }

  export async function deleteLog(collection: string, id: string) {
    const file = path.join(root, collection, `${id}.jsonl`)
    await fs.rm(file, { force: true })
  }
}
