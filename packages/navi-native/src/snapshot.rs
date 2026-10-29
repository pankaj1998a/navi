//! High-performance workspace snapshotting, tree hashing, and Myers diff generation in native Rust.
//! Designed to replace slow external `git.exe` spawns and heavy JavaScript `diff` string allocations.

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffItem {
    pub file: String,
    pub patch: String,
    pub additions: usize,
    pub deletions: usize,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DiffRequestItem {
    pub file: String,
    pub before: String,
    pub after: String,
    #[serde(default)]
    pub binary: bool,
}

/// Compute structured file diff between before and after contents
pub fn compute_structured_diff(file: &str, before: &str, after: &str) -> FileDiffItem {
    if before == after {
        return FileDiffItem {
            file: file.to_string(),
            patch: String::new(),
            additions: 0,
            deletions: 0,
            status: "modified".to_string(),
        };
    }

    let diff = TextDiff::from_lines(before, after);
    let mut additions = 0;
    let mut deletions = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }

    let status = if before.is_empty() && !after.is_empty() {
        "added"
    } else if !before.is_empty() && after.is_empty() {
        "deleted"
    } else {
        "modified"
    };

    // Format patch with full context (identical to structuredPatch with context: MAX_SAFE_INTEGER)
    let patch = diff
        .unified_diff()
        .header(file, file)
        .context_radius(usize::MAX / 4)
        .to_string();

    FileDiffItem {
        file: file.to_string(),
        patch,
        additions,
        deletions,
        status: status.to_string(),
    }
}

/// Computes batch diffs for multiple files efficiently
pub fn compute_batch_diffs(items: &[DiffRequestItem]) -> Vec<FileDiffItem> {
    items
        .iter()
        .map(|item| {
            if item.binary {
                FileDiffItem {
                    file: item.file.clone(),
                    patch: String::new(),
                    additions: 0,
                    deletions: 0,
                    status: if item.before.is_empty() {
                        "added".to_string()
                    } else if item.after.is_empty() {
                        "deleted".to_string()
                    } else {
                        "modified".to_string()
                    },
                }
            } else {
                compute_structured_diff(&item.file, &item.before, &item.after)
            }
        })
        .collect()
}

/// Computes a fast working-tree state hash for a directory
/// Walks the directory, hashes relative paths + file size + modified time
pub fn compute_tree_state_hash(root: &Path, ignore_dirs: &[&str]) -> Option<String> {
    let mut hasher = DefaultHasher::new();
    let mut files_scanned = 0usize;

    fn walk_dir(
        dir: &Path,
        root: &Path,
        ignore_dirs: &[&str],
        hasher: &mut DefaultHasher,
        count: &mut usize,
    ) {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            if ignore_dirs.iter().any(|&d| d == name_str) {
                continue;
            }

            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    walk_dir(&path, root, ignore_dirs, hasher, count);
                } else if meta.is_file() {
                    if let Ok(rel) = path.strip_prefix(root) {
                        rel.to_string_lossy().hash(hasher);
                        meta.len().hash(hasher);
                        if let Ok(mtime) = meta.modified() {
                            if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                                dur.as_millis().hash(hasher);
                            }
                        }
                        *count += 1;
                    }
                }
            }
        }
    }

    walk_dir(root, root, ignore_dirs, &mut hasher, &mut files_scanned);
    Some(format!("{:016x}:{}", hasher.finish(), files_scanned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_structured_diff() {
        let before = "line1\nline2\n";
        let after = "line1\nline2 modified\nline3\n";
        let diff = compute_structured_diff("foo.ts", before, after);
        assert_eq!(diff.file, "foo.ts");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.deletions, 1);
        assert_eq!(diff.additions, 2);
        assert!(diff.patch.contains("--- foo.ts"));
        assert!(diff.patch.contains("+++ foo.ts"));
    }

    #[test]
    fn test_batch_diffs() {
        let reqs = vec![
            DiffRequestItem {
                file: "a.txt".to_string(),
                before: "hello".to_string(),
                after: "world".to_string(),
                binary: false,
            },
            DiffRequestItem {
                file: "bin.dat".to_string(),
                before: "abc".to_string(),
                after: "def".to_string(),
                binary: true,
            },
        ];
        let diffs = compute_batch_diffs(&reqs);
        assert_eq!(diffs.len(), 2);
        assert_eq!(diffs[0].file, "a.txt");
        assert_eq!(diffs[0].additions, 1);
        assert_eq!(diffs[1].file, "bin.dat");
        assert_eq!(diffs[1].patch, "");
    }
}
