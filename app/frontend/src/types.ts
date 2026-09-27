/** 电机/关节模型 */
export type Motor = {
  id: string;
  /** 硬件舵机 ID（1-6），用于串口通信 */
  hwId: number;
  /** 关节代号，如 J1 */
  code: string;
  /** 中文名，如 基座 */
  name: string;
  /** 当前角度（°） */
  angle: number;
  /** 实测速度（°/s） */
  velocity: number;
  /** 目标值（单位随控制模式） */
  target: number;
  /** 角度上限 */
  max: number;
  /** 角度下限 */
  min: number;
  /** 电流（A） */
  current: number;
  /** 温度（°C） */
  temp: number;
  /** 是否使能 */
  enabled: boolean;
};

/**
 * SO-100：5 个旋转关节 + 夹爪的静态配置基线。
 *
 * min/max 为 URDF 真实关节限位（与 claw_arm/script/3.2arm_viewer.py 的 JOINT_LIMITS 一致）。
 * angle/velocity/current/temp/target 为运行时读数，初始置 0；
 * 连接真实设备后由 DeviceContext 的实时 tick 用串口读数刷新。
 */
export const MOTORS: Motor[] = [
  { id: "m1", hwId: 1, code: "J1", name: "底部旋转", angle: 0, velocity: 0, target: 0, max: 114.6, min: -114.6, current: 0, temp: 0, enabled: false },
  { id: "m2", hwId: 2, code: "J2", name: "大臂升降", angle: 0, velocity: 0, target: 0, max: 200.5, min: 0, current: 0, temp: 0, enabled: false },
  { id: "m3", hwId: 3, code: "J3", name: "肘部弯曲", angle: 0, velocity: 0, target: 0, max: 0, min: -180, current: 0, temp: 0, enabled: false },
  { id: "m4", hwId: 4, code: "J4", name: "手腕俯仰", angle: 0, velocity: 0, target: 0, max: 68.8, min: -143.2, current: 0, temp: 0, enabled: false },
  { id: "m5", hwId: 5, code: "J5", name: "手腕旋转", angle: 0, velocity: 0, target: 0, max: 180, min: -180, current: 0, temp: 0, enabled: false },
  { id: "m6", hwId: 6, code: "J6", name: "夹爪", angle: 0, velocity: 0, target: 0, max: 114.6, min: -11.5, current: 0, temp: 0, enabled: false },
];

/** 控制模式 */
export type ControlMode = "position" | "velocity" | "current";

/** 单电机故障标志 */
export type FaultFlags = {
  /** 超限位 */
  overTravel: boolean;
  /** 过流 */
  overCurrent: boolean;
  /** 过温 */
  overTemp: boolean;
  /** 通信丢失 */
  commLost: boolean;
};

export const NO_FAULT: FaultFlags = {
  overTravel: false,
  overCurrent: false,
  overTemp: false,
  commLost: false,
};

/** 安全限制（全局阈值） */
export type SafetyLimits = {
  /** 过温阈值（°C） */
  tempMax: number;
  /** 过流阈值（A） */
  currentMax: number;
  /** 超速阈值（°/s） */
  velocityMax: number;
  /** 软限位开关 */
  softLimit: boolean;
  /** 超限自动断使能 */
  autoDisable: boolean;
};

export const DEFAULT_SAFETY: SafetyLimits = {
  tempMax: 60,
  currentMax: 3.0,
  velocityMax: 180,
  softLimit: true,
  autoDisable: true,
};

/** 串口扫描结果 */
export type SerialPort = {
  name: string;
  baud: number;
  /** 是否被占用 */
  inUse: boolean;
};

/** 单个电机的 PID 参数 */
export type PidGains = {
  kp: number;
  ki: number;
  kd: number;
};

export const DEFAULT_PID: PidGains = { kp: 12.0, ki: 0.8, kd: 2.4 };

/** 高级调试参数（参与仿真模型） */
export type AdvancedParams = {
  /** 速度前馈（基于目标每步位移） */
  kv: number;
  /** 重力/位置前馈（基于目标位置） */
  kg: number;
  /** 微分项低通滤波截止频率（Hz，越低滤波越强） */
  dFilterHz: number;
  /** 反馈(PV)平滑系数（一阶低通强度） */
  pvSmooth: number;
  /** 输出限幅（绝对值） */
  outLimit: number;
  /** 积分限幅（抗饱和，绝对值） */
  iLimit: number;
  /** 目标斜坡速率（°/s，限制设定点变化速度） */
  rampRate: number;
  /** 误差死区（°，小于该值不响应） */
  deadZone: number;
};

/** 默认值保证不改变既有波形：滤波/限幅/斜坡近似不生效 */
export const DEFAULT_ADVANCED: AdvancedParams = {
  kv: 0,
  kg: 0,
  dFilterHz: 50,
  pvSmooth: 0,
  outLimit: 2000,
  iLimit: 80,
  rampRate: 3600,
  deadZone: 0,
};

/** 单电机完整调参集 */
export type TuneParams = PidGains & AdvancedParams;

export const DEFAULT_TUNE: TuneParams = { ...DEFAULT_PID, ...DEFAULT_ADVANCED };
