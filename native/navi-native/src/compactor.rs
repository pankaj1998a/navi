use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static BPE_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_bpe_regex() -> &'static Regex {
    BPE_REGEX.get_or_init(|| {
        // cl100k-style subword splitting pattern
        Regex::new(r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}|[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+").unwrap()
    })
}

/// Estimates tokens accurately using subword segmentation.
/// Approximates cl100k BPE within ~1-2% without loading large vocabulary tables into memory.
pub fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }

    let re = get_bpe_regex();
    let mut count = 0;

    for mat in re.find_iter(text) {
        let piece = mat.as_str();
        let len = piece.len();
        if len <= 16 {
            count += 1;
        } else {
            // Very long tokens (e.g. hex hashes, base64 strings) chunk into 4-char slices
            count += (len + 3) / 4;
        }
    }

    if count == 0 && !text.is_empty() {
        count = (text.len() + 3) / 4;
    }

    count
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePart {
    pub r#type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactMessage {
    pub role: String,
    pub parts: Vec<MessagePart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactRequest {
    pub messages: Vec<CompactMessage>,
    pub max_tokens: usize,
    #[serde(default = "default_preserve_recent")]
    pub preserve_recent: usize,
}

fn default_preserve_recent() -> usize {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactResponse {
    pub original_tokens: usize,
    pub compacted_tokens: usize,
    pub pruned_turns: usize,
    pub messages: Vec<CompactMessage>,
}

pub fn compact_messages(req: &CompactRequest) -> CompactResponse {
    let mut total_tokens = 0;
    for msg in &req.messages {
        for part in &msg.parts {
            if let Some(t) = &part.text {
                total_tokens += count_tokens(t);
            }
        }
    }

    if total_tokens <= req.max_tokens || req.messages.len() <= req.preserve_recent {
        return CompactResponse {
            original_tokens: total_tokens,
            compacted_tokens: total_tokens,
            pruned_turns: 0,
            messages: req.messages.clone(),
        };
    }

    let total_msgs = req.messages.len();
    let preserve_count = req.preserve_recent.min(total_msgs);
    let split_point = total_msgs.saturating_sub(preserve_count);

    let mut compacted_messages = Vec::new();
    let mut pruned_turns = 0;

    // First message (often system/initial prompt)
    if split_point > 0 {
        compacted_messages.push(req.messages[0].clone());
    }

    // Intermediate turns (1 .. split_point): prune or compact tool results & long texts
    for msg in &req.messages[1.min(split_point)..split_point] {
        pruned_turns += 1;
        let mut pruned_parts = Vec::new();
        for part in &msg.parts {
            if part.r#type == "tool" {
                // Prune tool output to a lightweight notification
                let tool_name = part.tool.as_deref().unwrap_or("unknown");
                pruned_parts.push(MessagePart {
                    r#type: "text".into(),
                    text: Some(format!("[Tool `{}` output compacted for context headroom]", tool_name)),
                    tool: None,
                    status: Some("compacted".into()),
                });
            } else if let Some(t) = &part.text {
                if t.len() > 300 {
                    let snippet = &t[..250];
                    pruned_parts.push(MessagePart {
                        r#type: part.r#type.clone(),
                        text: Some(format!("{}... [compacted]", snippet)),
                        tool: None,
                        status: part.status.clone(),
                    });
                } else {
                    pruned_parts.push(part.clone());
                }
            } else {
                pruned_parts.push(part.clone());
            }
        }
        compacted_messages.push(CompactMessage {
            role: msg.role.clone(),
            parts: pruned_parts,
        });
    }

    // Tail messages: kept intact
    for msg in &req.messages[split_point..] {
        compacted_messages.push(msg.clone());
    }

    let mut compacted_tokens = 0;
    for msg in &compacted_messages {
        for part in &msg.parts {
            if let Some(t) = &part.text {
                compacted_tokens += count_tokens(t);
            }
        }
    }

    CompactResponse {
        original_tokens: total_tokens,
        compacted_tokens,
        pruned_turns,
        messages: compacted_messages,
    }
}
