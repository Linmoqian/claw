// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// 设备通讯后端：通过常驻 Python 子进程（scservo_sdk 官方 SDK）封装 Feetech SCServo 协议，
// 经 stdin/stdout JSON 行协议转发 Tauri command。串口会话状态保持在桥进程内，
// 请求由 Mutex 串行化（半双工总线本就串行），桥随 stdin EOF 自行退出，无残留进程。
//
// Created on 2026-09-11
// @author:  https://github.com/Linmoqian

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

/// 嵌入的 Python 桥脚本（构建期编入二进制，运行时写到临时目录执行，dev/prod 均无路径问题）
const BRIDGE_SCRIPT: &str = include_str!("../python/servo_bridge.py");
const AI_BRIDGE_SCRIPT: &str = include_str!("../python/zdtaichu_bridge.py");

/// 全局设备状态：None = 未连接。同一时刻至多一个会话（串口半双工，本就串行）。
type DeviceState = Mutex<Option<Bridge>>;
type AiState = Mutex<Option<AiBridge>>;
type McuState = Mutex<Option<McuSession>>;

/// 便利：把 Mutex PoisonError / 任意 Display 错误转成 String（Tauri command 错误类型）。
fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 常驻 Python 桥：一问一答（请求串行化后无粘包/乱序问题）。
struct Bridge {
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

/// 常驻 AI Python 桥：会话通过 JSON 行协议串行化。
struct AiBridge {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

impl AiBridge {
    fn resolve_python(configured: &str) -> String {
        if !configured.is_empty() {
            return configured.to_string();
        }
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        for candidate in [
            r"C:\Users\30470\Anaconda3\envs\zdtaichu\python.exe".to_string(),
            format!(r"{home}\anaconda3\envs\zdtaichu\python.exe"),
            format!(r"{home}\miniconda3\envs\zdtaichu\python.exe"),
        ] {
            if std::path::Path::new(&candidate).exists() {
                return candidate;
            }
        }
        "python".into()
    }

    fn resolve_model_path() -> String {
        match std::env::var("ZDTAICHU_MODEL_PATH") {
            Ok(path) if !path.is_empty() => path,
            _ => r"D:\models\ZDTaichu5.0-9B".into(),
        }
    }

    fn spawn(config: &AiProviderConfig) -> Result<Self, String> {
        let script = std::env::temp_dir().join("xiakao_ai_bridge.py");
        std::fs::write(&script, AI_BRIDGE_SCRIPT)
            .map_err(|e| format!("写入 AI 桥脚本失败：{e}"))?;
        let python = if config.provider == "zdtaichu" {
            Self::resolve_python(&config.python_path)
        } else {
            env_string("AI_BRIDGE_PYTHON", "python")
        };
        let python_env = if config.provider == "zdtaichu" {
            "ZDTAICHU_PYTHON"
        } else {
            "AI_BRIDGE_PYTHON"
        };
        let mut child = Command::new(python)
            .arg("-X")
            .arg("utf8")
            .arg("-u")
            .arg(&script)
            .arg("--model-path")
            .arg(Self::resolve_model_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!("启动 AI Python 桥失败（{e}）；可用环境变量 {python_env} 指定解释器")
            })?;
        let stdin = child.stdin.take().ok_or("无法获取 AI 桥 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取 AI 桥 stdout")?;
        Ok(Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
        })
    }

    fn read_response(&mut self) -> Result<serde_json::Value, String> {
        let mut response = String::new();
        self.reader
            .read_line(&mut response)
            .map_err(|e| format!("AI 桥无响应：{e}"))?;
        if response.trim().is_empty() {
            return Err("AI 桥进程已退出".into());
        }
        serde_json::from_str(&response).map_err(|e| format!("AI 桥响应解析失败：{e}"))
    }

