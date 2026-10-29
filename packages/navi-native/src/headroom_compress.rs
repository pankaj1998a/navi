//! High-performance Context Compression & CCR (Compress-Cache-Retrieve) engine for Navi.
//! Inspired by Headroom AI.
//! Compresses logs, unified diffs, JSON payloads, and source code skeletons
//! while preserving critical errors, stack traces, and semantic structures.
//! Provides lossless end-to-end retrieval via in-memory content-addressed CCR store.

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex, PoisonError};
use serde::{Deserialize, Serialize};

/// Global in-memory CCR store: insertion-ordered hash -> original_payload.
/// A hard entry cap prevents unbounded growth of a long-lived process.
static CCR_STORE: LazyLock<Mutex<CcrStore>> = LazyLock::new(|| {
    Mutex::new(CcrStore::default())
});

/// Maximum retained CCR payloads; the oldest insertion is evicted beyond this.
const CCR_MAX_ENTRIES: usize = 512;

/// Stand-in for a CCR key inside compressed output before the stash gate
/// resolves it; identical 24-char length to a real `compute_ccr_key` result
/// so compressed-length accounting stays exact.
const CCR_KEY_PLACEHOLDER: &str = "000000000000000000000000";

/// A bounded, insertion-order-eviction payload store (std only).
#[derive(Default)]
struct CcrStore {
    payloads: HashMap<String, String>,
    order: VecDeque<String>,
}

impl CcrStore {
    fn insert(&mut self, key: String, payload: String) {
        if self.payloads.insert(key.clone(), payload).is_none() {
            self.order.push_back(key);
            while self.payloads.len() > CCR_MAX_ENTRIES {
                let Some(oldest) = self.order.pop_front() else { break };
                self.payloads.remove(&oldest);
            }
        }
    }

    fn get(&self, key: &str) -> Option<&String> {
        self.payloads.get(key)
    }

    fn len(&self) -> usize {
        self.payloads.len()
    }
}

/// Gate from the documentation: only stash the original payload into the CCR
/// store when compression saved more than 25% of the input
/// (i.e. `compressed_len < 75% of original_len`).
fn worth_stashing(original_len: usize, compressed_len: usize) -> bool {
    compressed_len * 4 < original_len * 3
}

/// Global telemetry stats
static HEADROOM_STATS: LazyLock<Mutex<HeadroomStats>> = LazyLock::new(|| {
    Mutex::new(HeadroomStats::default())
});

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HeadroomStats {
    pub total_compressions: usize,
    pub original_chars: usize,
    pub compressed_chars: usize,
    pub estimated_tokens_saved: usize,
    pub ccr_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    pub compressed: String,
    pub ccr_key: Option<String>,
    pub original_len: usize,
    pub compressed_len: usize,
    pub tokens_saved_est: usize,
    pub compression_ratio: f64,
}

/// Compute 24-character deterministic CCR key using custom fast hash (FNV-1a + length mix)
pub fn compute_ccr_key(content: &str) -> String {
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0x100000001b3;

    for (i, b) in content.bytes().enumerate() {
        h1 ^= b as u64;
        h1 = h1.wrapping_mul(0x100000001b3);

        h2 = h2.wrapping_add((b as u64).wrapping_shl((i % 7) as u32));
        h2 ^= (b as u64).wrapping_mul(0x517cc1b727220a95);
    }

    format!("{:012x}{:012x}", h1 & 0xffffffffffff, h2 & 0xffffffffffff)
}

/// Stash payload in CCR store and return its key
pub fn stash_ccr_payload(payload: &str) -> String {
    let key = compute_ccr_key(payload);
    let mut store = CCR_STORE.lock().unwrap_or_else(PoisonError::into_inner);
    store.insert(key.clone(), payload.to_string());

    let mut stats = HEADROOM_STATS.lock().unwrap_or_else(PoisonError::into_inner);
    stats.ccr_entries = store.len();

    key
}

