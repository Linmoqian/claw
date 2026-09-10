/** Simulation Loop：固定步长仿真核心，与 React/渲染解耦。
 *
 * 数据流：UI(滑块/按钮) → target → step(dt) → current → FK 计算 TCP → 渲染层/订阅者读取。
 * UI 只下达意图（"J3 到 40°"），不参与运动计算。
 */
import { Quaternion, Vector3 } from "three";
import {
  COLLISION_CLEAR,
  CollisionSystem,
  isRejected,
  TIER_SPEED_SCALE,
  type CollisionStatus,
} from "./collision";
import { solveIk, type IkResult } from "./ik";
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
  /** 当前目标角（°，手动模式下与 current 分岔） */
  targetDeg: number[];
  /** 预览角（°，M4 会话预览期 Ghost/滑块显示；无活动预览为 null） */
  previewDeg: number[] | null;
  /** TCP 世界位置（URDF/ROS 坐标，米） */
  tcp: Pose;
  /** TCP 拖拽目标位姿（无 TCP 意图时为 null；Ghost/对照显示用） */
  tcpTarget: Pose | null;
  /** 最近一次 IK 结果（奇异/限位徽标） */
  ik: IkResult | null;
  /** 碰撞评估（现实构型：自碰撞 + 环境档位；无碰撞系统时为全清） */
  collision: CollisionStatus;
  /** 碰撞引擎是否启用（WASM 加载失败为 false） */
  collisionEnabled: boolean;
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
  private tcpTarget: Pose | null = null;
  private lastIk: IkResult | null = null;
  private traj: TrajPoint[];
  private trajTime = 0;
  private tcp: Pose = { position: new Vector3(), quaternion: new Quaternion() };
  /** M3 碰撞查询器（null = 无碰撞系统，全部放行） */
  private collision: CollisionSystem | null;
  private lastCollision: CollisionStatus = COLLISION_CLEAR;
  /** M4 预览角（null = 无活动预览会话；Ghost 优先读它） */
  private previewDeg: number[] | null = null;

  constructor(model: RobotModel, collision: CollisionSystem | null = null) {
    this.model = model;
    this.collision = collision;
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
      // 手动/回零：current 向 target 以速率上限渐近（目标与现状保持分离）
      // M3：环境档位随距离缩放（warn 50% / slow 20% / stop 冻结）
      // 自碰撞只报告不冻结：现实穿过碰撞区时若冻结会死锁（回零路径可能穿越），
      // 防护职责在目标侧拒绝（checkCandidate）
      const rate0 = this.mode === "homing" ? HOMING_RATE_DEG_S : MANUAL_RATE_DEG_S;
      const scale =
        this.collision && this.lastCollision.tier !== "clear"
          ? TIER_SPEED_SCALE[this.lastCollision.tier]
          : 1;
      const stepDeg = rate0 * dt * scale;
      for (let i = 0; i < n; i++) {
        this.currentDeg[i] = approach(
          this.currentDeg[i],
          this.targetDeg[i],
          stepDeg,
        );
      }
    }
    // 现实构型碰撞评估（限速依据 + 快照读数；无系统时为全清常量）
    if (this.collision) {
      this.lastCollision = this.collision.evaluate(this.currentDeg);
    }
    this.updateTcp();
  }

  /** 用户拖动滑块/关节环：只写目标（现状经速率追赶，不瞬移）。
   * M3：目标/扫掠路径命中自碰撞或 stop 档时拒绝写入，返回命中状态（供徽标回灌） */
  setJointTarget(index: number, deg: number): CollisionStatus {
    const joint = this.model.active[index];
    if (!joint) return COLLISION_CLEAR;
    this.mode = "manual";
    const candidate = [...this.targetDeg];
    candidate[index] = clampDeg(deg, joint);
    const rejected = this.checkCandidate(candidate);
    if (rejected) return rejected;
    this.targetDeg[index] = candidate[index];
    return COLLISION_CLEAR;
  }

  /** 多关节目标批量设置（TCP IK 解算结果 / 外部意图）；拒绝时整批不写入 */
  setJointTargets(degs: number[]): CollisionStatus {
    this.mode = "manual";
    const candidate = [...this.targetDeg];
    this.model.active.forEach((joint, i) => {
      const v = degs[i];
      if (v !== undefined) {
        candidate[i] = clampDeg(v, joint);
      }
    });
    const rejected = this.checkCandidate(candidate);
    if (rejected) return rejected;
    this.targetDeg = candidate;
    return COLLISION_CLEAR;
  }

  /** 目标入闸校验：终点 + 扫掠路径（自碰撞或 stop 档 → 拒绝并返回命中状态） */
  private checkCandidate(candidate: number[]): CollisionStatus | null {
    if (!this.collision) return null;
    const goal = this.collision.evaluate(candidate);
    if (isRejected(goal)) return goal;
    const swept = this.collision.evaluateSwept(this.currentDeg, candidate);
    if (isRejected(swept)) return swept;
    return null;
  }

  /* ================= M4 预览通道（Preview→Commit 会话的 Ghost 侧） ================= */

  /** 单关节预览：限位钳制 + 入闸校验，只写 previewDeg 不动 target；返回 null=可提交 */
  previewJointTarget(index: number, deg: number): CollisionStatus | null {
    const joint = this.model.active[index];
    if (!joint) return null;
    const candidate = [...(this.previewDeg ?? this.targetDeg)];
    candidate[index] = clampDeg(deg, joint);
    const rejected = this.checkCandidate(candidate);
    if (rejected) return rejected;
    this.previewDeg = candidate;
    return null;
  }

  /** TCP 位姿预览：IK 解算入 previewDeg（不动 target）；返回结果（collision 字段 = 拒绝状态） */
  previewTcpTarget(position: Vector3, quaternion: Quaternion): IkResult {
    const result = solveIk(this.model, {
      target: { position: position.clone(), quaternion: quaternion.clone() },
      q0Deg: [...(this.previewDeg ?? this.currentDeg)],
    });
    const rejected = this.checkCandidate(result.qDeg);
    if (!rejected) this.previewDeg = [...result.qDeg];
    else result.collision = rejected;
    return result;
  }

  /** 清除预览（会话取消/提交后） */
  clearPreview(): void {
    this.previewDeg = null;
  }

  /** 提交预览：previewDeg → target（逐关节链路复用入闸校验；成功后清预览）
   * 返回 null = 已提交；CollisionStatus = 提交被拒（预览保留供用户调整） */
  commitPreview(): CollisionStatus | null {
    if (!this.previewDeg) return null;
    const rejected = this.checkCandidate(this.previewDeg);
    if (rejected) return rejected;
    this.targetDeg = [...this.previewDeg];
    this.mode = "manual";
    this.previewDeg = null;
    return null;
  }

  /** TCP 位姿意图：DLS IK 解算 → 碰撞入闸 → 写关节目标；返回结果供校验徽标 */
  setTcpTargetPose(position: Vector3, quaternion: Quaternion): IkResult {
    const result = solveIk(this.model, {
      target: { position: position.clone(), quaternion: quaternion.clone() },
      q0Deg: [...this.currentDeg],
    });
    const rejected = this.setJointTargets(result.qDeg);
    if (rejected) {
      // 拒绝：目标与 TCP 意图都冻结在最后有效状态（Ghost 停在安全边界）
      result.collision = rejected;
      return result;
    }
    this.lastIk = result;
    this.tcpTarget = { position: position.clone(), quaternion: quaternion.clone() };
    this.updateTcp();
    return result;
  }

  /** 清除 TCP 位姿意图（回零/停止等外部接管时） */
  clearTcpTarget(): void {
    this.tcpTarget = null;
    this.lastIk = null;
  }

  /** 回零：全部关节匀速回到 0（homing 动画，可被 STOP 打断） */
  goHome(): void {
    this.mode = "homing";
    this.targetDeg = this.model.active.map(() => 0);
    this.clearTcpTarget();
  }

  /** 播放演示轨迹（从 0 开始循环） */
  play(): void {
    this.trajTime = 0;
    this.mode = "play";
    this.clearTcpTarget();
  }

  /** 停止一切主动运动：目标冻结为当前值（纯仿真语义，非硬件急停） */
  stop(): void {
    this.mode = "manual";
    this.targetDeg = [...this.currentDeg];
    this.clearTcpTarget();
  }

  /** 当前仿真模式 */
  get currentMode(): SimMode {
    return this.mode;
  }

  /** TCP 世界位置引用（URDF/ROS 坐标，渲染层只读后立即转换，勿持有） */
  get tcpPosition(): Vector3 {
    return this.tcp.position;
  }

  /** 渲染层逐帧读取当前角（不创建新对象，避开 GC） */
  get currentDegrees(): readonly number[] {
    return this.currentDeg;
  }

  /** 渲染层逐帧读取目标角（Ghost 用，不创建新对象；预览期返回预览角） */
  get targetDegrees(): readonly number[] {
    return this.previewDeg ?? this.targetDeg;
  }

  /** 渲染层读取预览角（无活动预览为 null；TcpGizmo 拖拽基点用） */
  get previewDegrees(): readonly number[] | null {
    return this.previewDeg;
  }

  /** 释放碰撞系统资源（Studio 卸载时调用） */
  dispose(): void {
    this.collision?.dispose();
    this.collision = null;
  }

  /** UI 低频拉取快照 */
  getSnapshot(): SimSnapshot {
    const total = this.traj[this.traj.length - 1]?.time ?? 1;
    return {
      mode: this.mode,
      speed: this.speed,
      currentDeg: [...this.currentDeg],
      targetDeg: [...this.targetDeg],
      previewDeg: this.previewDeg ? [...this.previewDeg] : null,
      tcp: {
        position: this.tcp.position.clone(),
        quaternion: this.tcp.quaternion.clone(),
      },
      tcpTarget: this.tcpTarget
        ? {
            position: this.tcpTarget.position.clone(),
            quaternion: this.tcpTarget.quaternion.clone(),
          }
        : null,
      ik: this.lastIk
        ? {
            ...this.lastIk,
            qDeg: [...this.lastIk.qDeg],
            atLimit: [...this.lastIk.atLimit],
          }
        : null,
      collision: this.lastCollision,
      collisionEnabled: this.collision !== null,
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