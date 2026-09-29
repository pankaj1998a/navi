import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle, SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import path from "path"
import fs from "fs/promises"
import { readFileSync, readdirSync } from "fs"
import { JsonMigration } from "@/storage/json-migration"
import { Global } from "@navi-ai/core/global"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../../src/session/session.sql"
import { SessionShareTable } from "../../src/share/share.sql"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

// Test fixtures
const fixtures = {
  project: {
    id: "proj_test123abc",
    name: "Test Project",
    worktree: "/test/path",
    vcs: "git" as const,
    sandboxes: [],
  },
  session: {
    id: "ses_test456def",
    projectID: "proj_test123abc",
    slug: "test-session",
    directory: "/test/path",
    title: "Test Session",
    version: "1.0.0",
    time: { created: 1700000000000, updated: 1700000001000 },
  },
  message: {
    id: "msg_test789ghi",
    sessionID: "ses_test456def",
    role: "user" as const,
    agent: "default",
    model: { providerID: "openai", modelID: "gpt-4" },
    time: { created: 1700000000000 },
  },
  part: {
    id: "prt_testabc123",
    messageID: "msg_test789ghi",
    sessionID: "ses_test456def",
    type: "text" as const,
    text: "Hello, world!",
  },
}

// Helper to create test storage directory structure
async function setupStorageDir() {
  const storageDir = path.join(Global.Path.data, "storage")
  await fs.rm(storageDir, { recursive: true, force: true })
  await fs.mkdir(path.join(storageDir, "project"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "session", "proj_test123abc"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "message", "ses_test456def"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "part", "msg_test789ghi"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "session_diff"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "todo"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "permission"), { recursive: true })
  await fs.mkdir(path.join(storageDir, "session_share"), { recursive: true })
  // Create legacy marker to indicate JSON storage exists
  await Bun.write(path.join(storageDir, "migration"), "1")
  return storageDir
}

async function writeProject(storageDir: string, project: Record<string, unknown>) {
  await Bun.write(path.join(storageDir, "project", `${project.id}.json`), JSON.stringify(project))
}

async function writeSession(storageDir: string, projectID: string, session: Record<string, unknown>) {
  await Bun.write(path.join(storageDir, "session", projectID, `${session.id}.json`), JSON.stringify(session))
}

// Helper to create in-memory test database with schema
function createTestDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")

  // Apply schema migrations using drizzle migrate
  const dir = path.join(import.meta.dirname, "../../migration")
  const entries = readdirSync(dir, { withFileTypes: true })
  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      sql: readFileSync(path.join(dir, entry.name, "migration.sql"), "utf-8"),
      timestamp: Number(entry.name.split("_")[0]),
      name: entry.name,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  const db = drizzle({ client: sqlite })
  migrate(db, migrations)

  return [sqlite, db] as const
}

