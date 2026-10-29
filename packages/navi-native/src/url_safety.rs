//! High-performance URL Safety and SSRF Guard in native Rust.
//! Validates targets, prevents internal network scanning, cloud metadata access,
//! numeric IP obfuscation, and terminal injection attacks.

use std::net::{Ipv4Addr, Ipv6Addr};
use url::Url;

#[repr(i32)]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum UrlSafetyCode {
    Safe = 0,
    EmptyInput = 1,
    TerminalControl = 2,
    MalformedSyntax = 3,
    UnsupportedProtocol = 4,
    EmbeddedCredentials = 5,
    MissingHostname = 6,
    LocalOrPrivate = 7,
    CloudMetadata = 8,
    PrivateNetwork = 9,
    NumericObfuscation = 10,
}

impl UrlSafetyCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::EmptyInput => "Empty or invalid URL input",
            Self::TerminalControl => "Target URL contains illegal terminal control characters (CWE-117)",
            Self::MalformedSyntax => "Malformed URL syntax",
            Self::UnsupportedProtocol => "Unsupported protocol. Only http: and https: are permitted.",
            Self::EmbeddedCredentials => "URLs with embedded credentials in authority are disallowed",
            Self::MissingHostname => "Missing hostname in target URL",
            Self::LocalOrPrivate => "Target points to local or private address",
            Self::CloudMetadata => "Target points to cloud instance metadata service (SSRF protection)",
            Self::PrivateNetwork => "Target points to RFC1918 private network",
            Self::NumericObfuscation => "Hostname is represented as an obfuscated numeric/hex IP",
        }
    }
}

pub fn has_terminal_control(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_control() && c != '\t' && c != '\n' && c != '\r')
}

fn is_numeric_or_hex(label: &str) -> bool {
    let lowered = label.to_ascii_lowercase();
    if let Some(stripped) = lowered.strip_prefix("0x") {
        !stripped.is_empty() && stripped.chars().all(|c| c.is_ascii_hexdigit())
    } else {
        !lowered.is_empty() && lowered.chars().all(|c| c.is_ascii_digit())
    }
}

/// Checks if an IPv4 address belongs to private/restricted ranges
fn is_private_or_restricted_ipv4(ip: Ipv4Addr) -> Option<UrlSafetyCode> {
    let octets = ip.octets();

    // Loopback (127.0.0.0/8) or 0.0.0.0
    if octets[0] == 127 || ip.is_unspecified() {
        return Some(UrlSafetyCode::LocalOrPrivate);
    }

    // Cloud metadata & link-local (169.254.0.0/16)
    if octets[0] == 169 && octets[1] == 254 {
        return Some(UrlSafetyCode::CloudMetadata);
    }

    // RFC1918 Private ranges:
    // 10.0.0.0/8
    if octets[0] == 10 {
        return Some(UrlSafetyCode::PrivateNetwork);
    }
    // 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return Some(UrlSafetyCode::PrivateNetwork);
    }
    // 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 {
        return Some(UrlSafetyCode::PrivateNetwork);
    }

    // CGNAT (100.64.0.0/10)
    if octets[0] == 100 && (octets[1] & 0xC0) == 64 {
        return Some(UrlSafetyCode::PrivateNetwork);
    }

    None
}

/// Checks if an IPv6 address belongs to private/restricted ranges
fn is_private_or_restricted_ipv6(ip: Ipv6Addr) -> Option<UrlSafetyCode> {
    if ip.is_loopback() || ip.is_unspecified() {
        return Some(UrlSafetyCode::LocalOrPrivate);
    }

    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if let Some(ipv4) = ip.to_ipv4() {
        return is_private_or_restricted_ipv4(ipv4);
    }

    let segments = ip.segments();
    // Unique local (fc00::/7)
    if (segments[0] & 0xfe00) == 0xfc00 {
        return Some(UrlSafetyCode::PrivateNetwork);
    }
    // Link-local (fe80::/10)
    if (segments[0] & 0xffc0) == 0xfe80 {
        return Some(UrlSafetyCode::LocalOrPrivate);
    }

    None
}

