//! High-performance Myers diffing and change statistics in native Rust.
//! Uses the `similar` crate for zero-allocation slice diffing.

use similar::{ChangeTag, TextDiff};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffStats {
    pub additions: usize,
    pub deletions: usize,
}

/// Computes additions and deletions count between two text blobs
pub fn compute_diff_stats(old_text: &str, new_text: &str) -> DiffStats {
    let diff = TextDiff::from_lines(old_text, new_text);
    let mut additions = 0;
    let mut deletions = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }

    DiffStats { additions, deletions }
}

/// Generates a standard unified diff between two text documents
pub fn generate_unified_diff(
    old_text: &str,
    new_text: &str,
    file_path: &str,
    context_lines: usize,
) -> String {
    let diff = TextDiff::from_lines(old_text, new_text);
    diff.unified_diff()
        .header(&format!("a/{}", file_path), &format!("b/{}", file_path))
        .context_radius(context_lines)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_stats() {
        let old = "line 1\nline 2\nline 3\n";
        let new = "line 1\nline 2 modified\nline 3\nline 4\n";
        let stats = compute_diff_stats(old, new);
        assert_eq!(stats.deletions, 1);
        assert_eq!(stats.additions, 2);
    }

    #[test]
    fn test_unified_diff() {
        let old = "hello\nworld\n";
        let new = "hello\nbrave\nworld\n";
        let diff = generate_unified_diff(old, new, "test.txt", 3);
        assert!(diff.contains("--- a/test.txt"));
        assert!(diff.contains("+++ b/test.txt"));
        assert!(diff.contains("+brave"));
    }
}
