// Lawicel SLCAN 串口握手与经典 CAN 报文。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::to_err;
use super::debug_serial::{transfer, DebugSerialState};
use super::protocol::slcan::{acknowledged, encode_frame, valid_version};
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct CanFrame {
    pub(crate) id: u32,
    pub(crate) extended: bool,
    pub(crate) data: Vec<u8>,
}

fn command(
    port: &mut dyn serialport::SerialPort,
    instruction: &str,
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    transfer(port, format!("{instruction}\r").as_bytes(), timeout_ms)
}

#[tauri::command]
pub fn slcan_initialize(state: State<DebugSerialState>, bitrate: String) -> Result<(), String> {
    if !matches!(
        bitrate.as_str(),
        "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8"
    ) {
        return Err("CAN 总线速率代码无效".into());
    }
    let mut guard = state.lock().map_err(to_err)?;
    let port = guard.as_mut().ok_or("调试串口尚未连接")?;
    transfer(port.as_mut(), b"\r\r", 150)?;
    let version = command(port.as_mut(), "V", 300)?;
    if !valid_version(&version) {
        return Err("未收到 SLCAN 版本响应；请确认适配器支持 Lawicel ASCII 协议".into());
    }
    let _ = command(port.as_mut(), "C", 150)?;
    acknowledged(&command(port.as_mut(), &bitrate, 300)?, "设置总线速率")?;
    acknowledged(&command(port.as_mut(), "O", 300)?, "开启 CAN 通道")
}

#[tauri::command]
pub fn slcan_close(state: State<DebugSerialState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    let port = guard.as_mut().ok_or("调试串口尚未连接")?;
    acknowledged(&command(port.as_mut(), "C", 150)?, "关闭 CAN 通道")
}

#[tauri::command]
pub fn slcan_send_frame(
    state: State<DebugSerialState>,
    frame: CanFrame,
) -> Result<Vec<u8>, String> {
    let encoded = encode_frame(&frame)?;
    let mut guard = state.lock().map_err(to_err)?;
    let port = guard.as_mut().ok_or("调试串口尚未连接")?;
    let response = command(port.as_mut(), &encoded, 350)?;
    acknowledged(&response, "发送 CAN 帧")?;
    Ok(response)
}

#[tauri::command]
pub fn slcan_receive(state: State<DebugSerialState>) -> Result<Vec<u8>, String> {
    let mut guard = state.lock().map_err(to_err)?;
    let port = guard.as_mut().ok_or("调试串口尚未连接")?;
    transfer(port.as_mut(), &[], 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_standard_and_extended_frames() {
        assert_eq!(
            encode_frame(&CanFrame {
                id: 0x123,
                extended: false,
                data: vec![0xAB, 0xCD]
            })
            .unwrap(),
            "t1232ABCD"
        );
        assert_eq!(
            encode_frame(&CanFrame {
                id: 0x1ABCDE,
                extended: true,
                data: vec![]
            })
            .unwrap(),
            "T001ABCDE0"
        );
    }

    #[test]
    fn rejects_invalid_ack_and_version() {
        assert!(acknowledged(b"\r", "开启").is_ok());
        assert!(acknowledged(b"\x07", "开启").is_err());
        assert!(acknowledged(b"V1234\r", "开启").is_err());
        assert!(valid_version(b"V1234\r"));
        assert!(!valid_version(b"V12G4\r"));
    }
}
