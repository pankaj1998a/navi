//! High-performance native Rust core for Navi.
//! Provides zero-backtracking DFA privacy sanitization, zero-copy Shannon entropy,
//! repetitive boilerplate filtering, and vectorized cosine similarity.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use regex::Regex;

pub mod url_safety;
pub mod fast_diff;
pub mod security_audit;
pub mod agency_agents;
pub mod code_graph;
pub mod headroom_compress;
pub mod snapshot;
pub mod walker;
pub mod process_guard;

// Universal durable-body ceiling (16 KiB)
pub const OBSERVATION_BODY_MAX_BYTES: usize = 16 * 1024;

static ESCAPE_SEQUENCES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]").expect("valid ANSI escape sequence regex")
});

struct PatternEntry {
    regex: Regex,
    label: &'static str,
}

static BUILTIN_PATTERNS: LazyLock<Vec<PatternEntry>> = LazyLock::new(|| {
    vec![
        // Bearer-style tokens
        PatternEntry { regex: Regex::new(r"(?i)bearer\s+[A-Za-z0-9._\-+/=]{16,}").expect("valid bearer pattern regex"), label: "bearer_token" },
        // Vendor-prefixed API keys (OpenAI / Anthropic / OpenRouter)
        PatternEntry { regex: Regex::new(r"sk-[A-Za-z0-9_\-]{16,}").expect("valid api key pattern regex"), label: "api_key" },
        // Stripe live secret and restricted keys
        PatternEntry { regex: Regex::new(r"(?:sk|rk)_live_[A-Za-z0-9_\-]{16,}").expect("valid stripe key pattern regex"), label: "stripe_key" },
        // GitHub tokens (all prefixes)
        PatternEntry { regex: Regex::new(r"gh[pousr]_[A-Za-z0-9]{20,}").expect("valid github token pattern regex"), label: "github_token" },
        PatternEntry { regex: Regex::new(r"github_pat_[A-Za-z0-9_]{20,}").expect("valid github fine-grained token pattern regex"), label: "github_token" },
        // AWS access key IDs (AKIA & ASIA exactly 20 chars with word boundaries)
        PatternEntry { regex: Regex::new(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b").expect("valid AWS key pattern regex"), label: "aws_key" },
        // Google / Gemini API keys
        PatternEntry { regex: Regex::new(r"AIza[A-Za-z0-9_\-]{30,}").expect("valid Google API key pattern regex"), label: "google_api_key" },
        PatternEntry { regex: Regex::new(r"AQ\.Ab[A-Za-z0-9_\-]{30,}").expect("valid Google API key prefix pattern regex"), label: "google_api_key" },
        // Google OAuth refresh tokens
        PatternEntry { regex: Regex::new(r"1//[0-9A-Za-z_\-]{20,}").expect("valid Google OAuth pattern regex"), label: "google_oauth" },
        // Meta / Facebook Graph tokens
        PatternEntry { regex: Regex::new(r"EAA[A-Za-z0-9]{20,}").expect("valid Meta token pattern regex"), label: "meta_token" },
        // Telegram bot tokens
        PatternEntry { regex: Regex::new(r"\b\d{6,10}:(?:AA[A-Za-z0-9_\-]{30,}|[A-Za-z0-9_\-]{34,35})\b").expect("valid Telegram token pattern regex"), label: "telegram_token" },
        // GoHighLevel Private Integration Tokens
        PatternEntry { regex: Regex::new(r"pit-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}").expect("valid GHL token pattern regex"), label: "ghl_token" },
        // Slack tokens
        PatternEntry { regex: Regex::new(r"xox[abprs]-[A-Za-z0-9\-]{10,}").expect("valid Slack token pattern regex"), label: "slack_token" },
        PatternEntry { regex: Regex::new(r"xapp-[A-Za-z0-9\-]{10,}").expect("valid Slack app token pattern regex"), label: "slack_token" },
        // JWT tokens (three base64url segments)
        PatternEntry { regex: Regex::new(r"eyJ[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}").expect("valid JWT pattern regex"), label: "jwt" },
        // Base64 JSON tokens
        PatternEntry { regex: Regex::new(r"eyJ[A-Za-z0-9_\-+/]{40,}={0,2}").expect("valid base64 JSON token pattern regex"), label: "base64_json_token" },
        // PEM private keys
        PatternEntry { regex: Regex::new(r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----").expect("valid PEM private key pattern regex"), label: "private_key" },
        // URL-embedded credentials
        PatternEntry { regex: Regex::new(r"[a-zA-Z][a-zA-Z0-9+\-.]*://[^:/\s]+:[^@\s]+@[^\s]+").expect("valid URL credentials pattern regex"), label: "url_credentials" },
        // Known provider env vars (exclude '[' from value floor so already-redacted markers aren't re-redacted)
        PatternEntry {
            regex: Regex::new(r#"(?i)(ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|VOYAGE_API_KEY|MISTRAL_API_KEY|GROQ_API_KEY|HF_TOKEN|HUGGINGFACE_TOKEN|AWS_(SECRET_)?ACCESS_KEY[A-Z_]*|GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|GOOGLE_API_KEY|GEMINI_API_KEY|OLLAMA_API_KEY)"?\s*[=:]\s*[^\[\s]\S*"#).expect("valid provider env secret pattern regex"),
            label: "env_secret",
        },
        // Generic env-var secrets: *_KEY, *_TOKEN, etc.
        PatternEntry {
            regex: Regex::new(r#"(?i)\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|PRIVATE_KEY)"?\s*[=:]\s*[^\[\s]\S*"#).expect("valid generic env secret pattern regex"),
            label: "env_secret",
        },
        // Suffixes: *_KEY_ID, *_PASSPHRASE, *_SIGNING_KEY, *_PEPPER, *_SALT
        PatternEntry {
            regex: Regex::new(r#"\b[A-Z][A-Z0-9_]*_(KEY_ID|PASSPHRASE|SIGNING_KEY|PEPPER|SALT)"?\s*[=:]\s*[^\[\s]\S*"#).expect("valid env secret suffix pattern regex"),
            label: "env_secret",
        },
        // Credential file paths
        PatternEntry { regex: Regex::new(r"(?i)(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.ssh(?:[\\/][^\s]+)?").expect("valid .ssh credential path pattern regex"), label: "credential_path" },
        PatternEntry { regex: Regex::new(r"(?i)(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.aws(?:[\\/][^\s]+)?").expect("valid .aws credential path pattern regex"), label: "credential_path" },
        PatternEntry { regex: Regex::new(r"(?i)(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.kube(?:[\\/][^\s]+)?").expect("valid .kube credential path pattern regex"), label: "credential_path" },
        PatternEntry { regex: Regex::new(r"(?i)(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.config[\\/]gcloud(?:[\\/][^\s]+)?").expect("valid gcloud credential path pattern regex"), label: "credential_path" },
        PatternEntry { regex: Regex::new(r"(?i)(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/]\.gnupg(?:[\\/][^\s]+)?").expect("valid .gnupg credential path pattern regex"), label: "credential_path" },
    ]
});

/// Returns true if character is a non-printable control character to strip
fn is_stripped_control(c: char) -> bool {
    matches!(
        c,
        '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}'
        | '\u{7f}'..='\u{9f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
    )
}

/// Strips ANSI/VT escapes and control characters
pub fn strip_control(input: &str) -> String {
    let stripped = ESCAPE_SEQUENCES.replace_all(input, "");
    if stripped.contains(is_stripped_control) {
        stripped.chars().filter(|c| !is_stripped_control(*c)).collect()
    } else {
        stripped.into_owned()
    }
}

/// High-throughput privacy scrubber using linear-time DFAs
pub fn scrub_secrets(input: &str) -> String {
    let mut out = strip_control(input);
    for entry in BUILTIN_PATTERNS.iter() {
        let replacement = format!("[REDACTED:{}]", entry.label);
        out = entry.regex.replace_all(&out, replacement.as_str()).into_owned();
    }
    out
}

/// Truncate text to at most max bytes keeping head and tail
pub fn truncate_head_tail(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }
    if max_bytes < 64 {
        let mut end = 0;
        for (i, c) in input.char_indices() {
            if i + c.len_utf8() > max_bytes {
                break;
            }
            end = i + c.len_utf8();
        }
        let mut s = input[..end].to_string();
        s.push('…');
        return s;
    }

    const MARKER_RESERVE: usize = 48;
    let usable = max_bytes.saturating_sub(MARKER_RESERVE);
    let half = usable / 2;

    let mut head_end = 0;
    for (i, c) in input.char_indices() {
        if i + c.len_utf8() > half {
            break;
        }
        head_end = i + c.len_utf8();
    }

    let total = input.len();
    let tail_start_target = total.saturating_sub(half);
    let mut tail_start = total;
    for (i, _) in input.char_indices().rev() {
        if i <= tail_start_target {
            tail_start = i;
            break;
        }
        tail_start = i;
    }

    let omitted = tail_start.saturating_sub(head_end);
    format!(
        "{}\n...[truncated {} bytes]...\n{}",
        &input[..head_end],
        omitted,
        &input[tail_start..]
    )
}

/// Shannon entropy in bits per character
pub fn shannon_entropy(text: &str) -> f64 {
    let mut counts: HashMap<char, u64> = HashMap::new();
    let mut total: u64 = 0;
    for c in text.chars() {
        *counts.entry(c).or_insert(0) += 1;
        total += 1;
    }
    if total == 0 {
        return 0.0;
    }
    let total_f = total as f64;
    let mut bits = 0.0;
    for &count in counts.values() {
        let p = count as f64 / total_f;
        bits -= p * p.log2();
    }
    bits
}

/// 0 = Keep, 1 = NearEmpty, 2 = LowEntropy, 3 = Repetitive
pub fn classify_entropy(
    text: &str,
    min_chars: usize,
    min_entropy: f64,
    max_repetition: f64,
    min_tokens: usize,
) -> i32 {
    let non_ws: usize = text.chars().filter(|c| !c.is_whitespace()).count();
    if non_ws < min_chars {
        return 1; // NearEmpty
    }

    if shannon_entropy(text) < min_entropy {
        return 2; // LowEntropy
    }

    let tokens: Vec<&str> = text.split_whitespace().collect();
    if tokens.len() >= min_tokens {
        let distinct: HashSet<String> = tokens.iter().map(|t| t.to_ascii_lowercase()).collect();
        let total = tokens.len() as f64;
        let repetition = 1.0 - (distinct.len() as f64) / total;
        if repetition > max_repetition {
            return 3; // Repetitive
        }
    }

    0 // Keep
}

/// Vector cosine similarity dot product
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

// ============================================================================
// C-ABI Export Interface for Bun FFI / Node.js dlopen
// ============================================================================

/// Redacts known secret patterns from UTF-8 text.
///
/// Returns a caller-owned heap buffer, or null on null/empty input or invalid
/// UTF-8. Release the returned pointer with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `input_ptr` must be valid for reads of `input_len` bytes for the duration
/// of the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is rejected: `out_len` is set to 0 and null is
/// returned.
#[no_mangle]
pub unsafe extern "C" fn navi_sanitize(
    input_ptr: *const u8,
    input_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    if input_ptr.is_null() || input_len == 0 {
        if !out_len.is_null() {
            *out_len = 0;
        }
        return std::ptr::null_mut();
    }

    // SAFETY: caller contract (see `# Safety`) guarantees `input_ptr` is
    // valid for reads of `input_len` bytes, and non-null/empty input was
    // rejected above.
    let slice = std::slice::from_raw_parts(input_ptr, input_len);
    let text = match std::str::from_utf8(slice) {
        Ok(t) => t,
        Err(_) => return std::ptr::null_mut(),
    };

    let scrubbed = scrub_secrets(text);
    export_allocated_string(scrubbed, out_len)
    }
}

/// Frees a buffer previously returned by this crate's string-returning exports.
///
/// # Safety
/// `ptr` must have come from `export_allocated_string` (i.e. a `Box<[u8]>` with
/// `len == capacity`), must not have been freed before, and `len` must equal
/// the `out_len` value returned when it was produced. The allocation was made
/// by the same global allocator this crate links against; freeing allocations
/// from a different allocator binary is undefined. Null or zero-length input
/// is rejected and is a no-op.
#[no_mangle]
pub unsafe extern "C" fn navi_free_string(ptr: *mut u8, len: usize) {
    unsafe {
    if !ptr.is_null() && len > 0 {
        // SAFETY: `ptr` is a non-null pointer produced by `export_allocated_string`
        // as `Box::into_raw` of a boxed slice whose length equals its capacity;
        // `len` was reported to the caller via `out_len` for exactly this
        // reconstruction. It has not been freed before and uses the same
        // global allocator.
        drop(Vec::from_raw_parts(ptr, len, len));
    }
    }
}

/// Computes Shannon entropy in bits per character.
///
/// # Safety
/// `input_ptr` must be valid for reads of `input_len` bytes for the duration
/// of the call. Null or zero-length input returns 0.0.
#[no_mangle]
pub unsafe extern "C" fn navi_entropy(input_ptr: *const u8, input_len: usize) -> f64 {
    unsafe {
    if input_ptr.is_null() || input_len == 0 {
        return 0.0;
    }
    // SAFETY: caller contract (see `# Safety`) guarantees `input_ptr` is
    // valid for reads of `input_len` bytes; null/empty input was rejected above.
    let slice = std::slice::from_raw_parts(input_ptr, input_len);
    match std::str::from_utf8(slice) {
        Ok(t) => shannon_entropy(t),
        Err(_) => 0.0,
    }
    }
}

/// Classifies text entropy/verbosity (0 Keep, 1 NearEmpty, 2 LowEntropy, 3 Repetitive).
///
/// # Safety
/// `input_ptr` must be valid for reads of `input_len` bytes for the duration
/// of the call. Null or zero-length input returns 1 (NearEmpty).
#[no_mangle]
pub unsafe extern "C" fn navi_classify(
    input_ptr: *const u8,
    input_len: usize,
    min_chars: usize,
    min_entropy: f64,
    max_repetition: f64,
    min_tokens: usize,
) -> i32 {
    unsafe {
    if input_ptr.is_null() || input_len == 0 {
        return 1; // NearEmpty
    }
    // SAFETY: caller contract (see `# Safety`) guarantees `input_ptr` is
    // valid for reads of `input_len` bytes; null/empty input was rejected above.
    let slice = std::slice::from_raw_parts(input_ptr, input_len);
    match std::str::from_utf8(slice) {
        Ok(t) => classify_entropy(t, min_chars, min_entropy, max_repetition, min_tokens),
        Err(_) => 1,
    }
    }
}

/// Computes cosine similarity between two `f32` slices.
///
/// # Safety
/// `a_ptr` and `b_ptr` must each be valid for reads of `len * 4` bytes for
/// the duration of the call. Null pointers or zero length return 0.0.
#[no_mangle]
pub unsafe extern "C" fn navi_cosine_similarity(
    a_ptr: *const f32,
    b_ptr: *const f32,
    len: usize,
) -> f32 {
    unsafe {
    if a_ptr.is_null() || b_ptr.is_null() || len == 0 {
        return 0.0;
    }
    // SAFETY: caller contract (see `# Safety`) guarantees both pointers are
    // valid for reads of `len` floats; null/empty input was rejected above.
    let a = std::slice::from_raw_parts(a_ptr, len);
    let b = std::slice::from_raw_parts(b_ptr, len);
    cosine_similarity(a, b)
    }
}

/// Validates a URL against SSRF rules.
///
/// # Safety
/// `input_ptr` must be valid for reads of `len` bytes for the duration of the
/// call. Null or zero-length input returns `UrlSafetyCode::EmptyInput`.
#[no_mangle]
pub unsafe extern "C" fn navi_validate_url(
    input_ptr: *const u8,
    len: usize,
    allow_localhost: bool,
) -> i32 {
    unsafe {
    if input_ptr.is_null() || len == 0 {
        return url_safety::UrlSafetyCode::EmptyInput as i32;
    }
    // SAFETY: caller contract (see `# Safety`) guarantees `input_ptr` is
    // valid for reads of `len` bytes; null/empty input was rejected above.
    let slice = std::slice::from_raw_parts(input_ptr, len);
    match std::str::from_utf8(slice) {
        Ok(text) => url_safety::validate_url(text, allow_localhost) as i32,
        Err(_) => url_safety::UrlSafetyCode::MalformedSyntax as i32,
    }
    }
}

/// Computes line-based diff statistics without producing the diff itself.
///
/// On invalid UTF-8 in either buffer, writes nothing and returns -1.
///
/// # Safety
/// `old_ptr` must be valid for reads of `old_len` bytes and `new_ptr` for
/// `new_len` bytes, for the duration of the call. `additions_out` and
/// `deletions_out` must each be null or valid for a write of one `usize`.
/// Null or zero-length buffers are treated as empty text.
#[no_mangle]
pub unsafe extern "C" fn navi_diff_stats(
    old_ptr: *const u8,
    old_len: usize,
    new_ptr: *const u8,
    new_len: usize,
    additions_out: *mut usize,
    deletions_out: *mut usize,
) -> i32 {
    unsafe {
    let old_slice = if old_ptr.is_null() || old_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `old_ptr` is
        // valid for reads of `old_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(old_ptr, old_len)
    };
    let new_slice = if new_ptr.is_null() || new_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `new_ptr` is
        // valid for reads of `new_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(new_ptr, new_len)
    };

    let old_text = match std::str::from_utf8(old_slice) {
        Ok(t) => t,
        Err(_) => return -1,
    };
    let new_text = match std::str::from_utf8(new_slice) {
        Ok(t) => t,
        Err(_) => return -1,
    };

    let stats = fast_diff::compute_diff_stats(old_text, new_text);
    if !additions_out.is_null() {
        *additions_out = stats.additions;
    }
    if !deletions_out.is_null() {
        *deletions_out = stats.deletions;
    }

    0
    }
}

/// Generates a unified diff between two UTF-8 buffers.
///
/// Returns a caller-owned heap buffer, or null on invalid UTF-8 in either
/// input. Release the returned pointer with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `old_ptr`/`old_len`, `new_ptr`/`new_len`, and `file_ptr`/`file_len` must
/// each reference a buffer valid for reads for the duration of the call.
/// `out_len` must be null or valid for a write of one `usize`. Null or
/// zero-length buffers are treated as empty text; `file_ptr` defaults to
/// "file".
#[no_mangle]
pub unsafe extern "C" fn navi_unified_diff(
    old_ptr: *const u8,
    old_len: usize,
    new_ptr: *const u8,
    new_len: usize,
    file_ptr: *const u8,
    file_len: usize,
    context_lines: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let old_slice = if old_ptr.is_null() || old_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `old_ptr` is
        // valid for reads of `old_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(old_ptr, old_len)
    };
    let new_slice = if new_ptr.is_null() || new_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `new_ptr` is
        // valid for reads of `new_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(new_ptr, new_len)
    };
    let file_slice = if file_ptr.is_null() || file_len == 0 {
        "file".as_bytes()
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `file_ptr` is
        // valid for reads of `file_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(file_ptr, file_len)
    };

    let old_text = match std::str::from_utf8(old_slice) {
        Ok(t) => t,
        Err(_) => return std::ptr::null_mut(),
    };
    let new_text = match std::str::from_utf8(new_slice) {
        Ok(t) => t,
        Err(_) => return std::ptr::null_mut(),
    };
    let file_path = match std::str::from_utf8(file_slice) {
        Ok(t) => t,
        Err(_) => "file",
    };

    let diff = fast_diff::generate_unified_diff(old_text, new_text, file_path, context_lines);
    export_allocated_string(diff, out_len)
    }
}

