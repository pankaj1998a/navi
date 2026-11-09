use regex::{Regex, RegexSet};
use std::borrow::Cow;
use std::sync::LazyLock;

const REDACTED: &str = "[REDACTED_SECRET]";
const REDACTED_URL_VALUE: &str = "redacted";

fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid regex")
}

static API_KEY_PREFIX_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b(?:sk[-_]|xai-)[A-Za-z0-9_-]{20,}"));

static AWS_ACCESS_KEY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"));

static GITHUB_TOKEN_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"));

static VENDOR_TOKEN_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b(?:glpat-|xox[abp]-|xapp-)[A-Za-z0-9-]{10,}"));

static GOOGLE_API_KEY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\bAIza[0-9A-Za-z_-]{35}"));

static PEM_PRIVATE_KEY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    compile(r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----")
});

static BEARER_TOKEN_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]{16,}\b"));

static JWT_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"));

static SECRET_ASSIGNMENT_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    compile(
        r#"(?ix)
        \b(
            api[_-]?key
          | (?:access|refresh|id)[_-]token
          | token
          | secret
          | client[_-]secret
          | password
        )\b
        (\s*[:=]\s*)
        (["']?)
        [^\s"',&]{8,}
        "#,
    )
});

static URL_REGEX: LazyLock<Regex> = LazyLock::new(|| compile(r#"https?://[^\s"'<>(){}\[\],;`]+"#));

static MATCH_ANY: LazyLock<RegexSet> = LazyLock::new(|| {
    RegexSet::new([
        API_KEY_PREFIX_REGEX.as_str(),
        AWS_ACCESS_KEY_REGEX.as_str(),
        GITHUB_TOKEN_REGEX.as_str(),
        VENDOR_TOKEN_REGEX.as_str(),
        GOOGLE_API_KEY_REGEX.as_str(),
        PEM_PRIVATE_KEY_REGEX.as_str(),
        BEARER_TOKEN_REGEX.as_str(),
        JWT_REGEX.as_str(),
        URL_REGEX.as_str(),
        SECRET_ASSIGNMENT_REGEX.as_str(),
    ])
    .expect("redact_secrets RegexSet")
});

static SENSITIVE_QUERY_PARAMS: &[&str] = &[
    "access_token",
    "api_key",
    "assertion",
    "auth",
    "client_secret",
    "code",
    "code_verifier",
    "id_token",
    "key",
    "password",
    "refresh_token",
    "requested_token",
    "session_id",
    "state",
    "subject_token",
    "token",
];

fn redact_urls_in(input: &str) -> String {
    URL_REGEX
        .replace_all(input, |caps: &regex::Captures| {
            let url_str = &caps[0];
            let mut result = url_str.to_string();
            for param in SENSITIVE_QUERY_PARAMS {
                let pattern = format!(r"([?&]{}=)[^&\s]+", param);
                if let Ok(re) = Regex::new(&pattern) {
                    result = re
                        .replace_all(&result, format!("${{1}}{}", REDACTED_URL_VALUE))
                        .to_string();
                }
            }
            result
        })
        .to_string()
}

pub fn redact_secrets(input: &str) -> Cow<'_, str> {
    if !MATCH_ANY.is_match(input) {
        return Cow::Borrowed(input);
    }
    let s = PEM_PRIVATE_KEY_REGEX.replace_all(input, REDACTED);
    let s = API_KEY_PREFIX_REGEX.replace_all(&s, REDACTED);
    let s = AWS_ACCESS_KEY_REGEX.replace_all(&s, REDACTED);
    let s = GITHUB_TOKEN_REGEX.replace_all(&s, REDACTED);
    let s = VENDOR_TOKEN_REGEX.replace_all(&s, REDACTED);
    let s = GOOGLE_API_KEY_REGEX.replace_all(&s, REDACTED);
    let s = BEARER_TOKEN_REGEX.replace_all(&s, format!("Bearer {REDACTED}"));
    let s = JWT_REGEX.replace_all(&s, REDACTED);
    let s = redact_urls_in(&s);
    let s = SECRET_ASSIGNMENT_REGEX
        .replace_all(&s, format!("$1$2$3{REDACTED}"))
        .into_owned();
    Cow::Owned(s)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CommandSafetyResult {
    pub is_safe: bool,
    pub risk_level: String, // "safe" | "low" | "medium" | "high" | "critical"
    pub detected_threats: Vec<String>,
}

static FS_DESTRUCT_UNIX_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    compile(r#"\brm\s+.*-(?:[a-zA-Z]*r[a-zA-Z]*|-recursive)\b.*(?:\s|^)[/~*](?:\s|$|")"#)
});
static FS_DESTRUCT_WIN_RMDIR: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"rmdir\s+/[sS]\s+/[qQ]\s+[c-zC-Z]:\\"#));
static FS_DESTRUCT_WIN_DEL: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"del\s+/[fF]\s+/[sS]\s+/[qQ]\s+[c-zC-Z]:\\"#));

static FORK_BOMB_REGEX: LazyLock<Regex> = LazyLock::new(|| compile(r#":\(\)\s*\{\s*:\|:&\s*\};:"#));

static FORMAT_DISK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"\bmkfs\b|format\s+[c-zC-Z]:"#));
static DD_DISK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"dd\s+if=.*of=/dev/(?:sda|sdb|nvme|disk)"#));

static SQL_DROP_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"(?i)\bdrop\s+(?:database|schema|table)\b"#));
static SQL_TRUNCATE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"(?i)\btruncate\s+(?:table\s+)?[a-zA-Z0-9_.]+\b"#));

static PIPE_REMOTE_SH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"(?:curl|wget)\s+[^|]+\|\s*(?:ba)?sh\b"#));
static PS_ENCODED_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"powershell\s+.*-(?:enc|encodedcommand)\b"#));
static PS_IEX_REGEX: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"invoke-expression\s*\(?.*(?:downloadstring|iwr|curl)\b"#));

pub fn analyze_command_safety(command: &str) -> CommandSafetyResult {
    let mut threats: Vec<String> = Vec::new();
    let lower = command.to_lowercase();

    // 1. Critical: Root/System destruction
    if FS_DESTRUCT_UNIX_REGEX.is_match(command)
        || FS_DESTRUCT_WIN_RMDIR.is_match(command)
        || FS_DESTRUCT_WIN_DEL.is_match(command)
    {
        threats.push("Critical destructive filesystem deletion command".into());
    }

    // 2. Critical: Fork bomb
    if FORK_BOMB_REGEX.is_match(command) || lower.contains("%0|%0") {
        threats.push("Denial of service fork bomb detected".into());
    }

    // 3. High: Block device / filesystem formatting
    if FORMAT_DISK_REGEX.is_match(command) || DD_DISK_REGEX.is_match(command) {
        threats.push("Destructive disk or partition formatting detected".into());
    }

    // 4. High: Database drops
    if SQL_DROP_REGEX.is_match(command) || SQL_TRUNCATE_REGEX.is_match(command) {
        threats.push("Irreversible database drop or truncation detected".into());
    }

    // 5. Medium: Remote code execution via pipe
    if PIPE_REMOTE_SH_REGEX.is_match(command)
        || PS_ENCODED_REGEX.is_match(&lower)
        || PS_IEX_REGEX.is_match(&lower)
    {
        threats.push("Unvetted remote script pipe execution detected".into());
    }

    let risk_level = if threats
        .iter()
        .any(|t| t.contains("Critical") || t.contains("fork bomb"))
    {
        "critical".to_string()
    } else if threats
        .iter()
        .any(|t| t.contains("Destructive") || t.contains("database drop"))
    {
        "high".to_string()
    } else if !threats.is_empty() {
        "medium".to_string()
    } else {
        "safe".to_string()
    };

    let is_safe = threats.is_empty();

    CommandSafetyResult {
        is_safe,
        risk_level,
        detected_threats: threats,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_secrets() {
        let input = "Key: sk-1234567890abcdef1234567890abcdef";
        let out = redact_secrets(input);
        assert!(out.contains(REDACTED));
    }

    #[test]
    fn test_analyze_destructive_commands() {
        let rm_rf = analyze_command_safety("rm -rf /");
        assert!(!rm_rf.is_safe);
        assert_eq!(rm_rf.risk_level, "critical");

        let fork_bomb = analyze_command_safety(":(){ :|:& };:");
        assert!(!fork_bomb.is_safe);

        let sql_drop = analyze_command_safety("DROP TABLE users;");
        assert!(!sql_drop.is_safe);
        assert_eq!(sql_drop.risk_level, "high");

        let safe_cmd = analyze_command_safety("git status && bun test");
        assert!(safe_cmd.is_safe);
        assert_eq!(safe_cmd.risk_level, "safe");
    }
}
