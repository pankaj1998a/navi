/**
 * Cross-Project Developer Profile Store
 * Ported from ai-memory's cross-project profile design.
 * Maintains user-level engineering habits, preferred package managers, test runners,
 * and architectural defaults that automatically follow the developer across any repository.
 */

import fs from "node:fs"
import path from "node:path"
import { Global } from "@navi-ai/core/global"

export interface UserProfile {
  package_manager: string
  preferred_test_runner: string
  architectural_habits: string[]
  workflow_preferences: string[]
  custom_rules: string[]
  updated_at: string
}

const DEFAULT_PROFILE: UserProfile = {
  package_manager: "bun",
  preferred_test_runner: "bun test",
  architectural_habits: [
    "Favor simplicity and surgical changes over speculative abstractions",
    "Prefer TypeScript strict mode and Effect-TS functional error handling",
    "Preserve existing repository conventions and comments",
  ],
  workflow_preferences: [
    "Verify changes with automated tests and typechecks before marking done",
    "Clean up temporary files and keep diffs minimal",
  ],
  custom_rules: [],
  updated_at: new Date().toISOString(),
}

export function getProfilePath(): string {
  const dir = path.join(Global.Path.data, "memory")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, "user_profile.json")
}

export function getUserProfile(): UserProfile {
  const file = getProfilePath()
  if (!fs.existsSync(file)) {
    saveUserProfile(DEFAULT_PROFILE)
    return DEFAULT_PROFILE
  }
  try {
    const raw = fs.readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw) as Partial<UserProfile>
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      updated_at: parsed.updated_at || new Date().toISOString(),
    }
  } catch {
    return DEFAULT_PROFILE
  }
}

export function saveUserProfile(profile: UserProfile): void {
  const file = getProfilePath()
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), "utf-8")
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile()
  const updated: UserProfile = {
    ...current,
    ...updates,
    architectural_habits: updates.architectural_habits
      ? Array.from(new Set([...current.architectural_habits, ...updates.architectural_habits]))
      : current.architectural_habits,
    workflow_preferences: updates.workflow_preferences
      ? Array.from(new Set([...current.workflow_preferences, ...updates.workflow_preferences]))
      : current.workflow_preferences,
    custom_rules: updates.custom_rules
      ? Array.from(new Set([...current.custom_rules, ...updates.custom_rules]))
      : current.custom_rules,
    updated_at: new Date().toISOString(),
  }
  saveUserProfile(updated)
  return updated
}

export function formatProfileForPrompt(): string {
  const profile = getUserProfile()
  const lines: string[] = [
    "### Developer Cross-Project Profile (ai-memory)",
    `- **Package Manager**: \`${profile.package_manager}\``,
    `- **Preferred Test Runner**: \`${profile.preferred_test_runner}\``,
  ]
  if (profile.architectural_habits.length > 0) {
    lines.push("- **Architectural Habits**:")
    for (const habit of profile.architectural_habits) {
      lines.push(`  - ${habit}`)
    }
  }
  if (profile.workflow_preferences.length > 0) {
    lines.push("- **Workflow Preferences**:")
    for (const pref of profile.workflow_preferences) {
      lines.push(`  - ${pref}`)
    }
  }
  if (profile.custom_rules.length > 0) {
    lines.push("- **Global Rules**:")
    for (const rule of profile.custom_rules) {
      lines.push(`  - ${rule}`)
    }
  }
  return lines.join("\n")
}
