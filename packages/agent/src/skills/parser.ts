import yaml from "yaml";

export interface SkillMetadata {
  name: string;
  description: string;
  platform?: string[];
  requires_tools?: string[];
  fallback_for_tools?: string[];
  [key: string]: any;
}

export interface Skill {
  metadata: SkillMetadata;
  body: string;
}

/**
 * Parses a SKILL.md file.
 * Expects YAML frontmatter delimited by ---.
 */
export function parseSkill(content: string): Skill {
  // Regex to match YAML frontmatter
  const match = content.match(/^---\r?\n([\s\S]*?)\n---\r?\n([\s\S]*)$/);
  
  if (!match) {
    // If no frontmatter, treat the whole file as body (might need some default metadata)
    return {
      metadata: {
        name: "unknown",
        description: "No metadata found",
      },
      body: content,
    };
  }

  try {
    const metadata = yaml.parse(match[1]) as SkillMetadata;
    const body = match[2].trim();
    
    return {
      metadata: {
        ...metadata,
        name: metadata.name || "unnamed",
      },
      body,
    };
  } catch (error) {
    console.error("Failed to parse skill frontmatter:", error);
    return {
      metadata: {
        name: "error",
        description: "Failed to parse metadata",
      },
      body: match[2].trim(),
    };
  }
}
