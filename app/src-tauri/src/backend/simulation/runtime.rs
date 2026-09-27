// 单实例固定步长仿真与有序状态流。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::model::RobotModel;
use super::physics::{PhysicsScene, PropPose};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::State;

const STEP: Duration = Duration::from_millis(10);
const STREAM: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Default, Serialize)]
pub struct BasePose {
    x: f32,
    y: f32,
    yaw: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationFrame {
    version: u8,
    robot_id: String,
    sequence: u64,
    timestamp_ms: u128,
    joints_rad: Vec<f32>,
    target_rad: Vec<f32>,
    mode: &'static str,
    speed: f32,
    progress: f32,
    base: BasePose,
    tcp_position_m: [f32; 3],
    props: Vec<PropPose>,
}

struct SimulationState {
    model: RobotModel,
    joints: Vec<f32>,
    targets: Vec<f32>,
    mode: &'static str,
    speed: f32,
    trajectory_time_s: f32,
    paused: bool,
    base: BasePose,
    base_target: BasePose,
    last_command_sequence: u64,
    frame_sequence: u64,
    physics: PhysicsScene,
    subscribers: Vec<Channel<SimulationFrame>>,
}

impl SimulationState {
    fn new(model: RobotModel) -> Self {
        let count = model.active.len();
        Self {
            model,
            joints: vec![0.0; count],
            targets: vec![0.0; count],
            mode: "manual",
            speed: 1.0,
            trajectory_time_s: 0.0,
            paused: false,
            base: BasePose::default(),
            base_target: BasePose::default(),
            last_command_sequence: 0,
            frame_sequence: 0,
            physics: PhysicsScene::new(),
            subscribers: Vec::new(),
        }
    }

    fn step(&mut self, dt_s: f32) {
        if self.paused {
            return;
        }
        let base_dt = dt_s.clamp(0.0, 0.05);
        let dt = base_dt * self.speed;
        if self.mode == "play" {
            self.trajectory_time_s = (self.trajectory_time_s + dt) % 10.0;
            let poses: [[f32; 6]; 5] = [
                [0.0; 6],
                [60.0, 80.0, -90.0, -30.0, 60.0, 25.0],
                [-60.0, 60.0, -60.0, 40.0, -60.0, 50.0],
                [0.0, 110.0, -120.0, -50.0, 0.0, 35.0],
                [0.0; 6],
            ];
            let segment = (self.trajectory_time_s / 2.5).floor() as usize;
            let factor = (self.trajectory_time_s / 2.5) - segment as f32;
            let limits = self.model.joint_limits();
            for (index, (current, target)) in self
                .joints
                .iter_mut()
                .zip(self.targets.iter_mut())
                .enumerate()
            {
                let degrees = poses[segment][index.min(5)] * (1.0 - factor)
                    + poses[segment + 1][index.min(5)] * factor;
                let (lower, upper) = limits[index];
                *current = degrees.to_radians().clamp(lower, upper);
                *target = *current;
            }
        } else {
            let rate: f32 = if self.mode == "homing" { 90.0 } else { 300.0 };
            let joint_step = rate.to_radians() * dt;
            for (current, target) in self.joints.iter_mut().zip(&self.targets) {
                *current += (*target - *current).clamp(-joint_step, joint_step);
            }
        }
        let dx = self.base_target.x - self.base.x;
        let dy = self.base_target.y - self.base.y;
        let distance = dx.hypot(dy);
        if distance > 1.0e-6 {
            let move_m = distance.min(0.18 * base_dt);
            self.base.x += dx / distance * move_m;
            self.base.y += dy / distance * move_m;
        }
        let yaw_error = (self.base_target.yaw - self.base.yaw)
            .sin()
            .atan2((self.base_target.yaw - self.base.yaw).cos());
        self.base.yaw += yaw_error.clamp(-1.2 * base_dt, 1.2 * base_dt);
        let tcp = self.model.tcp_pose(&self.joints).position;
        let (sin_yaw, cos_yaw) = self.base.yaw.sin_cos();
        let world_tcp = [
            self.base.x + cos_yaw * tcp.x - sin_yaw * tcp.y,
            self.base.y + sin_yaw * tcp.x + cos_yaw * tcp.y,
            tcp.z,
        ];
        self.physics.step(base_dt, world_tcp);
        self.frame_sequence += 1;
    }

