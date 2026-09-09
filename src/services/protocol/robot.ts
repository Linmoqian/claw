/**
 * protocol/robot —— robot_state 消息定义与 2D → 3D 升维。
 * 兼容蓝图 2D 线格式（pose:{x,y,yaw} + velocity:{linear,angular}），
 * 也允许 sender 直接发完整 3D Pose（orientation 四元数 / z / 角速度分量）。
 */
import type { Orientation, Pose, Twist } from "../../core/world/pose";
import { yawQuaternion } from "../../core/world/pose";
import type { RobotState } from "../../core/world/state";

/** 线上格式：所有字段可选，逐字段回退（粘旧服务器不炸） */
export interface RobotStateMessageData {
  pose?: {
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    orientation?: Orientation;
  };
  velocity?: {
    /** 前进线速度 m/s（2D 消息 → linear.x） */
    linear?: number;
    /** 航向角速度 rad/s（2D 消息 → angular.z） */
    angular?: number;
    x?: number;
    y?: number;
    z?: number;
    rx?: number;
    ry?: number;
    rz?: number;
  };
  joints?: Record<string, number>;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function validQuaternion(o: Orientation | undefined): Orientation | null {
  if (!o) return null;
  for (const k of ["x", "y", "z", "w"] as const) {
    if (!Number.isFinite(o[k])) return null;
  }
  return o;
}

/** 消息 → 内部 RobotState（所有缺省字段回退 0） */
export function robotStateFromMessage(data: RobotStateMessageData): RobotState {
  const p = data.pose ?? {};
  const rawQ = validQuaternion(p.orientation);
  const orientation = rawQ ?? yawQuaternion(finiteOr(p.yaw, 0));
  const position = {
    x: finiteOr(p.x, 0),
    y: finiteOr(p.y, 0),
    z: finiteOr(p.z, 0),
  };

  const v = data.velocity ?? {};
  const twist: Twist = {
    linear: {
      x: finiteOr(v.linear ?? v.x, 0),
      y: finiteOr(v.y, 0),
      z: finiteOr(v.z, 0),
    },
    angular: {
      x: finiteOr(v.rx, 0),
      y: finiteOr(v.ry, 0),
      z: finiteOr(v.angular ?? v.rz, 0),
    },
  };

  const pose: Pose = { position, orientation };
  return {
    pose,
    velocity: twist,
    joints: data.joints ?? {},
  };
}