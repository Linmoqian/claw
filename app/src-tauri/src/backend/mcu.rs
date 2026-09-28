// MCU 串口通信。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::to_err;
use super::debug_serial::{DebugSerialState, SERIAL_OPEN_LOCK};
use super::servo::DeviceState;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

pub type McuState = Mutex<Option<McuSession>>;

// —— 通用 MCU 串口桥 ——
// 独立于 Feetech DeviceState。外部 MCU 固件按 JSON 行协议应答；
// 该通道只负责字节流，不解释引脚电气能力。

pub struct McuSession {
    port: Box<dyn serialport::SerialPort>,
    partial: Vec<u8>,
}

fn open_mcu_port(port_name: &str, baud: u32) -> Result<McuSession, String> {
    let port = serialport::new(port_name, baud)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(to_err)?;
    Ok(McuSession {
        port,
        partial: Vec::new(),
    })
}

fn read_mcu_line(session: &mut McuSession, timeout_ms: u64) -> Result<String, String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Some(index) = session.partial.iter().position(|byte| *byte == b'\n') {
            let line = session.partial.drain(..=index).collect::<Vec<u8>>();
            let text = String::from_utf8_lossy(&line).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err("MCU 串口读取超时".into());
        }
        let mut buffer = [0_u8; 128];
        let timeout = deadline.saturating_duration_since(std::time::Instant::now());
        session
            .port
            .set_timeout(timeout.max(Duration::from_millis(1)))
            .map_err(to_err)?;
        match session.port.read(&mut buffer) {
            Ok(count) if count > 0 => session.partial.extend_from_slice(&buffer[..count]),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn mcu_serial_open(
    state: State<McuState>,
    debug: State<DebugSerialState>,
    servo: State<DeviceState>,
    port: String,
    baud: u32,
) -> Result<String, String> {
    let _opening = SERIAL_OPEN_LOCK.lock().map_err(to_err)?;
    if debug.lock().map_err(to_err)?.is_some() || servo.lock().map_err(to_err)?.is_some() {
        return Err("已有其他串口会话，请先断开".into());
    }
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("MCU 串口已连接，请先断开".into());
    }
    *guard = Some(open_mcu_port(&port, baud)?);
    Ok(port)
}

#[tauri::command]
pub fn mcu_serial_close(state: State<McuState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if let Some(mut session) = guard.take() {
        let _ = session.port.write_all(b"\n");
        let _ = session.port.flush();
    }
    Ok(())
}

#[tauri::command]
pub fn mcu_serial_is_open(state: State<McuState>) -> bool {
    state.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn mcu_serial_send(state: State<McuState>, payload: String) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    let session = guard.as_mut().ok_or("MCU 串口尚未打开")?;
    session
        .port
        .write_all(payload.as_bytes())
        .and_then(|_| session.port.flush())
        .map_err(to_err)
}

#[tauri::command]
pub fn mcu_serial_read_line(state: State<McuState>, timeout_ms: u64) -> Result<String, String> {
    let mut guard = state.lock().map_err(to_err)?;
    let session = guard.as_mut().ok_or("MCU 串口尚未打开")?;
    read_mcu_line(session, timeout_ms)
}
