// Blockly 执行树的控制流与设备动作调度。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::{pose, ActionReply, ProgramAst, ProgramEvent, ProgramNode, ProgramRun};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

const MAX_LOOP: usize = 100_000;
const MAX_FUNCTION_DEPTH: usize = 32;
type Scope = HashMap<String, Value>;
type Definitions<'a> = HashMap<String, &'a ProgramNode>;

pub(super) struct Context<'a> {
    run: &'a ProgramRun,
    channel: &'a Channel<ProgramEvent>,
    receiver: Receiver<ActionReply>,
    sequence: u64,
    request_id: u64,
}

impl<'a> Context<'a> {
    pub fn new(
        run: &'a ProgramRun,
        channel: &'a Channel<ProgramEvent>,
        receiver: Receiver<ActionReply>,
    ) -> Self {
        Self {
            run,
            channel,
            receiver,
            sequence: 0,
            request_id: 0,
        }
    }

    fn emit(
        &mut self,
        kind: &'static str,
        request_id: Option<u64>,
        op: Option<String>,
        args: Option<Value>,
        text: Option<String>,
        log_kind: Option<&'static str>,
    ) -> Result<(), String> {
        self.sequence += 1;
        self.channel
            .send(ProgramEvent {
                version: 1,
                run_id: self.run.id,
                sequence: self.sequence,
                kind,
                request_id,
                op,
                args,
                text,
                log_kind,
            })
            .map_err(|error| format!("程序事件发送失败：{error}"))
    }

    fn check(&self) -> Result<(), String> {
        if self.run.cancelled.load(Ordering::Acquire) {
            Err("程序已停止".into())
        } else {
            Ok(())
        }
    }

    fn log(&mut self, text: impl Into<String>, kind: &'static str) -> Result<(), String> {
        self.emit("log", None, None, None, Some(text.into()), Some(kind))
    }

    fn action(&mut self, op: &str, args: Value) -> Result<Value, String> {
        self.check()?;
        self.request_id += 1;
        let request_id = self.request_id;
        self.emit(
            "action",
            Some(request_id),
            Some(op.into()),
            Some(args),
            None,
            None,
        )?;
        let started = Instant::now();
        loop {
            self.check()?;
            if started.elapsed() > Duration::from_secs(30) {
                return Err(format!("设备动作 {op} 等待回执超时"));
            }
            match self.receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(reply) if reply.request_id == request_id => {
                    return match reply.error {
                        Some(error) => Err(error),
                        None => Ok(reply.result),
                    };
                }
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return Err("设备动作回执通道已关闭".into()),
            }
        }
    }

    pub fn terminal(&mut self, kind: &'static str, text: Option<String>) {
        let _ = self.emit(kind, None, None, None, text, None);
    }
}

fn field<'a>(node: &'a ProgramNode, name: &str) -> &'a str {
    node.fields.get(name).map(String::as_str).unwrap_or("")
}
fn number(value: &Value, fallback: f64) -> f64 {
    let value = match value {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse::<f64>().ok(),
        Value::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        _ => None,
    };
    value.filter(|value| value.is_finite()).unwrap_or(fallback)
}
fn field_number(node: &ProgramNode, name: &str, fallback: f64) -> f64 {
    number(&Value::String(field(node, name).into()), fallback)
}
fn boolean(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(_) => number(value, 0.0) != 0.0,
        Value::String(value) => !value.is_empty(),
        _ => true,
    }
}
fn text(value: &Value) -> String {
    match value {
        Value::Null => "".into(),
        Value::String(value) => value.clone(),
        Value::Object(_) | Value::Array(_) => value.to_string(),
        _ => value.to_string(),
    }
}
fn json_number(value: f64) -> Result<Value, String> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or("表达式计算产生非有限数值".into())
}
fn input<'a>(node: &'a ProgramNode, name: &str) -> Result<&'a ProgramNode, String> {
    node.inputs
        .get(name)
        .ok_or_else(|| format!("积木缺少输入：{name}"))
}
fn eval_input<'a>(
    node: &'a ProgramNode,
    name: &str,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Value, String> {
    eval(input(node, name)?, context, scope, definitions, depth)
}

