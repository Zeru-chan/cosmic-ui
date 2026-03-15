use std::sync::Arc;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_tungstenite::accept_async;

pub const CONSOLE_PORT: u16 = 21576;

#[derive(Deserialize)]
struct ConsoleMessage {
    level: Option<String>,
    message: Option<String>,
}

pub struct ConsoleBridge {
    running: Arc<RwLock<bool>>,
}

impl ConsoleBridge {
    pub fn new() -> Self {
        Self {
            running: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn start(&self, app: AppHandle) -> Result<(), String> {
        if *self.running.read().await {
            return Ok(());
        }

        *self.running.write().await = true;

        let running = self.running.clone();

        tokio::spawn(async move {
            let addr = format!("127.0.0.1:{}", CONSOLE_PORT);
            let listener = match TcpListener::bind(&addr).await {
                Ok(listener) => listener,
                Err(err) => {
                    eprintln!("[Console] Failed to bind {}: {}", addr, err);
                    *running.write().await = false;
                    return;
                }
            };

            loop {
                if !*running.read().await {
                    break;
                }

                let accept_result = tokio::select! {
                    result = listener.accept() => Some(result),
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => None,
                };

                let Some(Ok((stream, _))) = accept_result else {
                    continue;
                };

                let ws_stream = match accept_async(stream).await {
                    Ok(ws_stream) => ws_stream,
                    Err(err) => {
                        eprintln!("[Console] WebSocket handshake failed: {}", err);
                        continue;
                    }
                };

                let app_handle = app.clone();
                tokio::spawn(async move {
                    let (_, mut read) = ws_stream.split();

                    while let Some(message) = read.next().await {
                        match message {
                            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                                if let Ok(payload) = serde_json::from_str::<ConsoleMessage>(&text) {
                                    let _ = app_handle.emit(
                                        "console-log",
                                        serde_json::json!({
                                            "level": payload.level.unwrap_or_else(|| "info".to_string()),
                                            "message": payload.message.unwrap_or_default(),
                                        }),
                                    );
                                }
                            }
                            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
                            Err(err) => {
                                eprintln!("[Console] Read error: {}", err);
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }
        });

        Ok(())
    }
}
