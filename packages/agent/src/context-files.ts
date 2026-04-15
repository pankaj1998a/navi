import fs from "fs/promises";
import path from "path";

export interface ContextFile {
  name: string;
  path: string;
  content: string;
}

const CONTEXT_THREAT_PATTERNS = [
  /ignore\s+(previous|all|above|prior)\s+instructions/i,
  /do\s+not\s+tell\s+the\s+user/i,
  /system\s+prompt\s+override/i,
  /you\s+are\s+now\s+an\s+unfiltered\s+ai/i,
];

/**
 * Handles loading and sanitizing project-specific context files.
 */
export class ContextFileReader {
  /**
   * Load standard context files from a directory.
   * Priority: .hermes.md > CLAUDE.md > AGENTS.md > .cursorrules
   */
  static async loadProjectContext(cwd: string): Promise<ContextFile[]> {
    const searchFiles = [
      ".hermes.md",
      "HERMES.md",
      "CLAUDE.md",
      "claude.md",
      "AGENTS.md",
      "agents.md",
      ".cursorrules",
    ];
    
    const results: ContextFile[] = [];
    
    for (const fileName of searchFiles) {
      const filePath = path.join(cwd, fileName);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        results.push({
          name: fileName,
          path: filePath,
          content: this.sanitizeContent(content),
        });
      } catch {
        // Skip missing files
      }
    }
    
    return results;
  }

  /**
   * Sanitizes content to prevent prompt injection and handle truncation.
   */
  private static sanitizeContent(content: string): string {
    // 1. Check for injection patterns
    for (const pattern of CONTEXT_THREAT_PATTERNS) {
      if (pattern.test(content)) {
        return `[Content removed: Potential prompt injection detected]`;
      }
    }

    // 2. Truncate if extremely long (Head 70% / Tail 20% split)
    const MAX_CONTEXT_FILE_CHARS = 50000;
    if (content.length > MAX_CONTEXT_FILE_CHARS) {
      const headSize = Math.floor(MAX_CONTEXT_FILE_CHARS * 0.7);
      const tailSize = Math.floor(MAX_CONTEXT_FILE_CHARS * 0.2);
      return (
        content.substring(0, headSize) +
        "\n\n... [Content truncated for length] ...\n\n" +
        content.substring(content.length - tailSize)
      );
    }

    return content;
  }

  /**
   * Formats loaded context files into a system prompt block.
   */
  static buildContextFilesPrompt(files: ContextFile[]): string {
    if (files.length === 0) return "";

    let prompt = "--- PROJECT CONTEXT ---\n";
    for (const file of files) {
      prompt += `\n### File: ${file.name}\n${file.content}\n`;
    }
    prompt += "\n--- END PROJECT CONTEXT ---";
    
    return prompt;
  }
}