fn call_procedure<'a>(
    node: &ProgramNode,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Value, String> {
    if depth >= MAX_FUNCTION_DEPTH {
        return Err(format!("函数嵌套超过 {MAX_FUNCTION_DEPTH} 层"));
    }
    let name = field(node, "NAME");
    let definition = definitions
        .get(name)
        .ok_or_else(|| format!("函数不存在：{name}"))?;
    let metadata = definition.procedure.as_ref().ok_or("函数定义无效")?;
    let mut local = scope.clone();
    for (index, argument) in metadata.args.iter().enumerate() {
        local.insert(
            argument.clone(),
            eval_input(
                node,
                &format!("ARG{index}"),
                context,
                scope,
                definitions,
                depth + 1,
            )?,
        );
    }
    if let Some(value) = sequence(
        definition.inputs.get("STACK"),
        context,
        &mut local,
        definitions,
        depth + 1,
    )? {
        return Ok(value);
    }
    if metadata.has_return {
        if definition.inputs.contains_key("RETURN") {
            return eval_input(
                definition,
                "RETURN",
                context,
                &mut local,
                definitions,
                depth + 1,
            );
        }
    }
    Ok(Value::Null)
}

fn eval<'a>(
    node: &'a ProgramNode,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Value, String> {
    context.check()?;
    if !node.enabled {
        return Ok(Value::Null);
    }
    match node.kind.as_str() {
        "math_number" => json_number(field_number(node, "NUM", 0.0)),
        "logic_boolean" => Ok(json!(field(node, "BOOL") == "TRUE")),
        "logic_negate" => Ok(json!(!boolean(&eval_input(node, "BOOL", context, scope, definitions, depth)?))),
        "logic_operation" => {
            let left = boolean(&eval_input(node, "A", context, scope, definitions, depth)?);
            let or = field(node, "OP") == "OR";
            if or && left { return Ok(json!(true)); }
            let right = boolean(&eval_input(node, "B", context, scope, definitions, depth)?);
            Ok(json!(if or { left || right } else { left && right }))
        }
        "logic_compare" => {
            let left = eval_input(node, "A", context, scope, definitions, depth)?;
            let right = eval_input(node, "B", context, scope, definitions, depth)?;
            let op = field(node, "OP");
            if left.is_object() || left.is_array() || right.is_object() || right.is_array() {
                return Ok(json!(match op { "EQ" => left == right, "NEQ" => left != right, _ => false }));
            }
            let (a, b) = (number(&left, 0.0), number(&right, 0.0));
            Ok(json!(match op { "EQ" => a == b, "NEQ" => a != b, "LT" => a < b,
                "LTE" => a <= b, "GT" => a > b, _ => a >= b }))
        }
        "math_arithmetic" => {
            let a = number(&eval_input(node, "A", context, scope, definitions, depth)?, 0.0);
            let b = number(&eval_input(node, "B", context, scope, definitions, depth)?, 0.0);
            let value = match field(node, "OP") {
                "ADD" => a + b, "MINUS" => a - b, "MULTIPLY" => a * b,
                "DIVIDE" if b == 0.0 => return Err("除数不能为 0".into()),
                "DIVIDE" => a / b, "POWER" => a.powf(b), _ => return Err("不支持的数学运算".into()),
            };
            json_number(value)
        }
        "math_single" => {
            let value = number(&eval_input(node, "NUM", context, scope, definitions, depth)?, 0.0);
            let result = match field(node, "OP") {
                "NEG" => -value, "ABS" => value.abs(),
                "ROOT" if value < 0.0 => return Err("平方根不能作用于负数".into()),
                "ROOT" => value.sqrt(), _ => return Err("不支持的数学函数".into()),
            };
            json_number(result)
        }
        "text" => Ok(json!(field(node, "TEXT"))),
        "text_join" => {
            let a = text(&eval_input(node, "ADD0", context, scope, definitions, depth)?);
            let b = text(&eval_input(node, "ADD1", context, scope, definitions, depth)?);
            Ok(json!(format!("{a}{b}")))
        }
        "variables_get" => Ok(scope.get(field(node, "VAR")).cloned().unwrap_or(json!(0))),
        "variables_set" => {
            let value = eval_input(node, "VALUE", context, scope, definitions, depth)?;
            scope.insert(field(node, "VAR").into(), value);
            Ok(Value::Null)
        }
        "lists_create_with" => {
            let mut values = Vec::new();
            for index in 0..node.input_names.len() + 1 {
                let name = format!("ADD{index}");
                if !node.input_names.contains(&name) { break; }
                if let Some(child) = node.inputs.get(&name) { values.push(eval(child, context, scope, definitions, depth)?); }
            }
            Ok(Value::Array(values))
        }
        "procedures_callreturn" | "procedures_callnoreturn" => call_procedure(node, context, scope, definitions, depth),
        "read_joints" | "read_tcp" | "calibrate_joints" | "calibrate_eye_hand" => context.action(&node.kind, json!({})),
        "camera_detect_color" => context.action("camera_detect_color", json!({ "color": field(node, "COLOR"), "minArea": field_number(node, "MIN_AREA", 500.0) })),
        "camera_target_pose" => context.action("camera_target_pose", json!({ "widthM": field_number(node, "WIDTH_M", 0.04) })),
        "serial_read_line" => context.action("serial_read_line", json!({ "timeoutMs": 2000 })),
        "digital_read" | "analog_read" => context.action(&node.kind, json!({ "pin": field_number(node, "PIN", 0.0).trunc() })),
        "sense_color" => context.action("sense_color", json!({ "color": field(node, "COLOR") })),
        "pose_make" => Ok(pose::make(
            field_number(node, "X", 0.0), field_number(node, "Y", 0.0),
            field_number(node, "Z", 0.0), field_number(node, "ROLL", 0.0),
            field_number(node, "PITCH", 0.0), field_number(node, "YAW", 0.0)
        )),
        "pose_property" => {
            let target = eval_input(node, "POSE", context, scope, definitions, depth)?;
            pose::property(&target, field(node, "PROPERTY"))
        }
        "pose_inverse" => {
            let target = eval_input(node, "POSE", context, scope, definitions, depth)?;
            pose::invert(&target)
        }
        "pose_compose" => {
            let parent = eval_input(node, "PARENT", context, scope, definitions, depth)?;
            let child = eval_input(node, "CHILD", context, scope, definitions, depth)?;
            pose::compose(&parent, &child)
        }
        "camera_pose_to_base" => {
            let target = eval_input(node, "POSE", context, scope, definitions, depth)?;
            context.action("camera_pose_to_base", json!({ "target": target }))
        }
        _ => Err(format!("不支持的表达式积木：{}", node.kind)),
    }
}