describe("JSON to SQLite migration", () => {
  let storageDir: string
  let sqlite: Database
  let db: SQLiteBunDatabase

  beforeEach(async () => {
    storageDir = await setupStorageDir()
    ;[sqlite, db] = createTestDb()
  })

  afterEach(async () => {
    sqlite.close()
    await fs.rm(storageDir, { recursive: true, force: true })
  })

  test("migrates project", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/test/path",
      vcs: "git",
      name: "Test Project",
      time: { created: 1700000000000, updated: 1700000001000 },
      sandboxes: ["/test/sandbox"],
    })

    const stats = await JsonMigration.run(db)

    expect(stats?.projects).toBe(1)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1)
    const project = projects[0]
    if (!project) throw new Error("expected project")
    expect(project.id).toBe(ProjectID.make("proj_test123abc"))
    expect(project.worktree).toBe("/test/path")
    expect(project.name).toBe("Test Project")
    expect(project.sandboxes).toEqual(["/test/sandbox"])
  })

  test("uses filename for project id when JSON has different value", async () => {
    await Bun.write(
      path.join(storageDir, "project", "proj_filename.json"),
      JSON.stringify({
        id: "proj_different_in_json", // Stale! Should be ignored
        worktree: "/test/path",
        vcs: "git",
        name: "Test Project",
        sandboxes: [],
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.projects).toBe(1)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1)
    const project = projects[0]
    if (!project) throw new Error("expected project")
    expect(project.id).toBe(ProjectID.make("proj_filename")) // Uses filename, not JSON id
  })

  test("migrates project with commands", async () => {
    await writeProject(storageDir, {
      id: "proj_with_commands",
      worktree: "/test/path",
      vcs: "git",
      name: "Project With Commands",
      time: { created: 1700000000000, updated: 1700000001000 },
      sandboxes: ["/test/sandbox"],
      commands: { start: "npm run dev" },
    })

    const stats = await JsonMigration.run(db)

    expect(stats?.projects).toBe(1)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1)
    const projectWithCommands = projects[0]
    if (!projectWithCommands) throw new Error("expected project")
    expect(projectWithCommands.id).toBe(ProjectID.make("proj_with_commands"))
    expect(projectWithCommands.commands).toEqual({ start: "npm run dev" })
  })

  test("migrates project without commands field", async () => {
    await writeProject(storageDir, {
      id: "proj_no_commands",
      worktree: "/test/path",
      vcs: "git",
      name: "Project Without Commands",
      time: { created: 1700000000000, updated: 1700000001000 },
      sandboxes: [],
    })

    const stats = await JsonMigration.run(db)

    expect(stats?.projects).toBe(1)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1)
    const projectNoCommands = projects[0]
    if (!projectNoCommands) throw new Error("expected project")
    expect(projectNoCommands.id).toBe(ProjectID.make("proj_no_commands"))
    expect(projectNoCommands.commands).toBeNull()
  })

  test("migrates session with individual columns", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/test/path",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })

    await writeSession(storageDir, "proj_test123abc", {
      id: "ses_test456def",
      projectID: "proj_test123abc",
      slug: "test-session",
      directory: "/test/dir",
      title: "Test Session Title",
      version: "1.0.0",
      time: { created: 1700000000000, updated: 1700000001000 },
      summary: { additions: 10, deletions: 5, files: 3 },
      share: { url: "https://example.com/share" },
    })

    await JsonMigration.run(db)

    const sessions = db.select().from(SessionTable).all()
    expect(sessions.length).toBe(1)
    const session = sessions[0]
    if (!session) throw new Error("expected session")
    expect(session.id).toBe(SessionID.make("ses_test456def"))
    expect(session.project_id).toBe(ProjectID.make("proj_test123abc"))
    expect(session.slug).toBe("test-session")
    expect(session.title).toBe("Test Session Title")
    expect(session.summary_additions).toBe(10)
    expect(session.summary_deletions).toBe(5)
    expect(session.share_url).toBe("https://example.com/share")
  })

  test("migrates messages and parts", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })
    await Bun.write(
      path.join(storageDir, "message", "ses_test456def", "msg_test789ghi.json"),
      JSON.stringify({ ...fixtures.message }),
    )
    await Bun.write(
      path.join(storageDir, "part", "msg_test789ghi", "prt_testabc123.json"),
      JSON.stringify({ ...fixtures.part }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.messages).toBe(1)
    expect(stats?.parts).toBe(1)

    const messages = db.select().from(MessageTable).all()
    expect(messages.length).toBe(1)
    const message = messages[0]
    if (!message) throw new Error("expected message")
    expect(message.id).toBe(MessageID.make("msg_test789ghi"))

    const parts = db.select().from(PartTable).all()
    expect(parts.length).toBe(1)
    const part = parts[0]
    if (!part) throw new Error("expected part")
    expect(part.id).toBe(PartID.make("prt_testabc123"))
  })

  test("migrates legacy parts without ids in body", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })
    await Bun.write(
      path.join(storageDir, "message", "ses_test456def", "msg_test789ghi.json"),
      JSON.stringify({
        role: "user",
        agent: "default",
        model: { providerID: "openai", modelID: "gpt-4" },
        time: { created: 1700000000000 },
      }),
    )
    await Bun.write(
      path.join(storageDir, "part", "msg_test789ghi", "prt_testabc123.json"),
      JSON.stringify({
        type: "text",
        text: "Hello, world!",
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.messages).toBe(1)
    expect(stats?.parts).toBe(1)

    const messages = db.select().from(MessageTable).all()
    expect(messages.length).toBe(1)
    const legacyMessage = messages[0]
    if (!legacyMessage) throw new Error("expected message")
    expect(legacyMessage.id).toBe(MessageID.make("msg_test789ghi"))
    expect(legacyMessage.session_id).toBe(SessionID.make("ses_test456def"))
    expect(legacyMessage.data).not.toHaveProperty("id")
    expect(legacyMessage.data).not.toHaveProperty("sessionID")

    const parts = db.select().from(PartTable).all()
    expect(parts.length).toBe(1)
    const legacyPart = parts[0]
    if (!legacyPart) throw new Error("expected part")
    expect(legacyPart.id).toBe(PartID.make("prt_testabc123"))
    expect(legacyPart.message_id).toBe(MessageID.make("msg_test789ghi"))
    expect(legacyPart.session_id).toBe(SessionID.make("ses_test456def"))
    expect(legacyPart.data).not.toHaveProperty("id")
    expect(legacyPart.data).not.toHaveProperty("messageID")
    expect(legacyPart.data).not.toHaveProperty("sessionID")
  })

  test("uses filename for message id when JSON has different value", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })
    await Bun.write(
      path.join(storageDir, "message", "ses_test456def", "msg_from_filename.json"),
      JSON.stringify({
        id: "msg_different_in_json", // Stale! Should be ignored
        sessionID: "ses_test456def",
        role: "user",
        agent: "default",
        time: { created: 1700000000000 },
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.messages).toBe(1)

    const messages = db.select().from(MessageTable).all()
    expect(messages.length).toBe(1)
    const filenameMessage = messages[0]
    if (!filenameMessage) throw new Error("expected message")
    expect(filenameMessage.id).toBe(MessageID.make("msg_from_filename")) // Uses filename, not JSON id
    expect(filenameMessage.session_id).toBe(SessionID.make("ses_test456def"))
  })

  test("uses paths for part id and messageID when JSON has different values", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })
    await Bun.write(
      path.join(storageDir, "message", "ses_test456def", "msg_realmsgid.json"),
      JSON.stringify({
        role: "user",
        agent: "default",
        time: { created: 1700000000000 },
      }),
    )
    await Bun.write(
      path.join(storageDir, "part", "msg_realmsgid", "prt_from_filename.json"),
      JSON.stringify({
        id: "prt_different_in_json", // Stale! Should be ignored
        messageID: "msg_different_in_json", // Stale! Should be ignored
        sessionID: "ses_test456def",
        type: "text",
        text: "Hello",
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.parts).toBe(1)

    const parts = db.select().from(PartTable).all()
    expect(parts.length).toBe(1)
    const filenamePart = parts[0]
    if (!filenamePart) throw new Error("expected part")
    expect(filenamePart.id).toBe(PartID.make("prt_from_filename")) // Uses filename, not JSON id
    expect(filenamePart.message_id).toBe(MessageID.make("msg_realmsgid")) // Uses parent dir, not JSON messageID
  })

  test("skips orphaned sessions (no parent project)", async () => {
    await Bun.write(
      path.join(storageDir, "session", "proj_test123abc", "ses_orphan.json"),
      JSON.stringify({
        id: "ses_orphan",
        projectID: "proj_nonexistent",
        slug: "orphan",
        directory: "/",
        title: "Orphan",
        version: "1.0.0",
        time: { created: Date.now(), updated: Date.now() },
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.sessions).toBe(0)
  })

  test("uses directory path for projectID when JSON has stale value", async () => {
    // Simulates the scenario where earlier migration moved sessions to new
    // git-based project directories but didn't update the projectID field
    const gitBasedProjectID = "abc123gitcommit"
    await writeProject(storageDir, {
      id: gitBasedProjectID,
      worktree: "/test/path",
      vcs: "git",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })

    // Session is in the git-based directory but JSON still has old projectID
    await writeSession(storageDir, gitBasedProjectID, {
      id: "ses_migrated",
      projectID: "old-project-name", // Stale! Should be ignored
      slug: "migrated-session",
      directory: "/test/path",
      title: "Migrated Session",
      version: "1.0.0",
      time: { created: 1700000000000, updated: 1700000001000 },
    })

    const stats = await JsonMigration.run(db)

    expect(stats?.sessions).toBe(1)

    const sessions = db.select().from(SessionTable).all()
    expect(sessions.length).toBe(1)
    const migratedSession = sessions[0]
    if (!migratedSession) throw new Error("expected session")
    expect(migratedSession.id).toBe(SessionID.make("ses_migrated"))
    expect(migratedSession.project_id).toBe(ProjectID.make(gitBasedProjectID)) // Uses directory, not stale JSON
  })

  test("uses filename for session id when JSON has different value", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/test/path",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })

    await Bun.write(
      path.join(storageDir, "session", "proj_test123abc", "ses_from_filename.json"),
      JSON.stringify({
        id: "ses_different_in_json", // Stale! Should be ignored
        projectID: "proj_test123abc",
        slug: "test-session",
        directory: "/test/path",
        title: "Test Session",
        version: "1.0.0",
        time: { created: 1700000000000, updated: 1700000001000 },
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.sessions).toBe(1)

    const sessions = db.select().from(SessionTable).all()
    expect(sessions.length).toBe(1)
    const filenameSession = sessions[0]
    if (!filenameSession) throw new Error("expected session")
    expect(filenameSession.id).toBe(SessionID.make("ses_from_filename")) // Uses filename, not JSON id
    expect(filenameSession.project_id).toBe(ProjectID.make("proj_test123abc"))
  })

  test("is idempotent (running twice doesn't duplicate)", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })

    await JsonMigration.run(db)
    await JsonMigration.run(db)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1) // Still only 1 due to onConflictDoNothing
  })

  test("migrates todos", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })

    // Create todo file (named by sessionID, contains array of todos)
    await Bun.write(
      path.join(storageDir, "todo", "ses_test456def.json"),
      JSON.stringify([
        {
          id: "todo_1",
          content: "First todo",
          status: "pending",
          priority: "high",
        },
        {
          id: "todo_2",
          content: "Second todo",
          status: "completed",
          priority: "medium",
        },
      ]),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.todos).toBe(2)

    const todos = db.select().from(TodoTable).orderBy(TodoTable.position).all()
    expect(todos.length).toBe(2)
    const firstTodo = todos[0]
    if (!firstTodo) throw new Error("expected todo")
    expect(firstTodo.content).toBe("First todo")
    expect(firstTodo.status).toBe("pending")
    expect(firstTodo.priority).toBe("high")
    expect(firstTodo.position).toBe(0)
    const secondTodo = todos[1]
    if (!secondTodo) throw new Error("expected todo")
    expect(secondTodo.content).toBe("Second todo")
    expect(secondTodo.position).toBe(1)
  })

  test("todos are ordered by position", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })

    await Bun.write(
      path.join(storageDir, "todo", "ses_test456def.json"),
      JSON.stringify([
        { content: "Third", status: "pending", priority: "low" },
        { content: "First", status: "pending", priority: "high" },
        { content: "Second", status: "in_progress", priority: "medium" },
      ]),
    )

    await JsonMigration.run(db)

    const todos = db.select().from(TodoTable).orderBy(TodoTable.position).all()

    expect(todos.length).toBe(3)
    const thirdTodo = todos[0]
    if (!thirdTodo) throw new Error("expected todo")
    expect(thirdTodo.content).toBe("Third")
    expect(thirdTodo.position).toBe(0)
    const firstOrderedTodo = todos[1]
    if (!firstOrderedTodo) throw new Error("expected todo")
    expect(firstOrderedTodo.content).toBe("First")
    expect(firstOrderedTodo.position).toBe(1)
    const secondOrderedTodo = todos[2]
    if (!secondOrderedTodo) throw new Error("expected todo")
    expect(secondOrderedTodo.content).toBe("Second")
    expect(secondOrderedTodo.position).toBe(2)
  })

  test("migrates permissions", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })

    // Create permission file (named by projectID, contains array of rules)
    const permissionData = [
      { permission: "file.read", pattern: "/test/file1.ts", action: "allow" as const },
      { permission: "file.write", pattern: "/test/file2.ts", action: "ask" as const },
      { permission: "command.run", pattern: "npm install", action: "deny" as const },
    ]
    await Bun.write(path.join(storageDir, "permission", "proj_test123abc.json"), JSON.stringify(permissionData))

    const stats = await JsonMigration.run(db)

    expect(stats?.permissions).toBe(1)

    const permissions = db.select().from(PermissionTable).all()
    expect(permissions.length).toBe(1)
    const permission = permissions[0]
    if (!permission) throw new Error("expected permission")
    expect(permission.project_id).toBe("proj_test123abc")
    expect(permission.data).toEqual(permissionData)
  })

  test("migrates session shares", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })

    // Create session share file (named by sessionID)
    await Bun.write(
      path.join(storageDir, "session_share", "ses_test456def.json"),
      JSON.stringify({
        id: "share_123",
        secret: "supersecretkey",
        url: "https://share.example.com/ses_test456def",
      }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats?.shares).toBe(1)

    const shares = db.select().from(SessionShareTable).all()
    expect(shares.length).toBe(1)
    const share = shares[0]
    if (!share) throw new Error("expected share")
    expect(share.session_id).toBe("ses_test456def")
    expect(share.id).toBe("share_123")
    expect(share.secret).toBe("supersecretkey")
    expect(share.url).toBe("https://share.example.com/ses_test456def")
  })

  test("returns empty stats when storage directory does not exist", async () => {
    await fs.rm(storageDir, { recursive: true, force: true })

    const stats = await JsonMigration.run(db)

    expect(stats.projects).toBe(0)
    expect(stats.sessions).toBe(0)
    expect(stats.messages).toBe(0)
    expect(stats.parts).toBe(0)
    expect(stats.todos).toBe(0)
    expect(stats.permissions).toBe(0)
    expect(stats.shares).toBe(0)
    expect(stats.errors).toEqual([])
  })

  test("continues when a JSON file is unreadable and records an error", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await Bun.write(path.join(storageDir, "project", "broken.json"), "{ invalid json")

    const stats = await JsonMigration.run(db)

    expect(stats.projects).toBe(1)
    expect(stats.errors.some((x) => x.includes("failed to read") && x.includes("broken.json"))).toBe(true)

    const projects = db.select().from(ProjectTable).all()
    expect(projects.length).toBe(1)
    const brokenProject = projects[0]
    if (!brokenProject) throw new Error("expected project")
    expect(brokenProject.id).toBe(ProjectID.make("proj_test123abc"))
  })

  test("skips invalid todo entries while preserving source positions", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })

    await Bun.write(
      path.join(storageDir, "todo", "ses_test456def.json"),
      JSON.stringify([
        { content: "keep-0", status: "pending", priority: "high" },
        { content: "drop-1", priority: "low" },
        { content: "keep-2", status: "completed", priority: "medium" },
      ]),
    )

    const stats = await JsonMigration.run(db)
    expect(stats.todos).toBe(2)

    const todos = db.select().from(TodoTable).orderBy(TodoTable.position).all()
    expect(todos.length).toBe(2)
    const keepTodo = todos[0]
    if (!keepTodo) throw new Error("expected todo")
    expect(keepTodo.content).toBe("keep-0")
    expect(keepTodo.position).toBe(0)
    const keepTodo2 = todos[1]
    if (!keepTodo2) throw new Error("expected todo")
    expect(keepTodo2.content).toBe("keep-2")
    expect(keepTodo2.position).toBe(2)
  })

  test("skips orphaned todos, permissions, and shares", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
    await writeSession(storageDir, "proj_test123abc", { ...fixtures.session })

    await Bun.write(
      path.join(storageDir, "todo", "ses_test456def.json"),
      JSON.stringify([{ content: "valid", status: "pending", priority: "high" }]),
    )
    await Bun.write(
      path.join(storageDir, "todo", "ses_missing.json"),
      JSON.stringify([{ content: "orphan", status: "pending", priority: "high" }]),
    )

    await Bun.write(
      path.join(storageDir, "permission", "proj_test123abc.json"),
      JSON.stringify([{ permission: "file.read" }]),
    )
    await Bun.write(
      path.join(storageDir, "permission", "proj_missing.json"),
      JSON.stringify([{ permission: "file.write" }]),
    )

    await Bun.write(
      path.join(storageDir, "session_share", "ses_test456def.json"),
      JSON.stringify({ id: "share_ok", secret: "secret", url: "https://ok.example.com" }),
    )
    await Bun.write(
      path.join(storageDir, "session_share", "ses_missing.json"),
      JSON.stringify({ id: "share_missing", secret: "secret", url: "https://missing.example.com" }),
    )

    const stats = await JsonMigration.run(db)

    expect(stats.todos).toBe(1)
    expect(stats.permissions).toBe(1)
    expect(stats.shares).toBe(1)

    expect(db.select().from(TodoTable).all().length).toBe(1)
    expect(db.select().from(PermissionTable).all().length).toBe(1)
    expect(db.select().from(SessionShareTable).all().length).toBe(1)
  })

  test("handles mixed corruption and partial validity in one migration run", async () => {
    await writeProject(storageDir, {
      id: "proj_test123abc",
      worktree: "/ok",
      time: { created: 1700000000000, updated: 1700000001000 },
      sandboxes: [],
    })
    await Bun.write(
      path.join(storageDir, "project", "proj_missing_id.json"),
      JSON.stringify({ worktree: "/bad", sandboxes: [] }),
    )
    await Bun.write(path.join(storageDir, "project", "proj_broken.json"), "{ nope")

    await writeSession(storageDir, "proj_test123abc", {
      id: "ses_test456def",
      projectID: "proj_test123abc",
      slug: "ok",
      directory: "/ok",
      title: "Ok",
      version: "1",
      time: { created: 1700000000000, updated: 1700000001000 },
    })
    await Bun.write(
      path.join(storageDir, "session", "proj_test123abc", "ses_missing_project.json"),
      JSON.stringify({
        id: "ses_missing_project",
        slug: "bad",
        directory: "/bad",
        title: "Bad",
        version: "1",
      }),
    )
    await Bun.write(
      path.join(storageDir, "session", "proj_test123abc", "ses_orphan.json"),
      JSON.stringify({
        id: "ses_orphan",
        projectID: "proj_missing",
        slug: "orphan",
        directory: "/bad",
        title: "Orphan",
        version: "1",
      }),
    )

    await Bun.write(
      path.join(storageDir, "message", "ses_test456def", "msg_ok.json"),
      JSON.stringify({ role: "user", time: { created: 1700000000000 } }),
    )
    await Bun.write(path.join(storageDir, "message", "ses_test456def", "msg_broken.json"), "{ nope")
    await Bun.write(
      path.join(storageDir, "message", "ses_missing", "msg_orphan.json"),
      JSON.stringify({ role: "user", time: { created: 1700000000000 } }),
    )

    await Bun.write(
      path.join(storageDir, "part", "msg_ok", "part_ok.json"),
      JSON.stringify({ type: "text", text: "ok" }),
    )
    await Bun.write(
      path.join(storageDir, "part", "msg_missing", "part_missing_message.json"),
      JSON.stringify({ type: "text", text: "bad" }),
    )
    await Bun.write(path.join(storageDir, "part", "msg_ok", "part_broken.json"), "{ nope")

    await Bun.write(
      path.join(storageDir, "todo", "ses_test456def.json"),
      JSON.stringify([
        { content: "ok", status: "pending", priority: "high" },
        { content: "skip", status: "pending" },
      ]),
    )
    await Bun.write(
      path.join(storageDir, "todo", "ses_missing.json"),
      JSON.stringify([{ content: "orphan", status: "pending", priority: "high" }]),
    )
    await Bun.write(path.join(storageDir, "todo", "ses_broken.json"), "{ nope")

    await Bun.write(
      path.join(storageDir, "permission", "proj_test123abc.json"),
      JSON.stringify([{ permission: "file.read" }]),
    )
    await Bun.write(
      path.join(storageDir, "permission", "proj_missing.json"),
      JSON.stringify([{ permission: "file.write" }]),
    )
    await Bun.write(path.join(storageDir, "permission", "proj_broken.json"), "{ nope")

    await Bun.write(
      path.join(storageDir, "session_share", "ses_test456def.json"),
      JSON.stringify({ id: "share_ok", secret: "secret", url: "https://ok.example.com" }),
    )
    await Bun.write(
      path.join(storageDir, "session_share", "ses_missing.json"),
      JSON.stringify({ id: "share_orphan", secret: "secret", url: "https://missing.example.com" }),
    )
    await Bun.write(path.join(storageDir, "session_share", "ses_broken.json"), "{ nope")

    const stats = await JsonMigration.run(db)

    // Projects: proj_test123abc (valid), proj_missing_id (now derives id from filename)
    // Sessions: ses_test456def (valid), ses_missing_project (now uses dir path),
    // ses_orphan (now uses dir path, ignores stale projectID)
    expect(stats.projects).toBe(2)
    expect(stats.sessions).toBe(3)
    expect(stats.messages).toBe(1)
    expect(stats.parts).toBe(1)
    expect(stats.todos).toBe(1)
    expect(stats.permissions).toBe(1)
    expect(stats.shares).toBe(1)
    expect(stats.errors.length).toBeGreaterThanOrEqual(6)

    expect(db.select().from(ProjectTable).all().length).toBe(2)
    expect(db.select().from(SessionTable).all().length).toBe(3)
    expect(db.select().from(MessageTable).all().length).toBe(1)
    expect(db.select().from(PartTable).all().length).toBe(1)
    expect(db.select().from(TodoTable).all().length).toBe(1)
    expect(db.select().from(PermissionTable).all().length).toBe(1)
    expect(db.select().from(SessionShareTable).all().length).toBe(1)
  })
})
