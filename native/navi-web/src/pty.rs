use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Deserialize)]
struct PtyResizeMsg {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        if let Ok(pwsh) = std::env::var("COMSPEC") {
            pwsh
        } else {
            "cmd.exe".to_string()
        }
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

pub async fn handle_pty_ws(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(run_pty_session)
}

async fn run_pty_session(socket: WebSocket) {
    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[navi-web-pty] Failed to open PTY: {}", e);
            return;
        }
    };

    let shell = get_default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[navi-web-pty] Failed to spawn shell '{}': {}", shell, e);
            return;
        }
    };

    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[navi-web-pty] Failed to clone reader: {}", e);
            return;
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(w) => Arc::new(Mutex::new(w)),
        Err(e) => {
            eprintln!("[navi-web-pty] Failed to take writer: {}", e);
            return;
        }
    };

    let master_resizer = Arc::new(Mutex::new(pair.master));

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx_out, mut rx_out) = mpsc::channel::<Vec<u8>>(128);

    // Background thread reading PTY output
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx_out.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Task forwarding PTY output -> WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(bytes) = rx_out.recv().await {
            if ws_sender.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
    });

    // Task receiving WebSocket -> PTY input
    let writer_clone = writer.clone();
    let resizer_clone = master_resizer.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Check if JSON resize message
                    if text.starts_with('{') {
                        if let Ok(resize) = serde_json::from_str::<PtyResizeMsg>(&text) {
                            if resize.msg_type.as_deref() == Some("resize") {
                                if let (Some(cols), Some(rows)) = (resize.cols, resize.rows) {
                                    if let Ok(master) = resizer_clone.lock() {
                                        let _ = master.resize(PtySize {
                                            rows,
                                            cols,
                                            pixel_width: 0,
                                            pixel_height: 0,
                                        });
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    if let Ok(mut w) = writer_clone.lock() {
                        let _ = w.write_all(text.as_bytes());
                        let _ = w.flush();
                    }
                }
                Message::Binary(bin) => {
                    if let Ok(mut w) = writer_clone.lock() {
                        let _ = w.write_all(&bin);
                        let _ = w.flush();
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    let _ = child.kill();
    let _ = child.wait();
}

