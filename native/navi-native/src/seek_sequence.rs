/// Attempt to find the sequence of `pattern` lines within `lines` beginning at or after `start`.
/// Ported from OpenAI Codex (codex-rs/apply-patch/src/seek_sequence.rs).
/// Matches are attempted with decreasing strictness:
/// 1. Exact match
/// 2. Right-stripped match (ignoring trailing whitespace)
/// 3. Both sides trimmed (ignoring leading & trailing whitespace)
/// 4. Unicode-normalised fuzzy match (smart quotes, dashes, non-breaking spaces)
pub fn seek_sequence(
    lines: &[String],
    pattern: &[String],
    start: usize,
    eof: bool,
) -> Option<usize> {
    if pattern.is_empty() {
        return Some(start);
    }
    if pattern.len() > lines.len() {
        return None;
    }

    let search_start = if eof && lines.len() >= pattern.len() {
        lines.len() - pattern.len()
    } else {
        start
    };

    // 1. Exact match first
    for i in search_start..=lines.len().saturating_sub(pattern.len()) {
        if lines[i..i + pattern.len()] == *pattern {
            return Some(i);
        }
    }

    // 2. Right-stripped match
    for i in search_start..=lines.len().saturating_sub(pattern.len()) {
        let mut ok = true;
        for (p_idx, pat) in pattern.iter().enumerate() {
            if lines[i + p_idx].trim_end() != pat.trim_end() {
                ok = false;
                break;
            }
        }
        if ok {
            return Some(i);
        }
    }

    // 3. Trim both sides
    for i in search_start..=lines.len().saturating_sub(pattern.len()) {
        let mut ok = true;
        for (p_idx, pat) in pattern.iter().enumerate() {
            if lines[i + p_idx].trim() != pat.trim() {
                ok = false;
                break;
            }
        }
        if ok {
            return Some(i);
        }
    }

    // 4. Unicode normalisation pass (dashes, quotes, non-breaking spaces)
    fn normalise(s: &str) -> String {
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
            .collect::<String>()
    }

    for i in search_start..=lines.len().saturating_sub(pattern.len()) {
        let mut ok = true;
        for (p_idx, pat) in pattern.iter().enumerate() {
            if normalise(&lines[i + p_idx]) != normalise(pat) {
                ok = false;
                break;
            }
        }
        if ok {
            return Some(i);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_vec(strings: &[&str]) -> Vec<String> {
        strings.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_exact_match() {
        let lines = to_vec(&["foo", "bar", "baz"]);
        let pat = to_vec(&["bar", "baz"]);
        assert_eq!(seek_sequence(&lines, &pat, 0, false), Some(1));
    }

    #[test]
    fn test_fuzzy_whitespace_match() {
        let lines = to_vec(&["   function test()   ", "   return 42   "]);
        let pat = to_vec(&["function test()", "return 42"]);
        assert_eq!(seek_sequence(&lines, &pat, 0, false), Some(0));
    }
}
