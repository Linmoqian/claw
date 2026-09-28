/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 场景道具的非响应式物理姿态缓存：Three/Rapier 每帧写入，解析碰撞层按需读取。
 */
import { Quaternion, Vector3 } from "three";
import type { ScenePropId } from "./sceneGeometry";

export interface PhysicsVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsQuaternion extends PhysicsVector3 {
  w: number;
}

export interface ScenePropPose {
  position: Vector3;
  rotation: Quaternion;
}

export interface ScenePropPoseSnapshot {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

const poses = new Map<ScenePropId, ScenePropPose>();

/** 写入一个刚体的 Three 世界姿态；复用对象避免渲染帧产生垃圾。 */
export function setScenePropPose(
  id: ScenePropId,
  position: PhysicsVector3,
  rotation: PhysicsQuaternion,
): void {
  let pose = poses.get(id);
  if (!pose) {
    pose = { position: new Vector3(), rotation: new Quaternion() };
    poses.set(id, pose);
  }
  pose.position.set(position.x, position.y, position.z);
  pose.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

/** 读取最新姿态；物理世界尚未初始化时返回 null，调用方应回退到静态布局。 */
export function getScenePropPose(id: ScenePropId): ScenePropPose | null {
  return poses.get(id) ?? null;
}

/** 场景卸载或复位时清除动态姿态，让解析碰撞回退到初始布局。 */
export function clearScenePropPoses(): void {
  poses.clear();
}

/** 生成调试/验证用快照，不暴露可写 Three 对象。 */
export function snapshotScenePropPoses(): Partial<
  Record<ScenePropId, ScenePropPoseSnapshot>
> {
  const snapshot: Partial<Record<ScenePropId, ScenePropPoseSnapshot>> = {};
  for (const [id, pose] of poses) {
    snapshot[id] = {
      position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      ],
    };
  }
  return snapshot;
}
