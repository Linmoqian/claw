/**
 * protocol/command —— 机器人控制指令（LIVE 阶段经 SafetyGuard 后发出）。
 * 统一成代数类型，禁止 UI 直接逐关节戳电机。
 */
export type RobotCommand =
  | { kind: "joint_target"; qDeg: number[] }
  | { kind: "velocity"; linear: number; angular: number }
  | { kind: "pose_target"; x: number; y: number; z: number; yaw: number }
  | { kind: "stop" };

/** command 消息线上载荷 */
export interface CommandMessageData {
  command: RobotCommand;
  /** 请求序号（网关可回执），可选 */
  seq?: number;
}