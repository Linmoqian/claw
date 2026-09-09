/**
 * 统一位姿与速度数学 —— 所有业务数据（robot/station/cad）共用的 Pose 结构。
 * 禁止出现散落的 x/y/z/t 变量组合；全项目统一走这里。
 */
import { Quaternion, Vector3 } from "three";

export interface Position {
  x: number;
  y: number;
  z: number;
}

/** 四元数 orientation（xyzw，与 ROS 一致） */
export interface Orientation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Position;
  orientation: Orientation;
}

/** 速度螺旋（ROS Twist 语义：linear 米/秒，angular 弧度/秒） */
export interface Twist {
  linear: Position;
  angular: Position;
}

export const POSITION_ZERO: Position = Object.freeze({ x: 0, y: 0, z: 0 });

export const ORIENTATION_IDENTITY: Orientation = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});

export const POSE_IDENTITY: Pose = Object.freeze({
  position: POSITION_ZERO,
  orientation: ORIENTATION_IDENTITY,
});

export const TWIST_ZERO: Twist = Object.freeze({
  linear: POSITION_ZERO,
  angular: POSITION_ZERO,
});

export function position(x: number, y: number, z: number): Position {
  return { x, y, z };
}

export function orientation(x: number, y: number, z: number, w: number): Orientation {
  return { x, y, z, w };
}

/** pose 由 (axial [x,y,z], quaternion) 构造 */
export function makePose(
  x: number,
  y: number,
  z: number,
  q: [number, number, number, number] = [0, 0, 0, 1],
): Pose {
  return { position: position(x, y, z), orientation: orientation(...q) };
}

/** 绕 Z 轴旋转（机器人 2.5D 场景最常用） */
export function yawQuaternion(yaw: number): Orientation {
  const q = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, 1), yaw);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function toThreePose(pose: Pose): {
  position: Vector3;
  quaternion: Quaternion;
} {
  return {
    position: new Vector3(pose.position.x, pose.position.y, pose.position.z),
    quaternion: new Quaternion(
      pose.orientation.x,
      pose.orientation.y,
      pose.orientation.z,
      pose.orientation.w,
    ),
  };
}

export function poseFromThree(
  position: Vector3,
  quaternion: Quaternion,
): Pose {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    orientation: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
}

export function poseFromYaw(
  x: number,
  y: number,
  z: number,
  yaw: number,
): Pose {
  const o = yawQuaternion(yaw);
  return { position: position(x, y, z), orientation: o };
}

function quaternionOf(pose: Pose): Quaternion {
  return new Quaternion(
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  );
}

/** 先应用 a、再应用 b：b(a(v)) */
export function composePose(a: Pose, b: Pose): Pose {
  const qa = quaternionOf(a);
  const qb = quaternionOf(b);
  const rotation = new Quaternion();
  rotation.multiplyQuaternions(qb, qa);
  const t = new Vector3(a.position.x, a.position.y, a.position.z)
    .applyQuaternion(qb)
    .add(new Vector3(b.position.x, b.position.y, b.position.z));
  return {
    position: { x: t.x, y: t.y, z: t.z },
    orientation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}

export function inversePose(pose: Pose): Pose {
  const q = quaternionOf(pose).invert();
  const t = new Vector3(pose.position.x, pose.position.y, pose.position.z)
    .applyQuaternion(q)
    .negate();
  return {
    position: { x: t.x, y: t.y, z: t.z },
    orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

/** 线性插值：位置 lerp + 姿态 slerp（时间对齐 buffer 采样用） */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const q = quaternionOf(a).slerp(quaternionOf(b), t);
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * t,
      y: a.position.y + (b.position.y - a.position.y) * t,
      z: a.position.z + (b.position.z - a.position.z) * t,
    },
    orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

/** 两点欧氏距离 */
export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}