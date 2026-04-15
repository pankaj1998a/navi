import { Database } from "bun:sqlite"
import fs from "fs"
import path from "path"
import os from "os"
import { xdgData } from "xdg-basedir"

// Simplified Global Paths for migration script
const app = "Navi"
const dataPath = path.join(xdgData!, app)
let dbPath = path.join(dataPath, "Navi.db")
if (!fs.existsSync(dbPath)) {
  dbPath = path.join(dataPath, "Navi-local.db")
}

if (!fs.existsSync(dbPath)) {
  console.log("No SQLite database found in", dataPath)
  process.exit(0)
}

const db = new Database(dbPath)

// We need a minimal JSONL Storage implementation here since we're running as a standalone script
const jsonlRoot = path.join(dataPath, "jsonl")
if (!fs.existsSync(jsonlRoot)) fs.mkdirSync(jsonlRoot, { recursive: true })

function writeItem(collection: string, id: string, item: any) {
  const dir = path.join(jsonlRoot, collection)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(item, null, 2))
}

function appendLog(collection: string, id: string, item: any) {
  const dir = path.join(jsonlRoot, collection)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify(item) + "\n")
}

console.log("Migrating Projects...")
const projects = db.query("SELECT * FROM project").all() as any[]
for (const p of projects) {
  writeItem("projects", p.id, p)
}

console.log("Migrating Sessions...")
const sessions = db.query("SELECT * FROM session").all() as any[]
for (const s of sessions) {
  writeItem("sessions", s.id, s)
}

console.log("Migrating Messages...")
const messages = db.query("SELECT * FROM message").all() as any[]
for (const m of messages) {
  // We'll store messages in the session log for better performance/structure
  appendLog("session_logs", m.session_id, { type: "message", ...m })
}

console.log("Migrating Parts...")
const parts = db.query("SELECT * FROM part").all() as any[]
for (const p of parts) {
  appendLog("session_logs", p.session_id, { type: "part", ...p })
}

console.log("Migrating Todos...")
const todos = db.query("SELECT * FROM todo").all() as any[]
for (const t of todos) {
  appendLog("session_logs", t.session_id, { type: "todo", ...t })
}

console.log("Migrating Permissions...")
const perms = db.query("SELECT * FROM permission").all() as any[]
for (const p of perms) {
  writeItem("permissions", p.project_id, p)
}

console.log("Migrating Accounts...")
const accounts = db.query("SELECT * FROM account").all() as any[]
for (const a of accounts) {
  writeItem("accounts", a.id, a)
}

const accountState = db.query("SELECT * FROM account_state").all() as any[]
if (accountState.length > 0) {
    writeItem("account_state", "global", accountState[0])
}

console.log("Migration finished successfully!")
db.close()
