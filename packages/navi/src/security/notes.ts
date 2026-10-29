/**
 * Cross-Agent Collaborative Notes Blackboard
 * Allows red-team agents to share tokens, credentials, discovered attack paths, and observations.
 */

export interface PentestNote {
  id: string
  title: string
  content: string
  tags: string[]
  author: string
  created_at: string
  updated_at: string
}

export class PentestNotesStore {
  private notes: Map<string, PentestNote> = new Map()

  create(title: string, content: string, tags: string[] = [], author = "agent"): PentestNote {
    const id = `NOTE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`
    const note: PentestNote = {
      id,
      title,
      content,
      tags,
      author,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.notes.set(id, note)
    return note
  }

  update(id: string, updates: { title?: string; content?: string; tags?: string[] }): PentestNote | undefined {
    const note = this.notes.get(id)
    if (!note) return undefined
    if (updates.title) note.title = updates.title
    if (updates.content) note.content = updates.content
    if (updates.tags) note.tags = updates.tags
    note.updated_at = new Date().toISOString()
    return note
  }

  get(id: string): PentestNote | undefined {
    return this.notes.get(id)
  }

  list(tagFilter?: string): PentestNote[] {
    const all = Array.from(this.notes.values())
    if (!tagFilter) return all
    return all.filter((n) => n.tags.includes(tagFilter.toLowerCase()))
  }

  delete(id: string): boolean {
    return this.notes.delete(id)
  }
}

export const globalPentestNotes = new PentestNotesStore()
