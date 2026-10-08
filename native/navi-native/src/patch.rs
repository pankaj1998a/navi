use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::seek_sequence::seek_sequence;

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchResult {
    pub success: bool,
    pub modified_files: Vec<String>,
    pub added_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub diff: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum Hunk {
    Add { raw_path: String, path: PathBuf, content: String },
    Delete { raw_path: String, path: PathBuf },
    Update { raw_path: String, path: PathBuf, raw_move_to: Option<String>, move_to: Option<PathBuf>, chunks: Vec<UpdateChunk> },
}

#[derive(Debug, Clone)]
pub struct UpdateChunk {
    pub change_context: Option<String>,
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
    pub is_eof: bool,
}

pub fn parse_patch(patch_text: &str) -> Result<Vec<Hunk>, String> {
    let lines: Vec<&str> = patch_text.lines().collect();
    let begin_idx = lines.iter().position(|l| l.trim().starts_with("*** Begin Patch"));
    let begin_idx = match begin_idx {
        Some(idx) => idx,
        None => return Err("Invalid patch format: missing '*** Begin Patch'".to_string()),
    };
    let mut i = begin_idx + 1;
    let mut hunks = Vec::new();

    while i < lines.len() {
        let line = lines[i].trim();
        if line.starts_with("*** End Patch") {
            break;
        }

        if let Some(rest) = line.strip_prefix("*** Add File:") {
            let raw_path = rest.trim().to_string();
            let path = PathBuf::from(&raw_path);
            i += 1;
            let mut content_lines = Vec::new();
            while i < lines.len() {
                let l = lines[i];
                if l.trim().starts_with("***") {
                    break;
                }
                if let Some(stripped) = l.strip_prefix('+') {
                    content_lines.push(stripped);
                } else {
                    content_lines.push(l);
                }
                i += 1;
            }
            let content = content_lines.join("\n");
            hunks.push(Hunk::Add { raw_path, path, content });
            continue;
        }

        if let Some(rest) = line.strip_prefix("*** Delete File:") {
            let raw_path = rest.trim().to_string();
            let path = PathBuf::from(&raw_path);
            i += 1;
            hunks.push(Hunk::Delete { raw_path, path });
            continue;
        }

        if let Some(rest) = line.strip_prefix("*** Update File:") {
            let raw_path = rest.trim().to_string();
            let path = PathBuf::from(&raw_path);
            i += 1;
            let mut raw_move_to = None;
            let mut move_to = None;
            if i < lines.len() && lines[i].trim().starts_with("*** Move to:") {
                let m_rest = lines[i].trim().strip_prefix("*** Move to:").unwrap().trim().to_string();
                move_to = Some(PathBuf::from(&m_rest));
                raw_move_to = Some(m_rest);
                i += 1;
            }

            let mut chunks = Vec::new();
            let mut cur_context = None;
            let mut cur_old = Vec::new();
            let mut cur_new = Vec::new();
            let mut is_eof = false;

            while i < lines.len() {
                let l = lines[i];
                let trimmed = l.trim();

                if trimmed.starts_with("***") {
                    if trimmed.starts_with("*** End of File") {
                        is_eof = true;
                        i += 1;
                    }
                    break;
                }

                if trimmed.starts_with("@@") {
                    if !cur_old.is_empty() || !cur_new.is_empty() {
                        chunks.push(UpdateChunk {
                            change_context: cur_context.take(),
                            old_lines: std::mem::take(&mut cur_old),
                            new_lines: std::mem::take(&mut cur_new),
                            is_eof: false,
                        });
                    }
                    let ctx_str = trimmed.strip_prefix("@@").unwrap().trim();
                    if !ctx_str.is_empty() {
                        cur_context = Some(ctx_str.to_string());
                    }
                    i += 1;
                    continue;
                }

                if let Some(stripped) = l.strip_prefix('-') {
                    cur_old.push(stripped.to_string());
                } else if let Some(stripped) = l.strip_prefix('+') {
                    cur_new.push(stripped.to_string());
                } else if let Some(stripped) = l.strip_prefix(' ') {
                    cur_old.push(stripped.to_string());
                    cur_new.push(stripped.to_string());
                } else {
                    // Plain context line without prefix
                    cur_old.push(l.to_string());
                    cur_new.push(l.to_string());
                }
                i += 1;
            }

            if !cur_old.is_empty() || !cur_new.is_empty() {
                chunks.push(UpdateChunk {
                    change_context: cur_context,
                    old_lines: cur_old,
                    new_lines: cur_new,
                    is_eof,
                });
            }

            hunks.push(Hunk::Update { raw_path, path, raw_move_to, move_to, chunks });
            continue;
        }

        i += 1;
    }

    Ok(hunks)
}

pub fn apply_hunk_to_file(file_content: &str, chunks: &[UpdateChunk]) -> Result<String, String> {
    let mut lines: Vec<String> = file_content.lines().map(|s| s.to_string()).collect();
    let mut line_index = 0;

    for chunk in chunks {
        let search_start = if let Some(ctx) = &chunk.change_context {
            let ctx_pattern = vec![ctx.clone()];
            if let Some(found_idx) = seek_sequence(&lines, &ctx_pattern, line_index, false) {
                found_idx
            } else if let Some(found_idx) = seek_sequence(&lines, &ctx_pattern, 0, false) {
                found_idx
            } else {
                return Err(format!("Context '{}' not found in file", ctx));
            }
        } else {
            line_index
        };

        if chunk.old_lines.is_empty() {
            // Pure insertion
            for (offset, new_line) in chunk.new_lines.iter().enumerate() {
                lines.insert(search_start + offset, new_line.clone());
            }
            line_index = search_start + chunk.new_lines.len();
            continue;
        }

        let found = seek_sequence(&lines, &chunk.old_lines, search_start, chunk.is_eof)
            .or_else(|| seek_sequence(&lines, &chunk.old_lines, 0, chunk.is_eof));

        if let Some(found_idx) = found {
            // Replace old_lines with new_lines
            for _ in 0..chunk.old_lines.len() {
                if found_idx < lines.len() {
                    lines.remove(found_idx);
                }
            }
            for (offset, new_line) in chunk.new_lines.iter().enumerate() {
                lines.insert(found_idx + offset, new_line.clone());
            }
            line_index = found_idx + chunk.new_lines.len();
        } else {
            return Err(format!(
                "Failed to find expected pattern in file:\n{}",
                chunk.old_lines.join("\n")
            ));
        }
    }

    let mut result = lines.join("\n");
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

pub fn execute_patch(root_dir: &Path, patch_text: &str) -> PatchResult {
    let hunks = match parse_patch(patch_text) {
        Ok(h) => h,
        Err(e) => {
            return PatchResult {
                success: false,
                modified_files: Vec::new(),
                added_files: Vec::new(),
                deleted_files: Vec::new(),
                diff: String::new(),
                error: Some(e),
            }
        }
    };

    if hunks.is_empty() {
        return PatchResult {
            success: false,
            modified_files: Vec::new(),
            added_files: Vec::new(),
            deleted_files: Vec::new(),
            diff: String::new(),
            error: Some("No files were modified.".to_string()),
        };
    }

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();

    for hunk in hunks {
        match hunk {
            Hunk::Add { raw_path, path, content } => {
                let full_path = root_dir.join(&path);
                if let Some(parent) = full_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&full_path, content) {
                    return PatchResult {
                        success: false,
                        modified_files: modified,
                        added_files: added,
                        deleted_files: deleted,
                        diff: String::new(),
                        error: Some(format!("Failed to write added file {:?}: {}", path, e)),
                    };
                }
                added.push(raw_path);
            }
            Hunk::Delete { raw_path, path } => {
                let full_path = root_dir.join(&path);
                if !full_path.exists() {
                    return PatchResult {
                        success: false,
                        modified_files: modified,
                        added_files: added,
                        deleted_files: deleted,
                        diff: String::new(),
                        error: Some(format!("Failed to delete non-existent file: {:?}", path)),
                    };
                }
                if let Err(e) = std::fs::remove_file(&full_path) {
                    return PatchResult {
                        success: false,
                        modified_files: modified,
                        added_files: added,
                        deleted_files: deleted,
                        diff: String::new(),
                        error: Some(format!("Failed to delete file {:?}: {}", path, e)),
                    };
                }
                deleted.push(raw_path);
            }
            Hunk::Update { raw_path, path, raw_move_to, move_to, chunks } => {
                let full_path = root_dir.join(&path);
                if !full_path.exists() {
                    return PatchResult {
                        success: false,
                        modified_files: modified,
                        added_files: added,
                        deleted_files: deleted,
                        diff: String::new(),
                        error: Some(format!("Failed to read file to update: {:?}", path)),
                    };
                }
                let current_content = match std::fs::read_to_string(&full_path) {
                    Ok(c) => c,
                    Err(e) => {
                        return PatchResult {
                            success: false,
                            modified_files: modified,
                            added_files: added,
                            deleted_files: deleted,
                            diff: String::new(),
                            error: Some(format!("Failed to read file {:?}: {}", path, e)),
                        };
                    }
                };

                let updated_content = match apply_hunk_to_file(&current_content, &chunks) {
                    Ok(c) => c,
                    Err(e) => {
                        return PatchResult {
                            success: false,
                            modified_files: modified,
                            added_files: added,
                            deleted_files: deleted,
                            diff: String::new(),
                            error: Some(format!("Error updating file {:?}: {}", path, e)),
                        };
                    }
                };

                let (target_path, recorded_path) = if let Some(target) = move_to {
                    let full_target = root_dir.join(&target);
                    if let Some(parent) = full_target.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::remove_file(&full_path);
                    (full_target, raw_move_to.unwrap_or_else(|| target.to_string_lossy().to_string()))
                } else {
                    (full_path, raw_path)
                };

                if let Err(e) = std::fs::write(&target_path, updated_content) {
                    return PatchResult {
                        success: false,
                        modified_files: modified,
                        added_files: added,
                        deleted_files: deleted,
                        diff: String::new(),
                        error: Some(format!("Failed to write updated file {:?}: {}", path, e)),
                    };
                }
                modified.push(recorded_path);
            }
        }
    }

    PatchResult {
        success: true,
        modified_files: modified,
        added_files: added,
        deleted_files: deleted,
        diff: "Patch applied successfully via native codex engine".to_string(),
        error: None,
    }
}
