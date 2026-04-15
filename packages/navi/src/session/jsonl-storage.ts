import fs from "fs"
import path from "path"
import { Global } from "../global"

export namespace JsonlStorage {
  export function getFile(sessionID: string): string {
    const dir = path.join(Global.Path.data, "sessions")
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return path.join(dir, `${sessionID}.jsonl`)
  }

  export function append(sessionID: string, item: any): void {
    const file = getFile(sessionID)
    try {
      fs.appendFileSync(file, JSON.stringify(item) + "\n")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, JSON.stringify(item) + "\n")
      } else {
        throw err
      }
    }
  }

  export function readAll(sessionID: string): any[] {
    const file = getFile(sessionID)
    if (!fs.existsSync(file)) return []
    try {
      const content = fs.readFileSync(file, "utf8")
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  export function remove(sessionID: string): void {
    const file = getFile(sessionID)
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}
