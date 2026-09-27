// 旧录像角度转换与有序回放状态流。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Deserialize)]
pub struct ReplayFrame {
    t: f64,
    pose: ReplayPose,
    joints: BTreeMap<String, f64>,
}

#[derive(Clone, Deserialize)]
struct ReplayPose {
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySnapshot {
    version: u8,
    sequence: u64,
    timestamp_ms: u128,
    position: f64,
    duration: f64,
    playing: bool,
    rate: f64,
    robot: ReplayRobot,
}

#[derive(Clone, Serialize)]
struct ReplayRobot {
    pose: RobotPose,
    velocity: RobotVelocity,
    joints: BTreeMap<String, f64>,
}

#[derive(Clone, Serialize)]
struct RobotPose {
    position: Position,
    orientation: Quaternion,
}

#[derive(Clone, Serialize)]
struct Position {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Clone, Serialize)]
struct Quaternion {
    x: f64,
    y: f64,
    z: f64,
    w: f64,
}

#[derive(Clone, Serialize)]
struct RobotVelocity {
    linear: Position,
    angular: Position,
}

struct ReplayState {
    frames: Vec<ReplayFrame>,
    position: f64,
    rate: f64,
    playing: bool,
    sequence: u64,
    last_tick: Instant,
    subscribers: Vec<Channel<ReplaySnapshot>>,
}

impl ReplayState {
    fn duration(&self) -> f64 {
        self.frames.last().map_or(0.0, |frame| frame.t)
    }

