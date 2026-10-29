//! Native Rust Agency Agents Indexer & Search Accelerator for Navi
//! Provides high-speed YAML frontmatter parsing, division filtering,
//! and scoring search across the 286+ Agency agent roster.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentMetadata {
    pub id: String,
    pub name: String,
    pub division: String,
    pub description: String,
    pub color: String,
    pub emoji: String,
    pub vibe: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSearchResult {
    pub agent: AgentMetadata,
    pub score: i32,
}

/// Extracts YAML frontmatter fields from markdown content without full YAML parser overhead.
pub fn parse_agent_frontmatter(content: &str, file_path: &str, fallback_id: &str) -> Option<AgentMetadata> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }

    let after_first = &trimmed[3..];
    let end_index = after_first.find("\n---")?;
    let frontmatter = &after_first[..end_index];

    let mut name = String::new();
    let mut description = String::new();
    let mut color = String::new();
    let mut emoji = String::new();
    let mut vibe = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some(rest) = line.strip_prefix("name:") {
            name = clean_yaml_val(rest);
        } else if let Some(rest) = line.strip_prefix("description:") {
            description = clean_yaml_val(rest);
        } else if let Some(rest) = line.strip_prefix("color:") {
            color = clean_yaml_val(rest);
        } else if let Some(rest) = line.strip_prefix("emoji:") {
            emoji = clean_yaml_val(rest);
        } else if let Some(rest) = line.strip_prefix("vibe:") {
            vibe = clean_yaml_val(rest);
        }
    }

    let id = fallback_id.to_string();

    let division = extract_division_from_path(file_path);

    Some(AgentMetadata {
        id,
        name: if name.is_empty() { fallback_id.to_string() } else { name },
        division,
        description,
        color: if color.is_empty() { "cyan".to_string() } else { color },
        emoji: if emoji.is_empty() { "🤖".to_string() } else { emoji },
        vibe,
        file_path: file_path.to_string(),
    })
}

fn clean_yaml_val(val: &str) -> String {
    let trimmed = val.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        if trimmed.len() >= 2 {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn extract_division_from_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() >= 2 {
        parts[parts.len() - 2].to_string()
    } else {
        "general".to_string()
    }
}

/// Scores and filters agents against a search query and optional division.
pub fn search_agents(
    catalog: &[AgentMetadata],
    query: &str,
    division_filter: Option<&str>,
    limit: usize,
) -> Vec<AgentSearchResult> {
    let q = query.trim().to_lowercase();
    let div_filter = division_filter.map(|d| d.trim().to_lowercase()).filter(|d| !d.is_empty());

    let mut results = Vec::new();

    for agent in catalog {
        if let Some(ref d) = div_filter {
            if !agent.division.to_lowercase().eq(d) {
                continue;
            }
        }

        if q.is_empty() {
            results.push(AgentSearchResult {
                agent: agent.clone(),
                score: 1,
            });
            continue;
        }

        let mut score = 0;
        let id_lower = agent.id.to_lowercase();
        let name_lower = agent.name.to_lowercase();
        let desc_lower = agent.description.to_lowercase();
        let vibe_lower = agent.vibe.to_lowercase();

        if name_lower == q || id_lower == q {
            score += 100;
        } else if name_lower.starts_with(&q) || id_lower.starts_with(&q) {
            score += 50;
        } else if name_lower.contains(&q) || id_lower.contains(&q) {
            score += 30;
        }

        if desc_lower.contains(&q) {
            score += 15;
        }

        if vibe_lower.contains(&q) {
            score += 10;
        }

        // Substring / word matching
        for word in q.split_whitespace() {
            if word.len() < 2 { continue; }
            if name_lower.contains(word) { score += 10; }
            if desc_lower.contains(word) { score += 5; }
        }

        if score > 0 {
            results.push(AgentSearchResult {
                agent: agent.clone(),
                score,
            });
        }
    }

    results.sort_by(|a, b| b.score.cmp(&a.score));
    if limit > 0 && results.len() > limit {
        results.truncate(limit);
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter() {
        let md = r#"---
name: Frontend Developer
description: Expert frontend developer specializing in modern web technologies
color: cyan
emoji: 🖥️
vibe: Builds responsive, accessible web apps with pixel-perfect precision.
---

# Instructions
You are frontend dev.
"#;
        let meta = parse_agent_frontmatter(md, "skills/agency/engineering/engineering-frontend-developer.md", "frontend-dev").unwrap();
        assert_eq!(meta.name, "Frontend Developer");
        assert_eq!(meta.division, "engineering");
        assert_eq!(meta.emoji, "🖥️");
        assert_eq!(meta.color, "cyan");
        assert!(meta.description.contains("modern web technologies"));
    }

    #[test]
    fn test_search_and_filter() {
        let catalog = vec![
            AgentMetadata {
                id: "engineering-frontend-developer".to_string(),
                name: "Frontend Developer".to_string(),
                division: "engineering".to_string(),
                description: "React and UI implementation".to_string(),
                color: "cyan".to_string(),
                emoji: "🖥️".to_string(),
                vibe: "Pixel perfect".to_string(),
                file_path: "engineering/dev.md".to_string(),
            },
            AgentMetadata {
                id: "testing-evidence-collector".to_string(),
                name: "Evidence Collector".to_string(),
                division: "testing".to_string(),
                description: "Task QA and visual verification".to_string(),
                color: "yellow".to_string(),
                emoji: "🔍".to_string(),
                vibe: "Evidence over claims".to_string(),
                file_path: "testing/qa.md".to_string(),
            },
        ];

        let res = search_agents(&catalog, "frontend", None, 10);
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].agent.name, "Frontend Developer");

        let res_div = search_agents(&catalog, "", Some("testing"), 10);
        assert_eq!(res_div.len(), 1);
        assert_eq!(res_div[0].agent.name, "Evidence Collector");
    }
}
