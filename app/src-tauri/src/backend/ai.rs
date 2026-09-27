// 设备与模型服务。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::common::{require_ok, to_err};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

const AI_BRIDGE_SCRIPT: &str = include_str!("../../python/zdtaichu_bridge.py");
pub type AiState = Mutex<Option<AiBridge>>;

/// 常驻 AI Python 桥：会话通过 JSON 行协议串行化。
pub struct AiBridge {
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

// —— ZDTaichu 视觉助手 ——

#[derive(Deserialize, Serialize)]
pub struct AiChatResult {
    answer: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
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
pub fn ai_get_config() -> AiProviderConfig {
    default_ai_config()
}

#[tauri::command(rename_all = "camelCase")]
pub fn ai_start(state: State<AiState>, config: AiProviderConfig) -> Result<(), String> {
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
pub fn ai_chat(
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
pub fn ai_clear(state: State<AiState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    let bridge = guard.as_mut().ok_or("模型尚未启动")?;
    require_ai_ok(bridge.call(&serde_json::json!({"cmd": "clear"}))?)?;
    Ok(())
}

#[tauri::command]
pub fn ai_stop(state: State<AiState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(to_err)?;
    if let Some(mut bridge) = guard.take() {
        let _ = bridge.call(&serde_json::json!({"cmd": "stop"}));
        bridge.kill();
    }
    Ok(())
}
