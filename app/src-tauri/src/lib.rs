// 设备与模型服务。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

mod backend;

use backend::{
    ai, assets, bluetooth, debug_serial, drafts, experiments, mcu, program, replay, servo,
    simulation, slcan, training, websocket,
};
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
        .manage(Mutex::new(None::<servo::ServoSession>))
        .manage(Mutex::new(None::<ai::AiBridge>))
        .manage(Mutex::new(None::<mcu::McuSession>))
        .manage(Mutex::new(None::<Box<dyn serialport::SerialPort>>))
        .manage(experiments::ExperimentLock(Mutex::new(())))
        .manage(drafts::DraftStore(Mutex::new(())))
        .manage(assets::AssetManager(Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(simulation::runtime::RuntimeManager::new())
        .manage(replay::ReplayManager::new())
        .manage(program::ProgramManager::new())
        .manage(websocket::WebSocketManager::new())
        .manage(bluetooth::BluetoothManager::new())
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
            slcan::slcan_initialize,
            slcan::slcan_close,
            slcan::slcan_send_frame,
            slcan::slcan_receive,
            bluetooth::bluetooth_scan,
            bluetooth::bluetooth_connect,
            bluetooth::bluetooth_disconnect,
            bluetooth::bluetooth_characteristics,
            bluetooth::bluetooth_read,
            bluetooth::bluetooth_write,
            bluetooth::bluetooth_subscribe,
            ai::ai_get_config,
            ai::ai_start,
            ai::ai_chat,
            ai::ai_clear,
            ai::ai_stop,
            experiments::experiment_list,
            experiments::experiment_write,
            experiments::experiment_get,
            experiments::experiment_update_record,
            drafts::draft_read,
            drafts::draft_write,
            assets::asset_list,
            assets::asset_migration_done,
            assets::asset_mark_migrated,
            assets::asset_save_link,
            assets::asset_begin_upload,
            assets::asset_upload_chunk,
            assets::asset_finish_upload,
            assets::asset_abort_upload,
            assets::asset_read_chunk,
            assets::asset_remove,
            simulation::runtime::simulation_start,
            simulation::runtime::simulation_subscribe,
            simulation::runtime::simulation_frame,
            simulation::runtime::simulation_reset_props,
            simulation::runtime::simulation_set_joint_targets,
            simulation::runtime::simulation_set_tcp_target,
            simulation::runtime::simulation_set_mode,
            simulation::runtime::simulation_set_speed,
            simulation::runtime::simulation_set_paused,
            simulation::runtime::simulation_set_base_target,
            simulation::runtime::simulation_stop_motion,
            simulation::runtime::simulation_stop_runtime,
            replay::replay_load,
            replay::replay_subscribe,
            replay::replay_control,
            replay::replay_clear,
            training::train_perception,
            training::train_decision,
            program::program_start,
            program::program_reply,
            program::program_stop,
            training::adversarial::train_adversarial,
            websocket::websocket_open,
            websocket::websocket_send,
            websocket::websocket_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
