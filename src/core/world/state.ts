/**
 * Unified World State —— V2 的中心数据结构。
 * robot / localization / trajectory / task / connection 五域一册，
 * 全项目禁止出现散落的 robotX/stationY 这类游离变量。
 */
import type { Pose, Twist } from "./pose";
import { POSE_IDENTITY, TWIST_ZERO } from "./pose";

/* ================= 错误体系 ================= */

export type SystemErrorSource =
  | "robot"
  | "station"
  | "cad"
  | "simulation"
  | "connection"
  | "task";

export interface SystemError {
  source: SystemErrorSource;
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  /** 产生时间（epoch ms） */
  ts: number;
}

/* ================= 连接状态 ================= */

export type ConnectionStatus = "offline" | "connecting" | "connected" | "error";

/** 单设备的连接健康状态（连接管理器与桥各自维护） */
export interface DeviceConnection {
  status: ConnectionStatus;
  /** 最后一条消息时间（epoch ms；null = 从未收到） */
  lastMessageAt: number | null;
  /** 最近一次测得的往返延迟 ms；null = 尚未测得 */
  latencyMs: number | null;
  /** 滑窗统计的消息速率 Hz；null = 尚未统计 */
  messageRateHz: number | null;
  error?: SystemError;
}

export interface ConnectionState {
  robot: DeviceConnection;
  station: DeviceConnection;
  /** CAD 与实时链路无关，仅有加载态 */
  cad: "unloaded" | "loading" | "loaded" | "error";
}

/* ================= 机器人状态 ================= */

export interface RobotState {
  /** 机器人本体定位（内部里程计/IMU 融合值，robot_base 帧） */
  pose: Pose;
  velocity: Twist;
  /** 关节角（弧度，key = joint name） */
  joints: Record<string, number>;
  /** TCP 位姿（robot_base 帧下；无 FK 数据时缺省） */
  tcp?: Pose;
}

/* ================= 全站仪与定位误差 ================= */

/** 全站仪单点测量 */
export interface StationPosition {
  /** 测量时间戳（epoch ms）——误差比对必须按时间对齐，不能拿最新值硬比 */
  timestamp: number;
  targetId: number;
  /** 目标点在 world 帧下的位置（已过 station → world 变换） */
  position: { x: number; y: number; z: number };
  valid: boolean;
}

/** robot（内部定位）与 station（外部测量）的偏差 */
export interface LocalizationError {
  dx: number;
  dy: number;
  dz: number;
  distance: number;
}

export interface LocalizationState {
  /** 机器人内部定位（按时间对齐后的样本，非原始最新值） */
  robotPose: Pose | null;
  /** 最近一次全站仪测量（可能已 stale） */
  station: StationPosition | null;
  /** 时间对齐后的误差；无对齐样本时为 null */
  error: LocalizationError | null;
  /** station 数据是否 stale（GUI 据此变灰并提示信号丢失） */
  stale: boolean;
  /** 最近一条 station 消息的 age（ms） */
  ageMs: number | null;
}

/* ================= 轨迹三线（Target / Planned / Actual） ================= */

/** workspace 点（业务层通用，也可视作 planar point + z） */
export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** 期望航向（rad，可选） */
  yaw?: number;
}

/** 路径规划输出：带时间或距离进度的机器人路径点 */
export interface PlannedPoint extends Waypoint {
  /** 段内进度 t [0,1] 或时间（取决于规划器），用于比例显示 */
  phase: number;
}

/** 实际运行记录点（Recorder 输出，采样判据见 TrajectoryRecorder） */
export interface ActualPoint {
  t: number;
  timestamp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 记录时刻的车速 m/s */
  speed: number;
}

export interface TrajectoryState {
  /** TARGET —— 来自 CAD 的目标几何（世界坐标点链 + 开放/闭合标记） */
  target: { points: Waypoint[]; closed: boolean } | null;
  /** PLANNED —— 路径规划输出 */
  planned: PlannedPoint[];
  /** ACTUAL —— 实际运行记录 */
  actual: ActualPoint[];
}

/* ================= 任务 ================= */

export type TaskStatus =
  | "idle"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export interface RobotTask {
  id: string;
  name: string;
  /** CAD 来源文件名（如 floor.dxf） */
  cadFile?: string;
  /** 规划路径长度（米，规划完成后填充） */
  pathLengthM?: number;
  status: TaskStatus;
}

export interface TaskState {
  tasks: Record<string, RobotTask>;
  activeId: string | null;
}

/* ================= WorldState 总装 ================= */

export interface WorldState {
  /** 本状态快照的合成时间（epoch ms） */
  timestamp: number;
  version: number;
  robot: RobotState | null;
  localization: LocalizationState;
  trajectory: TrajectoryState;
  task: TaskState;
  connection: ConnectionState;
  /** 系统最近错误（供 UI 顶部告警条；历史入日志层） */
  errors: SystemError[];
}

/* ================= 工厂 ================= */

export function makeDeviceConnection(): DeviceConnection {
  return {
    status: "offline",
    lastMessageAt: null,
    latencyMs: null,
    messageRateHz: null,
  };
}

export function makeRobotState(): RobotState {
  return {
    pose: POSE_IDENTITY,
    velocity: TWIST_ZERO,
    joints: {},
  };
}

export function createEmptyWorldState(now: number = Date.now()): WorldState {
  return {
    timestamp: now,
    version: 0,
    robot: null,
    localization: {
      robotPose: null,
      station: null,
      error: null,
      stale: false,
      ageMs: null,
    },
    trajectory: { target: null, planned: [], actual: [] },
    task: { tasks: {}, activeId: null },
    connection: {
      robot: makeDeviceConnection(),
      station: makeDeviceConnection(),
      cad: "unloaded",
    },
    errors: [],
  };
}

/** 从机器人状态生成本地化比对所需的内部定位样本 */
export function sampleLocalization(robot: RobotState): Pose {
  return robot.pose;
}

/** 时间对齐的误差计算：station(t) → 插值 robot(t') → 差 */
export function computeLocalizationError(
  robotPose: Pose,
  station: StationPosition,
): LocalizationError {
  const dx = station.position.x - robotPose.position.x;
  const dy = station.position.y - robotPose.position.y;
  const dz = station.position.z - robotPose.position.z;
  return {
    dx,
    dy,
    dz,
    distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}