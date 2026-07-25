/** 电机/关节模型 */
export type Motor = {
  id: string;
  /** 关节代号，如 J1 */
  code: string;
  /** 中文名，如 基座 */
  name: string;
  /** 当前角度（°） */
  angle: number;
  /** 目标角度（°） */
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

/** 7 自由度机械臂关节（mock 数据，后续接 USB 实时数据替换） */
export const MOTORS: Motor[] = [
  { id: "m1", code: "J1", name: "基座", angle: 12.4, target: 15.0, max: 180, min: -180, current: 0.82, temp: 38.2, enabled: true },
  { id: "m2", code: "J2", name: "肩部", angle: -28.6, target: -30.0, max: 90, min: -90, current: 1.14, temp: 41.7, enabled: true },
  { id: "m3", code: "J3", name: "肘部", angle: 64.2, target: 60.0, max: 135, min: -10, current: 0.96, temp: 39.5, enabled: true },
  { id: "m4", code: "J4", name: "腕俯仰", angle: 8.1, target: 10.0, max: 90, min: -90, current: 0.34, temp: 36.0, enabled: true },
  { id: "m5", code: "J5", name: "腕偏航", angle: -15.3, target: -15.0, max: 90, min: -90, current: 0.28, temp: 35.4, enabled: true },
  { id: "m6", code: "J6", name: "腕旋转", angle: 42.0, target: 45.0, max: 180, min: -180, current: 0.31, temp: 35.9, enabled: true },
  { id: "m7", code: "J7", name: "夹爪", angle: 58.0, target: 60.0, max: 100, min: 0, current: 0.12, temp: 34.1, enabled: true },
];

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
