/**
 * 姿态、欧拉角与坐标系变换纯函数；PnP 与设备运行时共用。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { PoseValue, QuaternionValue, RpyDeg, Vec3 } from "./types";

export function quaternion(value: QuaternionValue): Quaternion {
  return new Quaternion(value.x, value.y, value.z, value.w);
}

export function toQuaternionValue(value: Quaternion): QuaternionValue {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

/** URDF/ROS 固定轴 RPY（输入 rad）：R=Rz(yaw)·Ry(pitch)·Rx(roll)。 */
export function rpyToQuaternion(rpy: {
  x: number;
  y: number;
  z: number;
}): QuaternionValue {
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rpy.x);
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rpy.y);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rpy.z);
  return toQuaternionValue(qz.multiply(qy).multiply(qx));
}

/** UI 辅助转换：度数 RPY → rad 四元数。 */
export function rpyDegToQuaternion(rpy: RpyDeg): QuaternionValue {
  const d = Math.PI / 180;
  return rpyToQuaternion({ x: rpy.roll * d, y: rpy.pitch * d, z: rpy.yaw * d });
}

export function quaternionToRpyDeg(value: QuaternionValue): RpyDeg {
  const euler = new Euler().setFromQuaternion(quaternion(value), "XYZ");
  const scale = 180 / Math.PI;
  return {
    roll: euler.x * scale,
    pitch: euler.y * scale,
    yaw: euler.z * scale,
  };
}

export function pose(
  position: Vec3,
  orientation: QuaternionValue,
  frame = "base",
): PoseValue {
  return { position, quaternion: orientation, frame };
}

export function makePoseRpyDeg(
  x: number,
  y: number,
  z: number,
  rpy: RpyDeg,
): PoseValue {
  return pose({ x, y, z }, rpyDegToQuaternion(rpy), "base");
}

export function composePose(parent: PoseValue, child: PoseValue): PoseValue {
  const p = quaternion(parent.quaternion);
  const position = new Vector3(
    child.position.x,
    child.position.y,
    child.position.z,
  )
    .applyQuaternion(p)
    .add(new Vector3(parent.position.x, parent.position.y, parent.position.z));
  return pose(
    { x: position.x, y: position.y, z: position.z },
    toQuaternionValue(p.multiply(quaternion(child.quaternion))),
    parent.frame,
  );
}

export function inversePose(value: PoseValue): PoseValue {
  const q = quaternion(value.quaternion).invert();
  const position = new Vector3(
    value.position.x,
    value.position.y,
    value.position.z,
  )
    .applyQuaternion(q)
    .negate();
  return pose(
    { x: position.x, y: position.y, z: position.z },
    toQuaternionValue(q),
    value.frame,
  );
}

export type PoseProperty = "X" | "Y" | "Z" | "ROLL" | "PITCH" | "YAW";

export function poseProperty(value: PoseValue, property: PoseProperty): number {
  if (property === "X") return value.position.x;
  if (property === "Y") return value.position.y;
  if (property === "Z") return value.position.z;
  const rpy = quaternionToRpyDeg(value.quaternion);
  return property === "ROLL"
    ? rpy.roll
    : property === "PITCH"
      ? rpy.pitch
      : rpy.yaw;
}

/** 将相机系中的目标姿态变换到基座系：base←camera × camera←target。 */
export function transformCameraPoseToBase(
  cameraInBase: PoseValue,
  targetInCamera: PoseValue,
): PoseValue {
  const result = composePose(cameraInBase, targetInCamera);
  return { ...result, frame: "base" };
}

/** 检测目标中心（像素）转相机归一化方向，标定参数使用 SI/像素契约。 */
export function pixelToCameraRay(
  px: number,
  py: number,
  intrinsics: {
    width: number;
    height: number;
    fx: number;
    fy: number;
    cx: number;
    cy: number;
  },
): Vec3 {
  const x = (px - intrinsics.cx) / intrinsics.fx;
  const y = (py - intrinsics.cy) / intrinsics.fy;
  const length = Math.hypot(x, y, 1);
  return { x: x / length, y: y / length, z: 1 / length };
}

export function rotationMatrixToQuaternion(
  matrix: number[][],
): QuaternionValue {
  const m = new Matrix4().set(
    matrix[0][0],
    matrix[0][1],
    matrix[0][2],
    0,
    matrix[1][0],
    matrix[1][1],
    matrix[1][2],
    0,
    matrix[2][0],
    matrix[2][1],
    matrix[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  return toQuaternionValue(new Quaternion().setFromRotationMatrix(m));
}
