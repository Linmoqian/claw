/**
 * replayBridge —— 回放模式的 RobotBridge 实现（录制回放）。
 * 载入录像帧后按倍速推进播放头，线性插值重建 RobotState
 * → 与 WS 桥同构地喂给订阅方（bridgeStore → worldStore → 3D 复盘）。
 *
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import type { RobotState } from "../../core/world/state";
import { yawQuaternion } from "../../core/world/pose";
import type { RecFrame } from "../protocol/recording";
import { recordingDuration } from "../protocol/recording";
import type { BridgeStatus, RobotBridge } from "./robotBridge";
import { degreesToRadians } from "../../robot/model";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

interface DesktopReplaySnapshot {
  version: number;
  sequence: number;
  timestampMs: number;
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
  robot: RobotState;
}

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
  private desktopReady: Promise<void> = Promise.resolve();
  private desktopLoad: Promise<void> = Promise.resolve();
  private desktopSequence = -1;
  private desktopSubscriptionVersion = 0;
  private desktopRobot: RobotState | null = null;
  private desktopDuration = 0;
  private desktopError: string | null = null;
  private readonly robotListeners = new Set<
    (state: RobotState, timestampMs: number) => void
  >();

  /** 载入录像（重置播放头到 0，不自动播放） */
  load(frames: RecFrame[]): void {
    if (isTauri()) {
      this.frames = frames;
      this.playing = false;
      this.tPos = 0;
      this.desktopDuration = frames[frames.length - 1]?.t ?? 0;
      this.desktopSequence = -1;
      this.desktopError = null;
      this.desktopSubscriptionVersion += 1;
      this.desktopReady = this.desktopReady.catch(() => undefined)
        .then(async () => {
          this.acceptDesktop(await invoke<DesktopReplaySnapshot>("replay_load", { frames }));
          if (this.robotListeners.size > 0) await this.subscribeDesktop();
        });
      this.desktopLoad = this.desktopReady;
      return;
    }
    this.pause();
    this.frames = frames;
    this.tPos = 0;
    this.emit();
  }

  play(): void {
    if (isTauri()) {
      if (this.frames.length === 0) return;
      this.playing = true;
      this.desktopControl("play");
      return;
    }
    if (this.playing || this.frames.length === 0) return;
    this.playing = true;
    this.lastTickAt = performance.now();
    this.timer = window.setInterval(() => this.tick(), REPLAY_TICK_MS);
  }

  pause(): void {
    if (isTauri()) {
      this.playing = false;
      this.desktopControl("pause");
      return;
    }
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 播放头定位（秒，超出末尾钳到末尾） */
  seek(t: number): void {
    if (isTauri()) {
      this.desktopControl("seek", t);
      return;
    }
    this.tPos = Math.min(Math.max(t, 0), this.duration);
    this.emit();
  }

  setRate(rate: number): void {
    if (isTauri()) {
      this.desktopControl("rate", rate);
      return;
    }
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
    return isTauri() ? this.desktopDuration : recordingDuration(this.frames);
  }

  async connect(): Promise<void> {
    if (isTauri()) {
      await this.desktopLoad;
      await this.desktopReady;
      if (this.desktopError) throw new Error(this.desktopError);
    }
  }

  async disconnect(): Promise<void> {
    if (isTauri()) {
      await this.desktopReady.catch(() => undefined);
      this.desktopSubscriptionVersion += 1;
      await invoke("replay_clear").catch(() => undefined);
      this.playing = false;
      this.desktopRobot = null;
      return;
    }
    this.pause();
  }

  getStatus(): BridgeStatus {
    return {
      kind: this.kind,
      connected: this.frames.length > 0 && !this.desktopError,
      status: this.desktopError ? "error" : this.frames.length > 0 ? "connected" : "offline",
      latencyMs: 0,
      messageRateHz: this.playing ? 1000 / REPLAY_TICK_MS : null,
      lastMessageAt: Date.now(),
    };
  }

  subscribeRobotState(
    cb: (state: RobotState, timestampMs: number) => void,
  ): () => void {
    this.robotListeners.add(cb);
    if (isTauri()) {
      let active = true;
      if (this.desktopRobot) cb(this.desktopRobot, Date.now());
      void this.desktopReady.then(() => { if (active) return this.subscribeDesktop(); })
        .catch((error: unknown) => { this.desktopError = String(error); });
      return () => {
        active = false;
        this.robotListeners.delete(cb);
      };
    }
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

  private acceptDesktop(snapshot: DesktopReplaySnapshot): void {
    if (snapshot.version !== 1 || snapshot.sequence <= this.desktopSequence) return;
    this.desktopSequence = snapshot.sequence;
    this.tPos = snapshot.position;
    this.desktopDuration = snapshot.duration;
    this.playing = snapshot.playing;
    this.rate = snapshot.rate;
    this.desktopRobot = snapshot.robot;
    for (const cb of this.robotListeners) cb(snapshot.robot, snapshot.timestampMs);
  }

  private async subscribeDesktop(): Promise<void> {
    const version = ++this.desktopSubscriptionVersion;
    const channel = new Channel<DesktopReplaySnapshot>();
    channel.onmessage = (snapshot) => {
      if (version === this.desktopSubscriptionVersion) this.acceptDesktop(snapshot);
    };
    await invoke("replay_subscribe", { channel });
  }

  private desktopControl(command: "play" | "pause" | "seek" | "rate", value?: number): void {
    this.desktopReady = this.desktopReady.then(async () => {
      this.acceptDesktop(await invoke<DesktopReplaySnapshot>("replay_control", { command, value }));
    }).catch((error: unknown) => {
      this.desktopError = String(error);
      this.playing = false;
    });
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
      joints[key] = degreesToRadians(
        lerp(a.joints[key] ?? 0, b.joints[key] ?? 0, alpha),
      );
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
    joints: Object.fromEntries(
      Object.entries(f.joints).map(([key, degrees]) => [
        key,
        degreesToRadians(degrees),
      ]),
    ),
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
