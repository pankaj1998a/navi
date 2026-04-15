import os from "os";
import { SkillMetadata } from "./parser";

/**
 * Filter and match skills based on platform and tool availability.
 */
export class SkillMatcher {
  /**
   * Check if a skill matches the current operating system.
   * Hermes-Agent uses: darwin, linux, win32.
   */
  static matchesPlatform(metadata: SkillMetadata): boolean {
    if (!metadata.platform || metadata.platform.length === 0) {
      return true;
    }
    
    const currentPlatform = os.platform();
    // Normalize platforms (e.g. windows -> win32)
    const normalizedPlatform = currentPlatform === "win32" ? "win32" : currentPlatform;
    
    return metadata.platform.some((p) => {
      const target = p.toLowerCase();
      if (target === "windows") return normalizedPlatform === "win32";
      if (target === "macos") return normalizedPlatform === "darwin";
      return normalizedPlatform === target;
    });
  }

  /**
   * Check if the required tools for a skill are available.
   */
  static matchesRequiredTools(metadata: SkillMetadata, availableTools: string[]): boolean {
    if (!metadata.requires_tools || metadata.requires_tools.length === 0) {
      return true;
    }
    
    return metadata.requires_tools.every((tool) => availableTools.includes(tool));
  }

  /**
   * Comprehensive match check.
   */
  static isMatch(
    metadata: SkillMetadata,
    options: { platform?: string; availableTools?: string[] } = {}
  ): boolean {
    if (!this.matchesPlatform(metadata)) return false;
    
    if (options.availableTools && !this.matchesRequiredTools(metadata, options.availableTools)) {
      return false;
    }
    
    return true;
  }
}
