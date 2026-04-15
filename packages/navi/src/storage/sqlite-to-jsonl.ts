import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq } from "drizzle-orm"
import { Global } from "../global"
import { Log } from "../util/log"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
import { SessionShareTable } from "../share/share.sql"
import { JsonlStorage } from "./jsonl"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import path from "path"
import { existsSync } from "fs"

export namespace JsonlMigration {
  const log = Log.create({ service: "jsonl-migration" })

  export type Progress = {
    current: number
    total: number
    label: string
  }

  type Options = {
    progress?: (event: Progress) => void
  }

  export async function run(sqlitePath: string, options?: Options) {
    if (!existsSync(sqlitePath)) {
      log.info("sqlite database does not exist, skipping migration to jsonl")
      return
    }

    log.info("starting sqlite to jsonl migration", { sqlitePath })
    const sqlite = new Database(sqlitePath)
    const db = drizzle({ client: sqlite })
    
    const stats = {
      projects: 0,
      sessions: 0,
      messages: 0,
      parts: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
    }

    // 1. Projects
    const projects = db.select().from(ProjectTable).all()
    const totalCount = projects.length 
    let current = 0

    options?.progress?.({ current, total: totalCount || 1, label: "projects" })

    for (const p of projects) {
      const info: any = {
        id: p.id,
        worktree: p.worktree,
        vcs: p.vcs ?? undefined,
        name: p.name ?? undefined,
        icon: (p.icon_url || p.icon_color) ? {
          url: p.icon_url ?? undefined,
          color: p.icon_color ?? undefined,
        } : undefined,
        time: {
          created: p.time_created,
          updated: p.time_updated,
          initialized: p.time_initialized ?? undefined,
        },
        sandboxes: p.sandboxes ?? [],
        commands: p.commands ?? undefined,
      }
      await JsonlStorage.writeItem("projects", p.id as any, info)
      stats.projects++
      current++
      options?.progress?.({ current, total: totalCount + 100, label: "projects" }) // Estimating total
    }

    // 2. Sessions
    const sessions = db.select().from(SessionTable).all()
    for (const s of sessions) {
      const info: Session.Info = {
        id: s.id as any,
        slug: s.slug,
        projectID: s.project_id as any,
        workspaceID: s.workspace_id as any,
        directory: s.directory,
        parentID: s.parent_id as any,
        title: s.title,
        version: s.version,
        summary: (s.summary_additions !== null || s.summary_deletions !== null) ? {
          additions: s.summary_additions ?? 0,
          deletions: s.summary_deletions ?? 0,
          files: s.summary_files ?? 0,
          diffs: s.summary_diffs ?? undefined,
        } : undefined,
        share: s.share_url ? { url: s.share_url } : undefined,
        revert: s.revert ?? undefined,
        permission: (s.permission as any) ?? undefined,
        time: {
          created: s.time_created as any,
          updated: s.time_updated as any,
          compacting: s.time_compacting ?? undefined,
          archived: s.time_archived ?? undefined,
        },
      }
      await JsonlStorage.writeItem("sessions", s.id as any, info)
      stats.sessions++
    }

    // 3. Messages and Parts (into session_logs)
    for (const s of sessions) {
      const messages = db.select().from(MessageTable).where(eq(MessageTable.session_id, s.id as any)).all()
      for (const m of messages) {
        const parts = db.select().from(PartTable).where(eq(PartTable.message_id, m.id as any)).all()
        
        const mInfo = {
          ...m.data,
          id: m.id as any,
          sessionID: s.id as any,
        }
        
        await JsonlStorage.append("session_logs", s.id as any, {
          event: "message.updated",
          data: { sessionID: s.id as any, info: mInfo }
        })
        
        for (const p of parts) {
          const pData = {
            ...p.data,
            id: p.id as any,
            messageID: m.id as any,
            sessionID: s.id as any,
          }
          await JsonlStorage.append("session_logs", s.id as any, {
            event: "message.part.updated",
            data: { sessionID: s.id as any, part: pData, time: p.time_created }
          })
          stats.parts++
        }
        stats.messages++
      }
    }

    // 4. Todos
    const todos = db.select().from(TodoTable).all()
    const todoGroups = new Map<string, any[]>()
    for (const t of todos) {
        let group = todoGroups.get(t.session_id)
        if (!group) {
            group = []
            todoGroups.set(t.session_id, group)
        }
        group.push({
            content: t.content,
            status: t.status,
            priority: t.priority,
            position: t.position
        })
    }
    
    for (const [sessionID, group] of todoGroups.entries()) {
        group.sort((a, b) => a.position - b.position)
        const items = group.map(t => ({
            content: t.content,
            status: t.status,
            priority: t.priority
        }))
        await JsonlStorage.writeItem("todos", sessionID as any, { todos: items })
        stats.todos += items.length
    }

    // 5. Permissions
    const perms = db.select().from(PermissionTable).all()
    for (const p of perms) {
        await JsonlStorage.writeItem("permissions", p.project_id as any, { data: p.data })
        stats.permissions++
    }

    // 6. Shares
    const shares = db.select().from(SessionShareTable).all()
    for (const sh of shares) {
        await JsonlStorage.writeItem("shares", sh.session_id as any, { id: sh.id, secret: sh.secret, url: sh.url })
        stats.shares++
    }

    sqlite.close()
    log.info("sqlite to jsonl migration complete", stats)
    return stats
  }
}
