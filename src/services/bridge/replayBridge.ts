/**
 * replayBridge —— 回放模式的 RobotBridge 实现（录制回放）。
 * 载入录像帧后按倍速推进播放头，线性插值重建 RobotState
 * → 与 WS 桥同构地喂给订阅方（bridgeStore → worldStore → 3D 复盘）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { RobotState } from "../../core/world/state";
import { yawQuaternion } from "../../core/world/pose";
import type { RecFrame } from "../protocol/recording";
import { recordingDuration } from "../protocol/recording";
import type { BridgeStatus, RobotBridge } from "./robotBridge";

/** 回放驱动周期（ms；30Hz 与 worldStore 低频纪律一致） */
const REPLAY_TICK_MS = 33;

export class ReplayBridge implements RobotBridge {
  readonly kind = "replay";
  private frames: RecFrame[] = [];
  private playing = false;
  private rate = 1;
  /** 播放头（录像时间轴，秒） */
  private tPos = 0;
  private timer: number | null = null;
  private lastTickAt = 0;
  private readonly robotListeners = new Set<
    (state: RobotState, timestampMs: number) => void
  >();

  /** 载入录像（重置播放头到 0，不自动播放） */
  load(frames: RecFrame[]): void {
    this.pause();
    this.frames = frames;
    this.tPos = 0;
    this.emit();
  }

  play(): void {
    if (this.playing || this.frames.length === 0) return;
    this.playing = true;
    this.lastTickAt = performance.now();
    this.timer = window.setInterval(() => this.tick(), REPLAY_TICK_MS);
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 播放头定位（秒，超出末尾钳到末尾） */
  seek(t: number): void {
    this.tPos = Math.min(Math.max(t, 0), this.duration);
    this.emit();
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 播放速率（UI 展示用） */
  get rateGetter(): number {
    return this.rate;
  }

  get position(): number {
    return this.tPos;
  }

  get duration(): number {
    return recordingDuration(this.frames);
  }

  async connect(): Promise<void> {
    /* 回放无连接语义：载入即就绪 */
  }

  async disconnect(): Promise<void> {
    this.pause();
  }

  getStatus(): BridgeStatus {
    return {
      kind: this.kind,
      connected: this.frames.length > 0,
      status: this.frames.length > 0 ? "connected" : "offline",
      latencyMs: 0,
      messageRateHz: this.playing ? 1000 / REPLAY_TICK_MS : null,
      lastMessageAt: Date.now(),
    };
  }

  subscribeRobotState(
    cb: (state: RobotState, timestampMs: number) => void,
  ): () => void {
    this.robotListeners.add(cb);
    this.emit();
    return () => this.robotListeners.delete(cb);
  }

  /** 回放只读 */
  async sendCommand(): Promise<void> {
    throw new Error("回放模式禁止下发控制指令");
  }

  /** 推进播放头（到末尾自动暂停） */
  private tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.tPos += dt * this.rate;
    if (this.tPos >= this.duration) {
      this.tPos = this.duration;
      this.pause();
    }
    this.emit();
  }

  /** 播放头位置 → 插值帧 → 订阅回调 */
  private emit(): void {
    if (this.frames.length === 0) return;
    const state = this.interpolate(this.tPos);
    for (const cb of this.robotListeners) cb(state, Date.now());
  }

  /** 帧间线性插值（yaw 走最短角差） */
  private interpolate(t: number): RobotState {
    const frames = this.frames;
    if (t <= frames[0].t) return toRobotState(frames[0]);
    const last = frames[frames.length - 1];
    if (t >= last.t) return toRobotState(last);
    // 二分找上界
    let lo = 0;
    let hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = frames[lo];
    const b = frames[hi];
    const alpha = (t - a.t) / (b.t - a.t || 1);
    const pose = {
      x: lerp(a.pose.x, b.pose.x, alpha),
      y: lerp(a.pose.y, b.pose.y, alpha),
      z: lerp(a.pose.z, b.pose.z, alpha),
      yaw: lerpAngle(a.pose.yaw, b.pose.yaw, alpha),
    };
    const joints: Record<string, number> = {};
    for (const key of Object.keys(a.joints)) {
      joints[key] = lerp(a.joints[key] ?? 0, b.joints[key] ?? 0, alpha);
    }
    return {
      pose: {
        position: { x: pose.x, y: pose.y, z: pose.z },
        orientation: yawQuaternion(pose.yaw),
      },
      velocity: {
        linear: { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      },
      joints,
    };
  }
}

function toRobotState(f: RecFrame): RobotState {
  return {
    pose: {
      position: { x: f.pose.x, y: f.pose.y, z: f.pose.z },
      orientation: yawQuaternion(f.pose.yaw),
    },
    velocity: {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    },
    joints: { ...f.joints },
  };
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** 角度插值（最短角差路径） */
function lerpAngle(a: number, b: number, alpha: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * alpha;
}
