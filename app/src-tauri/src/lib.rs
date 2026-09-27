// 设备与模型服务。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

mod backend;

use backend::{ai, debug_serial, mcu, servo};
use std::sync::Mutex;

// —— 模板命令（保留，避免破坏前端既有调用） ——
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 开发目录在 app/；旧根目录 .env 保持原位且不写回。
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<servo::Bridge>))
        .manage(Mutex::new(None::<ai::AiBridge>))
        .manage(Mutex::new(None::<mcu::McuSession>))
        .manage(Mutex::new(None::<Box<dyn serialport::SerialPort>>))
        .invoke_handler(tauri::generate_handler![
            greet,
            servo::list_serial_ports,
            servo::serial_connect,
            servo::serial_disconnect,
            servo::serial_is_connected,
            servo::servo_ping,
            servo::servo_set_torque,
            servo::servo_read_position,
            servo::servo_write_position,
            servo::servo_write_speed,
            servo::servo_sync_read_positions,
            mcu::mcu_serial_open,
            mcu::mcu_serial_close,
            mcu::mcu_serial_is_open,
            mcu::mcu_serial_send,
            mcu::mcu_serial_read_line,
            debug_serial::debug_serial_open,
            debug_serial::debug_serial_close,
            debug_serial::debug_serial_transfer,
            ai::ai_get_config,
            ai::ai_start,
            ai::ai_chat,
            ai::ai_clear,
            ai::ai_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