/// Exports a Rust `String` to the C ABI as a heap-allocated, caller-owned buffer.
///
/// The returned pointer must be released with `navi_free_string(ptr, len)`.
/// The allocation is exactly `len` bytes wide so the free side can reconstruct
/// the layout with `Vec::from_raw_parts(ptr, len, len)`.
///
/// An empty string yields a non-null but dangling pointer with `out_len == 0`.
/// The caller must not read the buffer in that case; a null pointer is
/// reserved for genuine failures.
unsafe fn export_allocated_string(s: String, out_len: *mut usize) -> *mut u8 {
    unsafe {
    // SAFETY (implementing the allocator-binding invariant documented by
    // `navi_free_string`): the string bytes are sealed into a `Box<[u8]>`
    // whose length equals its capacity, so the caller can reconstruct the
    // exact allocation with `Vec::from_raw_parts(ptr, len, len)` using the
    // same global allocator.
    let boxed = s.into_bytes().into_boxed_slice();
    // SAFETY: `out_len` is either null or valid for a write of one `usize`
    // per the caller contract of every string-returning export.
    if !out_len.is_null() {
        *out_len = boxed.len();
    }
    Box::into_raw(boxed) as *mut u8
    }
}

/// Validates a coverage ledger JSON document.
///
/// Returns a caller-owned heap buffer containing a JSON `ValidationResult`;
/// release it with `navi_free_string(ptr, len)`. Invalid UTF-8 yields a
/// failure result rather than null.
///
/// # Safety
/// `json_ptr` must be valid for reads of `json_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is treated as empty JSON.
#[no_mangle]
pub unsafe extern "C" fn navi_audit_validate_ledger(
    json_ptr: *const u8,
    json_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let slice = if json_ptr.is_null() || json_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `json_ptr` is
        // valid for reads of `json_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(json_ptr, json_len)
    };
    let json_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => {
            let res = security_audit::ValidationResult::failed(vec!["Invalid UTF-8 in ledger JSON".to_string()]);
            let s = serde_json::to_string(&res).unwrap_or_default();
            return export_allocated_string(s, out_len);
        }
    };
    let res = security_audit::validate_coverage_ledger(json_str);
    let s = serde_json::to_string(&res).unwrap_or_default();
    export_allocated_string(s, out_len)
    }
}

