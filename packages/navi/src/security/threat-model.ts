/**
 * Structured Threat Model Store
 * Maintains STRIDE/DREAD threat trees, trust boundaries, high-risk assets,
 * severity calibrations, and live run-time amendments as attack surface expands.
 * Ported & adapted from Strix's target-normalized threat modeling engine.
 */

export interface ThreatItem {
  id: string
  category: "spoofing" | "tampering" | "repudiation" | "info_disclosure" | "dos" | "elevation_of_privilege"
  title: string
  description: string
  affected_component: string
  prerequisites: string
  potential_impact: string
  mitigation: string
  status: "unmitigated" | "partially_mitigated" | "verified_exploitable" | "mitigated"
}

export interface ThreatModelData {
  target: string
  application_overview: string
  architecture_summary: string
  trust_boundaries: string[]
  assets: string[]
  attack_surface: string[]
  severity_calibration: string
  raw_content?: string
  threats: ThreatItem[]
  amendments: Array<{ timestamp: string; note: string; author?: string }>
  updated_at: string
}

const REQUIRED_CONTENT_SECTIONS = [
  "overview",
  "trust boundaries",
  "attack surface",
  "severity calibration",
]

export function normalizeTargetKey(rawTarget: string): string {
  if (!rawTarget) return "default"
  const trimmed = rawTarget.trim().toLowerCase()
  if (trimmed.includes("://")) {
    try {
      const u = new URL(trimmed)
      const port = u.port ? `:${u.port}` : ""
      return `${u.hostname}${port}${u.pathname.replace(/\/$/, "")}`
    } catch {
      return trimmed
    }
  }
  return trimmed.replace(/\\/g, "/").replace(/\/$/, "")
}

export function validateThreatModelMarkdown(content: string): { valid: boolean; missingSections: string[] } {
  const lowered = content.toLowerCase()
  const missing = REQUIRED_CONTENT_SECTIONS.filter((section) => !lowered.includes(section))
  return {
    valid: missing.length === 0,
    missingSections: missing,
  }
}

export class ThreatModelStore {
  private models: Map<string, ThreatModelData> = new Map()
  private defaultTarget = "workspace"

  constructor() {
    this.initModel(this.defaultTarget)
  }

  private initModel(target: string): ThreatModelData {
    const key = normalizeTargetKey(target)
    if (!this.models.has(key)) {
      this.models.set(key, {
        target,
        application_overview: "",
        architecture_summary: "",
        trust_boundaries: [],
        assets: [],
        attack_surface: [],
        severity_calibration: "",
        threats: [],
        amendments: [],
        updated_at: new Date().toISOString(),
      })
    }
    return this.models.get(key)!
  }

  save(data: Partial<ThreatModelData>, target: string = this.defaultTarget): ThreatModelData {
    const key = normalizeTargetKey(target)
    const existing = this.initModel(target)
    const updated: ThreatModelData = {
      ...existing,
      ...data,
      target: target || existing.target,
      updated_at: new Date().toISOString(),
    }
    this.models.set(key, updated)
    return updated
  }

  saveMarkdownContent(content: string, target: string = this.defaultTarget): { saved: boolean; missingSections?: string[]; model?: ThreatModelData } {
    const check = validateThreatModelMarkdown(content)
    const key = normalizeTargetKey(target)
    const existing = this.initModel(target)
    const updated: ThreatModelData = {
      ...existing,
      raw_content: content,
      updated_at: new Date().toISOString(),
    }
    this.models.set(key, updated)
    return {
      saved: true,
      missingSections: check.missingSections,
      model: updated,
    }
  }

  addThreat(threat: Omit<ThreatItem, "id">, target: string = this.defaultTarget): ThreatItem {
    const model = this.initModel(target)
    const id = `THR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`
    const item: ThreatItem = { ...threat, id }
    model.threats.push(item)
    model.updated_at = new Date().toISOString()
    return item
  }

  amend(note: string, author?: string, target: string = this.defaultTarget): { timestamp: string; note: string; author?: string } {
    const model = this.initModel(target)
    const entry = {
      timestamp: new Date().toISOString(),
      note,
      author: author ?? "agent",
    }
    model.amendments.push(entry)
    model.updated_at = entry.timestamp
    return entry
  }

  get(target: string = this.defaultTarget): ThreatModelData {
    const key = normalizeTargetKey(target)
    return this.models.get(key) || this.initModel(target)
  }

  listModels(): ThreatModelData[] {
    return Array.from(this.models.values())
  }
}

export const globalThreatModelStore = new ThreatModelStore()
