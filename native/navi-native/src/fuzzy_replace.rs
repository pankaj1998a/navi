use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyReplaceRequest {
    pub content: String,
    pub old_string: String,
    pub new_string: String,
    #[serde(default)]
    pub replace_all: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyReplaceResponse {
    pub success: bool,
    pub result: Option<String>,
    pub strategy: Option<String>,
    pub matches_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuzzyReplaceOutput {
    pub new_content: String,
    pub strategy: &'static str,
    pub matches_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct ByteSpan {
    start: usize,
    end: usize,
}

/// Normalizes unicode smart quotes, dashes, and non-breaking spaces.
fn unicode_normalize(s: &str) -> String {
    s.trim()
        .chars()
        .map(|c| match c {
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}'
            | '\u{2212}' => '-',
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            '\u{00A0}' | '\u{2002}' | '\u{2003}' | '\u{2004}' | '\u{2005}' | '\u{2006}'
            | '\u{2007}' | '\u{2008}' | '\u{2009}' | '\u{200A}' | '\u{202F}' | '\u{205F}'
            | '\u{3000}' => ' ',
            other => other,
        })
        .collect()
}

/// Splits content by newline while retaining exact byte offsets of each line.
fn get_line_offsets(content: &str) -> Vec<ByteSpan> {
    let mut offsets = Vec::new();
    let mut line_start = 0;
    let bytes = content.as_bytes();

    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            let line_end = if i > line_start && bytes[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            offsets.push(ByteSpan {
                start: line_start,
                end: line_end,
            });
            line_start = i + 1;
        }
    }

    if line_start <= content.len() {
        let mut line_end = content.len();
        if line_end > line_start && bytes[line_end - 1] == b'\r' {
            line_end -= 1;
        }
        offsets.push(ByteSpan {
            start: line_start,
            end: line_end,
        });
    }

    offsets
}

fn strip_common_indentation<'a>(lines: &[&'a str]) -> Vec<&'a str> {
    let non_empty: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| !l.trim().is_empty())
        .collect();
    if non_empty.is_empty() {
        return lines.to_vec();
    }

    let min_indent = non_empty
        .iter()
        .map(|l| l.chars().take_while(|c| c.is_whitespace()).count())
        .min()
        .unwrap_or(0);

    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                ""
            } else {
                let mut char_indices = l.char_indices();
                let skip_byte = char_indices
                    .nth(min_indent)
                    .map(|(idx, _)| idx)
                    .unwrap_or_else(|| l.len());
                &l[skip_byte..]
            }
        })
        .collect()
}

/// Applies replacements at the given non-overlapping byte spans in `content`.
fn apply_spans(content: &str, spans: &[ByteSpan], new_string: &str) -> String {
    let mut sorted = spans.to_vec();
    sorted.sort_by_key(|s| s.start);

    let mut result = String::with_capacity(content.len());
    let mut last_idx = 0;

    for span in sorted {
        result.push_str(&content[last_idx..span.start]);
        result.push_str(new_string);
        last_idx = span.end;
    }
    result.push_str(&content[last_idx..]);
    result
}

struct TokenSpan {
    text: String,
    start: usize,
    end: usize,
}

fn extract_tokens(s: &str) -> Vec<TokenSpan> {
    let mut tokens = Vec::new();
    let mut current_start = None;

    for (idx, c) in s.char_indices() {
        if c.is_whitespace() {
            if let Some(st) = current_start {
                tokens.push(TokenSpan {
                    text: unicode_normalize(&s[st..idx]),
                    start: st,
                    end: idx,
                });
                current_start = None;
            }
        } else if current_start.is_none() {
            current_start = Some(idx);
        }
    }
    if let Some(st) = current_start {
        tokens.push(TokenSpan {
            text: unicode_normalize(&s[st..]),
            start: st,
            end: s.len(),
        });
    }
    tokens
}

