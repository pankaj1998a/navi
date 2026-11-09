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

const PTY_OUTPUT_CHUNK_BYTES: usize = 4096;
const PTY_OUTPUT_BUFFER_BYTES: usize = 512 * 1024;
const PTY_OUTPUT_CHANNEL_CAPACITY: usize = PTY_OUTPUT_BUFFER_BYTES / PTY_OUTPUT_CHUNK_BYTES;

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

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx_out, mut rx_out) = mpsc::channel::<Vec<u8>>(PTY_OUTPUT_CHANNEL_CAPACITY);

    // Background thread reading PTY output
    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; PTY_OUTPUT_CHUNK_BYTES];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx_out.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("[navi-web-pty] Failed to read PTY output: {error}");
                    break;
                }
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
                                    let Ok(master) = resizer_clone.lock() else {
                                        eprintln!("[navi-web-pty] PTY resize lock was poisoned");
                                        break;
                                    };
                                    if let Err(error) = master.resize(PtySize {
                                        rows,
                                        cols,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    }) {
                                        eprintln!("[navi-web-pty] Failed to resize PTY: {error}");
                                        break;
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    let Ok(mut w) = writer_clone.lock() else {
                        eprintln!("[navi-web-pty] PTY writer lock was poisoned");
                        break;
                    };
                    if let Err(error) = w.write_all(text.as_bytes()).and_then(|()| w.flush()) {
                        eprintln!("[navi-web-pty] Failed to write to PTY: {error}");
                        break;
                    }
                }
                Message::Binary(bin) => {
                    let Ok(mut w) = writer_clone.lock() else {
                        eprintln!("[navi-web-pty] PTY writer lock was poisoned");
                        break;
                    };
                    if let Err(error) = w.write_all(&bin).and_then(|()| w.flush()) {
                        eprintln!("[navi-web-pty] Failed to write to PTY: {error}");
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => {},
        _ = (&mut recv_task) => {},
    };

    send_task.abort();
    recv_task.abort();
    let _ = send_task.await;
    let _ = recv_task.await;

    let _ = child.kill();
    let _ = child.wait();
    drop(writer);
    drop(master_resizer);
    let mut join_task = tokio::task::spawn_blocking(move || {
        if reader_thread.join().is_err() {
            eprintln!("[navi-web-pty] PTY reader thread panicked");
        }
    });
    if tokio::time::timeout(std::time::Duration::from_millis(500), &mut join_task)
        .await
        .is_err()
    {
        join_task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::{PTY_OUTPUT_BUFFER_BYTES, PTY_OUTPUT_CHANNEL_CAPACITY, PTY_OUTPUT_CHUNK_BYTES};

    #[test]
    fn pty_output_channel_is_bounded_by_bytes() {
        assert_eq!(
            PTY_OUTPUT_CHUNK_BYTES * PTY_OUTPUT_CHANNEL_CAPACITY,
            PTY_OUTPUT_BUFFER_BYTES
        );
    }

    #[test]
    fn test_pty_spawn_resize_read_write_lifecycle() {
        use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
        use std::io::{Read, Write};

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        pair.master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize PTY");

        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut writer = pair.master.take_writer().expect("writer");

        let shell = super::get_default_shell();
        let cmd = CommandBuilder::new(&shell);
        let mut child = pair.slave.spawn_command(cmd).expect("spawn child");
        drop(pair.slave);

        if cfg!(target_os = "windows") {
            let _ = writer.write_all(b"echo PTY_TEST_PING\r\n");
        } else {
            let _ = writer.write_all(b"echo PTY_TEST_PING\n");
        }
        let _ = writer.flush();

        let mut output = Vec::new();
        let mut buf = [0u8; 1024];

        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(4) {
            if let Ok(n) = reader.read(&mut buf) {
                if n > 0 {
                    output.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&output);
                    if text.contains("PTY_TEST_PING") {
                        break;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let _ = child.kill();
        let _ = child.wait();

        let text = String::from_utf8_lossy(&output);
        assert!(
            text.contains("PTY_TEST_PING"),
            "Expected PTY output to contain PTY_TEST_PING, got: {}",
            text
        );
    }
}
