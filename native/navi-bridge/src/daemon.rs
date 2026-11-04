use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::accept_hdr_async;
use uuid::Uuid;

use crate::auth::tokens_match;
use crate::protocol::*;

type Sender = mpsc::UnboundedSender<Message>;

struct ExtensionClient {
    tx: Sender,
    #[allow(dead_code)]
    version: String,
}

#[derive(Default)]
struct DaemonState {
    extensions: HashMap<usize, ExtensionClient>,
    active_ext: Option<usize>,
    pending_requests: HashMap<String, oneshot::Sender<ToolResultPayload>>,
    next_id: usize,
}

pub struct BridgeDaemon {
    port: u16,
    token: String,
    state: Arc<RwLock<DaemonState>>,
}

impl BridgeDaemon {
    pub fn new(port: u16, token: String) -> Self {
        Self {
            port,
            token,
            state: Arc::new(RwLock::new(DaemonState::default())),
        }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let addr: SocketAddr = format!("127.0.0.1:{}", self.port).parse()?;
        let listener = TcpListener::bind(addr).await?;
        eprintln!("🚀 NaviBridge Local Daemon running on http://127.0.0.1:{}", self.port);
        eprintln!("🔑 Auth Token: {}", self.token);

        loop {
            let (stream, peer) = match listener.accept().await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("[daemon] Accept error: {}", e);
                    continue;
                }
            };

            let state = self.state.clone();
            let token = self.token.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_raw_connection(stream, peer, state, token).await {
                    let err_str = e.to_string();
                    if !err_str.contains("Broken pipe") && !err_str.contains("connection reset") {
                        eprintln!("[daemon] Connection handling error for {}: {}", peer, e);
                    }
                }
            });
        }
    }
}

