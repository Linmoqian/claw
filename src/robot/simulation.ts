/** Simulation Loop：固定步长仿真核心，与 React/渲染解耦。
 *
 * 数据流：UI(滑块/按钮) → target → step(dt) → current → FK 计算 TCP → 渲染层/订阅者读取。
 * UI 只下达意图（"J3 到 40°"），不参与运动计算。
 */
import { Quaternion, Vector3 } from "three";
import { computeLinkPoses, computeTcpPose, type Pose } from "./kinematics";
import { sampleTrajectory, so100DemoLoop, type TrajPoint } from "./trajectory";
import type { RobotModel } from "./types";

/** 仿真运行模式 */
export type SimMode = "manual" | "homing" | "play";

/** 供 UI 读取的快照（低频拉取，不参与 60FPS 渲染路径） */
export interface SimSnapshot {
  mode: SimMode;
  speed: number;
  /** 当前显示角（°，active 关节顺序） */
  currentDeg: number[];
  /** 当前目标角（°，手动模式下与 current 同步） */
  targetDeg: number[];
  /** TCP 世界位置（URDF/ROS 坐标，米） */
  tcp: Pose;
  /** 轨迹循环进度 0..1 */
  progress: number;
}

/** 手动/回零的关节渐近速率上限（°/s） */
const MANUAL_RATE_DEG_S = 300;
const HOMING_RATE_DEG_S = 90;

export class SimulationLoop {
  readonly model: RobotModel;
  /** 仿真速度倍率（UI 写） */
  speed = 1;

  private mode: SimMode = "manual";
  private currentDeg: number[];
  private targetDeg: number[];
  private traj: TrajPoint[];
  private trajTime = 0;
  private tcp: Pose = { position: new Vector3(), quaternion: new Quaternion() };

  constructor(model: RobotModel) {
    this.model = model;
    const zeros = model.active.map(() => 0);
    this.currentDeg = [...zeros];
    this.targetDeg = [...zeros];
    this.traj = so100DemoLoop();
    this.updateTcp();
  }

  /** 推进仿真一步（dtReal 为真实流逝时间，内部已乘速度倍率） */
  step(dtReal: number): void {
    const dt = Math.min(Math.max(dtReal, 0), 0.05) * this.speed;
    const n = this.model.active.length;

    if (this.mode === "play") {
      // 轨迹模式：目标随轨迹时间推进，当前直接跟随（轨迹本身速度连续）
      const total = this.traj[this.traj.length - 1]?.time ?? 1;
      this.trajTime = (this.trajTime + dt) % total;
      const q = sampleTrajectory(this.traj, this.trajTime);
      for (let i = 0; i < n; i++) {
        this.currentDeg[i] = clampDeg(q[i] ?? 0, this.model.active[i]);
        this.targetDeg[i] = this.currentDeg[i];
      }
    } else {
      // 手动/回零：current 向 target 以速率上限渐近（拖动时 setJointTarget 会瞬移同步）
      const rate = this.mode === "homing" ? HOMING_RATE_DEG_S : MANUAL_RATE_DEG_S;
      const stepDeg = rate * dt;
      for (let i = 0; i < n; i++) {
        this.currentDeg[i] = approach(
          this.currentDeg[i],
          this.targetDeg[i],
          stepDeg,
        );
      }
    }
    this.updateTcp();
  }

  /** 用户拖动滑块：瞬移同步（手动模式），并进入手动模式 */
  setJointTarget(index: number, deg: number): void {
    const joint = this.model.active[index];
    if (!joint) return;
    this.mode = "manual";
    this.targetDeg[index] = clampDeg(deg, joint);
    this.currentDeg[index] = this.targetDeg[index];
    this.updateTcp();
  }

  /** 回零：全部关节匀速回到 0（homing 动画，可被 STOP 打断） */
  goHome(): void {
    this.mode = "homing";
    this.targetDeg = this.model.active.map(() => 0);
  }

  /** 播放演示轨迹（从 0 开始循环） */
  play(): void {
    this.trajTime = 0;
    this.mode = "play";
  }

  /** 停止一切主动运动：目标冻结为当前值（纯仿真语义，非硬件急停） */
  stop(): void {
    this.mode = "manual";
    this.targetDeg = [...this.currentDeg];
  }

  /** 当前仿真模式 */
  get currentMode(): SimMode {
    return this.mode;
  }

  /** TCP 世界位置引用（URDF/ROS 坐标，渲染层只读后立即转换，勿持有） */
  get tcpPosition(): Vector3 {
    return this.tcp.position;
  }

  /** 供渲染层逐帧读取（不创建新对象，避开 GC） */
  get currentDegrees(): readonly number[] {
    return this.currentDeg;
  }

  /** UI 低频拉取快照 */
  getSnapshot(): SimSnapshot {
    const total = this.traj[this.traj.length - 1]?.time ?? 1;
    return {
      mode: this.mode,
      speed: this.speed,
      currentDeg: [...this.currentDeg],
      targetDeg: [...this.targetDeg],
      tcp: {
        position: this.tcp.position.clone(),
        quaternion: this.tcp.quaternion.clone(),
      },
      progress: total > 0 ? this.trajTime / total : 0,
    };
  }

  /** 末端位姿刷新（由 FK 计算，步内更新） */
  private updateTcp(): void {
    const poses = computeLinkPoses(this.model, this.currentDeg);
    this.tcp = computeTcpPose(this.model, poses);
  }
}

/** 夹取到关节限位范围内（无限位则原样） */
function clampDeg(deg: number, joint: { minDeg: number; maxDeg: number }): number {
  if (!Number.isFinite(joint.minDeg) && !Number.isFinite(joint.maxDeg)) return deg;
  const lo = Number.isFinite(joint.minDeg) ? joint.minDeg : -Infinity;
  const hi = Number.isFinite(joint.maxDeg) ? joint.maxDeg : Infinity;
  return Math.min(hi, Math.max(lo, deg));
}

/** 以不超过 step 的步长从 from 趋近 to */
function approach(from: number, to: number, step: number): number {
  const delta = to - from;
  if (Math.abs(delta) <= step) return to;
  return from + Math.sign(delta) * step;
}