// 设备与模型服务。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::{require_ok, to_err};
use super::debug_serial::DebugSerialState;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

const BRIDGE_SCRIPT: &str = include_str!("../../python/servo_bridge.py");
pub type DeviceState = Mutex<Option<Bridge>>;

/// 常驻 Python 桥：一问一答（请求串行化后无粘包/乱序问题）。
pub struct Bridge {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

impl Bridge {
    /// 解析 Python 解释器：SERVO_PYTHON 环境变量 → 常见 conda 安装路径 → PATH 上的 python
    fn resolve_python() -> String {
        if let Ok(p) = std::env::var("SERVO_PYTHON") {
            if !p.is_empty() {
                return p;
            }
        }
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        for cand in [
            format!("{home}\\anaconda3\\python.exe"),
            format!("{home}\\miniconda3\\python.exe"),
        ] {
            if std::path::Path::new(&cand).exists() {
                return cand;
            }
        }
        "python".into()
    }

    /// 启动桥进程（脚本写到临时目录，UTF-8 模式运行）
    fn spawn() -> Result<Self, String> {
        let script = std::env::temp_dir().join("claw_servo_bridge.py");
        std::fs::write(&script, BRIDGE_SCRIPT).map_err(|e| format!("写入桥脚本失败：{e}"))?;
        let mut child = Command::new(Self::resolve_python())
            .arg("-X")
            .arg("utf8")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!("启动 Python 桥失败（{e}）；可用环境变量 SERVO_PYTHON 指定解释器路径")
            })?;
        let stdin = child.stdin.take().ok_or("无法获取桥 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取桥 stdout")?;
        Ok(Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
        })
    }

    /// 发送请求并等待一行 JSON 响应（调用方保证串行访问）
    fn call(&mut self, req: &serde_json::Value) -> Result<serde_json::Value, String> {
        let mut line = serde_json::to_string(req).map_err(to_err)?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("桥通信失败：{e}"))?;
        self.stdin.flush().map_err(|e| format!("桥通信失败：{e}"))?;
        let mut resp = String::new();
        self.reader
            .read_line(&mut resp)
            .map_err(|e| format!("桥无响应：{e}"))?;
        if resp.trim().is_empty() {
            return Err("桥进程已退出".into());
        }
        serde_json::from_str(&resp).map_err(|e| format!("桥响应解析失败：{e}"))
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 已连接时向桥转发请求；桥级故障（进程死/管道断）时回收会话，避免后续命令继续打在死桥上
fn with_bridge(
    state: &State<DeviceState>,
    req: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut guard = state.lock().map_err(to_err)?;
    let bridge = guard.as_mut().ok_or("设备未连接")?;
    let resp = bridge.call(&req);
    if resp.is_err() {
        if let Some(mut b) = guard.take() {
            b.kill();
        }
    }
    resp
}

/// 舵机命令便捷链：转发 + 校验 ok
fn servo_call(
    state: &State<DeviceState>,
    req: serde_json::Value,
) -> Result<serde_json::Value, String> {
    require_ok(with_bridge(state, req)?)
}

// —— 串口管理 ——

/// 列出系统可用串口名（本地枚举，无需经过桥）。对应前端 scanPorts。
#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(to_err)?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

/// 启动 Python 桥并打开串口。baud 走 SDK 白名单校验（桥内）。
/// 返回端口名，前端可用作设备标识。
#[tauri::command]
pub fn serial_connect(
    state: State<DeviceState>,
    debug: State<DebugSerialState>,
    port: String,
    baud: u32,
) -> Result<String, String> {
    if debug.lock().map_err(to_err)?.is_some() {
        return Err("单电机调试串口已连接，请先断开".into());
    }
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("设备已连接，请先断开".into());
    }
    let mut bridge = Bridge::spawn()?;
    let req = serde_json::json!({"cmd": "connect", "port": port, "baud": baud});
    match bridge.call(&req).and_then(require_ok) {
        Ok(_) => {
            *guard = Some(bridge);
            Ok(port)
        }
        // 连接失败：桥已含失败状态，直接回收，下次连接重新冷启动
        Err(e) => {
            bridge.kill();
            Err(e)
        }
    }
}

/// 关闭串口、回收桥进程。
#[tauri::command]
pub fn serial_disconnect(state: State<DeviceState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if let Some(mut bridge) = guard.take() {
        // 先请求关串口（拿得到响应最好），无论成败都回收进程
        let _ = bridge.call(&serde_json::json!({"cmd": "disconnect"}));
        bridge.kill();
    }
    Ok(())
}

/// 当前是否有活动会话。
#[tauri::command]
pub fn serial_is_connected(state: State<DeviceState>) -> bool {
    state.lock().map(|g| g.is_some()).unwrap_or(false)
}

// —— 单点控制 ——

#[tauri::command]
pub fn servo_ping(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    let data = servo_call(&state, serde_json::json!({"cmd": "ping", "id": id}))?;
    data.as_u64()
        .map(|v| v as u16)
        .ok_or_else(|| "桥返回数据异常".into())
}

#[tauri::command]
pub fn servo_set_torque(state: State<DeviceState>, id: u8, on: bool) -> Result<(), String> {
    servo_call(
        &state,
        serde_json::json!({"cmd": "set_torque", "id": id, "on": on}),
    )?;
    Ok(())
}

#[tauri::command]
pub fn servo_read_position(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    let data = servo_call(
        &state,
        serde_json::json!({"cmd": "read_position", "id": id}),
    )?;
    data.as_u64()
        .map(|v| v as u16)
        .ok_or_else(|| "桥返回数据异常".into())
}

#[tauri::command]
pub fn servo_write_position(
    state: State<DeviceState>,
    id: u8,
    position: u16,
) -> Result<(), String> {
    servo_call(
        &state,
        serde_json::json!({"cmd": "write_position", "id": id, "position": position}),
    )?;
    Ok(())
}

#[tauri::command]
pub fn servo_write_speed(state: State<DeviceState>, id: u8, speed: u16) -> Result<(), String> {
    servo_call(
        &state,
        serde_json::json!({"cmd": "write_speed", "id": id, "speed": speed}),
    )?;
    Ok(())
}

// —— 批量读取 ——

/// 批量读取多个电机的当前位置（原始值 0-4095）。
///
/// 整体通信失败时返回每个 id 的失败项（ok=false），不直接 Err，
/// 便于前端区分「某电机掉线」与「整体异常」。
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
        return Ok(vec![]);
    }
    let data = servo_call(
        &state,
        serde_json::json!({"cmd": "sync_read_positions", "ids": ids}),
    )?;
    let arr = data.as_array().ok_or("桥返回数据异常")?;
    arr.iter()
        .map(|item| {
            Ok(MotorReading {
                id: item["id"].as_u64().ok_or("缺少 id")? as u8,
                position: item["position"].as_u64().unwrap_or(0) as u16,
                ok: item["ok"].as_bool().unwrap_or(false),
                error: item["error"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect()
}