async fn handle_raw_connection(
    mut stream: TcpStream,
    peer: SocketAddr,
    state: Arc<RwLock<DaemonState>>,
    token: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut peek_buf = [0u8; 1024];
    let n = stream.peek(&mut peek_buf).await?;
    let header_str = String::from_utf8_lossy(&peek_buf[..n]);

    let is_ws = header_str.to_ascii_lowercase().contains("upgrade: websocket");

    if !is_ws {
        // Plain HTTP handler
        let mut req_buf = vec![0u8; 65536];
        let bytes_read = stream.read(&mut req_buf).await?;
        let req_text = String::from_utf8_lossy(&req_buf[..bytes_read]);

        if req_text.starts_with("OPTIONS ") {
            let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n";
            stream.write_all(resp.as_bytes()).await?;
            stream.flush().await?;
            return Ok(());
        }

        // GET /status or GET /
        if req_text.starts_with("GET /status") || req_text.starts_with("GET / ") {
            let (is_connected, ext_count) = {
                let st = state.read().await;
                (st.active_ext.is_some(), st.extensions.len())
            };
            let body = serde_json::json!({
                "ok": true,
                "service": "NaviBridge Local Daemon (Rust)",
                "connected": is_connected,
                "clientsCount": ext_count,
                "token": token,
                "wsEndpoint": "ws://127.0.0.1:10086/ws"
            })
            .to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(resp.as_bytes()).await?;
            stream.flush().await?;
            return Ok(());
        }

        // GET /v1/models (OpenAI-compatible)
        if req_text.starts_with("GET /v1/models") {
            let body = serde_json::json!({
                "object": "list",
                "data": [
                    { "id": "claude", "object": "model", "owned_by": "NaviBridge" },
                    { "id": "chatgpt", "object": "model", "owned_by": "NaviBridge" },
                    { "id": "deepseek", "object": "model", "owned_by": "NaviBridge" },
                    { "id": "gemini", "object": "model", "owned_by": "NaviBridge" },
                    { "id": "grok", "object": "model", "owned_by": "NaviBridge" },
                    { "id": "perplexity", "object": "model", "owned_by": "NaviBridge" }
                ]
            }).to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(resp.as_bytes()).await?;
            stream.flush().await?;
            return Ok(());
        }

        // POST /v1/chat/completions (OpenAI-compatible endpoint)
        if req_text.starts_with("POST /v1/chat/completions") {
            let body_start = req_text.find("\r\n\r\n").map(|p| p + 4).unwrap_or(bytes_read);
            let body_str = &req_text[body_start..];
            let parsed_json: serde_json::Value = serde_json::from_str(body_str).unwrap_or(serde_json::Value::Null);

            let model_raw = parsed_json.get("model").and_then(|m| m.as_str()).unwrap_or("chatgpt");
            let provider = model_raw.replace("bridge/", "").replace("-web", "");

            // Extract prompt from messages array
            let mut prompt = String::new();
            if let Some(msgs) = parsed_json.get("messages").and_then(|m| m.as_array()) {
                for m in msgs {
                    let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
                    let content = if let Some(s) = m.get("content").and_then(|c| c.as_str()) {
                        s.to_string()
                    } else if let Some(arr) = m.get("content").and_then(|c| c.as_array()) {
                        arr.iter().filter_map(|part| part.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join(" ")
                    } else {
                        String::new()
                    };

                    if role == "user" {
                        prompt = content;
                    }
                }
            }
            if prompt.is_empty() {
                prompt = parsed_json.get("prompt").and_then(|p| p.as_str()).unwrap_or("").to_string();
            }

            // Route query to extension
            let ext_tx = {
                let st = state.read().await;
                st.active_ext.and_then(|id| st.extensions.get(&id).map(|ext| ext.tx.clone()))
            };

            let req_id = Uuid::new_v4().to_string();
            let (resp_tx, resp_rx) = oneshot::channel();
            {
                let mut st = state.write().await;
                st.pending_requests.insert(req_id.clone(), resp_tx);
            }

            let text_result = match ext_tx {
                Some(tx) => {
                    let call = BridgeMessage::ToolCall {
                        request_id: req_id.clone(),
                        payload: ToolCallPayload {
                            name: "ask".into(),
                            args: serde_json::json!({
                                "prompt": prompt,
                                "provider": provider,
                                "timeoutMs": 90000
                            }),
                        },
                    };
                    let _ = tx.send(Message::Text(serde_json::to_string(&call).unwrap_or_default()));
                    match tokio::time::timeout(Duration::from_secs(95), resp_rx).await {
                        Ok(Ok(payload)) => {
                            if let Some(data) = payload.data {
                                if let Some(txt) = data.get("text").and_then(|t| t.as_str()) {
                                    txt.to_string()
                                } else if let Some(s) = data.as_str() {
                                    s.to_string()
                                } else {
                                    data.to_string()
                                }
                            } else {
                                payload.error.unwrap_or_else(|| "unknown-error".into())
                            }
                        }
                        _ => "Relay timeout waiting for browser AI response".to_string(),
                    }
                }
                None => "NaviBridge Chrome Extension is not connected. Open Chrome and link NaviBridge.".to_string(),
            };

            let response_body = serde_json::json!({
                "id": format!("chatcmpl-{}", Uuid::new_v4()),
                "object": "chat.completion",
                "created": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
                "model": model_raw,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": text_result
                        },
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }
            }).to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(resp.as_bytes()).await?;
            stream.flush().await?;
            return Ok(());
        }

        let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot-found";
        stream.write_all(resp.as_bytes()).await?;
        stream.flush().await?;
        return Ok(());
    }

    // Origin Check for WebSocket
    let mut origin_ok = true;
    let mut is_chrome_ext = false;
    let ws_stream = accept_hdr_async(stream, |req: &Request, resp: Response| {
        if let Some(origin_val) = req.headers().get("origin") {
            if let Ok(orig) = origin_val.to_str() {
                let trusted = orig.starts_with("chrome-extension://")
                    || orig.starts_with("http://localhost")
                    || orig.starts_with("http://127.0.0.1");
                if !trusted {
                    origin_ok = false;
                }
                if orig.starts_with("chrome-extension://") {
                    is_chrome_ext = true;
                }
            }
        }
        Ok(resp)
    })
    .await?;

    if !origin_ok {
        return Ok(());
    }

    let (mut ws_sink, mut ws_stream) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Forward outgoing messages to ws_sink
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = false;
    let mut client_id: Option<usize> = None;

    // Await hello handshake within 10 seconds
    let hello_timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(hello_timeout);

    while let Some(msg_result) = tokio::select! {
        res = ws_stream.next() => res,
        _ = &mut hello_timeout, if !authenticated => {
            eprintln!("[daemon] Handshake timed out for peer {}", peer);
            let _ = tx.send(Message::Text(serde_json::to_string(&BridgeMessage::Error { error: "auth-timeout".into() })?));
            return Ok(());
        }
    } {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => break,
        };

        if msg.is_ping() {
            let _ = tx.send(Message::Pong(vec![]));
            continue;
        }

        if let Message::Text(text) = msg {
            let parsed: BridgeMessage = match serde_json::from_str(&text) {
                Ok(p) => p,
                Err(_) => continue,
            };

            match parsed {
                BridgeMessage::Hello { token: t1, payload } => {
                    let incoming_token = t1.or_else(|| payload.as_ref().and_then(|p| p.token.clone())).unwrap_or_default();
                    let token_matches = tokens_match(&incoming_token, &token);

                    // Extension from trusted chrome-extension:// origin is accepted automatically
                    if !token_matches && !is_chrome_ext {
                        eprintln!("[daemon] Auth rejected: received token '{}' (len {}) vs expected '{}' (len {}) from {}", incoming_token, incoming_token.len(), token, token.len(), peer);
                        let err_msg = serde_json::to_string(&BridgeMessage::Error { error: "bad-token".into() })?;
                        let _ = tx.send(Message::Text(err_msg));
                        return Ok(());
                    }

                    authenticated = true;
                    let is_cli = payload.as_ref().and_then(|p| p.client.as_deref()) == Some("cli");
                    let ext_ver = payload.as_ref().and_then(|p| p.extension_version.clone()).unwrap_or_else(|| "unknown".into());

                    // Send HelloAck including the token so client can cache it
                    let hello_ack = serde_json::json!({
                        "type": "hello_ack",
                        "token": token
                    });
                    let _ = tx.send(Message::Text(hello_ack.to_string()));

                    if !is_cli {
                        let mut st = state.write().await;
                        let id = st.next_id;
                        st.next_id += 1;
                        st.extensions.insert(id, ExtensionClient { tx: tx.clone(), version: ext_ver.clone() });
                        st.active_ext = Some(id);
                        client_id = Some(id);
                        eprintln!("[daemon] Chrome Extension authenticated (v{}, id: {})", ext_ver, id);
                    } else {
                        eprintln!("[daemon] CLI client authenticated from {}", peer);
                    }
                }
                BridgeMessage::ToolCall { request_id, payload } => {
                    if !authenticated {
                        continue;
                    }

                    // Forward tool call to active extension
                    let ext_tx = {
                        let st = state.read().await;
                        st.active_ext.and_then(|id| st.extensions.get(&id).map(|ext| ext.tx.clone()))
                    };

                    match ext_tx {
                        Some(target_tx) => {
                            let (resp_tx, resp_rx) = oneshot::channel();
                            {
                                let mut st = state.write().await;
                                st.pending_requests.insert(request_id.clone(), resp_tx);
                            }

                            let forward_msg = serde_json::to_string(&BridgeMessage::ToolCall {
                                request_id: request_id.clone(),
                                payload,
                            })?;
                            let _ = target_tx.send(Message::Text(forward_msg));

                            let cli_tx = tx.clone();
                            tokio::spawn(async move {
                                let result = match tokio::time::timeout(Duration::from_secs(120), resp_rx).await {
                                    Ok(Ok(data)) => data,
                                    Ok(Err(_)) => ToolResultPayload { data: None, error: Some("relay_cancelled".into()) },
                                    Err(_) => ToolResultPayload { data: None, error: Some("relay_timeout".into()) },
                                };
                                let reply_msg = serde_json::to_string(&BridgeMessage::ToolResult {
                                    response_to_request_id: request_id,
                                    payload: result,
                                }).unwrap_or_default();
                                let _ = cli_tx.send(Message::Text(reply_msg));
                            });
                        }
                        None => {
                            let reply = serde_json::to_string(&BridgeMessage::ToolResult {
                                response_to_request_id: request_id,
                                payload: ToolResultPayload {
                                    data: None,
                                    error: Some("extension_not_connected".into()),
                                },
                            })?;
                            let _ = tx.send(Message::Text(reply));
                        }
                    }
                }
                BridgeMessage::ToolResult { response_to_request_id, payload } => {
                    if !authenticated {
                        continue;
                    }
                    let mut st = state.write().await;
                    if let Some(sender) = st.pending_requests.remove(&response_to_request_id) {
                        let _ = sender.send(payload);
                    }
                }
                BridgeMessage::Ping => {
                    let _ = tx.send(Message::Text(serde_json::to_string(&BridgeMessage::Pong)?));
                }
                BridgeMessage::Pong | BridgeMessage::HelloAck | BridgeMessage::Error { .. } => {}
            }
        }
    }

    // Teardown on disconnect
    if let Some(id) = client_id {
        let mut st = state.write().await;
        st.extensions.remove(&id);
        if st.active_ext == Some(id) {
            st.active_ext = st.extensions.keys().copied().next();
        }
        eprintln!("[daemon] Client {} disconnected (remaining extensions: {})", id, st.extensions.len());
    }

    Ok(())
}