/// Validates a findings JSON document.
///
/// Returns a caller-owned heap buffer containing a JSON `ValidationResult`;
/// release it with `navi_free_string(ptr, len)`. Invalid UTF-8 yields a
/// failure result rather than null.
///
/// # Safety
/// `json_ptr` must be valid for reads of `json_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is treated as empty JSON.
#[no_mangle]
pub unsafe extern "C" fn navi_audit_validate_findings(
    json_ptr: *const u8,
    json_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let slice = if json_ptr.is_null() || json_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `json_ptr` is
        // valid for reads of `json_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(json_ptr, json_len)
    };
    let json_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => {
            let res = security_audit::ValidationResult::failed(vec!["Invalid UTF-8 in findings JSON".to_string()]);
            let s = serde_json::to_string(&res).unwrap_or_default();
            return export_allocated_string(s, out_len);
        }
    };
    let res = security_audit::validate_findings(json_str);
    let s = serde_json::to_string(&res).unwrap_or_default();
    export_allocated_string(s, out_len)
    }
}

/// Generates a Markdown security audit report from findings and ledger JSON.
///
/// Returns a caller-owned heap buffer; release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `findings_ptr`, `ledger_ptr`, and `type_ptr` must each be valid for reads
/// of their corresponding `*_len` bytes for the duration of the call.
/// `out_len` must be null or valid for a write of one `usize`. Null or
/// zero-length buffers fall back to `[]` / `[]` / `main`.
#[no_mangle]
pub unsafe extern "C" fn navi_audit_generate_report(
    findings_ptr: *const u8,
    findings_len: usize,
    ledger_ptr: *const u8,
    ledger_len: usize,
    type_ptr: *const u8,
    type_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let f_slice = if findings_ptr.is_null() || findings_len == 0 { &[][..] } else { std::slice::from_raw_parts(findings_ptr, findings_len) };
    let l_slice = if ledger_ptr.is_null() || ledger_len == 0 { &[][..] } else { std::slice::from_raw_parts(ledger_ptr, ledger_len) };
    let t_slice = if type_ptr.is_null() || type_len == 0 { &[][..] } else { std::slice::from_raw_parts(type_ptr, type_len) };

    let f_str = std::str::from_utf8(f_slice).unwrap_or("[]");
    let l_str = std::str::from_utf8(l_slice).unwrap_or("[]");
    let t_str = std::str::from_utf8(t_slice).unwrap_or("main");

    match security_audit::generate_markdown_report(f_str, l_str, t_str) {
        Ok(report) => export_allocated_string(report, out_len),
        Err(e) => export_allocated_string(format!("# Report Generation Error\n\n{}", e), out_len),
    }
    }
}

