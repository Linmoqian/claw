// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// 设备通讯后端：基于 scservo-rs（独立 crate）封装 Feetech SCServo 协议，
// 通过 Tauri command 暴露给前端。状态（串口会话）用 Mutex 管理，由 Tauri State 共享。

use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

use scservo_rs::{
    ADDR_GOAL_POSITION, ADDR_PRESENT_POSITION, ADDR_TORQUE_ENABLE, Endian, GroupSyncRead,
    PacketHandler, PortHandler,
};

/// 一个已连接的设备会话。PortHandler 持有打开的串口；PacketHandler 是 Copy。
struct Session {
    port: PortHandler,
    ph: PacketHandler,
}

/// 全局设备状态。同一时刻至多一个会话（串口半双工，本就串行）。
#[derive(Default)]
struct DeviceState {
    session: Option<Session>,
}

/// 便利：把 Mutex PoisonError / 任意 Display 错误转成 String（Tauri command 错误类型）。
fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// —— 模板命令（保留，避免破坏前端既有调用） ——
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// —— 串口管理 ——

/// 列出系统可用串口名。对应前端 scanPorts。
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(to_err)?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

/// 打开串口并建立会话。baud 走 scservo-rs 白名单校验。
/// 返回端口名，前端可用作设备标识。
#[tauri::command]
fn serial_connect(
    state: State<'_, Mutex<DeviceState>>,
    port: String,
    baud: u32,
) -> Result<String, String> {
    let mut s = state.lock().map_err(to_err)?;
    if s.session.is_some() {
        return Err("设备已连接，请先断开".into());
    }
    let mut handler = PortHandler::new(&port);
    handler.set_baudrate(baud).map_err(to_err)?;
    handler.open().map_err(to_err)?;
    s.session = Some(Session {
        port: handler,
        ph: PacketHandler::new(Endian::Little),
    });
    Ok(port)
}

/// 关闭串口、释放会话。
#[tauri::command]
fn serial_disconnect(state: State<'_, Mutex<DeviceState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(to_err)?;
    // take() 后 Session drop，PortHandler 随之释放串口
    s.session.take();
    Ok(())
}

/// 当前是否有活动会话。
#[tauri::command]
fn serial_is_connected(state: State<'_, Mutex<DeviceState>>) -> bool {
    state
        .lock()
        .map(|s| s.session.is_some())
        .unwrap_or(false)
}

// —— 单点控制 ——

#[tauri::command]
fn servo_ping(state: State<'_, Mutex<DeviceState>>, id: u8) -> Result<u16, String> {
    let mut s = state.lock().map_err(to_err)?;
    let sess = s.session.as_mut().ok_or("设备未连接")?;
    let (model, _hw) = sess.ph.ping(&mut sess.port, id).map_err(to_err)?;
    Ok(model)
}

#[tauri::command]
fn servo_set_torque(
    state: State<'_, Mutex<DeviceState>>,
    id: u8,
    on: bool,
) -> Result<(), String> {
    let mut s = state.lock().map_err(to_err)?;
    let sess = s.session.as_mut().ok_or("设备未连接")?;
    let val: u8 = if on { 1 } else { 0 };
    sess.ph
        .write_1byte_tx_rx(&mut sess.port, id, ADDR_TORQUE_ENABLE, val)
        .map_err(to_err)?;
    Ok(())
}

#[tauri::command]
fn servo_read_position(
    state: State<'_, Mutex<DeviceState>>,
    id: u8,
) -> Result<u16, String> {
    let mut s = state.lock().map_err(to_err)?;
    let sess = s.session.as_mut().ok_or("设备未连接")?;
    let (pos, _hw) = sess
        .ph
        .read_2byte_tx_rx(&mut sess.port, id, ADDR_PRESENT_POSITION)
        .map_err(to_err)?;
    Ok(pos)
}

#[tauri::command]
fn servo_write_position(
    state: State<'_, Mutex<DeviceState>>,
    id: u8,
    position: u16,
) -> Result<(), String> {
    let mut s = state.lock().map_err(to_err)?;
    let sess = s.session.as_mut().ok_or("设备未连接")?;
    sess.ph
        .write_2byte_tx_rx(&mut sess.port, id, ADDR_GOAL_POSITION, position)
        .map_err(to_err)?;
    Ok(())
}

// —— 批量读取 ——

/// 批量读取多个电机的当前位置（原始值 0-4095）。
///
/// 整体通信失败时返回每个 id 的失败项（ok=false），不直接 Err，
/// 便于前端区分「某电机掉线」与「整体异常」。
#[derive(Serialize)]
struct MotorReading {
    id: u8,
    position: u16,
    ok: bool,
    error: String,
}

#[tauri::command]
fn servo_sync_read_positions(
    state: State<'_, Mutex<DeviceState>>,
    ids: Vec<u8>,
) -> Result<Vec<MotorReading>, String> {
    let mut s = state.lock().map_err(to_err)?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let sess = s.session.as_mut().ok_or("设备未连接")?;

    let mut gsr = GroupSyncRead::new(ADDR_PRESENT_POSITION, 2, Endian::Little);
    for &id in &ids {
        gsr.add_param(id);
    }

    match gsr.tx_rx_packet(&mut sess.port, &sess.ph) {
        Ok(()) => Ok(ids
            .iter()
            .map(|&id| match gsr.get_data(id, ADDR_PRESENT_POSITION, 2) {
                Some(pos) => MotorReading {
                    id,
                    position: pos as u16,
                    ok: true,
                    error: String::new(),
                },
                None => MotorReading {
                    id,
                    position: 0,
                    ok: false,
                    error: "no data".into(),
                },
            })
            .collect()),
        Err(e) => {
            let msg = e.to_string();
            Ok(ids
                .iter()
                .map(|&id| MotorReading {
                    id,
                    position: 0,
                    ok: false,
                    error: msg.clone(),
                })
                .collect())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(DeviceState::default()))
        .invoke_handler(tauri::generate_handler![
            greet,
            list_serial_ports,
            serial_connect,
            serial_disconnect,
            serial_is_connected,
            servo_ping,
            servo_set_torque,
            servo_read_position,
            servo_write_position,
            servo_sync_read_positions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
