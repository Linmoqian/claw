// 设备与模型服务。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

pub fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

/// 统一桥响应：ok=false 时把 error 提为 Err，ok=true 时返回 data
pub fn require_ok(resp: serde_json::Value) -> Result<serde_json::Value, String> {
    if resp["ok"].as_bool().unwrap_or(false) {
        Ok(resp["data"].clone())
    } else {
        Err(resp["error"]
            .as_str()
            .unwrap_or("桥返回未知错误")
            .to_string())
    }
}