/// Parses agent frontmatter from markdown content.
///
/// Returns a caller-owned heap buffer containing JSON agent metadata; release
/// it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `content_ptr`, `path_ptr`, and `fallback_id_ptr` must each be valid for
/// reads of their corresponding `*_len` bytes for the duration of the call.
/// `out_len` must be null or valid for a write of one `usize`. Null or
/// zero-length buffers fall back to `""` / `""` / `agent`.
#[no_mangle]
pub unsafe extern "C" fn navi_agency_parse_frontmatter(
    content_ptr: *const u8,
    content_len: usize,
    path_ptr: *const u8,
    path_len: usize,
    fallback_id_ptr: *const u8,
    fallback_id_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let c_slice = if content_ptr.is_null() || content_len == 0 { &[][..] } else { std::slice::from_raw_parts(content_ptr, content_len) };
    let p_slice = if path_ptr.is_null() || path_len == 0 { &[][..] } else { std::slice::from_raw_parts(path_ptr, path_len) };
    let id_slice = if fallback_id_ptr.is_null() || fallback_id_len == 0 { &[][..] } else { std::slice::from_raw_parts(fallback_id_ptr, fallback_id_len) };

    let content = std::str::from_utf8(c_slice).unwrap_or("");
    let path = std::str::from_utf8(p_slice).unwrap_or("");
    let fallback_id = std::str::from_utf8(id_slice).unwrap_or("agent");

    let result = agency_agents::parse_agent_frontmatter(content, path, fallback_id);
    let s = serde_json::to_string(&result).unwrap_or_else(|_| "null".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Searches an agent catalog for entries matching a query.
///
/// Returns a caller-owned heap buffer containing JSON search results; release
/// it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `catalog_ptr`, `query_ptr`, and `div_ptr` must each be valid for reads of
/// their corresponding `*_len` bytes for the duration of the call. `out_len`
/// must be null or valid for a write of one `usize`. Null or zero-length
/// buffers fall back to `[]` / `""` / `""`.
#[no_mangle]
pub unsafe extern "C" fn navi_agency_search(
    catalog_ptr: *const u8,
    catalog_len: usize,
    query_ptr: *const u8,
    query_len: usize,
    div_ptr: *const u8,
    div_len: usize,
    limit: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let cat_slice = if catalog_ptr.is_null() || catalog_len == 0 { &[][..] } else { std::slice::from_raw_parts(catalog_ptr, catalog_len) };
    let q_slice = if query_ptr.is_null() || query_len == 0 { &[][..] } else { std::slice::from_raw_parts(query_ptr, query_len) };
    let div_slice = if div_ptr.is_null() || div_len == 0 { &[][..] } else { std::slice::from_raw_parts(div_ptr, div_len) };

    let cat_str = std::str::from_utf8(cat_slice).unwrap_or("[]");
    let query = std::str::from_utf8(q_slice).unwrap_or("");
    let div = std::str::from_utf8(div_slice).unwrap_or("");
    let div_opt = if div.trim().is_empty() { None } else { Some(div) };

    let catalog: Vec<agency_agents::AgentMetadata> = serde_json::from_str(cat_str).unwrap_or_default();
    let results = agency_agents::search_agents(&catalog, query, div_opt, limit);
    let s = serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Runs full dependency-graph analysis over the supplied nodes and edges.
///
/// Returns a caller-owned heap buffer containing JSON analysis; release it
/// with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `nodes_ptr` and `edges_ptr` must each be valid for reads of their
/// corresponding `*_len` bytes for the duration of the call. `out_len` must
/// be null or valid for a write of one `usize`. Null or zero-length buffers
/// fall back to `[]`.
#[no_mangle]
pub unsafe extern "C" fn navi_graph_analyze(
    nodes_ptr: *const u8,
    nodes_len: usize,
    edges_ptr: *const u8,
    edges_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let n_slice = if nodes_ptr.is_null() || nodes_len == 0 { &[][..] } else { std::slice::from_raw_parts(nodes_ptr, nodes_len) };
    let e_slice = if edges_ptr.is_null() || edges_len == 0 { &[][..] } else { std::slice::from_raw_parts(edges_ptr, edges_len) };
    let n_str = std::str::from_utf8(n_slice).unwrap_or("[]");
    let e_str = std::str::from_utf8(e_slice).unwrap_or("[]");
    let nodes: Vec<code_graph::CodeNode> = serde_json::from_str(n_str).unwrap_or_default();
    let edges: Vec<code_graph::CodeEdge> = serde_json::from_str(e_str).unwrap_or_default();
    let mut graph = code_graph::CodeGraph::from_nodes_and_edges(nodes, edges);
    let analysis = graph.analyze();
    let s = serde_json::to_string(&analysis).unwrap_or_else(|_| "{}".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Finds all nodes affected by a change to the `seed` node.
///
/// Returns a caller-owned heap buffer containing JSON node IDs; release it
/// with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `nodes_ptr`, `edges_ptr`, and `seed_ptr` must each be valid for reads of
/// their corresponding `*_len` bytes for the duration of the call. `out_len`
/// must be null or valid for a write of one `usize`. Null or zero-length
/// buffers fall back to `[]` / `[]` / `""`.
#[no_mangle]
pub unsafe extern "C" fn navi_graph_affected(
    nodes_ptr: *const u8,
    nodes_len: usize,
    edges_ptr: *const u8,
    edges_len: usize,
    seed_ptr: *const u8,
    seed_len: usize,
    depth: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let n_slice = if nodes_ptr.is_null() || nodes_len == 0 { &[][..] } else { std::slice::from_raw_parts(nodes_ptr, nodes_len) };
    let e_slice = if edges_ptr.is_null() || edges_len == 0 { &[][..] } else { std::slice::from_raw_parts(edges_ptr, edges_len) };
    let s_slice = if seed_ptr.is_null() || seed_len == 0 { &[][..] } else { std::slice::from_raw_parts(seed_ptr, seed_len) };
    let n_str = std::str::from_utf8(n_slice).unwrap_or("[]");
    let e_str = std::str::from_utf8(e_slice).unwrap_or("[]");
    let seed = std::str::from_utf8(s_slice).unwrap_or("");
    let nodes: Vec<code_graph::CodeNode> = serde_json::from_str(n_str).unwrap_or_default();
    let edges: Vec<code_graph::CodeEdge> = serde_json::from_str(e_str).unwrap_or_default();
    let graph = code_graph::CodeGraph::from_nodes_and_edges(nodes, edges);
    let hits = graph.affected_nodes(seed, depth, None);
    let s = serde_json::to_string(&hits).unwrap_or_else(|_| "[]".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Finds the shortest path between two graph nodes.
///
/// Returns a caller-owned heap buffer containing the JSON path (null JSON if
/// no path exists); release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `nodes_ptr`, `edges_ptr`, `from_ptr`, and `to_ptr` must each be valid for
/// reads of their corresponding `*_len` bytes for the duration of the call.
/// `out_len` must be null or valid for a write of one `usize`. Null or
/// zero-length buffers fall back to `[]` / `[]` / `""` / `""`.
#[no_mangle]
pub unsafe extern "C" fn navi_graph_path(
    nodes_ptr: *const u8,
    nodes_len: usize,
    edges_ptr: *const u8,
    edges_len: usize,
    from_ptr: *const u8,
    from_len: usize,
    to_ptr: *const u8,
    to_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let n_slice = if nodes_ptr.is_null() || nodes_len == 0 { &[][..] } else { std::slice::from_raw_parts(nodes_ptr, nodes_len) };
    let e_slice = if edges_ptr.is_null() || edges_len == 0 { &[][..] } else { std::slice::from_raw_parts(edges_ptr, edges_len) };
    let f_slice = if from_ptr.is_null() || from_len == 0 { &[][..] } else { std::slice::from_raw_parts(from_ptr, from_len) };
    let t_slice = if to_ptr.is_null() || to_len == 0 { &[][..] } else { std::slice::from_raw_parts(to_ptr, to_len) };
    let n_str = std::str::from_utf8(n_slice).unwrap_or("[]");
    let e_str = std::str::from_utf8(e_slice).unwrap_or("[]");
    let from = std::str::from_utf8(f_slice).unwrap_or("");
    let to = std::str::from_utf8(t_slice).unwrap_or("");
    let nodes: Vec<code_graph::CodeNode> = serde_json::from_str(n_str).unwrap_or_default();
    let edges: Vec<code_graph::CodeEdge> = serde_json::from_str(e_str).unwrap_or_default();
    let graph = code_graph::CodeGraph::from_nodes_and_edges(nodes, edges);
    let path = graph.shortest_path(from, to);
    let s = serde_json::to_string(&path).unwrap_or_else(|_| "null".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Runs a structured subgraph query limited by `depth` and `budget`.
///
/// Returns a caller-owned heap buffer containing the JSON result; release it
/// with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `nodes_ptr`, `edges_ptr`, and `q_ptr` must each be valid for reads of
/// their corresponding `*_len` bytes for the duration of the call. `out_len`
/// must be null or valid for a write of one `usize`. Null or zero-length
/// buffers fall back to `[]`.
#[no_mangle]
pub unsafe extern "C" fn navi_graph_query(
    nodes_ptr: *const u8,
    nodes_len: usize,
    edges_ptr: *const u8,
    edges_len: usize,
    q_ptr: *const u8,
    q_len: usize,
    depth: usize,
    budget: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let n_slice = if nodes_ptr.is_null() || nodes_len == 0 { &[][..] } else { std::slice::from_raw_parts(nodes_ptr, nodes_len) };
    let e_slice = if edges_ptr.is_null() || edges_len == 0 { &[][..] } else { std::slice::from_raw_parts(edges_ptr, edges_len) };
    let q_slice = if q_ptr.is_null() || q_len == 0 { &[][..] } else { std::slice::from_raw_parts(q_ptr, q_len) };
    let n_str = std::str::from_utf8(n_slice).unwrap_or("[]");
    let e_str = std::str::from_utf8(e_slice).unwrap_or("[]");
    let query = std::str::from_utf8(q_slice).unwrap_or("");
    let nodes: Vec<code_graph::CodeNode> = serde_json::from_str(n_str).unwrap_or_default();
    let edges: Vec<code_graph::CodeEdge> = serde_json::from_str(e_str).unwrap_or_default();
    let graph = code_graph::CodeGraph::from_nodes_and_edges(nodes, edges);
    let result = graph.query_subgraph(query, depth, budget);
    export_allocated_string(result, out_len)
    }
}

/// Generates a repository-level graph report.
///
/// Returns a caller-owned heap buffer containing the Markdown/JSON report;
/// release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `nodes_ptr`, `edges_ptr`, and `repo_ptr` must each be valid for reads of
/// their corresponding `*_len` bytes for the duration of the call. `out_len`
/// must be null or valid for a write of one `usize`. Null or zero-length
/// buffers fall back to `[]`.
#[no_mangle]
pub unsafe extern "C" fn navi_graph_report(
    nodes_ptr: *const u8,
    nodes_len: usize,
    edges_ptr: *const u8,
    edges_len: usize,
    repo_ptr: *const u8,
    repo_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let n_slice = if nodes_ptr.is_null() || nodes_len == 0 { &[][..] } else { std::slice::from_raw_parts(nodes_ptr, nodes_len) };
    let e_slice = if edges_ptr.is_null() || edges_len == 0 { &[][..] } else { std::slice::from_raw_parts(edges_ptr, edges_len) };
    let r_slice = if repo_ptr.is_null() || repo_len == 0 { &[][..] } else { std::slice::from_raw_parts(repo_ptr, repo_len) };
    let n_str = std::str::from_utf8(n_slice).unwrap_or("[]");
    let e_str = std::str::from_utf8(e_slice).unwrap_or("[]");
    let repo_name = std::str::from_utf8(r_slice).unwrap_or("workspace");
    let nodes: Vec<code_graph::CodeNode> = serde_json::from_str(n_str).unwrap_or_default();
    let edges: Vec<code_graph::CodeEdge> = serde_json::from_str(e_str).unwrap_or_default();
    let mut graph = code_graph::CodeGraph::from_nodes_and_edges(nodes, edges);
    let report = graph.generate_report(repo_name);
    export_allocated_string(report, out_len)
    }
}

/// Compresses an input payload (log/diff/json/code) for context headroom.
///
/// Returns a caller-owned heap buffer containing a JSON `CompressionResult`;
/// release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `type_ptr` and `input_ptr` must each be valid for reads of their
/// corresponding `*_len` bytes for the duration of the call. `out_len` must
/// be null or valid for a write of one `usize`. Null or zero-length buffers
/// fall back to "log" / `""`.
#[no_mangle]
pub unsafe extern "C" fn navi_headroom_compress(
    type_ptr: *const u8,
    type_len: usize,
    input_ptr: *const u8,
    input_len: usize,
    max_param: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let t_slice = if type_ptr.is_null() || type_len == 0 { &[][..] } else { std::slice::from_raw_parts(type_ptr, type_len) };
    let i_slice = if input_ptr.is_null() || input_len == 0 { &[][..] } else { std::slice::from_raw_parts(input_ptr, input_len) };
    let c_type = std::str::from_utf8(t_slice).unwrap_or("log");
    let input = std::str::from_utf8(i_slice).unwrap_or("");

    let res = match c_type {
        "diff" => headroom_compress::compress_diff(input, if max_param == 0 { 3 } else { max_param }),
        "json" => headroom_compress::compress_json(input),
        "code" => headroom_compress::compress_code_skeleton(input, if max_param == 0 { 8 } else { max_param }),
        _ => headroom_compress::compress_log(input, if max_param == 0 { 80 } else { max_param }),
    };

    let s = serde_json::to_string(&res).unwrap_or_else(|_| "{}".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Retrieves an original (uncompressed) payload by CCR key.
///
/// Returns a caller-owned heap buffer with the payload, or an empty string
/// (out_len == 0) on a cache miss; release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `key_ptr` must be valid for reads of `key_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length keys are treated as an empty key (miss).
#[no_mangle]
pub unsafe extern "C" fn navi_headroom_retrieve(
    key_ptr: *const u8,
    key_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: `from_raw_parts` relies on the caller contract in
    // `# Safety` — the pointer is non-null with a matching non-zero length.
    let k_slice = if key_ptr.is_null() || key_len == 0 { &[][..] } else { std::slice::from_raw_parts(key_ptr, key_len) };
    let key = std::str::from_utf8(k_slice).unwrap_or("");
    let retrieved = headroom_compress::retrieve_ccr_payload(key).unwrap_or_default();
    export_allocated_string(retrieved, out_len)
    }
}

/// Returns global headroom telemetry statistics as JSON.
///
/// Returns a caller-owned heap buffer; release it with
/// `navi_free_string(ptr, len)`.
///
/// # Safety
/// `out_len` must be null or valid for a write of one `usize`.
#[no_mangle]
pub unsafe extern "C" fn navi_headroom_stats(
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let stats = headroom_compress::get_telemetry_stats();
    let s = serde_json::to_string(&stats).unwrap_or_else(|_| "{}".to_string());
    export_allocated_string(s, out_len)
    }
}

/// Computes multiple diffs in one round trip from a JSON batch request.
///
/// Returns a caller-owned heap buffer containing JSON diffs; release it with
/// `navi_free_string(ptr, len)`. Unparsable input yields `[]`.
///
/// # Safety
/// `json_ptr` must be valid for reads of `json_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is treated as empty JSON.
#[no_mangle]
pub unsafe extern "C" fn navi_snapshot_batch_diff(
    json_ptr: *const u8,
    json_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let slice = if json_ptr.is_null() || json_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `json_ptr` is
        // valid for reads of `json_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(json_ptr, json_len)
    };
    let json_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => return export_allocated_string("[]".to_string(), out_len),
    };
    let reqs: Vec<snapshot::DiffRequestItem> = match serde_json::from_str(json_str) {
        Ok(r) => r,
        Err(_) => return export_allocated_string("[]".to_string(), out_len),
    };
    let diffs = snapshot::compute_batch_diffs(&reqs);
    let out = serde_json::to_string(&diffs).unwrap_or_else(|_| "[]".to_string());
    export_allocated_string(out, out_len)
    }
}

/// Computes a content tree hash for a directory.
///
/// Returns a caller-owned heap buffer containing the hash string (empty on
/// failure/invalid UTF-8); release it with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `dir_ptr` must be valid for reads of `dir_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is treated as an empty path.
#[no_mangle]
pub unsafe extern "C" fn navi_snapshot_tree_hash(
    dir_ptr: *const u8,
    dir_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let slice = if dir_ptr.is_null() || dir_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `dir_ptr` is
        // valid for reads of `dir_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(dir_ptr, dir_len)
    };
    let dir_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => return export_allocated_string(String::new(), out_len),
    };
    let default_ignore = ["node_modules", ".git", "target", ".turbo", "dist", "out"];
    let hash = snapshot::compute_tree_state_hash(std::path::Path::new(dir_str), &default_ignore)
        .unwrap_or_default();
    export_allocated_string(hash, out_len)
    }
}

/// Scans a directory tree according to JSON-encoded walk options.
///
/// Returns a caller-owned heap buffer containing JSON entries; release it
/// with `navi_free_string(ptr, len)`. Unparsable options yield `[]`.
///
/// # Safety
/// `opts_ptr` must be valid for reads of `opts_len` bytes for the duration of
/// the call. `out_len` must be null or valid for a write of one `usize`.
/// Null or zero-length input is treated as empty JSON.
#[no_mangle]
pub unsafe extern "C" fn navi_walker_scan(
    opts_ptr: *const u8,
    opts_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    let slice = if opts_ptr.is_null() || opts_len == 0 {
        &[][..]
    } else {
        // SAFETY: caller contract (see `# Safety`) guarantees `opts_ptr` is
        // valid for reads of `opts_len` bytes; null/empty was excluded above.
        std::slice::from_raw_parts(opts_ptr, opts_len)
    };
    let opts_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => return export_allocated_string("[]".to_string(), out_len),
    };
    let opts: walker::WalkOptions = match serde_json::from_str(opts_str) {
        Ok(o) => o,
        Err(_) => return export_allocated_string("[]".to_string(), out_len),
    };
    let entries = walker::scan_directory(&opts);
    let out = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string());
    export_allocated_string(out, out_len)
    }
}

