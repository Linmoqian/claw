// 桌面 WebSocket 传输与会话清理。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

enum Outbound {
    Text(String),
    Close,
}

struct Session {
    sender: mpsc::Sender<Outbound>,
    cancelled: Arc<AtomicBool>,
    last_command_sequence: AtomicU64,
}

pub struct WebSocketManager {
    next_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<u64, Session>>>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketEvent {
    kind: &'static str,
    text: Option<String>,
    code: Option<u16>,
    reason: Option<String>,
    message: Option<String>,
}

impl WebSocketEvent {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            text: None,
            code: None,
            reason: None,
            message: None,
        }
    }
}

// 只把传输事件送回 UI；重连、心跳和业务协议仍由同一个 ConnectionManager 处理。
#[tauri::command]
pub fn websocket_open(
    state: State<WebSocketManager>,
    url: String,
    channel: Channel<WebSocketEvent>,
) -> Result<u64, String> {
    if url.len() > 2048 || !(url.starts_with("ws://") || url.starts_with("wss://")) {
        return Err("WebSocket 地址须以 ws:// 或 wss:// 开头且不超过 2048 字符".into());
    }
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (sender, mut receiver) = mpsc::channel(64);
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            id,
            Session {
                sender,
                cancelled: cancelled.clone(),
                last_command_sequence: AtomicU64::new(0),
            },
        );
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async(url),
        )
        .await;
        match outcome {
            Ok(Ok((socket, _))) if !cancelled.load(Ordering::Acquire) => {
                let _ = channel.send(WebSocketEvent::new("open"));
                let (mut writer, mut reader) = socket.split();
                loop {
                    if cancelled.load(Ordering::Acquire) {
                        let _ = writer.close().await;
                        break;
                    }
                    tokio::select! {
                        outgoing = receiver.recv() => match outgoing {
                            Some(Outbound::Text(text)) => {
                                if let Err(error) = writer.send(Message::Text(text.into())).await {
                                    let mut event = WebSocketEvent::new("error");
                                    event.message = Some(error.to_string());
                                    let _ = channel.send(event);
                                    break;
                                }
                            }
                            Some(Outbound::Close) | None => {
                                let _ = writer.close().await;
                                break;
                            }
                        },
                        incoming = reader.next() => match incoming {
                            Some(Ok(Message::Text(text))) => {
                                let mut event = WebSocketEvent::new("message");
                                event.text = Some(text.to_string());
                                if channel.send(event).is_err() { break; }
                            }
                            Some(Ok(Message::Close(frame))) => {
                                let mut event = WebSocketEvent::new("close");
                                if let Some(frame) = frame {
                                    event.code = Some(frame.code.into());
                                    event.reason = Some(frame.reason.to_string());
                                }
                                let _ = channel.send(event);
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(error)) => {
                                let mut event = WebSocketEvent::new("error");
                                event.message = Some(error.to_string());
                                let _ = channel.send(event);
                                break;
                            }
                            None => break,
                        }
                    }
                }
            }
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                let mut event = WebSocketEvent::new("error");
                event.message = Some(error.to_string());
                let _ = channel.send(event);
            }
            Err(_) => {
                let mut event = WebSocketEvent::new("error");
                event.message = Some("WebSocket 连接超时".into());
                let _ = channel.send(event);
            }
        }
        if let Ok(mut guard) = sessions.lock() {
            guard.remove(&id);
        }
        if !cancelled.load(Ordering::Acquire) {
            let _ = channel.send(WebSocketEvent::new("closed"));
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn websocket_send(state: State<WebSocketManager>, id: u64, text: String) -> Result<(), String> {
    if text.len() > 1024 * 1024 {
        return Err("WebSocket 消息超过 1 MiB".into());
    }
    let guard = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = guard.get(&id).ok_or("WebSocket 已断开")?;
    if session.cancelled.load(Ordering::Acquire) {
        return Err("WebSocket 已断开".into());
    }
    let command_sequence = check_command_sequence(&text, &session.last_command_sequence)?;
    session
        .sender
        .try_send(Outbound::Text(text))
        .map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => {
                String::from("WebSocket 发送队列已满，请稍后重试")
            }
            mpsc::error::TrySendError::Closed(_) => String::from("WebSocket 已断开"),
        })?;
    if let Some(sequence) = command_sequence {
        session
            .last_command_sequence
            .store(sequence, Ordering::Release);
    }
    Ok(())
}

fn check_command_sequence(text: &str, last_sequence: &AtomicU64) -> Result<Option<u64>, String> {
    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) {
        if payload.get("type").and_then(|value| value.as_str()) == Some("command") {
            let sequence = payload
                .get("sequence")
                .and_then(|value| value.as_u64())
                .ok_or("控制命令缺少有效序号")?;
            let previous = last_sequence.load(Ordering::Acquire);
            if sequence <= previous {
                return Err("控制命令序号已过期".into());
            }
            return Ok(Some(sequence));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn websocket_close(state: State<WebSocketManager>, id: u64) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id)
    {
        session.cancelled.store(true, Ordering::Release);
        let _ = session.sender.try_send(Outbound::Close);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_stale_control_after_a_newer_command() {
        let sequence = AtomicU64::new(0);
        let first =
            check_command_sequence(r#"{"type":"command","sequence":2}"#, &sequence).unwrap();
        sequence.store(first.unwrap(), Ordering::Release);
        assert!(check_command_sequence(r#"{"type":"command","sequence":1}"#, &sequence).is_err());
        assert!(check_command_sequence(r#"{"type":"command","sequence":2}"#, &sequence).is_err());
        assert_eq!(
            check_command_sequence(r#"{"type":"ping","sequence":99}"#, &sequence).unwrap(),
            None
        );
        assert_eq!(
            check_command_sequence(r#"{"type":"command","sequence":3}"#, &sequence).unwrap(),
            Some(3)
        );
    }
}
