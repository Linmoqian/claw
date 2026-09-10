import type * as THREE from "three";

/* ================= 交互模式与控制源 ================= */

export type ToolMode = "select" | "joint" | "tcp" | "base";

export type ControlSource = "mouse" | "slider" | "trajectory" | "agent" | "ros";

/** 统一输入意图：滑块/鼠标/未来的 Agent 全部经此形态进入目标世界 */
export type InputIntent = JointIntent | TcpPoseIntent | BasePoseIntent;

/** 关节级目标（滑块与 3D 部件直操共用） */
export interface JointIntent {
  kind: "joint-target";
  source: ControlSource;
  /** active 面板下标（SimulationLoop 语义） */
  jointIndex: number;
  jointName: string;
  /** 目标角（°） */
  valueDeg: number;
}

/** TCP 拖拽目标位姿（M2 IK 接入后启用） */
export interface TcpPoseIntent {
  kind: "tcp-pose";
  source: ControlSource;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

/** 移动底座拖拽目标（BASE 模式，DXF/规划器接入后启用） */
export interface BasePoseIntent {
  kind: "base-pose";
  source: ControlSource;
  x: number;
  y: number;
  yaw: number;
}

/* ================= 验证结果 ================= */

export interface ValidationResult {
  valid: boolean;
  /** 命中关节限位（已钳制，非拒绝） */
  jointLimit: boolean;
  /** M2+：碰撞引擎输出 */
  collision: boolean;
  /** M2+：IK 奇异 */
  singularity: boolean;
  reachable: boolean;
  safetyDistance: number | null;
  reason?: string;
  /** 被钳制后的实际下发值（°） */
  clampedValueDeg?: number;
}

export const VALIDATION_OK: ValidationResult = {
  valid: true,
  jointLimit: false,
  collision: false,
  singularity: false,
  reachable: true,
  safetyDistance: null,
};

/* ================= 拾取与拖拽状态 ================= */

/** SELECT 模式拾取结果：mesh → link → 归属关节 */
export interface SelectedEntity {
  linkName: string;
  /** 入向关节名（root link 为 null） */
  jointName: string | null;
  /** active 面板下标（非可动关节为 null） */
  jointIndex: number | null;
}

/** 关节拖拽帧信息（模型网格以 three 世界坐标喂给控制器） */
export interface JointDragFrame {
  /** 关节中心（three 世界） */
  center: THREE.Vector3;
  /** 关节轴单位向量（three 世界） */
  axis: THREE.Vector3;
  /** 按下瞬间的当前目标角（°，拖拽基准） */
  startValueDeg: number;
}