/// Greps a JSON-encoded list of files for a query.
///
/// Returns a caller-owned heap buffer containing JSON matches; release it
/// with `navi_free_string(ptr, len)`.
///
/// # Safety
/// `files_ptr` and `query_ptr` must each be valid for reads of their
/// corresponding `*_len` bytes for the duration of the call. `out_len` must
/// be null or valid for a write of one `usize`. Null or zero-length buffers
/// fall back to `[]` / `""`.
#[no_mangle]
pub unsafe extern "C" fn navi_walker_grep(
    files_ptr: *const u8,
    files_len: usize,
    query_ptr: *const u8,
    query_len: usize,
    case_insensitive: bool,
    max_matches: usize,
    out_len: *mut usize,
) -> *mut u8 {
    unsafe {
    // SAFETY below: each `from_raw_parts` call relies on the caller contract
    // in `# Safety` — the pointer is non-null with a matching non-zero length.
    let f_slice = if files_ptr.is_null() || files_len == 0 { &[][..] } else { std::slice::from_raw_parts(files_ptr, files_len) };
    let q_slice = if query_ptr.is_null() || query_len == 0 { &[][..] } else { std::slice::from_raw_parts(query_ptr, query_len) };

    let files_json = std::str::from_utf8(f_slice).unwrap_or("[]");
    let query = std::str::from_utf8(q_slice).unwrap_or("");

    let files: Vec<String> = serde_json::from_str(files_json).unwrap_or_default();
    let matches = walker::grep_files(&files, query, case_insensitive, max_matches);
    let out = serde_json::to_string(&matches).unwrap_or_else(|_| "[]".to_string());
    export_allocated_string(out, out_len)
    }
}

