/**
 * BaseSim —— 移动底盘仿真（M5）：目标位姿 → 现实位姿的限速跟随 + waypoint 路径播放。
 * 与 SimulationLoop 同构的非响应式仿真核心（React 不持有实例）；
 * 现实位姿写入 worldStore.world.robot.pose（MobileBase/臂自动联动）。
 * 坐标：world 平面（x, y, yaw，yaw 为绕 Z 的平面航向，CCW 正）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { BaseWaypoint } from "../cad/workspaceStore";

/** 平移限速（m/s）与转向限速（rad/s）——X-line 量级的保守值 */
const LINEAR_SPEED = 0.18;
const ANGULAR_SPEED = 1.2;

/** 到点判定半径（m）：进入即切下一 waypoint */
const ARRIVE_RADIUS = 0.015;

/** 平面位姿（world 坐标） */
export interface BasePose {
  x: number;
  y: number;
  yaw: number;
}

export interface BaseSnapshot {
  /** 现实位姿 */
  current: BasePose;
  /** 目标位姿（手动拖拽/路径当前段终点） */
  target: BasePose;
  /** 路径播放中（true 时 target 随 waypoint 推进） */
  playing: boolean;
  /** 剩余 waypoint 数（含当前目标） */
  waypointsLeft: number;
  /** 总 waypoint 数 */
  waypointsTotal: number;
}

export class BaseSim {
  onTargetChanged: ((pose: BasePose) => void) | null = null;
  private current: BasePose = { x: 0, y: 0, yaw: 0 };
  private target: BasePose = { x: 0, y: 0, yaw: 0 };
  /** M4 会话预览位姿（null = 无预览；Ghost 标记用） */
  private previewPose: BasePose | null = null;
  /** TWIN 真数据模式下停写现实位姿（避免与遥测打架） */
  enabled = true;
  /** 路径播放队列（playing 时逐点喂 target） */
  private queue: BaseWaypoint[] = [];
  private pathTotal = 0;
  private playing = false;
  /** 现实位姿写出（wire 到 worldStore，见 Studio 接线） */
  onPose: ((p: BasePose) => void) | null = null;

  /** 推进一步（渲染循环驱动；dt 钳制防切后台大步长） */
  step(dtReal: number): void {
    const dt = Math.min(Math.max(dtReal, 0), 0.05);
    // 路径模式：到点切换下一 waypoint（yaw 目标 = 段切线方向）
    if (this.playing) {
      this.advanceQueue();
    }
    this.approachTarget(dt);
    if (this.enabled) this.onPose?.({ ...this.current });
  }

  /** 手动设定目标（拖拽提交）：保持当前 yaw 语义由调用方决定，这里只收平面目标 */
  setTarget(x: number, y: number, yaw?: number): void {
    this.target = { x, y, yaw: yaw ?? this.target.yaw };
    this.playing = false;
    this.queue = [];
    this.onTargetChanged?.(this.target);
  }

  /** 目标位姿（Ghost 回退显示用） */
  get targetPose(): BasePose {
    return this.target;
  }

  /* ================= M4 会话预览通道 ================= */

  /** 预览目标位姿（拖拽中 Ghost 跟手，现实不动） */
  setPreviewBase(x: number, y: number): void {
    this.previewPose = { x, y, yaw: this.target.yaw };
  }

  /** 提交预览：预览位姿 → 目标（底盘无碰撞门禁，总成功） */
  commitPreview(): void {
    if (this.previewPose) {
      this.setTarget(this.previewPose.x, this.previewPose.y);
      this.previewPose = null;
    }
  }

  /** 清除预览 */
  clearPreview(): void {
    this.previewPose = null;
  }

  /** 预览活动（Ghost 配色用） */
  get previewActive(): boolean {
    return this.previewPose !== null;
  }

  /** 预览位姿（Ghost 标记渲染用；无预览返回目标位姿） */
  get previewOrTargetPose(): BasePose {
    return this.previewPose ?? this.target;
  }

  /** 载入路径并开始播放（从队首推进） */
  playPath(waypoints: BaseWaypoint[]): void {
    if (waypoints.length === 0) return;
    this.queue = [...waypoints];
    this.pathTotal = waypoints.length;
    this.playing = true;
    this.advanceQueue();
  }

  /** 停止路径播放（目标冻结在当前 waypoint，继续走完当前段） */
  stopPath(): void {
    this.playing = false;
  }

  /** 直接停放（不动画） */
  teleport(pose: BasePose): void {
    this.current = { ...pose };
    this.target = { ...pose };
    this.previewPose = null;
    this.playing = false;
    this.queue = [];
    if (this.enabled) this.onPose?.({ ...this.current });
  }

  /** 只同步 Rust 权威位姿；保留路径队列与预览意图。 */
  applyAuthorityPose(pose: BasePose): void {
    this.current = { ...pose };
    if (this.playing) this.advanceQueue();
    if (this.enabled) this.onPose?.({ ...this.current });
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** UI 低频快照 */
  getSnapshot(): BaseSnapshot {
    return {
      current: { ...this.current },
      target: { ...this.target },
      playing: this.playing,
      waypointsLeft: this.queue.length,
      waypointsTotal: this.pathTotal,
    };
  }

  /** 到点检测 → 下一 waypoint（队尾到齐则结束播放） */
  private advanceQueue(): void {
    const next = this.queue[0];
    if (!next) {
      this.playing = false;
      return;
    }
    const dx = next.x - this.current.x;
    const dy = next.y - this.current.y;
    if (Math.hypot(dx, dy) <= ARRIVE_RADIUS) {
      this.queue.shift();
      if (this.queue.length === 0) {
        this.playing = false;
      }
      return;
    }
    // yaw 目标 = 行进方向切线（atan2 的 world 平面语义）
    const target = { x: next.x, y: next.y, yaw: Math.atan2(dy, dx) };
    if (Math.hypot(target.x - this.target.x, target.y - this.target.y) > 1e-6
      || Math.abs(target.yaw - this.target.yaw) > 1e-6) {
      this.target = target;
      this.onTargetChanged?.(target);
    }
  }

  /** 现实向目标限速渐近：平移（直线）+ 转向（最短角差） */
  private approachTarget(dt: number): void {
    const dx = this.target.x - this.current.x;
    const dy = this.target.y - this.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-6) {
      const step = Math.min(dist, LINEAR_SPEED * dt);
      this.current.x += (dx / dist) * step;
      this.current.y += (dy / dist) * step;
    }
    const dYaw = shortestAngle(this.target.yaw - this.current.yaw);
    if (Math.abs(dYaw) > 1e-6) {
      const stepYaw = Math.min(Math.abs(dYaw), ANGULAR_SPEED * dt);
      this.current.yaw += Math.sign(dYaw) * stepYaw;
    }
  }
}

/** 角度差归一到 (-π, π] */
function shortestAngle(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
