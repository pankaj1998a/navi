import fs from "fs/promises";
import path from "path";
import { Skill } from "./parser";

/**
 * Handles snapshot caching for skills.
 * Persists parsed metadata and content to avoid re-parsing every time.
 */
export class SkillCache {
  private cachePath: string;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
  }

  /**
   * Save a snapshot of parsed skills to disk.
   */
  async saveSnapshot(skills: Skill[], manifest: Record<string, { mtime: number; size: number }>): Promise<void> {
    const data = JSON.stringify({ skills, manifest }, null, 2);
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.cachePath, data, "utf-8");
  }

  /**
   * Load a snapshot from disk.
   */
  async loadSnapshot(): Promise<{ skills: Skill[]; manifest: Record<string, { mtime: number; size: number }> } | null> {
    try {
      const data = await fs.readFile(this.cachePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a file's manifest matches its current state on disk.
   */
  async isUpToDate(filePath: string, storedManifest: Record<string, { mtime: number; size: number }>): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      const entry = storedManifest[filePath];
      if (!entry) return false;
      
      return entry.mtime === stats.mtimeMs && entry.size === stats.size;
    } catch (error) {
      return false;
    }
  }
}
