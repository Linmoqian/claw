/**
 * 运行时四态与命令生命周期边界。
 * Wire 时间在协议适配层转换；运行时显式使用 epoch ms。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { RobotState } from "../world/state";

export type CommandLifecycle =
  | "DRAFT"
  | "VALIDATED"
  | "COMMITTED"
  | "DISPATCHED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "REJECTED"
  | "CANCELLED"
  | "ABORTED"
  | "FAILED";

export const COMMAND_TRANSITIONS: Readonly<
  Record<CommandLifecycle, readonly CommandLifecycle[]>
> = Object.freeze({
  DRAFT: ["VALIDATED", "REJECTED", "CANCELLED"],
  VALIDATED: ["COMMITTED", "REJECTED", "CANCELLED"],
  COMMITTED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["EXECUTING", "ABORTED", "FAILED"],
  EXECUTING: ["SUCCEEDED", "ABORTED", "FAILED"],
  SUCCEEDED: [],
  REJECTED: [],
  CANCELLED: [],
  ABORTED: [],
  FAILED: [],
});

export function canTransitionCommand(
  from: CommandLifecycle,
  to: CommandLifecycle,
): boolean {
  return COMMAND_TRANSITIONS[from].includes(to);
}

export interface ObservedState {
  robot: RobotState;
  observedAtMs: number;
  frameId: string;
  sequence: number;
}

export interface EstimatedState {
  robot: RobotState;
  estimatedAtMs: number;
  basedOnSequences: number[];
}

export interface TargetState {
  robot: Partial<RobotState>;
  authoredAtMs: number;
}

export interface CommandState<TCommand = unknown> {
  commandId: string;
  lifecycle: CommandLifecycle;
  command: TCommand;
  updatedAtMs: number;
  error?: string;
}
