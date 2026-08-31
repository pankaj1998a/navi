import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

export function init(path: string) {
  const sqlite = new Database(path, { create: true } as any)
  const db = drizzle({ client: sqlite as any })
  return db
}
