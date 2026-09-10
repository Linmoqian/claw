/**
 * protocol/command —— LIVE 控制命令的 SI wire 契约。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { CommandLifecycle } from "../../core/runtime/state";

export type RobotCommand =
  | { kind: "joint_target"; position_rad: number[] }
  | { kind: "velocity"; linear_mps: number; angular_radps: number }
  | { kind: "pose_target"; position_m: { x: number; y: number; z: number }; yaw_rad: number }
  | { kind: "stop" };

export interface CommandMessageData {
  command_id: string;
  lifecycle: Extract<CommandLifecycle, "DISPATCHED">;
  command: RobotCommand;
}