    fn interpolate(&self, position: f64) -> ReplayRobot {
        let frames = &self.frames;
        let (a, b, alpha) = if position <= frames[0].t {
            (&frames[0], &frames[0], 0.0)
        } else if position >= self.duration() {
            let last = frames.last().unwrap();
            (last, last, 0.0)
        } else {
            let upper = frames.partition_point(|frame| frame.t <= position);
            let lower = upper - 1;
            let a = &frames[lower];
            let b = &frames[upper];
            (a, b, (position - a.t) / (b.t - a.t))
        };
        let lerp = |left: f64, right: f64| left + (right - left) * alpha;
        let yaw_delta = (b.pose.yaw - a.pose.yaw)
            .sin()
            .atan2((b.pose.yaw - a.pose.yaw).cos());
        let yaw = a.pose.yaw + yaw_delta * alpha;
        let half = yaw / 2.0;
        let joints = a
            .joints
            .iter()
            .map(|(name, start)| {
                let end = b.joints.get(name).unwrap_or(start);
                (name.clone(), lerp(*start, *end).to_radians())
            })
            .collect();
        ReplayRobot {
            pose: RobotPose {
                position: Position {
                    x: lerp(a.pose.x, b.pose.x),
                    y: lerp(a.pose.y, b.pose.y),
                    z: lerp(a.pose.z, b.pose.z),
                },
                orientation: Quaternion {
                    x: 0.0,
                    y: 0.0,
                    z: half.sin(),
                    w: half.cos(),
                },
            },
            velocity: RobotVelocity {
                linear: Position {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                angular: Position {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            joints,
        }
    }

    fn snapshot(&self) -> ReplaySnapshot {
        ReplaySnapshot {
            version: 1,
            sequence: self.sequence,
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            position: self.position,
            duration: self.duration(),
            playing: self.playing,
            rate: self.rate,
            robot: self.interpolate(self.position),
        }
    }

    fn publish(&mut self) {
        self.sequence += 1;
        let snapshot = self.snapshot();
        self.subscribers
            .retain(|channel| channel.send(snapshot.clone()).is_ok());
    }

    fn tick(&mut self) {
        let now = Instant::now();
        if self.playing {
            self.position = (self.position
                + now.duration_since(self.last_tick).as_secs_f64() * self.rate)
                .min(self.duration());
            if self.position >= self.duration() {
                self.playing = false;
            }
            self.publish();
        }
        self.last_tick = now;
    }
}

struct ReplayHandle {
    state: Arc<Mutex<ReplayState>>,
    stopped: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

pub struct ReplayManager(Mutex<Option<ReplayHandle>>);

impl ReplayManager {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

fn active(manager: &State<ReplayManager>) -> Result<Arc<Mutex<ReplayState>>, String> {
    manager
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
        .map(|handle| Arc::clone(&handle.state))
        .ok_or("尚未载入回放录像".into())
}

fn stop(handle: ReplayHandle) -> Result<(), String> {
    handle.stopped.store(true, Ordering::Relaxed);
    handle
        .worker
        .join()
        .map_err(|_| "回放线程异常退出".to_string())
}

#[tauri::command]
pub fn replay_load(
    manager: State<ReplayManager>,
    frames: Vec<ReplayFrame>,
) -> Result<ReplaySnapshot, String> {
    if frames.is_empty() {
        return Err("录像中没有运动帧".into());
    }
    if frames.len() > 1_000_000 {
        return Err("录像帧超过上限".into());
    }
    let mut previous = -1.0;
    for frame in &frames {
        if !frame.t.is_finite()
            || frame.t < 0.0
            || frame.t <= previous
            || ![frame.pose.x, frame.pose.y, frame.pose.z, frame.pose.yaw]
                .iter()
                .all(|value| value.is_finite())
            || !frame.joints.values().all(|value| value.is_finite())
        {
            return Err("录像帧损坏，原文件已保留".into());
        }
        previous = frame.t;
    }
    let mut guard = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(previous) = guard.take() {
        stop(previous)?;
    }
    let state = Arc::new(Mutex::new(ReplayState {
        frames,
        position: 0.0,
        rate: 1.0,
        playing: false,
        sequence: 0,
        last_tick: Instant::now(),
        subscribers: Vec::new(),
    }));
    let stopped = Arc::new(AtomicBool::new(false));
    let thread_state = Arc::clone(&state);
    let thread_stop = Arc::clone(&stopped);
    let worker = thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            if let Ok(mut state) = thread_state.lock() {
                state.tick();
            } else {
                break;
            }
            thread::sleep(Duration::from_millis(33));
        }
    });
    let snapshot = state.lock().map_err(|error| error.to_string())?.snapshot();
    *guard = Some(ReplayHandle {
        state,
        stopped,
        worker,
    });
    Ok(snapshot)
}

#[tauri::command]
pub fn replay_subscribe(
    manager: State<ReplayManager>,
    channel: Channel<ReplaySnapshot>,
) -> Result<(), String> {
    let state = active(&manager)?;
    let mut replay = state.lock().map_err(|error| error.to_string())?;
    channel
        .send(replay.snapshot())
        .map_err(|error| error.to_string())?;
    replay.subscribers.push(channel);
    Ok(())
}

#[tauri::command]
pub fn replay_control(
    manager: State<ReplayManager>,
    command: String,
    value: Option<f64>,
) -> Result<ReplaySnapshot, String> {
    let state = active(&manager)?;
    let mut replay = state.lock().map_err(|error| error.to_string())?;
    match command.as_str() {
        "play" => {
            if replay.position >= replay.duration() {
                replay.position = 0.0;
            }
            replay.playing = true;
            replay.last_tick = Instant::now();
        }
        "pause" => replay.playing = false,
        "seek" => {
            let value = value.ok_or("缺少回放位置")?;
            if !value.is_finite() {
                return Err("回放位置无效".into());
            }
            replay.position = value.clamp(0.0, replay.duration());
            replay.last_tick = Instant::now();
        }
        "rate" => {
            let value = value.ok_or("缺少回放倍率")?;
            if !value.is_finite() || !(0.1..=4.0).contains(&value) {
                return Err("回放倍率须在 0.1 至 4 倍之间".into());
            }
            replay.rate = value;
        }
        _ => return Err("未知回放命令".into()),
    }
    replay.publish();
    Ok(replay.snapshot())
}

#[tauri::command]
pub fn replay_clear(manager: State<ReplayManager>) -> Result<(), String> {
    if let Some(handle) = manager.0.lock().map_err(|error| error.to_string())?.take() {
        stop(handle)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ninety_degree_recording_keeps_units_at_start_middle_and_end() {
        let state = ReplayState {
            frames: vec![
                ReplayFrame {
                    t: 0.0,
                    pose: ReplayPose {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                        yaw: 0.0,
                    },
                    joints: BTreeMap::from([("J1".into(), 0.0)]),
                },
                ReplayFrame {
                    t: 2.0,
                    pose: ReplayPose {
                        x: 1.0,
                        y: 0.0,
                        z: 0.0,
                        yaw: 0.0,
                    },
                    joints: BTreeMap::from([("J1".into(), 90.0)]),
                },
            ],
            position: 0.0,
            rate: 1.0,
            playing: false,
            sequence: 0,
            last_tick: Instant::now(),
            subscribers: Vec::new(),
        };
        for (time, expected) in [
            (0.0, 0.0),
            (1.0, std::f64::consts::FRAC_PI_4),
            (2.0, std::f64::consts::FRAC_PI_2),
        ] {
            let actual = state.interpolate(time).joints["J1"];
            assert!((actual - expected).abs() < 1.0e-10);
        }
    }
}