fn control<'a>(
    node: &'a ProgramNode,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Option<Value>, String> {
    match node.kind.as_str() {
        "decision_if" => {
            let condition = boolean(&eval_input(
                node,
                "CONDITION",
                context,
                scope,
                definitions,
                depth,
            )?);
            context.log(
                if condition {
                    "条件满足，执行分支"
                } else {
                    "条件未满足，跳过分支"
                },
                "event",
            )?;
            if condition {
                sequence(node.inputs.get("DO"), context, scope, definitions, depth)
            } else {
                Ok(None)
            }
        }
        "controls_if" => {
            for index in 0..node.input_names.len() + 1 {
                let name = format!("IF{index}");
                if !node.input_names.contains(&name) {
                    break;
                }
                if boolean(&eval_input(
                    node,
                    &name,
                    context,
                    scope,
                    definitions,
                    depth,
                )?) {
                    return sequence(
                        node.inputs.get(&format!("DO{index}")),
                        context,
                        scope,
                        definitions,
                        depth,
                    );
                }
            }
            sequence(node.inputs.get("ELSE"), context, scope, definitions, depth)
        }
        "controls_repeat_ext" => {
            let count = number(
                &eval_input(node, "TIMES", context, scope, definitions, depth)?,
                0.0,
            )
            .floor();
            if count < 0.0 || count > MAX_LOOP as f64 {
                return Err(format!("循环次数必须位于 0..{MAX_LOOP}"));
            }
            for _ in 0..count as usize {
                if let Some(value) =
                    sequence(node.inputs.get("DO"), context, scope, definitions, depth)?
                {
                    return Ok(Some(value));
                }
            }
            Ok(None)
        }
        "controls_whileUntil" => {
            for _ in 0..MAX_LOOP {
                let condition = boolean(&eval_input(
                    node,
                    "BOOL",
                    context,
                    scope,
                    definitions,
                    depth,
                )?);
                if (field(node, "MODE") == "WHILE") != condition {
                    return Ok(None);
                }
                if let Some(value) =
                    sequence(node.inputs.get("DO"), context, scope, definitions, depth)?
                {
                    return Ok(Some(value));
                }
            }
            Err(format!("循环超过 {MAX_LOOP} 次"))
        }
        "controls_for" => {
            let from = number(
                &eval_input(node, "FROM", context, scope, definitions, depth)?,
                0.0,
            );
            let to = number(
                &eval_input(node, "TO", context, scope, definitions, depth)?,
                0.0,
            );
            let step = if node.inputs.contains_key("BY") {
                number(
                    &eval_input(node, "BY", context, scope, definitions, depth)?,
                    0.0,
                )
            } else if from <= to {
                1.0
            } else {
                -1.0
            };
            if step == 0.0 {
                return Err("循环步长不能为 0".into());
            }
            let mut value = from;
            for _ in 0..MAX_LOOP {
                if if step > 0.0 { value > to } else { value < to } {
                    return Ok(None);
                }
                scope.insert(field(node, "VAR").into(), json_number(value)?);
                if let Some(result) =
                    sequence(node.inputs.get("DO"), context, scope, definitions, depth)?
                {
                    return Ok(Some(result));
                }
                value += step;
            }
            if if step > 0.0 { value > to } else { value < to } {
                Ok(None)
            } else {
                Err(format!("循环超过 {MAX_LOOP} 次"))
            }
        }
        "controls_forEach" => {
            let list = eval_input(node, "LIST", context, scope, definitions, depth)?;
            let values = list.as_array().ok_or("遍历积木需要列表输入")?;
            if values.len() > MAX_LOOP {
                return Err(format!("循环超过 {MAX_LOOP} 次"));
            }
            for value in values {
                scope.insert(field(node, "VAR").into(), value.clone());
                if let Some(result) =
                    sequence(node.inputs.get("DO"), context, scope, definitions, depth)?
                {
                    return Ok(Some(result));
                }
            }
            Ok(None)
        }
        _ => Err("未知控制积木".into()),
    }
}