    fn frame(&self) -> SimulationFrame {
        let tcp = self.model.tcp_pose(&self.joints).position;
        let (sin_yaw, cos_yaw) = self.base.yaw.sin_cos();
        SimulationFrame {
            version: 1,
            robot_id: self.model.id.clone(),
            sequence: self.frame_sequence,
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            joints_rad: self.joints.clone(),
            target_rad: self.targets.clone(),
            mode: self.mode,
            speed: self.speed,
            progress: if self.mode == "play" {
                self.trajectory_time_s / 10.0
            } else {
                0.0
            },
            base: self.base,
            tcp_position_m: [
                self.base.x + cos_yaw * tcp.x - sin_yaw * tcp.y,
                self.base.y + sin_yaw * tcp.x + cos_yaw * tcp.y,
                tcp.z,
            ],
            props: self.physics.props(),
        }
    }

    fn accept_command(&mut self, robot_id: &str, sequence: u64) -> Result<(), String> {
        if self.model.id != robot_id {
            return Err("机型已切换，旧控制命令被拒绝".into());
        }
        if sequence <= self.last_command_sequence {
            return Err("过期控制命令被拒绝".into());
        }
        self.last_command_sequence = sequence;
        Ok(())
    }
}

struct RuntimeHandle {
    shared: Arc<Mutex<SimulationState>>,
    stopped: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

pub struct RuntimeManager(Mutex<Option<RuntimeHandle>>);

impl RuntimeManager {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

fn runtime(state: &State<RuntimeManager>) -> Result<Arc<Mutex<SimulationState>>, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
        .map(|handle| Arc::clone(&handle.shared))
        .ok_or("仿真运行时尚未启动".into())
}

#[tauri::command]
pub fn simulation_start(
    state: State<RuntimeManager>,
    robot_id: String,
) -> Result<SimulationFrame, String> {
    let mut guard = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(handle) = guard.as_ref() {
        let runtime = handle.shared.lock().map_err(|error| error.to_string())?;
        if runtime.model.id != robot_id {
            return Err("请先停止当前机型的仿真运行时".into());
        }
        return Ok(runtime.frame());
    }
    let model = RobotModel::builtin(&robot_id)?;
    let shared = Arc::new(Mutex::new(SimulationState::new(model)));
    let stopped = Arc::new(AtomicBool::new(false));
    let thread_state = Arc::clone(&shared);
    let thread_stop = Arc::clone(&stopped);
    let worker = thread::spawn(move || {
        let mut last = Instant::now();
        let mut next_stream = last + STREAM;
        while !thread_stop.load(Ordering::Relaxed) {
            let started = Instant::now();
            let dt = started.duration_since(last).as_secs_f32();
            last = started;
            if let Ok(mut state) = thread_state.lock() {
                state.step(dt);
                if started >= next_stream {
                    let frame = state.frame();
                    state
                        .subscribers
                        .retain(|subscriber| subscriber.send(frame.clone()).is_ok());
                    next_stream += STREAM;
                    if next_stream <= started {
                        next_stream = started + STREAM;
                    }
                }
            } else {
                break;
            }
            thread::sleep(STEP.saturating_sub(started.elapsed()));
        }
    });
    let frame = shared.lock().map_err(|error| error.to_string())?.frame();
    *guard = Some(RuntimeHandle {
        shared,
        stopped,
        worker,
    });
    Ok(frame)
}

#[tauri::command]
pub fn simulation_subscribe(
    state: State<RuntimeManager>,
    channel: Channel<SimulationFrame>,
) -> Result<(), String> {
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    channel
        .send(sim.frame())
        .map_err(|error| error.to_string())?;
    sim.subscribers.push(channel);
    Ok(())
}

#[tauri::command]
pub fn simulation_frame(state: State<RuntimeManager>) -> Result<SimulationFrame, String> {
    Ok(runtime(&state)?
        .lock()
        .map_err(|error| error.to_string())?
        .frame())
}

#[tauri::command]
pub fn simulation_reset_props(state: State<RuntimeManager>) -> Result<(), String> {
    let shared = runtime(&state)?;
    shared
        .lock()
        .map_err(|error| error.to_string())?
        .physics
        .reset();
    Ok(())
}

#[tauri::command]
pub fn simulation_set_joint_targets(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
    joints_rad: Vec<f32>,
) -> Result<(), String> {
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    if sim.paused {
        return Err("回放期间不能控制仿真，请先退出回放".into());
    }
    if joints_rad.len() != sim.joints.len() {
        return Err("关节数量与机型不匹配".into());
    }
    for (angle, (lower, upper)) in joints_rad.iter().zip(sim.model.joint_limits()) {
        if !angle.is_finite() || *angle < lower || *angle > upper {
            return Err("关节目标超出限位或不是有效弧度".into());
        }
    }
    sim.accept_command(&robot_id, sequence)?;
    sim.targets = joints_rad;
    sim.mode = "manual";
    Ok(())
}

#[tauri::command]
pub fn simulation_set_base_target(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
    x: f32,
    y: f32,
    yaw: f32,
) -> Result<(), String> {
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    if sim.paused {
        return Err("回放期间不能控制仿真，请先退出回放".into());
    }
    if ![x, y, yaw].iter().all(|value| value.is_finite()) {
        return Err("底盘目标包含无效 SI 数值".into());
    }
    sim.accept_command(&robot_id, sequence)?;
    sim.base_target = BasePose { x, y, yaw };
    Ok(())
}

#[tauri::command]
pub fn simulation_stop_motion(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
) -> Result<(), String> {
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    sim.accept_command(&robot_id, sequence)?;
    sim.targets = sim.joints.clone();
    sim.base_target = sim.base;
    sim.mode = "manual";
    Ok(())
}

#[tauri::command]
pub fn simulation_set_mode(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
    mode: String,
    speed: f32,
) -> Result<(), String> {
    if !speed.is_finite() || !(0.05..=5.0).contains(&speed) {
        return Err("仿真速度超出范围".into());
    }
    if !["manual", "homing", "play"].contains(&mode.as_str()) {
        return Err("未知仿真模式".into());
    }
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    if sim.paused {
        return Err("回放期间不能控制仿真，请先退出回放".into());
    }
    sim.accept_command(&robot_id, sequence)?;
    sim.speed = speed;
    sim.mode = match mode.as_str() {
        "homing" => {
            sim.targets.fill(0.0);
            "homing"
        }
        "play" => {
            sim.trajectory_time_s = 0.0;
            "play"
        }
        _ => "manual",
    };
    Ok(())
}

#[tauri::command]
pub fn simulation_set_speed(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
    speed: f32,
) -> Result<(), String> {
    if !speed.is_finite() || !(0.05..=5.0).contains(&speed) {
        return Err("仿真速度超出范围".into());
    }
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    sim.accept_command(&robot_id, sequence)?;
    sim.speed = speed;
    Ok(())
}

#[tauri::command]
pub fn simulation_set_paused(
    state: State<RuntimeManager>,
    robot_id: String,
    sequence: u64,
    paused: bool,
) -> Result<(), String> {
    let shared = runtime(&state)?;
    let mut sim = shared.lock().map_err(|error| error.to_string())?;
    sim.accept_command(&robot_id, sequence)?;
    sim.paused = paused;
    if paused {
        sim.targets = sim.joints.clone();
        sim.base_target = sim.base;
        sim.mode = "manual";
    }
    Ok(())
}

#[tauri::command]
pub fn simulation_stop_runtime(state: State<RuntimeManager>) -> Result<(), String> {
    let Some(handle) = state.0.lock().map_err(|error| error.to_string())?.take() else {
        return Ok(());
    };
    handle.stopped.store(true, Ordering::Relaxed);
    handle
        .worker
        .join()
        .map_err(|_| "仿真线程异常退出".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_step_moves_joints_and_base_toward_targets() {
        let mut sim = SimulationState::new(RobotModel::builtin("so100").unwrap());
        sim.targets[0] = 0.3;
        sim.base_target.x = 1.0;
        sim.step(0.02);
        assert!(sim.joints[0] > 0.0 && sim.joints[0] < 0.3);
        assert!(sim.base.x > 0.0 && sim.base.x < 1.0);
        assert_eq!(sim.frame().version, 1);
    }

    #[test]
    fn stop_sequence_rejects_earlier_motion() {
        let mut sim = SimulationState::new(RobotModel::builtin("so100").unwrap());
        sim.accept_command("so100", 4).unwrap();
        assert!(sim.accept_command("so100", 3).is_err());
        assert!(sim.accept_command("panthera", 5).is_err());
        assert!(sim.accept_command("so100", 5).is_ok());
    }
}
