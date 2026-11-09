use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use rayon::prelude::*;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

const DEFAULT_MAX_MATCHES: usize = 5_000;
const DEFAULT_MAX_LINE_LENGTH: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepPathText {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepLinesText {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepItem {
    pub path: GrepPathText,
    pub line_number: usize,
    pub lines: GrepLinesText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepResult {
    pub items: Vec<GrepItem>,
    pub partial: bool,
    pub total_matches: usize,
    pub files_searched: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GrepOptions {
    pub root: String,
    pub pattern: String,
    pub glob: Option<Vec<String>>,
    pub case_insensitive: Option<bool>,
    pub max_matches: Option<usize>,
    pub max_line_len: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GlobOptions {
    pub root: String,
    pub glob: Option<Vec<String>>,
    pub max_files: Option<usize>,
}

/// Checks if the first 1024 bytes contain a null byte (common binary file check).
fn is_binary_file(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut buffer = [0u8; 1024];
    let Ok(bytes_read) = file.read(&mut buffer) else {
        return false;
    };
    buffer[..bytes_read].contains(&0)
}

/// Collects all candidate file paths using gitignore-aware `WalkBuilder`.
pub fn walk_files(root: &str, globs: Option<&[String]>, max_files: Option<usize>) -> Vec<PathBuf> {
    let root_path = PathBuf::from(root);
    let mut override_builder = OverrideBuilder::new(&root_path);
    if let Some(glob_patterns) = globs {
        for pattern in glob_patterns {
            if let Err(e) = override_builder.add(pattern) {
                eprintln!("Invalid glob override '{}': {}", pattern, e);
            }
        }
    }
    let overrides = override_builder.build().unwrap_or_else(|_| {
        OverrideBuilder::new(&root_path)
            .build()
            .expect("empty override")
    });

    let mut walker = WalkBuilder::new(&root_path);
    walker
        .standard_filters(true)
        .parents(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .overrides(overrides);

    let max = max_files.unwrap_or(usize::MAX);
    let mut files = Vec::new();

    for result in walker.build() {
        if files.len() >= max {
            break;
        }
        let Ok(entry) = result else {
            continue;
        };
        if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(entry.into_path());
        }
    }

    files
}

/// Performs parallel, in-process regex grep across all gitignore-filtered files.
pub fn grep_files(opts: &GrepOptions) -> Result<GrepResult, String> {
    let regex = RegexBuilder::new(&opts.pattern)
        .case_insensitive(opts.case_insensitive.unwrap_or(false))
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))?;

    let candidate_files = walk_files(&opts.root, opts.glob.as_deref(), None);

    let max_matches = opts.max_matches.unwrap_or(DEFAULT_MAX_MATCHES);
    let max_line_len = opts.max_line_len.unwrap_or(DEFAULT_MAX_LINE_LENGTH);
    let files_searched = candidate_files.len();

    // Parallel scan across files
    let mut all_matches: Vec<GrepItem> = candidate_files
        .par_iter()
        .flat_map(|file_path| {
            if is_binary_file(file_path) {
                return Vec::new();
            }

            let Ok(file) = File::open(file_path) else {
                return Vec::new();
            };

            let reader = BufReader::new(file);
            let mut file_matches = Vec::new();

            for (idx, line_res) in reader.lines().enumerate() {
                let Ok(line) = line_res else {
                    break;
                };

                if regex.is_match(&line) {
                    let display_text = if line.len() > max_line_len {
                        let mut truncated = line[..max_line_len].to_string();
                        truncated.push_str("...");
                        truncated
                    } else {
                        line
                    };

                    file_matches.push(GrepItem {
                        path: GrepPathText {
                            text: file_path.to_string_lossy().replace('\\', "/"),
                        },
                        line_number: idx + 1,
                        lines: GrepLinesText { text: display_text },
                    });
                }
            }

            file_matches
        })
        .collect();

    // Sort deterministically by file path and line number
    all_matches.sort_by(|a, b| {
        a.path
            .text
            .cmp(&b.path.text)
            .then_with(|| a.line_number.cmp(&b.line_number))
    });

    let total_matches = all_matches.len();
    let truncated = total_matches > max_matches;
    if truncated {
        all_matches.truncate(max_matches);
    }

    Ok(GrepResult {
        items: all_matches,
        partial: truncated,
        total_matches,
        files_searched,
    })
}

/// Returns a list of relative or absolute file paths matching glob patterns.
pub fn glob_files(opts: &GlobOptions) -> Vec<String> {
    let root_path = Path::new(&opts.root);
    let files = walk_files(&opts.root, opts.glob.as_deref(), opts.max_files);

    files
        .into_iter()
        .map(|p| {
            if let Ok(rel) = p.strip_prefix(root_path) {
                rel.to_string_lossy().replace('\\', "/")
            } else {
                p.to_string_lossy().replace('\\', "/")
            }
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_walker_and_grep_with_gitignore() {
        let temp_dir = std::env::temp_dir().join("navi_walker_test_01");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(temp_dir.join("src")).unwrap();

        // Write .gitignore
        let mut gi = File::create(temp_dir.join(".gitignore")).unwrap();
        writeln!(gi, "ignored_dir/").unwrap();
        writeln!(gi, "*.secret").unwrap();

        // Write files
        let mut f1 = File::create(temp_dir.join("src/main.rs")).unwrap();
        writeln!(f1, "fn main() {{\n    println!(\"TARGET_STRING\");\n}}").unwrap();

        let mut f2 = File::create(temp_dir.join("src/lib.rs")).unwrap();
        writeln!(f2, "pub const KEY: &str = \"TARGET_STRING_2\";").unwrap();

        // Write ignored files
        fs::create_dir_all(temp_dir.join("ignored_dir")).unwrap();
        let mut fi1 = File::create(temp_dir.join("ignored_dir/skip.rs")).unwrap();
        writeln!(fi1, "TARGET_STRING in ignored dir").unwrap();

        let mut fi2 = File::create(temp_dir.join("test.secret")).unwrap();
        writeln!(fi2, "TARGET_STRING in secret").unwrap();

        // Grep for TARGET_STRING
        let grep_opts = GrepOptions {
            root: temp_dir.to_string_lossy().to_string(),
            pattern: "TARGET_STRING".to_string(),
            glob: None,
            case_insensitive: Some(false),
            max_matches: Some(100),
            max_line_len: Some(500),
        };

        let result = grep_files(&grep_opts).unwrap();
        assert_eq!(result.items.len(), 2);
        assert!(result
            .items
            .iter()
            .any(|i| i.lines.text.contains("TARGET_STRING_2")));
        assert!(result
            .items
            .iter()
            .any(|i| i.lines.text.contains("TARGET_STRING")
                && !i.lines.text.contains("TARGET_STRING_2")));

        // Glob files
        let glob_opts = GlobOptions {
            root: temp_dir.to_string_lossy().to_string(),
            glob: Some(vec!["*.rs".to_string()]),
            max_files: Some(50),
        };
        let globbed = glob_files(&glob_opts);
        assert_eq!(globbed.len(), 2);
        assert!(globbed.iter().any(|p| p == "src/main.rs"));
        assert!(globbed.iter().any(|p| p == "src/lib.rs"));

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