/// Retrieve original uncompressed payload by CCR key
pub fn retrieve_ccr_payload(key: &str) -> Option<String> {
    let store = CCR_STORE.lock().unwrap_or_else(PoisonError::into_inner);
    store.get(key).cloned()
}
/// Log Compressor: Compresses build and test outputs (pytest, cargo, npm, jest, compiler logs)
/// Typical compression: 5x to 30x. Preserves FATAL, ERROR, stack traces, and summary lines.
pub fn compress_log(input: &str, max_lines: usize) -> CompressionResult {
    let original_len = input.len();
    if input.trim().is_empty() {
        return CompressionResult {
            compressed: String::new(),
            ccr_key: None,
            original_len: 0,
            compressed_len: 0,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    let lines: Vec<&str> = input.lines().collect();
    if lines.len() <= 30 {
        return CompressionResult {
            compressed: input.to_string(),
            ccr_key: None,
            original_len,
            compressed_len: original_len,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    // Pass 1: Line classification
    let mut critical_indices = Vec::new();
    let mut in_stack_trace = false;

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let upper = trimmed.to_uppercase();

        // Stack trace detection (Python, JS, Rust, Go)
        if upper.contains("TRACEBACK (MOST RECENT CALL LAST)")
            || upper.contains("PANICKED AT")
            || upper.contains("STACKTRACE:")
            || upper.contains("CALL STACK:")
        {
            in_stack_trace = true;
            critical_indices.push(idx);
            continue;
        }

        if in_stack_trace {
            if trimmed.starts_with("at ")
                || trimmed.starts_with("File ")
                || trimmed.starts_with("src/")
                || trimmed.starts_with("packages/")
                || trimmed.starts_with("goroutine ")
            {
                critical_indices.push(idx);
                continue;
            } else if trimmed.is_empty() {
                in_stack_trace = false;
            }
        }

        // Critical signal keywords
        if upper.contains("FATAL")
            || upper.contains("ERROR")
            || upper.contains("FAILURE")
            || upper.contains("FAILED")
            || upper.contains("PANIC")
            || upper.contains("EXCEPTION")
            || upper.contains("REJECTED")
            || upper.contains("ABORT")
            || upper.contains("SEGMENTATION FAULT")
            || upper.contains("CWE-")
        {
            critical_indices.push(idx);
            continue;
        }

        // Summary test report lines
        if upper.contains("TEST RESULT:")
            || upper.contains("TESTS:")
            || upper.contains("PASSED;")
            || upper.contains("FAIL;")
            || upper.contains("PASS ")
            || upper.contains("FAIL ")
        {
            critical_indices.push(idx);
        }
    }

    // Always keep initial 5 lines and final 5 lines for context
    let mut selected_set = std::collections::BTreeSet::new();
    for i in 0..lines.len().min(5) {
        selected_set.insert(i);
    }
    for i in lines.len().saturating_sub(5)..lines.len() {
        selected_set.insert(i);
    }

    // Add critical lines and surrounding 1 line of context
    for &idx in &critical_indices {
        if idx > 0 {
            selected_set.insert(idx - 1);
        }
        selected_set.insert(idx);
        if idx + 1 < lines.len() {
            selected_set.insert(idx + 1);
        }
    }

    // Stash original in CCR only when compression saves > 25% (see gate in
    // `worth_stashing`); assemble with the fixed-length placeholder key first.
    let mut out = String::new();
    let mut last_idx: Option<usize> = None;
    let mut emitted_count = 0;

    for &idx in &selected_set {
        if emitted_count >= max_lines {
            out.push_str(&format!(
                "\n... [Remaining {} lines truncated. Full original: <<ccr:{}>>]\n",
                lines.len() - idx,
                CCR_KEY_PLACEHOLDER
            ));
            break;
        }

        if let Some(last) = last_idx {
            if idx > last + 1 {
                let skipped = idx - last - 1;
                out.push_str(&format!(
                    "... [{} non-critical log lines pruned | <<ccr:{}>>]\n",
                    skipped, CCR_KEY_PLACEHOLDER
                ));
            }
        }

        out.push_str(lines[idx]);
        out.push('\n');
        last_idx = Some(idx);
        emitted_count += 1;
    }

    let compressed_len = out.len();
    let ratio = compressed_len as f64 / original_len as f64;
    let tokens_saved_est = (original_len.saturating_sub(compressed_len)) / 4;

    let (out, key) = if worth_stashing(original_len, compressed_len) {
        let key = stash_ccr_payload(input);
        (out.replace(CCR_KEY_PLACEHOLDER, &key), Some(key))
    } else {
        // Gate rejected: no stash happened, so resolve markers to "not cached"
        // instead of advertising an unresolvable retrieval key.
        (out.replace(CCR_KEY_PLACEHOLDER, "not cached"), None)
    };

    record_stats(original_len, compressed_len, tokens_saved_est);

    CompressionResult {
        compressed: out,
        ccr_key: key,
        original_len,
        compressed_len,
        tokens_saved_est,
        compression_ratio: ratio,
    }
}

/// Unified Diff Compressor: Trims massive Git diffs by reducing context lines
/// around modifications and capping redundant file changes while keeping all + and - hunks.
pub fn compress_diff(input: &str, max_context_lines: usize) -> CompressionResult {
    let original_len = input.len();
    if !input.contains("diff --git") && !input.contains("@@ -") {
        return CompressionResult {
            compressed: input.to_string(),
            ccr_key: None,
            original_len,
            compressed_len: original_len,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    let lines: Vec<&str> = input.lines().collect();
    if lines.len() <= 40 {
        return CompressionResult {
            compressed: input.to_string(),
            ccr_key: None,
            original_len,
            compressed_len: original_len,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    let mut out = String::new();
    let mut hunk_lines: Vec<&str> = Vec::new();

    let flush_hunk = |lines_buf: &[&str], dest: &mut String| {
        if lines_buf.is_empty() {
            return;
        }

        // Find modified line indices (+ or -)
        let mut mod_indices = Vec::new();
        for (i, line) in lines_buf.iter().enumerate() {
            if line.starts_with('+') || line.starts_with('-') {
                mod_indices.push(i);
            }
        }

        if mod_indices.is_empty() {
            // Keep first and last context line only
            if !lines_buf.is_empty() {
                dest.push_str(lines_buf[0]);
                dest.push('\n');
                if lines_buf.len() > 1 {
                    dest.push_str(" ...\n");
                    dest.push_str(lines_buf[lines_buf.len() - 1]);
                    dest.push('\n');
                }
            }
            return;
        }

        let mut keep = std::collections::BTreeSet::new();
        for &m in &mod_indices {
            let start = m.saturating_sub(max_context_lines);
            let end = (m + max_context_lines + 1).min(lines_buf.len());
            for k in start..end {
                keep.insert(k);
            }
        }

        let mut prev = None;
        for &k in &keep {
            if let Some(p) = prev {
                if k > p + 1 {
                    dest.push_str(" ... [context trimmed]\n");
                }
            }
            dest.push_str(lines_buf[k]);
            dest.push('\n');
            prev = Some(k);
        }
    };

    let mut in_hunk = false;
    for line in lines {
        if line.starts_with("diff --git")
            || line.starts_with("index ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
        {
            if in_hunk {
                flush_hunk(&hunk_lines, &mut out);
                hunk_lines.clear();
                in_hunk = false;
            }
            out.push_str(line);
            out.push('\n');
        } else if line.starts_with("@@ ") {
            if in_hunk {
                flush_hunk(&hunk_lines, &mut out);
                hunk_lines.clear();
            }
            out.push_str(line);
            out.push('\n');
            in_hunk = true;
        } else if in_hunk {
            hunk_lines.push(line);
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }

    if in_hunk {
        flush_hunk(&hunk_lines, &mut out);
    }

    let compressed_len = out.len();
    let ratio = compressed_len as f64 / original_len as f64;
    let tokens_saved_est = (original_len.saturating_sub(compressed_len)) / 4;

    // Stash original in CCR only when compression saves > 25%.
    let key = if worth_stashing(original_len, compressed_len) {
        Some(stash_ccr_payload(input))
    } else {
        None
    };

    record_stats(original_len, compressed_len, tokens_saved_est);

    CompressionResult {
        compressed: out,
        ccr_key: key,
        original_len,
        compressed_len,
        tokens_saved_est,
        compression_ratio: ratio,
    }
}

/// JSON & Data Crusher: Strips nulls, empty structures, repetitive whitespace,
/// while preserving essential structure and keys
pub fn compress_json(input: &str) -> CompressionResult {
    let original_len = input.len();
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(input);
    if parsed.is_err() || original_len <= 50 {
        return CompressionResult {
            compressed: input.to_string(),
            ccr_key: None,
            original_len,
            compressed_len: original_len,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    let mut val = parsed.expect("JSON was validated before stripping");
    strip_nulls_and_empty(&mut val, 0);

    let crushed = serde_json::to_string(&val).unwrap_or_else(|_| input.to_string());

    let compressed_len = crushed.len();
    let ratio = compressed_len as f64 / original_len as f64;
    let tokens_saved_est = (original_len.saturating_sub(compressed_len)) / 4;

    // Stash original in CCR only when compression saves > 25%.
    let key = if worth_stashing(original_len, compressed_len) {
        Some(stash_ccr_payload(input))
    } else {
        None
    };

    record_stats(original_len, compressed_len, tokens_saved_est);

    CompressionResult {
        compressed: crushed,
        ccr_key: key,
        original_len,
        compressed_len,
        tokens_saved_est,
        compression_ratio: ratio,
    }
}

/// Recursion depth is capped at 200: `Value` nesting beyond that would
/// otherwise consume unbounded stack and crash the process.
const MAX_STRIP_RECURSION_DEPTH: usize = 200;

fn strip_nulls_and_empty(v: &mut serde_json::Value, depth: usize) {
    if depth >= MAX_STRIP_RECURSION_DEPTH {
        return;
    }
    match v {
        serde_json::Value::Object(map) => {
            map.retain(|_, val| match val {
                serde_json::Value::Null => false,
                serde_json::Value::Array(arr) if arr.is_empty() => false,
                serde_json::Value::Object(obj) if obj.is_empty() => false,
                serde_json::Value::String(s) if s.is_empty() => false,
                _ => true,
            });
            for (_, val) in map.iter_mut() {
                strip_nulls_and_empty(val, depth + 1);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                strip_nulls_and_empty(item, depth + 1);
            }
        }
        _ => {}
    }
}

/// Code Skeleton Compressor: Extracts top-level declarations, classes, interfaces, and function signatures,
/// collapsing large routine bodies into concise CCR-retrievable markers.
pub fn compress_code_skeleton(code: &str, min_body_lines: usize) -> CompressionResult {
    let original_len = code.len();
    let lines: Vec<&str> = code.lines().collect();

    if lines.len() <= 15 {
        return CompressionResult {
            compressed: code.to_string(),
            ccr_key: None,
            original_len,
            compressed_len: original_len,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
        };
    }

    // Assemble with the fixed-length placeholder key; the gate below decides
    // whether the original gets stashed and the placeholder swapped out.
    let mut out = String::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Detect function start with braces
        let is_func_start = (trimmed.starts_with("export function ")
            || trimmed.starts_with("function ")
            || trimmed.starts_with("pub fn ")
            || trimmed.starts_with("fn ")
            || trimmed.starts_with("def ")
            || (trimmed.starts_with("const ") && trimmed.contains(" = ("))
            || (trimmed.starts_with("export const ") && trimmed.contains(" = (")))
            && trimmed.ends_with('{');

        if is_func_start {
            // Find end of function block by brace counting
            let mut depth = 0;
            let start_line = i;
            let mut end_line = i;

            for j in i..lines.len() {
                for c in lines[j].chars() {
                    if c == '{' {
                        depth += 1;
                    } else if c == '}' {
                        depth -= 1;
                    }
                }
                if depth == 0 {
                    end_line = j;
                    break;
                }
            }

            let span = end_line - start_line;
            if span >= min_body_lines && depth == 0 {
                out.push_str(line);
                out.push('\n');
                out.push_str(&format!(
                    "    // ... [{} lines routine body compressed | <<ccr:{}>>]\n",
                    span, CCR_KEY_PLACEHOLDER
                ));
                out.push_str(lines[end_line]);
                out.push('\n');
                i = end_line + 1;
                continue;
            }
        }

        out.push_str(line);
        out.push('\n');
        i += 1;
    }

    let compressed_len = out.len();
    let ratio = compressed_len as f64 / original_len as f64;
    let tokens_saved_est = (original_len.saturating_sub(compressed_len)) / 4;

    // Stash original in CCR only when compression saves > 25%; otherwise the
    // placeholder resolves to "not cached" so no unresolvable key is emitted.
    let (out, key) = if worth_stashing(original_len, compressed_len) {
        let key = stash_ccr_payload(code);
        (out.replace(CCR_KEY_PLACEHOLDER, &key), Some(key))
    } else {
        (out.replace(CCR_KEY_PLACEHOLDER, "not cached"), None)
    };

    record_stats(original_len, compressed_len, tokens_saved_est);

    CompressionResult {
        compressed: out,
        ccr_key: key,
        original_len,
        compressed_len,
        tokens_saved_est,
        compression_ratio: ratio,
    }
}

fn record_stats(orig: usize, comp: usize, saved: usize) {
    let mut stats = HEADROOM_STATS.lock().unwrap_or_else(PoisonError::into_inner);
    stats.total_compressions += 1;
    stats.original_chars += orig;
    stats.compressed_chars += comp;
    stats.estimated_tokens_saved += saved;
}

pub fn get_telemetry_stats() -> HeadroomStats {
    let stats = HEADROOM_STATS.lock().unwrap_or_else(PoisonError::into_inner);
    stats.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_compressor() {
        let mut log = String::new();
        log.push_str("Starting build pipeline...\n");
        for i in 0..100 {
            log.push_str(&format!("INFO: compiling module_{} ok\n", i));
        }
        log.push_str("ERROR: test_auth failed at line 42 with CWE-89 injection alert!\n");
        log.push_str("Traceback (most recent call last):\n");
        log.push_str("  File 'src/auth.py', line 42, in test_auth\n");
        log.push_str("    raise AssertionError('bad token')\n");
        log.push_str("AssertionError: bad token\n");
        for i in 0..50 {
            log.push_str(&format!("DEBUG: cleanup step {}\n", i));
        }
        log.push_str("FAIL: 1 failed, 99 passed\n");

        let res = compress_log(&log, 40);
        assert!(res.compressed_len < res.original_len);
        assert!(res.compressed.contains("ERROR: test_auth failed"));
        assert!(res.compressed.contains("Traceback"));
        assert!(res.compressed.contains("AssertionError"));
        assert!(res.compressed.contains("<<ccr:"));
        assert!(res.ccr_key.is_some());

        // Lossless retrieval verification
        let retrieved = retrieve_ccr_payload(&res.ccr_key.unwrap());
        assert_eq!(retrieved, Some(log));
    }

    #[test]
    fn test_diff_compressor() {
        let mut diff = String::new();
        diff.push_str("diff --git a/src/auth.ts b/src/auth.ts\n");
        diff.push_str("--- a/src/auth.ts\n");
        diff.push_str("+++ b/src/auth.ts\n");
        diff.push_str("@@ -10,30 +10,32 @@\n");
        for _ in 0..20 {
            diff.push_str(" unchanged context line\n");
        }
        diff.push_str("-const oldSecret = '12345'\n");
        diff.push_str("+const newSecret = env.JWT_SECRET\n");
        for _ in 0..20 {
            diff.push_str(" trailing context line\n");
        }

        let res = compress_diff(&diff, 2);
        assert!(res.compressed_len < res.original_len);
        assert!(res.compressed.contains("+const newSecret = env.JWT_SECRET"));
        assert!(res.compressed.contains("-const oldSecret = '12345'"));
    }

    #[test]
    fn test_json_compressor() {
        let json = r#"{
            "status": "ok",
            "redundant_null": null,
            "empty_list": [],
            "empty_dict": {},
            "empty_str": "",
            "active_user": {
                "id": 123,
                "null_token": null,
                "role": "admin"
            }
        }"#;

        let res = compress_json(json);
        assert!(!res.compressed.contains("redundant_null"));
        assert!(!res.compressed.contains("null_token"));
        assert!(res.compressed.contains("\"id\":123"));
        assert!(res.compressed.contains("\"role\":\"admin\""));
    }

    #[test]
    fn test_code_skeleton_compressor() {
        let code = r#"
import { db } from "./db"

export function processTransactions(txs: any[]) {
    // line 1
    // line 2
    // line 3
    // line 4
    // line 5
    // line 6
    // line 7
    // line 8
    // line 9
    // line 10
    // line 11
    // line 12
    return true
}

export function smallFunc() {
    return 1
}
"#;

        let res = compress_code_skeleton(code, 5);
        assert!(res.compressed.contains("processTransactions"));
        assert!(res.compressed.contains("routine body compressed"));
        assert!(res.compressed.contains("smallFunc"));
    }
}
