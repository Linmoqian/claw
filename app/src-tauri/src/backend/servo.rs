// 飞特 SCS/STS 串口协议与会话。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::to_err;
use super::debug_serial::{DebugSerialState, SERIAL_OPEN_LOCK};
use super::mcu::McuState;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

const BROADCAST_ID: u8 = 0xFE;
const INST_PING: u8 = 0x01;
const INST_READ: u8 = 0x02;
const INST_WRITE: u8 = 0x03;
const INST_SYNC_READ: u8 = 0x82;
const ADDR_MODEL: u8 = 3;
const ADDR_TORQUE: u8 = 40;
const ADDR_GOAL_POSITION: u8 = 42;
const ADDR_MOVING_SPEED: u8 = 46;
const ADDR_PRESENT_POSITION: u8 = 56;

pub type DeviceState = Mutex<Option<ServoSession>>;

pub struct ServoSession {
    port: Box<dyn serialport::SerialPort>,
    baud: u32,
    rx_pending: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
struct StatusPacket {
    id: u8,
    error: u8,
    data: Vec<u8>,
}

fn valid_id(id: u8) -> Result<(), String> {
    if !(1..=253).contains(&id) {
        return Err("舵机 ID 须为 1–253".into());
    }
    Ok(())
}

// SCS/STS 协议：FF FF ID LEN INST PARAM... CHECKSUM；长度含指令与校验。
fn instruction_packet(id: u8, instruction: u8, parameters: &[u8]) -> Result<Vec<u8>, String> {
    if parameters.len() > 244 {
        return Err("舵机报文过长".into());
    }
    let mut packet = vec![0xFF, 0xFF, id, (parameters.len() + 2) as u8, instruction];
    packet.extend_from_slice(parameters);
    let sum = packet[2..]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    packet.push(!sum);
    Ok(packet)
}

fn parse_status_frame(frame: &[u8]) -> Result<StatusPacket, String> {
    if frame.len() < 6 || frame[..2] != [0xFF, 0xFF] {
        return Err("舵机响应帧头无效".into());
    }
    let length = frame[3] as usize;
    if !(2..=246).contains(&length) || frame.len() != length + 4 {
        return Err("舵机响应长度无效".into());
    }
    let sum = frame[2..frame.len() - 1]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    if frame[frame.len() - 1] != !sum {
        return Err("舵机响应校验和错误".into());
    }
    Ok(StatusPacket {
        id: frame[2],
        error: frame[4],
        data: frame[5..frame.len() - 1].to_vec(),
    })
}

fn send(
    session: &mut ServoSession,
    id: u8,
    instruction: u8,
    parameters: &[u8],
) -> Result<(), String> {
    let packet = instruction_packet(id, instruction, parameters)?;
    session
        .port
        .clear(serialport::ClearBuffer::Input)
        .map_err(to_err)?;
    session.rx_pending.clear();
    session
        .port
        .write_all(&packet)
        .and_then(|_| session.port.flush())
        .map_err(to_err)
}

fn take_status(pending: &mut Vec<u8>, expected_id: Option<u8>) -> Option<StatusPacket> {
    loop {
        let Some(start) = pending.windows(2).position(|pair| pair == [0xFF, 0xFF]) else {
            if pending.last() == Some(&0xFF) {
                pending.drain(..pending.len() - 1);
            } else {
                pending.clear();
            }
            return None;
        };
        pending.drain(..start);
        if pending.len() < 4 {
            return None;
        }
        let total = pending[3] as usize + 4;
        if !(6..=250).contains(&total) {
            pending.drain(..1);
            continue;
        }
        if pending.len() < total {
            return None;
        }
        let frame = pending.drain(..total).collect::<Vec<_>>();
        if let Ok(status) = parse_status_frame(&frame) {
            if expected_id.is_none_or(|id| id == status.id) {
                return Some(status);
            }
        }
    }
}

fn receive(
    session: &mut ServoSession,
    expected_id: Option<u8>,
    deadline: Instant,
) -> Result<StatusPacket, String> {
    let mut buffer = [0_u8; 64];
    while Instant::now() < deadline {
        if let Some(status) = take_status(&mut session.rx_pending, expected_id) {
            return Ok(status);
        }
        let timeout = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(20))
            .max(Duration::from_millis(1));
        session.port.set_timeout(timeout).map_err(to_err)?;
        match session.port.read(&mut buffer) {
            Ok(count) if count > 0 => session.rx_pending.extend_from_slice(&buffer[..count]),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("舵机响应超时或报文损坏".into())
}

fn command(
    session: &mut ServoSession,
    id: u8,
    instruction: u8,
    parameters: &[u8],
    response_bytes: usize,
) -> Result<Vec<u8>, String> {
    valid_id(id)?;
    send(session, id, instruction, parameters)?;
    let expected_wire_bytes = response_bytes + 6;
    let wire_ms = (expected_wire_bytes as u64 * 10_000 / session.baud as u64).max(1);
    let status = receive(
        session,
        Some(id),
        Instant::now() + Duration::from_millis(60 + wire_ms),
    )?;
    if status.error != 0 {
        return Err(format!("舵机 ID {id} 报告错误码 0x{:02X}", status.error));
    }
    if status.data.len() != response_bytes {
        return Err("舵机响应数据长度不匹配".into());
    }
    Ok(status.data)
}

fn read_register(
    session: &mut ServoSession,
    id: u8,
    address: u8,
    count: u8,
) -> Result<Vec<u8>, String> {
    command(session, id, INST_READ, &[address, count], count as usize)
}

fn write_register(
    session: &mut ServoSession,
    id: u8,
    address: u8,
    bytes: &[u8],
) -> Result<(), String> {
    let mut parameters = vec![address];
    parameters.extend_from_slice(bytes);
    command(session, id, INST_WRITE, &parameters, 0).map(|_| ())
}

fn with_session<T>(
    state: &State<DeviceState>,
    action: impl FnOnce(&mut ServoSession) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.lock().map_err(to_err)?;
    action(guard.as_mut().ok_or("舵机串口尚未连接")?)
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(to_err)?;
    Ok(ports.into_iter().map(|port| port.port_name).collect())
}

#[tauri::command]
pub fn serial_connect(
    state: State<DeviceState>,
    debug: State<DebugSerialState>,
    mcu: State<McuState>,
    port: String,
    baud: u32,
) -> Result<String, String> {
    let _opening = SERIAL_OPEN_LOCK.lock().map_err(to_err)?;
    if port.trim().is_empty() || !(4800..=1_000_000).contains(&baud) {
        return Err("请选择串口并填写 4800–1000000 范围内的波特率".into());
    }
    if debug.lock().map_err(to_err)?.is_some() || mcu.lock().map_err(to_err)?.is_some() {
        return Err("已有其他串口会话，请先断开".into());
    }
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("舵机串口已连接，请先断开".into());
    }
    let serial = serialport::new(&port, baud)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(to_err)?;
    *guard = Some(ServoSession {
        port: serial,
        baud,
        rx_pending: Vec::new(),
    });
    Ok(port)
}

#[tauri::command]
pub fn serial_disconnect(state: State<DeviceState>) -> Result<(), String> {
    *state.lock().map_err(to_err)? = None;
    Ok(())
}

#[tauri::command]
pub fn serial_is_connected(state: State<DeviceState>) -> bool {
    state.lock().is_ok_and(|guard| guard.is_some())
}

#[tauri::command]
pub fn servo_ping(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    with_session(&state, |session| {
        command(session, id, INST_PING, &[], 0)?;
        let bytes = read_register(session, id, ADDR_MODEL, 2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    })
}

#[tauri::command]
pub fn servo_set_torque(state: State<DeviceState>, id: u8, on: bool) -> Result<(), String> {
    with_session(&state, |session| {
        write_register(session, id, ADDR_TORQUE, &[u8::from(on)])
    })
}

#[tauri::command]
pub fn servo_read_position(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    with_session(&state, |session| {
        let bytes = read_register(session, id, ADDR_PRESENT_POSITION, 2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    })
}

#[tauri::command]
pub fn servo_write_position(
    state: State<DeviceState>,
    id: u8,
    position: u16,
) -> Result<(), String> {
    if position > 4095 {
        return Err("舵机目标位置须在 0–4095".into());
    }
    with_session(&state, |session| {
        write_register(session, id, ADDR_GOAL_POSITION, &position.to_le_bytes())
    })
}

#[tauri::command]
pub fn servo_write_speed(state: State<DeviceState>, id: u8, speed: u16) -> Result<(), String> {
    if speed > 2400 {
        return Err("舵机速度原始值须在 0–2400".into());
    }
    with_session(&state, |session| {
        write_register(session, id, ADDR_MOVING_SPEED, &speed.to_le_bytes())
    })
}

#[derive(Serialize)]
pub struct MotorReading {
    id: u8,
    position: u16,
    ok: bool,
    error: String,
}

#[tauri::command]
pub fn servo_sync_read_positions(
    state: State<DeviceState>,
    ids: Vec<u8>,
) -> Result<Vec<MotorReading>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    if ids.len() > 32 {
        return Err("单次最多读取 32 个舵机".into());
    }
    for id in &ids {
        valid_id(*id)?;
    }
    with_session(&state, |session| {
        let mut unique = HashSet::new();
        let ordered = ids
            .iter()
            .copied()
            .filter(|id| unique.insert(*id))
            .collect::<Vec<_>>();
        let mut parameters = vec![ADDR_PRESENT_POSITION, 2];
        parameters.extend(ordered.iter().copied());
        send(session, BROADCAST_ID, INST_SYNC_READ, &parameters)?;
        let wire_ms = (unique.len() as u64 * 8 * 10_000 / session.baud as u64).max(1);
        let deadline = Instant::now() + Duration::from_millis((100 + wire_ms).min(2000));
        let mut readings = HashMap::<u8, Result<u16, String>>::new();
        while readings.len() < unique.len() && Instant::now() < deadline {
            match receive(session, None, deadline) {
                Ok(status) if unique.contains(&status.id) => {
                    let value = if status.error != 0 {
                        Err(format!("舵机错误码 0x{:02X}", status.error))
                    } else if status.data.len() != 2 {
                        Err("位置响应长度无效".into())
                    } else {
                        Ok(u16::from_le_bytes([status.data[0], status.data[1]]))
                    };
                    readings.insert(status.id, value);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        Ok(ids
            .into_iter()
            .map(|id| match readings.get(&id) {
                Some(Ok(position)) => MotorReading {
                    id,
                    position: *position,
                    ok: true,
                    error: String::new(),
                },
                Some(Err(error)) => MotorReading {
                    id,
                    position: 0,
                    ok: false,
                    error: error.clone(),
                },
                None => MotorReading {
                    id,
                    position: 0,
                    ok: false,
                    error: "未收到舵机位置响应".into(),
                },
            })
            .collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_matches_scs_read_example() {
        assert_eq!(
            instruction_packet(1, INST_READ, &[56, 2]).unwrap(),
            vec![0xFF, 0xFF, 1, 4, 2, 56, 2, 0xBE]
        );
    }

    #[test]
    fn status_checksum_and_length_are_checked() {
        let frame = [0xFF, 0xFF, 1, 4, 0, 0x34, 0x12, 0xB4];
        assert_eq!(parse_status_frame(&frame).unwrap().data, [0x34, 0x12]);
        assert!(parse_status_frame(&[0xFF, 0xFF, 1, 4, 0, 0x34, 0x12, 0]).is_err());
    }

    #[test]
    fn keeps_coalesced_sync_responses() {
        let mut pending = vec![0x00, 0xFF, 0xFF, 1, 4, 0, 0x34, 0x12, 0xB4];
        pending.extend_from_slice(&[0xFF, 0xFF, 2, 4, 0, 0x01, 0x02, 0xF6]);
        assert_eq!(take_status(&mut pending, None).unwrap().id, 1);
        assert_eq!(take_status(&mut pending, None).unwrap().id, 2);
        assert!(pending.is_empty());
    }
}
