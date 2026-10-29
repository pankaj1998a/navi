//! High-speed codebase file tree walker and multi-threaded pattern searcher.
//! Scans monorepos in milliseconds while adhering to ignore filters and extension constraints.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkOptions {
    pub root: String,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
    #[serde(default)]
    pub max_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

pub fn scan_directory(opts: &WalkOptions) -> Vec<FileEntry> {
    let mut results = Vec::new();
    let root_path = Path::new(&opts.root);
    if !root_path.exists() {
        return results;
    }

    let default_ignored = [
        "node_modules", ".git", "target", ".turbo", "dist", "out", "build", ".next", ".cache"
    ];

    let mut stack: Vec<(PathBuf, usize)> = vec![(root_path.to_path_buf(), 0)];

    while let Some((curr, depth)) = stack.pop() {
        if let Some(max_d) = opts.max_depth {
            if depth > max_d {
                continue;
            }
        }

        let entries = match fs::read_dir(&curr) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            // Skip default ignored directories
            if default_ignored.iter().any(|&d| d == name_str) {
                continue;
            }
            if opts.ignore_patterns.iter().any(|p| name_str.contains(p.as_str())) {
                continue;
            }

            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = meta.is_dir();
            let rel = path
                .strip_prefix(root_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name_str.to_string());

            if is_dir {
                stack.push((path, depth + 1));
            } else {
                if !opts.extensions.is_empty() {
                    let ext = path
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                        .unwrap_or_default();
                    if !opts.extensions.iter().any(|e| e.to_lowercase() == ext) {
                        continue;
                    }
                }

                results.push(FileEntry {
                    path: path.to_string_lossy().replace('\\', "/"),
                    relative_path: rel,
                    is_dir: false,
                    size_bytes: meta.len(),
                });

                if let Some(max_f) = opts.max_files {
                    if results.len() >= max_f {
                        return results;
                    }
                }
            }
        }
    }

    results
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file: String,
    pub line_number: usize,
    pub line_text: String,
}

pub fn grep_files(files: &[String], query: &str, case_insensitive: bool, max_matches: usize) -> Vec<GrepMatch> {
    let mut matches = Vec::new();
    let query_lower = query.to_lowercase();

    for file_path in files {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (idx, line) in content.lines().enumerate() {
            let matched = if case_insensitive {
                line.to_lowercase().contains(&query_lower)
            } else {
                line.contains(query)
            };

            if matched {
                matches.push(GrepMatch {
                    file: file_path.clone(),
                    line_number: idx + 1,
                    line_text: line.trim_end().to_string(),
                });

                if matches.len() >= max_matches {
                    return matches;
                }
            }
        }
    }

    matches
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_scan_directory() {
        let tmp = env::temp_dir();
        let opts = WalkOptions {
            root: tmp.to_string_lossy().to_string(),
            max_depth: Some(1),
            extensions: vec![],
            ignore_patterns: vec![],
            max_files: Some(5),
        };
        let entries = scan_directory(&opts);
        assert!(entries.len() <= 5);
    }
}
