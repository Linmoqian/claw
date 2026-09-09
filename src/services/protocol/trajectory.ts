/**
 * protocol/trajectory —— trajectory 消息：目标路径点链（等 planner 齐备后
 * planned/actual 再扩展独立消息类型，本阶段先喂 target 线）。
 */
import type { TrajectoryState, Waypoint } from "../../core/world/state";

export interface TrajectoryMessageData {
  id: string;
  points: { x: number; y: number; z?: number; yaw?: number }[];
  closed?: boolean;
}

export function targetFromTrajectoryMessage(
  data: TrajectoryMessageData,
): NonNullable<TrajectoryState["target"]> {
  const points: Waypoint[] = data.points.map((p) => ({
    x: p.x,
    y: p.y,
    z: typeof p.z === "number" ? p.z : 0,
    yaw: typeof p.yaw === "number" ? p.yaw : undefined,
  }));
  return { points, closed: data.closed === true };
}