    fn call(&mut self, request: &serde_json::Value) -> Result<serde_json::Value, String> {
        let mut line = serde_json::to_string(request).map_err(to_err)?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("AI 桥通信失败：{e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("AI 桥通信失败：{e}"))?;
        self.read_response()
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for AiBridge {
    fn drop(&mut self) {
        self.kill();
    }
}

/// 统一桥响应：ok=false 时把 error 提为 Err，ok=true 时返回 data
fn require_ok(resp: serde_json::Value) -> Result<serde_json::Value, String> {
    if resp["ok"].as_bool().unwrap_or(false) {
        Ok(resp["data"].clone())
    } else {
        Err(resp["error"]
            .as_str()
            .unwrap_or("桥返回未知错误")
            .to_string())
    }
}

/// 已连接时向桥转发请求；桥级故障（进程死/管道断）时回收会话，避免后续命令继续打在死桥上
fn with_bridge(state: &State<DeviceState>, req: serde_json::Value) -> Result<serde_json::Value, String> {
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
fn servo_call(state: &State<DeviceState>, req: serde_json::Value) -> Result<serde_json::Value, String> {
    require_ok(with_bridge(state, req)?)
}

// —— 模板命令（保留，避免破坏前端既有调用） ——
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// —— 串口管理 ——

/// 列出系统可用串口名（本地枚举，无需经过桥）。对应前端 scanPorts。
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(to_err)?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

/// 启动 Python 桥并打开串口。baud 走 SDK 白名单校验（桥内）。
/// 返回端口名，前端可用作设备标识。
#[tauri::command]
fn serial_connect(state: State<DeviceState>, port: String, baud: u32) -> Result<String, String> {
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
fn serial_disconnect(state: State<DeviceState>) -> Result<(), String> {
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
fn serial_is_connected(state: State<DeviceState>) -> bool {
    state.lock().map(|g| g.is_some()).unwrap_or(false)
}

// —— 单点控制 ——

#[tauri::command]
fn servo_ping(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    let data = servo_call(&state, serde_json::json!({"cmd": "ping", "id": id}))?;
    data.as_u64()
        .map(|v| v as u16)
        .ok_or_else(|| "桥返回数据异常".into())
}

#[tauri::command]
fn servo_set_torque(state: State<DeviceState>, id: u8, on: bool) -> Result<(), String> {
    servo_call(
        &state,
        serde_json::json!({"cmd": "set_torque", "id": id, "on": on}),
    )?;
    Ok(())
}

#[tauri::command]
fn servo_read_position(state: State<DeviceState>, id: u8) -> Result<u16, String> {
    let data = servo_call(&state, serde_json::json!({"cmd": "read_position", "id": id}))?;
    data.as_u64()
        .map(|v| v as u16)
        .ok_or_else(|| "桥返回数据异常".into())
}

#[tauri::command]
fn servo_write_position(state: State<DeviceState>, id: u8, position: u16) -> Result<(), String> {
    servo_call(
        &state,
        serde_json::json!({"cmd": "write_position", "id": id, "position": position}),
    )?;
    Ok(())
}

#[tauri::command]
fn servo_write_speed(state: State<DeviceState>, id: u8, speed: u16) -> Result<(), String> {
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
struct MotorReading {
    id: u8,
    position: u16,
    ok: bool,
    error: String,
}

#[tauri::command]
fn servo_sync_read_positions(state: State<DeviceState>, ids: Vec<u8>) -> Result<Vec<MotorReading>, String> {
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


// —— 通用 MCU 串口桥 ——
// 独立于 Feetech DeviceState。外部 MCU 固件按 JSON 行协议应答；
// 该通道只负责字节流，不解释引脚电气能力。

struct McuSession {
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
fn mcu_serial_open(
    state: State<McuState>,
    port: String,
    baud: u32,
) -> Result<String, String> {
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("MCU 串口已连接，请先断开".into());
    }
    *guard = Some(open_mcu_port(&port, baud)?);
    Ok(port)
}

#[tauri::command]
fn mcu_serial_close(state: State<McuState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if let Some(mut session) = guard.take() {
        let _ = session.port.write_all(b"\n");
        let _ = session.port.flush();
    }
    Ok(())
}

#[tauri::command]
fn mcu_serial_is_open(state: State<McuState>) -> bool {
    state.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

#[tauri::command]
fn mcu_serial_send(state: State<McuState>, payload: String) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    let session = guard.as_mut().ok_or("MCU 串口尚未打开")?;
    session
        .port
        .write_all(payload.as_bytes())
        .and_then(|_| session.port.flush())
        .map_err(to_err)
}

#[tauri::command]
fn mcu_serial_read_line(state: State<McuState>, timeout_ms: u64) -> Result<String, String> {
    let mut guard = state.lock().map_err(to_err)?;
    let session = guard.as_mut().ok_or("MCU 串口尚未打开")?;
    read_mcu_line(session, timeout_ms)
}

// —— ZDTaichu 视觉助手 ——

#[derive(Deserialize, Serialize)]
struct AiChatResult {
    answer: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    provider: String,
    model: String,
    base_url: String,
    #[serde(default)]
    api_key: String,
    supports_vision: bool,
    max_tokens: u32,
    model_path: String,
    python_path: String,
}

fn env_string(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn env_bool(name: &str, fallback: bool) -> bool {
    match std::env::var(name) {
        Ok(value) => matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => fallback,
    }
}

fn default_ai_config() -> AiProviderConfig {
    let provider = env_string("AI_PROVIDER", "zdtaichu").to_lowercase();
    AiProviderConfig {
        provider: provider.clone(),
        model: env_string(
            "AI_MODEL",
            if provider == "zdtaichu" {
                "ZDTaichu5.0-9B"
            } else {
                ""
            },
        ),
        base_url: env_string(
            "AI_BASE_URL",
            if provider == "llama-cpp" {
                "http://127.0.0.1:8080/v1"
            } else {
                "http://127.0.0.1:1234/v1"
            },
        ),
        api_key: String::new(),
        supports_vision: env_bool("AI_SUPPORTS_VISION", provider == "zdtaichu"),
        max_tokens: std::env::var("AI_MAX_TOKENS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(128)
            .clamp(1, 512),
        model_path: env_string("ZDTAICHU_MODEL_PATH", r"D:\models\ZDTaichu5.0-9B"),
        python_path: if provider == "zdtaichu" {
            env_string(
                "ZDTAICHU_PYTHON",
                r"C:\Users\30470\Anaconda3\envs\zdtaichu\python.exe",
            )
        } else {
            env_string("AI_BRIDGE_PYTHON", "python")
        },
    }
}

fn require_ai_ok(response: serde_json::Value) -> Result<serde_json::Value, String> {
    require_ok(response)
}

#[tauri::command]
fn ai_get_config() -> AiProviderConfig {
    default_ai_config()
}

#[tauri::command(rename_all = "camelCase")]
fn ai_start(state: State<AiState>, config: AiProviderConfig) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if guard.is_some() {
        return Err("已有模型会话，请先停止当前供应商".into());
    }

    let mut bridge = AiBridge::spawn(&config)?;
    let ready = bridge
        .call(&serde_json::json!({"cmd": "start", "config": config}))
        .and_then(require_ai_ok);
    match ready {
        Ok(data) if data["event"].as_str() == Some("ready") => {
            *guard = Some(bridge);
            Ok(())
        }
        Ok(_) => {
            bridge.kill();
            Err("AI 桥未返回 ready 状态".into())
        }
        Err(error) => {
            bridge.kill();
            Err(error)
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
fn ai_chat(
    state: State<AiState>,
    prompt: String,
    image_path: Option<String>,
) -> Result<AiChatResult, String> {
    let mut guard = state.lock().map_err(to_err)?;
    let bridge = guard.as_mut().ok_or("模型尚未启动")?;
    let response = bridge.call(&serde_json::json!({
        "cmd": "chat",
        "prompt": prompt,
        "imagePath": image_path,
    }));
    let response = match response {
        Ok(value) => value,
        Err(error) => {
            if let Some(mut failed_bridge) = guard.take() {
                failed_bridge.kill();
            }
            return Err(error);
        }
    };
    let data = require_ai_ok(response)?;
    serde_json::from_value(data).map_err(|error| format!("AI 结果解析失败：{error}"))
}

#[tauri::command]
fn ai_clear(state: State<AiState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    let bridge = guard.as_mut().ok_or("模型尚未启动")?;
    require_ai_ok(bridge.call(&serde_json::json!({"cmd": "clear"}))?)?;
    Ok(())
}

#[tauri::command]
fn ai_stop(state: State<AiState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if let Some(mut bridge) = guard.take() {
        let _ = bridge.call(&serde_json::json!({"cmd": "stop"}));
        bridge.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<Bridge>))
        .manage(Mutex::new(None::<AiBridge>))
        .manage(Mutex::new(None::<McuSession>))
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
            servo_write_speed,
            servo_sync_read_positions,
            mcu_serial_open,
            mcu_serial_close,
            mcu_serial_is_open,
            mcu_serial_send,
            mcu_serial_read_line,
            ai_get_config,
            ai_start,
            ai_chat,
            ai_clear,
            ai_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
