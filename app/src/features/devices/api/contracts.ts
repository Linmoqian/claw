// 对外设备能力契约。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

/** 设备类别描述物理对象；TTL、RS485、CAN 属于连接层，不作为设备类别。 */
export type DeviceKind = "motor" | "drone" | "robot_arm" | "servo" | "lidar";

export type DeviceConnection = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceStatus {
  connection: DeviceConnection;
  /** 最近一次有效状态时间，Unix 毫秒；尚无状态时为 null。 */
  updatedAtMs: number | null;
  error?: string;
}

export interface DeviceIdentity<K extends DeviceKind> {
  readonly id: string;
  readonly kind: K;
  readonly name: string;
  /** 连接参数由具体适配器持有；连接过程和互斥检查由后端执行。 */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): DeviceStatus;
}

/** 单轴电机。位置和速度使用 rad、rad/s，扭矩使用 N·m。 */
export interface MotorDevice extends DeviceIdentity<"motor"> {
  readState(): Promise<{ positionRad: number; velocityRadPerSec: number; torqueNm?: number }>;
  /** 停止当前运动指令；不能替代硬件急停。 */
  stop(): Promise<void>;
  setPositionRad?(positionRad: number): Promise<void>;
  setVelocityRadPerSec?(velocityRadPerSec: number): Promise<void>;
  setTorqueNm?(torqueNm: number): Promise<void>;
}

export interface SpatialPose {
  positionM: { x: number; y: number; z: number };
  orientationXyzw: { x: number; y: number; z: number; w: number };
  frame: string;
}

/** 飞行控制由具体驱动完成；无驱动时不得报告已连接或接受起飞命令。 */
export interface DroneDevice extends DeviceIdentity<"drone"> {
  readPose(): Promise<SpatialPose>;
  land(): Promise<void>;
  /** 取消当前运动目标；具体悬停或制动语义由驱动声明。 */
  stop(): Promise<void>;
  takeOff?(altitudeM: number): Promise<void>;
  moveTo?(target: SpatialPose): Promise<void>;
}

export interface RobotArmDevice extends DeviceIdentity<"robot_arm"> {
  readJointsRad(): Promise<Record<string, number>>;
  stop(): Promise<void>;
  setJointsRad?(positionsRad: Record<string, number>): Promise<void>;
  readTcpPose?(): Promise<SpatialPose>;
  moveTcpTo?(target: SpatialPose): Promise<void>;
}

/** 舵机以关节角为统一边界；厂商 raw 刻度只允许存在于适配器内部。 */
export interface ServoDevice extends DeviceIdentity<"servo"> {
  readAngleRad(): Promise<number>;
  stop(): Promise<void>;
  setAngleRad?(angleRad: number): Promise<void>;
  setTorqueEnabled?(enabled: boolean): Promise<void>;
}

export interface LidarScan {
  timestampMs: number;
  frame: string;
  /** 每个点在 frame 中的坐标，单位米。 */
  pointsM: ReadonlyArray<{ x: number; y: number; z: number }>;
}

/** 激光雷达是只读传感器；扫描订阅由驱动负责释放。 */
export interface LidarDevice extends DeviceIdentity<"lidar"> {
  subscribeScan(listener: (scan: LidarScan) => void): () => void;
}

export type ExternalDevice =
  | MotorDevice
  | DroneDevice
  | RobotArmDevice
  | ServoDevice
  | LidarDevice;
