// 调试器协议选择与命令分派。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

pub mod feetech;
pub mod slcan;

use super::{bluetooth, common::to_err, debug_serial, mcu, servo};
use bluetooth::{BleCharacteristic, BleNotification, BluetoothManager};
use debug_serial::DebugSerialState;
use mcu::McuState;
use serde::Serialize;
use servo::DeviceState;
use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ProtocolKind {
    RawSerial,
    Feetech,
    Slcan,
    BleGatt,
}

pub struct ProtocolManager(Mutex<Option<ProtocolKind>>);

impl ProtocolManager {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

fn choose_serial(protocol: &str, interface_type: &str) -> Result<ProtocolKind, String> {
    match (protocol, interface_type) {
        ("raw", "ttl" | "rs485" | "can") => Ok(ProtocolKind::RawSerial),
        ("feetech", "ttl" | "rs485") => Ok(ProtocolKind::Feetech),
        ("slcan", "can") => Ok(ProtocolKind::Slcan),
        _ => Err(
            "通信接口与协议不匹配；TTL/RS485 可选原始串口或飞特，CAN 可选原始串口或 SLCAN".into(),
        ),
    }
}

async fn require(manager: &ProtocolManager, expected: ProtocolKind) -> Result<(), String> {
    if *manager.0.lock().await == Some(expected) {
        Ok(())
    } else {
        Err("当前会话未选择该协议，请先连接对应接口".into())
    }
}

#[tauri::command]
pub async fn protocol_active(state: State<'_, ProtocolManager>) -> Result<Option<String>, String> {
    Ok(state.0.lock().await.map(|kind| {
        match kind {
            ProtocolKind::RawSerial => "raw-serial",
            ProtocolKind::Feetech => "feetech",
            ProtocolKind::Slcan => "slcan",
            ProtocolKind::BleGatt => "ble-gatt",
        }
        .to_string()
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn protocol_open_serial(
    manager: State<'_, ProtocolManager>,
    debug: State<'_, DebugSerialState>,
    servo: State<'_, DeviceState>,
    mcu: State<'_, McuState>,
    protocol: String,
    interface_type: String,
    port: String,
    baud: u32,
    data_bits: u8,
    parity: String,
    stop_bits: u8,
    can_bitrate: String,
    target_id: Option<u8>,
) -> Result<String, String> {
    let kind = choose_serial(&protocol, &interface_type)?;
    if kind == ProtocolKind::Feetech && !matches!(target_id, Some(1..=253)) {
        return Err("飞特舵机 ID 须为 1–253".into());
    }
    let mut active = manager.0.lock().await;
    if active.is_some() {
        return Err("调试器已有协议会话，请先断开".into());
    }
    let connected = match kind {
        ProtocolKind::Feetech => servo::serial_connect(servo, debug, mcu, port, baud)?,
        ProtocolKind::RawSerial | ProtocolKind::Slcan => {
            let (bits, parity, stops) = if kind == ProtocolKind::Slcan {
                (8, "none".to_string(), 1)
            } else {
                (data_bits, parity, stop_bits)
            };
            let name = debug_serial::debug_serial_open(
                debug.clone(),
                servo,
                mcu,
                port,
                baud,
                bits,
                parity,
                stops,
            )?;
            if kind == ProtocolKind::Slcan {
                if let Err(error) = super::slcan::slcan_initialize(debug.clone(), can_bitrate) {
                    let _ = debug_serial::debug_serial_close(debug);
                    return Err(error);
                }
            }
            name
        }
        ProtocolKind::BleGatt => unreachable!(),
    };
    *active = Some(kind);
    Ok(connected)
}

#[tauri::command]
pub async fn protocol_open_ble(
    manager: State<'_, ProtocolManager>,
    bluetooth: State<'_, BluetoothManager>,
    debug: State<'_, DebugSerialState>,
    servo: State<'_, DeviceState>,
    mcu: State<'_, McuState>,
    id: String,
) -> Result<Vec<BleCharacteristic>, String> {
    let mut active = manager.0.lock().await;
    if active.is_some() {
        return Err("调试器已有协议会话，请先断开".into());
    }
    if debug.lock().map_err(to_err)?.is_some()
        || servo.lock().map_err(to_err)?.is_some()
        || mcu.lock().map_err(to_err)?.is_some()
    {
        return Err("已有串口会话，请先断开后再连接蓝牙".into());
    }
    let characteristics = bluetooth::bluetooth_connect(bluetooth, id).await?;
    *active = Some(ProtocolKind::BleGatt);
    Ok(characteristics)
}

#[tauri::command]
pub async fn protocol_close(
    manager: State<'_, ProtocolManager>,
    debug: State<'_, DebugSerialState>,
    servo: State<'_, DeviceState>,
    bluetooth: State<'_, BluetoothManager>,
) -> Result<Option<String>, String> {
    let mut active = manager.0.lock().await;
    match *active {
        Some(ProtocolKind::RawSerial) => debug_serial::debug_serial_close(debug)?,
        Some(ProtocolKind::Slcan) => {
            let warning = super::slcan::slcan_close(debug.clone()).err();
            debug_serial::debug_serial_close(debug)?;
            // 串口已释放；适配器回执异常作为警告返回，避免界面误判仍连接。
            *active = None;
            return Ok(warning);
        }
        Some(ProtocolKind::Feetech) => servo::serial_disconnect(servo)?,
        Some(ProtocolKind::BleGatt) => bluetooth::bluetooth_disconnect(bluetooth).await?,
        None => return Ok(None),
    }
    *active = None;
    Ok(None)
}

#[tauri::command]
pub async fn protocol_raw_transfer(
    manager: State<'_, ProtocolManager>,
    debug: State<'_, DebugSerialState>,
    tx: Vec<u8>,
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    require(&manager, ProtocolKind::RawSerial).await?;
    debug_serial::debug_serial_transfer(debug, tx, timeout_ms)
}

#[tauri::command]
pub async fn protocol_can_send(
    manager: State<'_, ProtocolManager>,
    debug: State<'_, DebugSerialState>,
    frame: super::slcan::CanFrame,
) -> Result<Vec<u8>, String> {
    require(&manager, ProtocolKind::Slcan).await?;
    super::slcan::slcan_send_frame(debug, frame)
}

#[tauri::command]
pub async fn protocol_can_receive(
    manager: State<'_, ProtocolManager>,
    debug: State<'_, DebugSerialState>,
) -> Result<Vec<u8>, String> {
    require(&manager, ProtocolKind::Slcan).await?;
    super::slcan::slcan_receive(debug)
}

#[tauri::command]
pub async fn protocol_ble_read(
    manager: State<'_, ProtocolManager>,
    bluetooth: State<'_, BluetoothManager>,
    uuid: String,
) -> Result<Vec<u8>, String> {
    require(&manager, ProtocolKind::BleGatt).await?;
    bluetooth::bluetooth_read(bluetooth, uuid).await
}

#[tauri::command]
pub async fn protocol_ble_write(
    manager: State<'_, ProtocolManager>,
    bluetooth: State<'_, BluetoothManager>,
    uuid: String,
    value: Vec<u8>,
    with_response: bool,
) -> Result<(), String> {
    require(&manager, ProtocolKind::BleGatt).await?;
    bluetooth::bluetooth_write(bluetooth, uuid, value, with_response).await
}

#[tauri::command]
pub async fn protocol_ble_subscribe(
    manager: State<'_, ProtocolManager>,
    bluetooth: State<'_, BluetoothManager>,
    uuid: String,
    channel: Channel<BleNotification>,
) -> Result<(), String> {
    require(&manager, ProtocolKind::BleGatt).await?;
    bluetooth::bluetooth_subscribe(bluetooth, uuid, channel).await
}

#[tauri::command]
pub async fn protocol_ble_unsubscribe(
    manager: State<'_, ProtocolManager>,
    bluetooth: State<'_, BluetoothManager>,
    uuid: String,
) -> Result<(), String> {
    require(&manager, ProtocolKind::BleGatt).await?;
    bluetooth::bluetooth_unsubscribe(bluetooth, uuid).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_only_supported_interface_protocol_pairs() {
        assert_eq!(
            choose_serial("raw", "ttl").unwrap(),
            ProtocolKind::RawSerial
        );
        assert_eq!(
            choose_serial("feetech", "rs485").unwrap(),
            ProtocolKind::Feetech
        );
        assert_eq!(choose_serial("slcan", "can").unwrap(), ProtocolKind::Slcan);
        assert_eq!(
            choose_serial("raw", "can").unwrap(),
            ProtocolKind::RawSerial
        );
        assert!(choose_serial("feetech", "can").is_err());
        assert!(choose_serial("raw", "ble").is_err());
    }
}