/// Validates raw URL for security and SSRF safety
pub fn validate_url(raw_url: &str, allow_localhost: bool) -> UrlSafetyCode {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return UrlSafetyCode::EmptyInput;
    }

    if has_terminal_control(trimmed) {
        return UrlSafetyCode::TerminalControl;
    }

    if trimmed.contains('\\') || trimmed.chars().any(char::is_whitespace) {
        return UrlSafetyCode::MalformedSyntax;
    }

    // Check raw authority for numeric/hex obfuscation (e.g. 0x7f000001, 2130706433)
    if let Some(after_scheme) = trimmed.strip_prefix("http://").or_else(|| trimmed.strip_prefix("https://")) {
        let authority = after_scheme.split(&['/', '?', '#'][..]).next().unwrap_or("");
        let host_part = authority.split('@').last().unwrap_or("").split(':').next().unwrap_or("");
        let labels: Vec<&str> = host_part.split('.').collect();
        if !labels.is_empty() && (labels.iter().any(|l| l.to_ascii_lowercase().starts_with("0x")) || (labels.len() == 1 && host_part.chars().all(|c| c.is_ascii_digit()))) {
            return UrlSafetyCode::NumericObfuscation;
        }
    }

    let parsed = match Url::parse(trimmed) {
        Ok(u) => u,
        Err(_) => return UrlSafetyCode::MalformedSyntax,
    };

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return UrlSafetyCode::UnsupportedProtocol;
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return UrlSafetyCode::EmbeddedCredentials;
    }

    let host_str = match parsed.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return UrlSafetyCode::MissingHostname,
    };

    let clean_host = host_str.trim_end_matches('.');
    if clean_host.is_empty() {
        return UrlSafetyCode::MissingHostname;
    }

    if allow_localhost {
        return UrlSafetyCode::Safe;
    }

    // Direct hostname string checks
    if clean_host == "localhost"
        || clean_host.ends_with(".localhost")
        || clean_host.ends_with(".local")
        || clean_host.ends_with(".internal")
        || clean_host == "metadata.google.internal"
        || clean_host == "instance-data"
    {
        return UrlSafetyCode::LocalOrPrivate;
    }

    // Check numeric obfuscation (e.g. 0x7f000001, 2130706433)
    let labels: Vec<&str> = clean_host.split('.').collect();
    if !labels.is_empty() && (clean_host.starts_with("0x") || (labels.len() == 1 && clean_host.chars().all(|c| c.is_ascii_digit()))) {
        return UrlSafetyCode::NumericObfuscation;
    }

    // Check parsed host IP if available
    if let Some(host) = parsed.host() {
        match host {
            url::Host::Ipv4(ip) => {
                if let Some(code) = is_private_or_restricted_ipv4(ip) {
                    return code;
                }
            }
            url::Host::Ipv6(ip) => {
                if let Some(code) = is_private_or_restricted_ipv6(ip) {
                    return code;
                }
            }
            url::Host::Domain(_) => {
                if !labels.is_empty() && labels.iter().all(|l| is_numeric_or_hex(l)) {
                    return UrlSafetyCode::NumericObfuscation;
                }
            }
        }
    }

    // Specific cloud metadata string check
    if clean_host == "169.254.169.254" || clean_host.starts_with("169.254.") {
        return UrlSafetyCode::CloudMetadata;
    }

    UrlSafetyCode::Safe
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validates_benign_urls() {
        assert_eq!(validate_url("https://example.com/api/v1", false), UrlSafetyCode::Safe);
        assert_eq!(validate_url("http://8.8.8.8/dns-query", false), UrlSafetyCode::Safe);
    }

    #[test]
    fn test_blocks_localhost_and_metadata() {
        assert_eq!(validate_url("http://localhost:8080", false), UrlSafetyCode::LocalOrPrivate);
        assert_eq!(validate_url("http://127.0.0.1:3000", false), UrlSafetyCode::LocalOrPrivate);
        assert_eq!(validate_url("http://169.254.169.254/latest/meta-data/", false), UrlSafetyCode::CloudMetadata);
        assert_eq!(validate_url("http://metadata.google.internal/computeMetadata/v1/", false), UrlSafetyCode::LocalOrPrivate);
    }

    #[test]
    fn test_blocks_private_networks() {
        assert_eq!(validate_url("http://10.0.1.5:8000", false), UrlSafetyCode::PrivateNetwork);
        assert_eq!(validate_url("http://192.168.1.1/admin", false), UrlSafetyCode::PrivateNetwork);
        assert_eq!(validate_url("http://172.20.0.10/", false), UrlSafetyCode::PrivateNetwork);
    }

    #[test]
    fn test_blocks_control_characters() {
        assert_eq!(validate_url("https://example.com\x1b[31m", false), UrlSafetyCode::TerminalControl);
        assert_eq!(validate_url("https://user:pass@example.com", false), UrlSafetyCode::EmbeddedCredentials);
    }

    #[test]
    fn test_blocks_numeric_obfuscation() {
        assert_eq!(validate_url("http://0x7f000001:8080", false), UrlSafetyCode::NumericObfuscation);
        assert_eq!(validate_url("http://2130706433/", false), UrlSafetyCode::NumericObfuscation);
    }
}