/// High-performance fuzzy replace engine.
/// Progressively tries exact, trimmed, unicode-normalized, indentation-flexible, and context-anchor matching.
pub fn fuzzy_replace(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<FuzzyReplaceOutput, String> {
    if old_string == new_string {
        return Err("No changes to apply: oldString and newString are identical.".to_string());
    }
    if old_string.is_empty() {
        return Err("oldString cannot be empty.".to_string());
    }

    // ── Strategy 1: Exact Match ──
    let exact_indices: Vec<usize> = content.match_indices(old_string).map(|(i, _)| i).collect();
    if !exact_indices.is_empty() {
        if replace_all {
            let new_content = content.replace(old_string, new_string);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "exact",
                matches_count: exact_indices.len(),
            });
        }
        if exact_indices.len() == 1 {
            let idx = exact_indices[0];
            let mut new_content =
                String::with_capacity(content.len() - old_string.len() + new_string.len());
            new_content.push_str(&content[..idx]);
            new_content.push_str(new_string);
            new_content.push_str(&content[idx + old_string.len()..]);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "exact",
                matches_count: 1,
            });
        }
        return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
    }

    let line_offsets = get_line_offsets(content);
    let content_lines: Vec<&str> = line_offsets
        .iter()
        .map(|span| &content[span.start..span.end])
        .collect();

    let mut old_lines: Vec<&str> = old_string.lines().collect();
    if old_lines.last() == Some(&"") {
        old_lines.pop();
    }
    if old_lines.is_empty() {
        return Err("Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.".to_string());
    }

    let search_len = old_lines.len();
    if search_len > content_lines.len() {
        return Err("Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.".to_string());
    }

    // Helper to extract candidate byte span for lines [i .. i + search_len]
    let span_for_range = |start_line: usize, end_line: usize| -> ByteSpan {
        let mut start = line_offsets[start_line].start;
        if !old_string.starts_with(|c: char| c.is_whitespace())
            && !new_string.starts_with(|c: char| c.is_whitespace())
        {
            let lead_ws =
                content_lines[start_line].len() - content_lines[start_line].trim_start().len();
            start += lead_ws;
        }
        let end = line_offsets[end_line].end;
        ByteSpan { start, end }
    };

    // ── Strategy 2: Line Right-Trimmed Match ──
    let mut right_trimmed_matches = Vec::new();
    for i in 0..=(content_lines.len() - search_len) {
        let mut ok = true;
        for (j, &pat) in old_lines.iter().enumerate() {
            if content_lines[i + j].trim_end() != pat.trim_end() {
                ok = false;
                break;
            }
        }
        if ok {
            right_trimmed_matches.push(span_for_range(i, i + search_len - 1));
        }
    }

    if !right_trimmed_matches.is_empty() {
        if replace_all || right_trimmed_matches.len() == 1 {
            let new_content = apply_spans(content, &right_trimmed_matches, new_string);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "line_trimmed",
                matches_count: right_trimmed_matches.len(),
            });
        }
        return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
    }

    // ── Strategy 3: Both Sides Trimmed Match ──
    let mut both_trimmed_matches = Vec::new();
    for i in 0..=(content_lines.len() - search_len) {
        let mut ok = true;
        for (j, &pat) in old_lines.iter().enumerate() {
            if content_lines[i + j].trim() != pat.trim() {
                ok = false;
                break;
            }
        }
        if ok {
            both_trimmed_matches.push(span_for_range(i, i + search_len - 1));
        }
    }

    if !both_trimmed_matches.is_empty() {
        if replace_all || both_trimmed_matches.len() == 1 {
            let new_content = apply_spans(content, &both_trimmed_matches, new_string);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "both_trimmed",
                matches_count: both_trimmed_matches.len(),
            });
        }
        return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
    }

    // ── Strategy 4: Indentation-Flexible Match ──
    let stripped_old = strip_common_indentation(&old_lines);
    let mut indent_matches = Vec::new();
    for i in 0..=(content_lines.len() - search_len) {
        let window = &content_lines[i..i + search_len];
        let stripped_window = strip_common_indentation(window);
        if stripped_window == stripped_old {
            indent_matches.push(span_for_range(i, i + search_len - 1));
        }
    }

    if !indent_matches.is_empty() {
        if replace_all || indent_matches.len() == 1 {
            let new_content = apply_spans(content, &indent_matches, new_string);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "indentation_flexible",
                matches_count: indent_matches.len(),
            });
        }
        return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
    }

    // ── Strategy 5: Unicode Normalization Match (smart quotes, dashes, nbsp) ──
    let norm_old: Vec<String> = old_lines.iter().map(|l| unicode_normalize(l)).collect();
    let mut unicode_matches = Vec::new();
    for i in 0..=(content_lines.len() - search_len) {
        let mut ok = true;
        for (j, pat) in norm_old.iter().enumerate() {
            if unicode_normalize(content_lines[i + j]) != *pat {
                ok = false;
                break;
            }
        }
        if ok {
            unicode_matches.push(span_for_range(i, i + search_len - 1));
        }
    }

    if !unicode_matches.is_empty() {
        if replace_all || unicode_matches.len() == 1 {
            let new_content = apply_spans(content, &unicode_matches, new_string);
            return Ok(FuzzyReplaceOutput {
                new_content,
                strategy: "unicode_normalized",
                matches_count: unicode_matches.len(),
            });
        }
        return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
    }

    // ── Strategy 6: Context-Anchor Match (first and last lines anchored, middle lines LCS/subset) ──
    if search_len >= 3 {
        let first_anchor = old_lines[0].trim();
        let last_anchor = old_lines[search_len - 1].trim();
        let middle_search = &old_lines[1..search_len - 1];
        let total_middle = middle_search.len();

        let mut candidate_spans = Vec::new();
        for i in 0..content_lines.len() {
            if content_lines[i].trim() != first_anchor {
                continue;
            }
            // Candidate last line must be at or after i + 2, bounded by search size
            let max_lookahead = (search_len * 2 + 10).min(content_lines.len() - i);
            for offset in 2..max_lookahead {
                let j = i + offset;
                if j < content_lines.len() && content_lines[j].trim() == last_anchor {
                    let middle_candidate = &content_lines[i + 1..j];
                    if total_middle == 0 {
                        candidate_spans.push(span_for_range(i, j));
                    } else {
                        let mut matched_lines = 0;
                        for sl in middle_search {
                            let sl_trim = sl.trim();
                            if middle_candidate.iter().any(|cl| cl.trim() == sl_trim) {
                                matched_lines += 1;
                            }
                        }
                        if (matched_lines as f64 / total_middle as f64) >= 0.5 {
                            candidate_spans.push(span_for_range(i, j));
                        }
                    }
                    break;
                }
            }
        }

        if !candidate_spans.is_empty() {
            if replace_all || candidate_spans.len() == 1 {
                let new_content = apply_spans(content, &candidate_spans, new_string);
                return Ok(FuzzyReplaceOutput {
                    new_content,
                    strategy: "context_anchor",
                    matches_count: candidate_spans.len(),
                });
            }
            return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
        }
    }

    // ── Strategy 7: Whitespace-Normalized Token Match ──
    let old_tokens = extract_tokens(old_string);
    if !old_tokens.is_empty() {
        let content_tokens = extract_tokens(content);
        if content_tokens.len() >= old_tokens.len() {
            let old_tok_len = old_tokens.len();
            let first_tok = &old_tokens[0].text;
            let mut token_matches = Vec::new();

            for i in 0..=(content_tokens.len() - old_tok_len) {
                if content_tokens[i].text != *first_tok {
                    continue;
                }
                let mut matched = true;
                for j in 1..old_tok_len {
                    if content_tokens[i + j].text != old_tokens[j].text {
                        matched = false;
                        break;
                    }
                }
                if matched {
                    let raw_start = content_tokens[i].start;
                    let raw_end = content_tokens[i + old_tok_len - 1].end;

                    let mut start = raw_start;
                    let line_start = content[..raw_start]
                        .rfind('\n')
                        .map(|idx| idx + 1)
                        .unwrap_or(0);
                    let only_whitespace_before = content[line_start..raw_start]
                        .chars()
                        .all(|c| c.is_whitespace());
                    if only_whitespace_before
                        && (old_string.starts_with(|c: char| c.is_whitespace())
                            || new_string.starts_with(|c: char| c.is_whitespace()))
                    {
                        start = line_start;
                    }

                    let mut end = raw_end;
                    if old_string.ends_with('\n') || new_string.ends_with('\n') {
                        let line_end = content[raw_end..]
                            .find('\n')
                            .map(|idx| raw_end + idx + 1)
                            .unwrap_or(content.len());
                        if content[raw_end..line_end]
                            .chars()
                            .all(|c| c.is_whitespace() || c == '\r' || c == '\n')
                        {
                            end = line_end;
                        }
                    }

                    token_matches.push(ByteSpan { start, end });
                }
            }

            if !token_matches.is_empty() {
                if replace_all || token_matches.len() == 1 {
                    let new_content = apply_spans(content, &token_matches, new_string);
                    return Ok(FuzzyReplaceOutput {
                        new_content,
                        strategy: "whitespace_normalized",
                        matches_count: token_matches.len(),
                    });
                }
                return Err("Found multiple matches for oldString. Provide more surrounding context to make the match unique.".to_string());
            }
        }
    }

    Err("Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.".to_string())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_replacement() {
        let content = "const x = 1;\nconst y = 2;\n";
        let out = fuzzy_replace(content, "const y = 2;", "const y = 42;", false).unwrap();
        assert_eq!(out.new_content, "const x = 1;\nconst y = 42;\n");
        assert_eq!(out.strategy, "exact");
        assert_eq!(out.matches_count, 1);
    }

    #[test]
    fn test_exact_multiple_rejected_when_not_replace_all() {
        let content = "let a = 1;\nlet a = 1;\n";
        let err = fuzzy_replace(content, "let a = 1;", "let a = 2;", false).unwrap_err();
        assert!(err.contains("Found multiple matches"));
    }

    #[test]
    fn test_exact_multiple_accepted_when_replace_all() {
        let content = "let a = 1;\nlet a = 1;\n";
        let out = fuzzy_replace(content, "let a = 1;", "let a = 2;", true).unwrap();
        assert_eq!(out.new_content, "let a = 2;\nlet a = 2;\n");
        assert_eq!(out.matches_count, 2);
    }

    #[test]
    fn test_line_right_trimmed_replacement() {
        let content = "function test() {   \n    return 42;  \n}\n";
        let search = "function test() {\n    return 42;\n}";
        let out = fuzzy_replace(
            content,
            search,
            "function test() {\n    return 100;\n}",
            false,
        )
        .unwrap();
        assert_eq!(out.new_content, "function test() {\n    return 100;\n}\n");
        assert_eq!(out.strategy, "line_trimmed");
    }

    #[test]
    fn test_both_trimmed_indentation_replacement() {
        let content = "    function hello() {\n        console.log('hi');\n    }\n";
        let search = "function hello() {\n    console.log('hi');\n}";
        let out = fuzzy_replace(
            content,
            search,
            "    function hello() {\n        console.log('world');\n    }",
            false,
        )
        .unwrap();
        assert_eq!(
            out.new_content,
            "    function hello() {\n        console.log('world');\n    }\n"
        );
        assert_eq!(out.strategy, "both_trimmed");
    }

    #[test]
    fn test_unicode_quotes_and_dashes_fuzzy_replacement() {
        let content = "const text = “Hello world” – version 1;\n";
        let search = "const text = \"Hello world\" - version 1;";
        let out = fuzzy_replace(
            content,
            search,
            "const text = \"Hello universe\" - version 2;",
            false,
        )
        .unwrap();
        assert_eq!(
            out.new_content,
            "const text = \"Hello universe\" - version 2;\n"
        );
        assert_eq!(out.strategy, "unicode_normalized");
    }

    #[test]
    fn test_context_anchor_with_minor_middle_drift() {
        let content =
            "function compute() {\n    // Some comment\n    let val = 10;\n    return val;\n}\n";
        let search = "function compute() {\n    let val = 10;\n    return val;\n}";
        // First line and last line anchor match
        let out = fuzzy_replace(
            content,
            search,
            "function compute() {\n    return 20;\n}",
            false,
        );
        assert!(out.is_ok());
    }

    #[test]
    fn test_crlf_preservation() {
        let content = "line 1\r\nline 2\r\nline 3\r\n";
        let out = fuzzy_replace(content, "line 2", "line two", false).unwrap();
        assert_eq!(out.new_content, "line 1\r\nline two\r\nline 3\r\n");
    }

    #[test]
    fn test_indentation_preservation_when_replacing_inside_block() {
        let content = "class Worker {\n    execute() {\n        return true;\n    }\n}\n";
        let search = "execute() {\n  return true;\n}";
        let replacement = "execute() {\n    return false;\n}";
        let out = fuzzy_replace(content, search, replacement, false).unwrap();
        assert_eq!(
            out.new_content,
            "class Worker {\n    execute() {\n    return false;\n}\n}\n"
        );
    }

    #[test]
    fn test_whitespace_normalized_multiline_to_singleline() {
        let content = "const x = 1;\n  function target() { return 'needle'; }  \nconst y = 2;\n";
        let search = "function target() {\n  return 'needle';\n}";
        let replacement = "function target() {\n  return 'replaced';\n}";
        let out = fuzzy_replace(content, search, replacement, false).unwrap();
        assert!(out
            .new_content
            .contains("function target() {\n  return 'replaced';\n}"));
        assert_eq!(out.strategy, "whitespace_normalized");
    }
}
