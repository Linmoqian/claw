// BLE GATT 中心端会话。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use btleplug::api::{Central, CharPropFlags, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
struct Session {
    adapter: Option<Adapter>,
    peripheral: Option<Peripheral>,
    subscribed: HashSet<Uuid>,
    generation: u64,
}

pub struct BluetoothManager(Arc<Mutex<Session>>);

impl BluetoothManager {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Session::default())))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleDevice {
    id: String,
    name: Option<String>,
    rssi: Option<i16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleCharacteristic {
    service_uuid: String,
    uuid: String,
    can_read: bool,
    can_write: bool,
    can_write_without_response: bool,
    can_notify: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleNotification {
    uuid: String,
    value: Vec<u8>,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

async fn first_adapter() -> Result<Adapter, String> {
    Manager::new()
        .await
        .map_err(err)?
        .adapters()
        .await
        .map_err(err)?
        .into_iter()
        .next()
        .ok_or_else(|| "未找到蓝牙适配器，请开启系统蓝牙后重试".into())
}

fn characteristic(
    peripheral: &Peripheral,
    uuid: &str,
) -> Result<btleplug::api::Characteristic, String> {
    let id = Uuid::parse_str(uuid).map_err(|_| "特征 UUID 格式无效".to_string())?;
    peripheral
        .characteristics()
        .into_iter()
        .find(|item| item.uuid == id)
        .ok_or_else(|| "设备未提供该 GATT 特征，请先查看特征列表".into())
}

async fn connected(manager: &BluetoothManager) -> Result<Peripheral, String> {
    let peripheral = manager
        .0
        .lock()
        .await
        .peripheral
        .clone()
        .ok_or_else(|| "尚未连接 BLE 设备".to_string())?;
    if !peripheral.is_connected().await.map_err(err)? {
        return Err("BLE 连接已断开，请重新连接".into());
    }
    Ok(peripheral)
}

#[tauri::command]
pub async fn bluetooth_scan(
    state: State<'_, BluetoothManager>,
    duration_ms: u64,
) -> Result<Vec<BleDevice>, String> {
    let adapter = first_adapter().await?;
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(err)?;
    tokio::time::sleep(Duration::from_millis(duration_ms.clamp(500, 10_000))).await;
    let devices = adapter.peripherals().await.map_err(err)?;
    let mut found = Vec::new();
    for device in devices {
        if let Some(properties) = device.properties().await.map_err(err)? {
            found.push(BleDevice {
                id: device.id().to_string(),
                name: properties.local_name,
                rssi: properties.rssi,
            });
        }
    }
    adapter.stop_scan().await.map_err(err)?;
    state.0.lock().await.adapter = Some(adapter);
    Ok(found)
}

#[tauri::command]
pub async fn bluetooth_connect(
    state: State<'_, BluetoothManager>,
    id: String,
) -> Result<Vec<BleCharacteristic>, String> {
    let adapter = state
        .0
        .lock()
        .await
        .adapter
        .clone()
        .ok_or_else(|| "请先扫描 BLE 设备".to_string())?;
    let device = adapter
        .peripherals()
        .await
        .map_err(err)?
        .into_iter()
        .find(|item| item.id().to_string() == id)
        .ok_or_else(|| "扫描结果中找不到设备，请重新扫描".to_string())?;
    let old = { state.0.lock().await.peripheral.take() };
    if let Some(old) = old {
        let _ = old.disconnect().await;
    }
    device.connect().await.map_err(err)?;
    if let Err(error) = device.discover_services().await {
        let _ = device.disconnect().await;
        return Err(err(error));
    }
    let list = describe(&device);
    let mut session = state.0.lock().await;
    session.generation = session.generation.wrapping_add(1);
    session.subscribed.clear();
    session.peripheral = Some(device);
    Ok(list)
}

fn describe(device: &Peripheral) -> Vec<BleCharacteristic> {
    device
        .characteristics()
        .into_iter()
        .map(|item| BleCharacteristic {
            service_uuid: item.service_uuid.to_string(),
            uuid: item.uuid.to_string(),
            can_read: item.properties.contains(CharPropFlags::READ),
            can_write: item.properties.contains(CharPropFlags::WRITE),
            can_write_without_response: item
                .properties
                .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE),
            can_notify: item
                .properties
                .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE),
        })
        .collect()
}

#[tauri::command]
pub async fn bluetooth_characteristics(
    state: State<'_, BluetoothManager>,
) -> Result<Vec<BleCharacteristic>, String> {
    Ok(describe(&connected(&state).await?))
}

#[tauri::command]
pub async fn bluetooth_disconnect(state: State<'_, BluetoothManager>) -> Result<(), String> {
    let device = {
        let mut session = state.0.lock().await;
        session.generation = session.generation.wrapping_add(1);
        session.subscribed.clear();
        session.peripheral.take()
    };
    if let Some(device) = device {
        device.disconnect().await.map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn bluetooth_read(
    state: State<'_, BluetoothManager>,
    uuid: String,
) -> Result<Vec<u8>, String> {
    let device = connected(&state).await?;
    let target = characteristic(&device, &uuid)?;
    if !target.properties.contains(CharPropFlags::READ) {
        return Err("该 GATT 特征不支持读取".into());
    }
    device.read(&target).await.map_err(err)
}

#[tauri::command]
pub async fn bluetooth_write(
    state: State<'_, BluetoothManager>,
    uuid: String,
    value: Vec<u8>,
    with_response: bool,
) -> Result<(), String> {
    if value.is_empty() || value.len() > 512 {
        return Err("BLE 单次写入须为 1 至 512 字节；实际可写长度还受设备 MTU 限制".into());
    }
    let device = connected(&state).await?;
    let target = characteristic(&device, &uuid)?;
    let (flag, write_type) = if with_response {
        (CharPropFlags::WRITE, WriteType::WithResponse)
    } else {
        (
            CharPropFlags::WRITE_WITHOUT_RESPONSE,
            WriteType::WithoutResponse,
        )
    };
    if !target.properties.contains(flag) {
        return Err("该 GATT 特征不支持所选写入方式".into());
    }
    device.write(&target, &value, write_type).await.map_err(err)
}

#[tauri::command]
pub async fn bluetooth_subscribe(
    state: State<'_, BluetoothManager>,
    uuid: String,
    channel: Channel<BleNotification>,
) -> Result<(), String> {
    let device = connected(&state).await?;
    let target = characteristic(&device, &uuid)?;
    if !target
        .properties
        .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
    {
        return Err("该 GATT 特征不支持通知".into());
    }
    if !state.0.lock().await.subscribed.is_empty() {
        return Err("当前会话已有通知订阅；请断开后重新连接以切换特征".into());
    }
    let mut notifications = device.notifications().await.map_err(err)?;
    device.subscribe(&target).await.map_err(err)?;
    let generation = {
        let mut session = state.0.lock().await;
        session.subscribed.insert(target.uuid);
        session.generation
    };
    let manager = state.0.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = notifications.next().await {
            if manager.lock().await.generation != generation {
                break;
            }
            if event.uuid == target.uuid
                && channel
                    .send(BleNotification {
                        uuid: event.uuid.to_string(),
                        value: event.value,
                    })
                    .is_err()
            {
                break;
            }
        }
        let mut session = manager.lock().await;
        if session.generation == generation {
            session.subscribed.remove(&target.uuid);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn bluetooth_unsubscribe(
    state: State<'_, BluetoothManager>,
    uuid: String,
) -> Result<(), String> {
    let device = connected(&state).await?;
    let target = characteristic(&device, &uuid)?;
    if !state.0.lock().await.subscribed.contains(&target.uuid) {
        return Ok(());
    }
    device.unsubscribe(&target).await.map_err(err)?;
    let mut session = state.0.lock().await;
    session.generation = session.generation.wrapping_add(1);
    session.subscribed.remove(&target.uuid);
    Ok(())
}
