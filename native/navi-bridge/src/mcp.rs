use std::io::{self, BufRead, Write};
use serde_json::{json, Value};
use crate::auth::load_or_generate_token;
use crate::client::call_bridge_tool;

pub async fn run_mcp_server(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let token = load_or_generate_token();
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();

    while let Some(Ok(line)) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

        match method {
            "initialize" => {
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "navi-bridge-mcp",
                            "version": "0.1.0"
                        }
                    }
                });
                send_frame(&resp);
            }
            "notifications/initialized" => {
                // No reply required for notifications
            }
            "tools/list" => {
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "ask",
                                "description": "Fan-out prompt to logged-in web AI providers (ChatGPT, Claude, Gemini, DeepSeek)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "prompt": { "type": "string" },
                                        "provider": { "type": "string" }
                                    },
                                    "required": ["prompt"]
                                }
                            },
                            {
                                "name": "browser_navigate",
                                "description": "Navigate active or new tab in your live browser",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "url": { "type": "string" },
                                        "newTab": { "type": "boolean" }
                                    },
                                    "required": ["url"]
                                }
                            },
                            {
                                "name": "browser_snapshot",
                                "description": "Extract semantic accessibility snapshot of current webpage",
                                "inputSchema": { "type": "object", "properties": {} }
                            },
                            {
                                "name": "browser_click",
                                "description": "Simulate hardware click on a selector or coordinates",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "selector": { "type": "string" },
                                        "x": { "type": "number" },
                                        "y": { "type": "number" }
                                    }
                                }
                            },
                            {
                                "name": "browser_fill",
                                "description": "Type text into form input with trusted hardware keystrokes",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "selector": { "type": "string" },
                                        "value": { "type": "string" }
                                    },
                                    "required": ["value"]
                                }
                            },
                            {
                                "name": "doctor",
                                "description": "Check NaviBridge daemon and extension status",
                                "inputSchema": { "type": "object", "properties": {} }
                            }
                        ]
                    }
                });
                send_frame(&resp);
            }
            "tools/call" => {
                let params = req.get("params").cloned().unwrap_or(json!({}));
                let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let bridge_tool = match tool_name {
                    "browser_navigate" => "navigate",
                    "browser_snapshot" => "snapshot",
                    "browser_click" => "click",
                    "browser_fill" => "fill",
                    other => other,
                };

                let result = call_bridge_tool(port, &token, bridge_tool, args, 60).await;
                match result {
                    Ok(data) => {
                        let text_val = if let Some(s) = data.as_str() {
                            s.to_string()
                        } else if let Some(txt) = data.get("text").and_then(|t| t.as_str()) {
                            txt.to_string()
                        } else {
                            serde_json::to_string_pretty(&data).unwrap_or_default()
                        };

                        let resp = json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [
                                    { "type": "text", "text": text_val }
                                ]
                            }
                        });
                        send_frame(&resp);
                    }
                    Err(e) => {
                        let resp = json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [
                                    { "type": "text", "text": format!("Error: {}", e) }
                                ],
                                "isError": true
                            }
                        });
                        send_frame(&resp);
                    }
                }
            }
            _ => {
                if id.is_some() {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32601,
                            "message": "Method not found"
                        }
                    });
                    send_frame(&resp);
                }
            }
        }
    }

    Ok(())
}

fn send_frame(val: &Value) {
    let mut stdout = io::stdout().lock();
    if let Ok(mut json_str) = serde_json::to_string(val) {
        json_str.push('\n');
        let _ = stdout.write_all(json_str.as_bytes());
        let _ = stdout.flush();
    }
}

