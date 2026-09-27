/** 正运动学：q → 全部 link 世界位姿（保持 URDF/ROS 坐标，渲染层再做 Z-up→Y-up 变换）。 */
import { Euler, Quaternion, Vector3 } from "three";
import { degreesToRadians, radiansToDegrees } from "./model";
import type { RobotModel, Vec3 } from "./types";

/** 世界位姿（位置 + 四元数） */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** URDF rpy → 四元数：R = Rz(yaw)·Ry(pitch)·Rx(roll)（固定轴 X→Y→Z 依次作用） */
export function rpyToQuaternion(rpy: Vec3, target = new Quaternion()): Quaternion {
  const qx = new Quaternion().setFromAxisAngle(X_AXIS, rpy[0]);
  const qy = new Quaternion().setFromAxisAngle(Y_AXIS, rpy[1]);
  const qz = new Quaternion().setFromAxisAngle(Z_AXIS, rpy[2]);
  return target.copy(qz).multiply(qy).multiply(qx);
}

/** 递归正运动学（BFS）：world(child) = world(parent) × T(jointOrigin) × T_joint(q)
 * qDeg 按 active 数组顺序（与 SimulationLoop.currentDeg/快照语义一致） */
export function computeLinkPoses(
  model: RobotModel,
  qDeg: number[],
): Map<string, Pose> {
  const def = model.def;
  // 可动关节 URDF index → 当前角（rad）；prismatic/fixed 恒 0
  const qRadByJoint = new Map<number, number>();
  model.active.forEach((a, i) => {
    qRadByJoint.set(a.index, degreesToRadians(qDeg[i] ?? 0));
  });

  const poses = new Map<string, Pose>();
  // 根 link：无入向关节者（与 buildRobotModel 同规则，用第一个无入向）
  const root =
    def.links.find((l) => model.jointOfLink.get(l.name) === null)?.name ??
    def.links[0]?.name;
  if (!root) return poses;
  poses.set(root, {
    position: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
  });

  const queue: string[] = [root];
  const seen = new Set<string>([root]);
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const parentPose = poses.get(parent)!;
    def.joints.forEach((j, jointIndex) => {
      if (j.parent !== parent || seen.has(j.child)) return;
      seen.add(j.child);
      const originQ = rpyToQuaternion(j.originRpy);
      const jointQ = new Quaternion().setFromAxisAngle(
        new Vector3(...j.axis),
        qRadByJoint.get(jointIndex) ?? 0,
      );
      const childQ = parentPose.quaternion
        .clone()
        .multiply(originQ)
        .multiply(jointQ);
      const childPos = parentPose.position
        .clone()
        .add(new Vector3(...j.originXyz).applyQuaternion(parentPose.quaternion));
      poses.set(j.child, { position: childPos, quaternion: childQ });
      queue.push(j.child);
    });
  }
  return poses;
}

/** 末端（TCP 基座 link）世界位姿；无 tcpOffset 时即 eeLink 原点 */
export function computeTcpPose(model: RobotModel, poses: Map<string, Pose>, tcpOffset: Vec3 = [0, 0, 0]): Pose {
  const ee = poses.get(model.eeLink);
  if (!ee) {
    return {
      position: new Vector3(0, 0, 0),
      quaternion: new Quaternion(),
    };
  }
  const position = ee.position.clone().add(new Vector3(...tcpOffset).applyQuaternion(ee.quaternion));
  return { position, quaternion: ee.quaternion.clone() };
}

/** 世界位姿 → "XYZ (m) / RPY (°)" 字符串，供 UI 读数 */
export function formatPose(pose: Pose): { xyz: string; rpy: string } {
  const euler = poseToRpy(pose.quaternion);
  return {
    xyz: `${pose.position.x.toFixed(3)}, ${pose.position.y.toFixed(3)}, ${pose.position.z.toFixed(3)}`,
    rpy: `${radiansToDegrees(euler[0]).toFixed(1)}, ${radiansToDegrees(euler[1]).toFixed(1)}, ${radiansToDegrees(euler[2]).toFixed(1)}`,
  };
}

/** 四元数 → rpy（固定轴，仅取近似欧拉角，显示用） */
export function poseToRpy(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return [e.x, e.y, e.z];
}