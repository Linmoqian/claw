/**
 * protocol/robot —— v2 SI 机器人位姿、速度与关节状态。
 * 字段名携带单位，避免度/弧度及线速度/角速度歧义。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { Orientation, Position, Pose, Twist } from "../../core/world/pose";
import { yawQuaternion } from "../../core/world/pose";
import type { RobotState } from "../../core/world/state";

export interface RobotStateMessageData {
  pose?: {
    position_m?: Partial<Position>;
    orientation_xyzw?: Orientation;
    yaw_rad?: number;
  };
  twist?: {
    linear_mps?: Partial<Position>;
    angular_radps?: Partial<Position>;
  };
}

export interface JointStateMessageData {
  names: string[];
  position_rad: number[];
  velocity_radps?: number[];
  effort_nm?: number[];
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function validQuaternion(o: Orientation | undefined): Orientation | null {
  if (!o) return null;
  return [o.x, o.y, o.z, o.w].every(Number.isFinite) ? o : null;
}

export function robotStateFromMessage(data: RobotStateMessageData): RobotState {
  const p = data.pose ?? {};
  const positionM = p.position_m ?? {};
  const orientation =
    validQuaternion(p.orientation_xyzw) ?? yawQuaternion(finiteOr(p.yaw_rad, 0));
  const linearMps = data.twist?.linear_mps ?? {};
  const angularRadps = data.twist?.angular_radps ?? {};
  const pose: Pose = {
    position: {
      x: finiteOr(positionM.x, 0),
      y: finiteOr(positionM.y, 0),
      z: finiteOr(positionM.z, 0),
    },
    orientation,
  };
  const velocity: Twist = {
    linear: {
      x: finiteOr(linearMps.x, 0),
      y: finiteOr(linearMps.y, 0),
      z: finiteOr(linearMps.z, 0),
    },
    angular: {
      x: finiteOr(angularRadps.x, 0),
      y: finiteOr(angularRadps.y, 0),
      z: finiteOr(angularRadps.z, 0),
    },
  };
  return { pose, velocity, joints: {} };
}

export function jointsFromMessage(data: JointStateMessageData): Record<string, number> {
  if (!Array.isArray(data.names) || !Array.isArray(data.position_rad)) return {};
  const joints: Record<string, number> = {};
  const count = Math.min(data.names.length, data.position_rad.length);
  for (let i = 0; i < count; i += 1) {
    const name = data.names[i];
    const value = data.position_rad[i];
    if (typeof name === "string" && name.length > 0 && Number.isFinite(value)) {
      joints[name] = value;
    }
  }
  return joints;
}