fn statement<'a>(
    node: &'a ProgramNode,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Option<Value>, String> {
    match node.kind.as_str() {
        "variables_set" => {
            let _ = eval(node, context, scope, definitions, depth)?;
            Ok(None)
        }
        "decision_if"
        | "controls_if"
        | "controls_repeat_ext"
        | "controls_whileUntil"
        | "controls_for"
        | "controls_forEach" => control(node, context, scope, definitions, depth),
        "procedures_ifreturn" => {
            let condition = boolean(&eval_input(
                node,
                "CONDITION",
                context,
                scope,
                definitions,
                depth,
            )?);
            if !condition {
                return Ok(None);
            }
            let value = if node.inputs.contains_key("VALUE") {
                eval_input(node, "VALUE", context, scope, definitions, depth)?
            } else {
                Value::Null
            };
            Ok(Some(value))
        }
        "procedures_callnoreturn" => {
            let _ = call_procedure(node, context, scope, definitions, depth)?;
            context.log(format!("调用函数 {}", field(node, "NAME")), "event")?;
            Ok(None)
        }
        "select_arm" => {
            let id = field(node, "ARM_ID");
            context.action("select_arm", json!({ "robotId": id }))?;
            context.log(format!("已选择机械臂 {id}"), "event")?;
            Ok(None)
        }
        "arm_home" => {
            context.action("arm_home", json!({}))?;
            context.log("机械臂回零完成", "event")?;
            Ok(None)
        }
        "arm_joint_angle" => {
            let index = field_number(node, "JOINT", 0.0).trunc();
            let angle = field_number(node, "ANGLE", 0.0);
            context.action("arm_joint_angle", json!({ "index": index, "angleDeg": angle, "speed": field_number(node, "SPEED", 80.0) }))?;
            context.log(
                format!("关节 J{} 到 {}°", index as i64 + 1, field(node, "ANGLE")),
                "event",
            )?;
            Ok(None)
        }
        "arm_joint_angles" => {
            let angles: Vec<f64> = field(node, "ANGLES")
                .split(',')
                .filter_map(|part| part.trim().parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .collect();
            if angles.is_empty() {
                return Err("多关节角度列表无效".into());
            }
            context.action(
                "arm_joint_angles",
                json!({ "anglesDeg": angles, "speed": field_number(node, "SPEED", 80.0) }),
            )?;
            context.log(
                format!(
                    "多关节目标：{}°",
                    angles
                        .iter()
                        .map(|angle| format!("{angle:.1}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                "event",
            )?;
            Ok(None)
        }
        "arm_pose" => {
            let target = pose::make(
                field_number(node, "X", 0.0),
                field_number(node, "Y", 0.0),
                field_number(node, "Z", 0.0),
                field_number(node, "ROLL", 0.0),
                field_number(node, "PITCH", 0.0),
                field_number(node, "YAW", 0.0),
            );
            context.action(
                "arm_pose",
                json!({ "target": target, "speed": field_number(node, "SPEED", 80.0) }),
            )?;
            context.log(
                format!(
                    "TCP 移动到 {:.3}, {:.3}, {:.3} m",
                    field_number(node, "X", 0.0),
                    field_number(node, "Y", 0.0),
                    field_number(node, "Z", 0.0)
                ),
                "event",
            )?;
            Ok(None)
        }
        "gripper_open_percent" => {
            context.action("gripper_open_percent", json!({ "percent": field_number(node, "PERCENT", 0.0), "speed": field_number(node, "SPEED", 80.0) }))?;
            context.log(format!("夹爪开度 {}%", field(node, "PERCENT")), "event")?;
            Ok(None)
        }
        "motor_speed" => {
            context.action(
                "motor_speed",
                json!({ "speed": field_number(node, "SPEED", 0.0) }),
            )?;
            context.log(format!("默认速度 {}°/s", field(node, "SPEED")), "event")?;
            Ok(None)
        }
        "motor_torque" => {
            let enabled = field(node, "ON") == "1";
            context.action("motor_torque", json!({ "enabled": enabled }))?;
            context.log(
                if enabled {
                    "扭矩已使能"
                } else {
                    "扭矩已失能"
                },
                "event",
            )?;
            Ok(None)
        }
        "stop_robot" => {
            context.action("stop_robot", json!({}))?;
            context.log("机器人已停止", "warning")?;
            Ok(None)
        }
        "select_tool" => {
            let id = field(node, "TOOL_ID");
            context.action("select_tool", json!({ "toolId": id }))?;
            context.log(format!("切换工具 {id}"), "event")?;
            Ok(None)
        }
        "camera_capture" => {
            if !boolean(&context.action("camera_capture", json!({}))?) {
                return Err("摄像头帧不可用".into());
            }
            context.log("摄像头画面已更新", "event")?;
            Ok(None)
        }
        "lidar_scan" => {
            context.action("lidar_scan", json!({}))?;
            context.log("点云已更新", "event")?;
            Ok(None)
        }
        "serial_open" => {
            let port = field(node, "PORT");
            context.action(
                "serial_open",
                json!({ "port": port, "baud": field_number(node, "BAUD", 0.0) }),
            )?;
            context.log(format!("串口 {port} 已打开"), "event")?;
            Ok(None)
        }
        "serial_close" => {
            context.action("serial_close", json!({}))?;
            context.log("串口已关闭", "event")?;
            Ok(None)
        }
        "serial_send" => {
            let payload = text(&eval_input(
                node,
                "PAYLOAD",
                context,
                scope,
                definitions,
                depth,
            )?);
            context.action("serial_send", json!({ "payload": payload }))?;
            context.log(format!("串口已发送 {payload}"), "event")?;
            Ok(None)
        }
        "pin_mode" => {
            let pin = field_number(node, "PIN", 0.0).trunc();
            let mode = field(node, "MODE");
            context.action("pin_mode", json!({ "pin": pin, "mode": mode }))?;
            context.log(format!("引脚 {} 设为 {mode}", field(node, "PIN")), "event")?;
            Ok(None)
        }
        "digital_write" => {
            let pin = field_number(node, "PIN", 0.0).trunc();
            let value = if field(node, "VALUE") == "1" { 1 } else { 0 };
            context.action("digital_write", json!({ "pin": pin, "value": value }))?;
            context.log(
                format!("引脚 {} 写入 {}", field(node, "PIN"), field(node, "VALUE")),
                "event",
            )?;
            Ok(None)
        }
        "analog_write" => {
            let pin = field_number(node, "PIN", 0.0).trunc();
            context.action(
                "analog_write",
                json!({ "pin": pin, "value": field_number(node, "VALUE", 0.0) }),
            )?;
            context.log(
                format!("引脚 {} PWM {}", field(node, "PIN"), field(node, "VALUE")),
                "event",
            )?;
            Ok(None)
        }
        "turn_left" | "turn_right" | "grab_object" => {
            context.action(&node.kind, json!({}))?;
            context.log(
                match node.kind.as_str() {
                    "turn_left" => "向左转 20°",
                    "turn_right" => "向右转 20°",
                    _ => "夹爪闭合",
                },
                "event",
            )?;
            Ok(None)
        }
        "move_steps" => {
            context.log("旧演示步数块不驱动运动，请改用关节或位姿积木", "warning")?;
            Ok(None)
        }
        _ => Err(format!("不支持的语句积木：{}", node.kind)),
    }
}

fn sequence<'a>(
    start: Option<&'a ProgramNode>,
    context: &mut Context,
    scope: &mut Scope,
    definitions: &Definitions<'a>,
    depth: usize,
) -> Result<Option<Value>, String> {
    let mut current = start;
    while let Some(node) = current {
        context.check()?;
        if node.enabled {
            if let Some(value) = statement(node, context, scope, definitions, depth)? {
                return Ok(Some(value));
            }
        }
        current = node.next.as_deref();
    }
    Ok(None)
}

pub(super) fn execute(ast: &ProgramAst, context: &mut Context) -> Result<(), String> {
    let mut definitions = HashMap::new();
    for node in &ast.top {
        if let Some(metadata) = &node.procedure {
            definitions.insert(metadata.name.clone(), node);
        }
    }
    let start = ast
        .top
        .iter()
        .find(|node| node.kind == "event_start")
        .ok_or("程序缺少“开始运行”积木")?;
    let mut scope = Scope::new();
    sequence(start.next.as_deref(), context, &mut scope, &definitions, 0)?;
    context.log("程序执行完成", "success")?;
    Ok(())
}
