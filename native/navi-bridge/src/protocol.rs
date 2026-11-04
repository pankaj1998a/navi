use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(default)]
        token: Option<String>,
        #[serde(default)]
        payload: Option<HelloPayload>,
    },
    #[serde(rename = "hello_ack")]
    HelloAck,
    #[serde(rename = "tool_call")]
    ToolCall {
        #[serde(rename = "requestId")]
        request_id: String,
        payload: ToolCallPayload,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        #[serde(rename = "responseToRequestId")]
        response_to_request_id: String,
        payload: ToolResultPayload,
    },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HelloPayload {
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default, rename = "extensionVersion")]
    pub extension_version: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallPayload {
    pub name: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolResultPayload {
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<String>,
}

