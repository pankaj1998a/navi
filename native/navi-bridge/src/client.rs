use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

use crate::protocol::*;

pub async fn check_daemon_status(port: u16) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let addr = format!("127.0.0.1:{}", port);
    let mut stream = TcpStream::connect(&addr).await.map_err(|e| format!("Bridge daemon not reachable: {}", e))?;

    let req = format!(
        "GET /status HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;

    let resp = String::from_utf8_lossy(&buf);
    if let Some(pos) = resp.find("\r\n\r\n") {
        let body = &resp[pos + 4..];
        let val: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("Invalid JSON from daemon: {}", e))?;
        return Ok(val);
    }

    Err("Invalid HTTP response from bridge daemon".into())
}

pub async fn call_bridge_tool(
    port: u16,
    token: &str,
    name: &str,
    args: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let ws_url = format!("ws://127.0.0.1:{}/ws", port);
    let (ws_stream, _) = connect_async(&ws_url).await.map_err(|e| {
        format!("Could not connect to bridge daemon at {}: {}. Run `navi bridge start` first.", ws_url, e)
    })?;

    let (mut sink, mut stream) = ws_stream.split();

    // Send Hello as CLI client
    let hello = BridgeMessage::Hello {
        token: Some(token.to_string()),
        payload: Some(HelloPayload {
            client: Some("cli".into()),
            extension_version: None,
            token: Some(token.to_string()),
        }),
    };
    sink.send(Message::Text(serde_json::to_string(&hello).map_err(|e| e.to_string())?))
        .await
        .map_err(|e| e.to_string())?;

    let req_id = Uuid::new_v4().to_string();

    let timeout = tokio::time::sleep(Duration::from_secs(timeout_secs));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            _ = &mut timeout => {
                return Err("Request to NaviBridge timed out".into());
            }
            msg = stream.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => return Err(format!("WS error: {}", e)),
                    None => return Err("Connection closed unexpectedly by bridge".into()),
                };

                if let Message::Text(text) = msg {
                    let parsed: BridgeMessage = match serde_json::from_str(&text) {
                        Ok(p) => p,
                        Err(_) => continue,
                    };

                    match parsed {
                        BridgeMessage::HelloAck => {
                            // Send ToolCall
                            let call = BridgeMessage::ToolCall {
                                request_id: req_id.clone(),
                                payload: ToolCallPayload {
                                    name: name.to_string(),
                                    args: args.clone(),
                                },
                            };
                            sink.send(Message::Text(serde_json::to_string(&call).map_err(|e| e.to_string())?))
                                .await
                                .map_err(|e| e.to_string())?;
                        }
                        BridgeMessage::Error { error } => {
                            return Err(format!("Bridge error: {}", error));
                        }
                        BridgeMessage::ToolResult { response_to_request_id, payload } => {
                            if response_to_request_id == req_id {
                                if let Some(err) = payload.error {
                                    return Err(format!("Tool execution error: {}", err));
                                }
                                return Ok(payload.data.unwrap_or(serde_json::Value::Null));
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}
