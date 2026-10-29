/**
 * Attack Surface Coverage Tracker
 * Records discovered endpoints, parameters, routes, and their testing status
 * to ensure comprehensive testing with no blind spots.
 * Implements Strix-compatible outcome statuses: reported, no_issue_found, ruled_out, not_applicable, needs_follow_up.
 */

export type CoverageStatus =
  | "discovered"
  | "in_progress"
  | "tested"
  | "vulnerable"
  | "reported"
  | "no_issue_found"
  | "ruled_out"
  | "not_applicable"
  | "needs_follow_up"

export interface CoverageEntry {
  id: string
  asset: string
  method: string
  endpoint: string
  parameters: string[]
  status: CoverageStatus
  tested_vulnerability_types: string[]
  evidence?: string
  notes?: string
  last_tested_at?: string
}

export class CoverageStore {
  private entries: Map<string, CoverageEntry> = new Map()

  record(entry: Omit<CoverageEntry, "id">): CoverageEntry {
    const key = `${entry.method.toUpperCase()} ${entry.endpoint}`
    const id = `COV-${Math.abs(this.hashCode(key)).toString(36)}`
    const existing = this.entries.get(key)

    const updated: CoverageEntry = {
      ...entry,
      id,
      method: entry.method.toUpperCase(),
      parameters: Array.from(new Set([...(existing?.parameters || []), ...(entry.parameters || [])])),
      tested_vulnerability_types: Array.from(
        new Set([...(existing?.tested_vulnerability_types || []), ...(entry.tested_vulnerability_types || [])]),
      ),
      last_tested_at: new Date().toISOString(),
    }

    this.entries.set(key, updated)
    return updated
  }

  list(): CoverageEntry[] {
    return Array.from(this.entries.values())
  }

  getSummary() {
    const all = this.list()
    return {
      totalEndpoints: all.length,
      tested: all.filter(
        (e) =>
          e.status === "tested" ||
          e.status === "vulnerable" ||
          e.status === "reported" ||
          e.status === "no_issue_found" ||
          e.status === "ruled_out" ||
          e.status === "not_applicable",
      ).length,
      vulnerable: all.filter((e) => e.status === "vulnerable" || e.status === "reported").length,
      pending: all.filter((e) => e.status === "discovered" || e.status === "in_progress" || e.status === "needs_follow_up").length,
    }
  }

  private hashCode(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    }
    return h
  }
}

export const globalCoverageStore = new CoverageStore()
