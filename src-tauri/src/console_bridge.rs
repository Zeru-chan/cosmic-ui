use std::sync::Arc;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::accept_async;

pub const CONSOLE_PORT: u16 = 32578;

#[derive(Deserialize)]
struct ConsoleMessage {
    level: Option<String>,
    message: Option<String>,
}

pub struct ConsoleBridge {
    running: Arc<RwLock<bool>>,
    startup_lock: Arc<Mutex<()>>,
}

impl ConsoleBridge {
    pub fn new() -> Self {
        Self {
            running: Arc::new(RwLock::new(false)),
            startup_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn start(&self, app: AppHandle) -> Result<u16, String> {
        if *self.running.read().await {
            return Ok(CONSOLE_PORT);
        }

        let _guard = self.startup_lock.lock().await;

        if *self.running.read().await {
            return Ok(CONSOLE_PORT);
        }

        let listener = TcpListener::bind(("127.0.0.1", CONSOLE_PORT))
            .await
            .map_err(|err| format!("Failed to bind console bridge: {}", err))?;

        *self.running.write().await = true;

        let running = self.running.clone();

        tokio::spawn(async move {
            loop {
                let accept_result = listener.accept().await;

                let (stream, _) = match accept_result {
                    Ok(connection) => connection,
                    Err(err) => {
                        eprintln!("[Console] Accept error: {}", err);
                        break;
                    }
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

            *running.write().await = false;
        });

        Ok(CONSOLE_PORT)
    }

    pub async fn port(&self) -> Option<u16> {
        if *self.running.read().await {
            Some(CONSOLE_PORT)
        } else {
            None
        }
    }
}