/// Registers a child process PID for supervision and cleanup.
///
/// # Safety
/// This function performs no pointer dereferencing; the `unsafe` marker
/// follows the crate-wide FFI convention. Accepts any `pid`; always safe
/// from the caller's side.
#[no_mangle]
pub unsafe extern "C" fn navi_process_register(pid: u32) -> bool {
    process_guard::register_pid(pid)
}

/// Kills a previously registered or running process tree.
///
/// # Safety
/// This function performs no pointer dereferencing; the `unsafe` marker
/// follows the crate-wide FFI convention. Spawning `taskkill`/`kill` with
/// an arbitrary `pid` is the caller's chosen behavior.
#[no_mangle]
pub unsafe extern "C" fn navi_process_kill(pid: u32) -> bool {
    process_guard::kill_process_tree(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitization_patterns() {
        let out = scrub_secrets("Authorization: Bearer abcdef0123456789ABCDEF0123456789");
        assert!(out.contains("[REDACTED:bearer_token]"));

        let out = scrub_secrets("sk-1234567890abcdefghijklmnopqrstuvwxyz");
        assert!(out.contains("[REDACTED:api_key]"));

        let out = scrub_secrets("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
        assert!(out.contains("[REDACTED:github_token]"));

        let out = scrub_secrets("AKIA1234567890ABCDEF");
        assert!(out.contains("[REDACTED:aws_key]"));

        // Normal word surviving
        assert_eq!(scrub_secrets("ASIAPACIFICREGION"), "ASIAPACIFICREGION");

        // ANSI stripping
        assert_eq!(scrub_secrets("\x1b[31;1mError: Alert\x1b[0m"), "Error: Alert");
    }

    #[test]
    fn test_entropy_classification() {
        assert_eq!(classify_entropy("   ", 16, 2.0, 0.7, 6), 1);
        assert_eq!(classify_entropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 16, 2.0, 0.7, 6), 2);
        assert_eq!(classify_entropy("status ok status ok status ok status ok status ok status ok", 16, 2.0, 0.7, 6), 3);
        assert_eq!(classify_entropy("Fixed packages/navi/src/memory/sanitize.ts correctly", 16, 2.0, 0.7, 6), 0);
    }

    #[test]
    fn test_cosine_similarity() {
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![1.0, 0.0, 0.0];
        let v3 = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&v1, &v2) - 1.0).abs() < 1e-5);
        assert!((cosine_similarity(&v1, &v3) - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_export_allocated_string_round_trip() {
        let mut len = 0usize;
        unsafe {
            // SAFETY: the produced pointer is passed to `navi_free_string`
            // with the same `len` reported via `out_len`, satisfying the
            // allocator-binding invariant; the slice read is bounded by `len`.
            let ptr = export_allocated_string("hello navi".to_string(), &mut len);
            assert_eq!(len, 10);
            assert!(!ptr.is_null());
            let slice = std::slice::from_raw_parts(ptr, len);
            assert_eq!(std::str::from_utf8(slice).unwrap(), "hello navi");
            navi_free_string(ptr, len);
        }
    }

    #[test]
    fn test_export_allocated_string_empty_reports_zero_length() {
        let mut len = 12345usize;
        unsafe {
            // SAFETY: the produced pointer (possibly dangling for an empty
            // payload) is never dereferenced; `len == 0` makes the free a no-op.
            let ptr = export_allocated_string(String::new(), &mut len);
            // An empty payload must report length 0 so the caller never reads the buffer.
            assert_eq!(len, 0);
            navi_free_string(ptr, len);
        }
    }

    #[test]
    fn test_navi_sanitize_handles_control_only_input() {
        let input = b"\x01\x02\x03";
        let mut len = 0usize;
        unsafe {
            // SAFETY: `input.as_ptr()`/`input.len()` describe a valid stack
            // buffer alive for the whole block; the returned pointer is freed
            // with the reported `len` immediately.
            let ptr = navi_sanitize(input.as_ptr(), input.len(), &mut len);
            assert_eq!(len, 0);
            navi_free_string(ptr, len);
        }
    }

    #[test]
    fn test_navi_headroom_retrieve_miss_reports_zero_length() {
        let key = b"deadbeefdeadbeefdeadbeef";
        let mut len = 0usize;
        unsafe {
            // SAFETY: `key.as_ptr()`/`key.len()` describe a valid stack buffer
            // alive for the whole block; the returned pointer is freed with
            // the reported `len` immediately.
            let ptr = navi_headroom_retrieve(key.as_ptr(), key.len(), &mut len);
            assert_eq!(len, 0);
            navi_free_string(ptr, len);
        }
    }
}
