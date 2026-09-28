// 原始串口通信与会话互斥。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::to_err;
use super::mcu::McuState;
use super::servo::DeviceState;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

pub type DebugSerialState = Mutex<Option<Box<dyn serialport::SerialPort>>>;
pub static SERIAL_OPEN_LOCK: Mutex<()> = Mutex::new(());

// —— 单电机通用串口调试 ——
// 原始字节收发不解释设备协议；SLCAN 握手与 CAN 报文由 slcan.rs 负责。

#[tauri::command]
pub fn debug_serial_open(
    state: State<DebugSerialState>,
    servo: State<DeviceState>,
    mcu: State<McuState>,
    port: String,
    baud: u32,
    data_bits: u8,
    parity: String,
    stop_bits: u8,
) -> Result<String, String> {
    let _opening = SERIAL_OPEN_LOCK.lock().map_err(to_err)?;
    if port.trim().is_empty() || baud == 0 {
        return Err("请选择串口并填写有效波特率".into());
    }
    if servo.lock().map_err(to_err)?.is_some() || mcu.lock().map_err(to_err)?.is_some() {
        return Err("已有其他串口会话，请先断开".into());
    }
    let bits = match data_bits {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        8 => serialport::DataBits::Eight,
        _ => return Err("数据位只支持 5、6、7、8".into()),
    };
    let parity = match parity.as_str() {
        "none" => serialport::Parity::None,
        "even" => serialport::Parity::Even,
        "odd" => serialport::Parity::Odd,
        _ => return Err("校验位只支持无、偶、奇".into()),
    };
    let stops = match stop_bits {
        1 => serialport::StopBits::One,
        2 => serialport::StopBits::Two,
        _ => return Err("停止位只支持 1 或 2".into()),
    };
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("调试串口已连接，请先断开".into());
    }
    let serial = serialport::new(port.as_str(), baud)
        .data_bits(bits)
        .parity(parity)
        .stop_bits(stops)
        .timeout(Duration::from_millis(30))
        .open()
        .map_err(to_err)?;
    *guard = Some(serial);
    Ok(port)
}

#[tauri::command]
pub fn debug_serial_close(state: State<DebugSerialState>) -> Result<(), String> {
    *state.lock().map_err(to_err)? = None;
    Ok(())
}

#[tauri::command]
pub fn debug_serial_transfer(
    state: State<DebugSerialState>,
    tx: Vec<u8>,
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    if tx.len() > 512 || !(20..=2000).contains(&timeout_ms) {
        return Err("报文最多 512 字节，等待时间须在 20–2000 ms".into());
    }
    let mut guard = state.lock().map_err(to_err)?;
    let serial = guard.as_mut().ok_or("调试串口尚未连接")?;
    transfer(serial.as_mut(), &tx, timeout_ms)
}

pub(crate) fn transfer(
    serial: &mut dyn serialport::SerialPort,
    tx: &[u8],
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    if !tx.is_empty() {
        serial
            .write_all(tx)
            .and_then(|_| serial.flush())
            .map_err(to_err)?;
    }
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    let mut last_rx = None;
    let mut rx = Vec::new();
    let mut buffer = [0_u8; 128];
    loop {
        let now = std::time::Instant::now();
        if now >= deadline
            || last_rx.is_some_and(|last: std::time::Instant| {
                now.duration_since(last) >= Duration::from_millis(30)
            })
        {
            break;
        }
        serial
            .set_timeout(
                deadline
                    .saturating_duration_since(now)
                    .min(Duration::from_millis(30))
                    .max(Duration::from_millis(1)),
            )
            .map_err(to_err)?;
        match serial.read(&mut buffer) {
            Ok(count) if count > 0 => {
                rx.extend_from_slice(&buffer[..count]);
                last_rx = Some(std::time::Instant::now());
                if rx.len() >= 2048 {
                    rx.truncate(2048);
                    break;
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(rx)
}
