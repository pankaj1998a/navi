use std::fs;
use std::path::PathBuf;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use rand::RngCore;

pub fn get_token_path() -> PathBuf {
    if let Ok(p) = std::env::var("NAVIBRIDGE_HOME") {
        return PathBuf::from(p).join("token");
    }
    if let Some(home) = dirs::home_dir() {
        let navi_dir = home.join(".navi");
        if navi_dir.exists() {
            return navi_dir.join("bridge.token");
        }
        return home.join(".navibridge").join("token");
    }
    PathBuf::from(".navi-bridge.token")
}

pub fn load_or_generate_token() -> String {
    if let Ok(t) = std::env::var("NAVIBRIDGE_TOKEN") {
        let trimmed = t.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    let token_path = get_token_path();
    if token_path.exists() {
        if let Ok(content) = fs::read_to_string(&token_path) {
            let trimmed = content.trim().to_string();
            if trimmed.len() >= 16 {
                return trimmed;
            }
        }
    }

    // Generate 24 random bytes -> 48 hex chars
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    if let Some(parent) = token_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&token_path, &token);

    token
}

pub fn tokens_match(a: &str, b: &str) -> bool {
    let hash_a = Sha256::digest(a.as_bytes());
    let hash_b = Sha256::digest(b.as_bytes());
    hash_a.ct_eq(&hash_b).into()
}
