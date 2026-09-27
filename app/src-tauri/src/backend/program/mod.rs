// 桌面程序生命周期与有序动作通道。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

mod interpreter;
mod pose;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramNode {
    #[serde(rename = "type")]
    kind: String,
    enabled: bool,
    fields: HashMap<String, String>,
    #[serde(default)]
    input_names: Vec<String>,
    inputs: HashMap<String, ProgramNode>,
    next: Option<Box<ProgramNode>>,
    procedure: Option<ProcedureDefinition>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcedureDefinition {
    name: String,
    args: Vec<String>,
    has_return: bool,
}

#[derive(Deserialize)]
pub struct ProgramAst {
    version: u8,
    top: Vec<ProgramNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramEvent {
    version: u8,
    run_id: u64,
    sequence: u64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    op: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    log_kind: Option<&'static str>,
}

struct ActionReply {
    request_id: u64,
    result: Value,
    error: Option<String>,
}

struct ProgramRun {
    id: u64,
    cancelled: AtomicBool,
    replies: mpsc::Sender<ActionReply>,
}

pub struct ProgramManager {
    active: Arc<Mutex<Option<Arc<ProgramRun>>>>,
    next_id: AtomicU64,
}

impl ProgramManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
            next_id: AtomicU64::new(0),
        }
    }
}

fn count_nodes(node: &ProgramNode, depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if *count > 5000 || depth > 256 {
        return Err("程序积木数量或嵌套深度超出限制".into());
    }
    for child in node.inputs.values() {
        count_nodes(child, depth + 1, count)?;
    }
    if let Some(next) = &node.next {
        count_nodes(next, depth + 1, count)?;
    }
    Ok(())
}

#[tauri::command]
pub fn program_start(
    state: State<ProgramManager>,
    ast: ProgramAst,
    channel: Channel<ProgramEvent>,
) -> Result<u64, String> {
    if ast.version != 1 {
        return Err("程序快照版本不受支持".into());
    }
    let mut count = 0;
    for node in &ast.top {
        count_nodes(node, 0, &mut count)?;
    }
    if !ast
        .top
        .iter()
        .any(|node| node.kind == "event_start" && node.next.is_some())
    {
        return Err("程序缺少开始积木或可执行动作".into());
    }
    let mut active = state.active.lock().map_err(|error| error.to_string())?;
    if active.is_some() {
        return Err("已有程序正在执行".into());
    }
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (sender, receiver) = mpsc::channel();
    let run = Arc::new(ProgramRun {
        id,
        cancelled: AtomicBool::new(false),
        replies: sender,
    });
    *active = Some(run.clone());
    let slot = state.active.clone();
    std::thread::spawn(move || {
        let mut context = interpreter::Context::new(&run, &channel, receiver);
        let outcome = interpreter::execute(&ast, &mut context);
        if let Ok(mut active) = slot.lock() {
            if active.as_ref().is_some_and(|current| current.id == id) {
                *active = None;
            }
        }
        match outcome {
            Ok(()) if run.cancelled.load(Ordering::Acquire) => context.terminal("stopped", None),
            Ok(()) => context.terminal("complete", None),
            Err(_) if run.cancelled.load(Ordering::Acquire) => context.terminal("stopped", None),
            Err(error) => context.terminal("error", Some(error)),
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn program_reply(
    state: State<ProgramManager>,
    run_id: u64,
    request_id: u64,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let active = state.active.lock().map_err(|failure| failure.to_string())?;
    let run = active
        .as_ref()
        .filter(|run| run.id == run_id)
        .ok_or("程序已结束，忽略过期动作回复")?;
    run.replies
        .send(ActionReply {
            request_id,
            result: result.unwrap_or(Value::Null),
            error,
        })
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub fn program_stop(state: State<ProgramManager>, run_id: u64) -> Result<(), String> {
    let active = state.active.lock().map_err(|failure| failure.to_string())?;
    let run = active
        .as_ref()
        .filter(|run| run.id == run_id)
        .ok_or("程序已结束")?;
    run.cancelled.store(true, Ordering::Release);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn frozen_loop_dispatches_actions_in_order_and_waits_for_replies() {
        let ast: ProgramAst = serde_json::from_value(serde_json::json!({
            "version": 1,
            "top": [{ "type": "event_start", "enabled": true, "fields": {}, "inputs": {},
                "next": { "type": "controls_repeat_ext", "enabled": true, "fields": {},
                    "inputs": {
                        "TIMES": { "type": "math_number", "enabled": true, "fields": { "NUM": "3" }, "inputs": {} },
                        "DO": { "type": "arm_joint_angle", "enabled": true,
                            "fields": { "JOINT": "0", "ANGLE": "20", "SPEED": "60" }, "inputs": {} }
                    }
                }
            }]
        })).unwrap();
        let (sender, receiver) = mpsc::channel();
        let run = ProgramRun {
            id: 7,
            cancelled: AtomicBool::new(false),
            replies: sender.clone(),
        };
        let actions = Arc::new(Mutex::new(Vec::new()));
        let observed = actions.clone();
        let channel = Channel::<ProgramEvent>::new(move |body| {
            if let InvokeResponseBody::Json(raw) = body {
                let event: Value = serde_json::from_str(&raw)?;
                if event["kind"] == "action" {
                    observed
                        .lock()
                        .unwrap()
                        .push(event["op"].as_str().unwrap().to_owned());
                    sender
                        .send(ActionReply {
                            request_id: event["requestId"].as_u64().unwrap(),
                            result: Value::Null,
                            error: None,
                        })
                        .unwrap();
                }
            }
            Ok(())
        });
        let mut context = interpreter::Context::new(&run, &channel, receiver);
        interpreter::execute(&ast, &mut context).unwrap();
        assert_eq!(actions.lock().unwrap().as_slice(), ["arm_joint_angle"; 3]);
    }

    #[test]
    fn cancellation_interrupts_pending_device_action() {
        let ast: ProgramAst = serde_json::from_value(serde_json::json!({
            "version": 1,
            "top": [{ "type": "event_start", "enabled": true, "fields": {}, "inputs": {},
                "next": { "type": "arm_home", "enabled": true, "fields": {}, "inputs": {} }
            }]
        }))
        .unwrap();
        let (reply_sender, receiver) = mpsc::channel();
        let run = Arc::new(ProgramRun {
            id: 8,
            cancelled: AtomicBool::new(false),
            replies: reply_sender,
        });
        let (action_sender, action_receiver) = mpsc::channel();
        let channel = Channel::<ProgramEvent>::new(move |body| {
            if let InvokeResponseBody::Json(raw) = body {
                let event: Value = serde_json::from_str(&raw)?;
                if event["kind"] == "action" {
                    action_sender.send(()).unwrap();
                }
            }
            Ok(())
        });
        let worker_run = run.clone();
        let worker = std::thread::spawn(move || {
            let mut context = interpreter::Context::new(&worker_run, &channel, receiver);
            interpreter::execute(&ast, &mut context)
        });
        action_receiver
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        run.cancelled.store(true, Ordering::Release);
        assert!(worker.join().unwrap().is_err());
    }
}
