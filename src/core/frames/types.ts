/**
 * 坐标框架与刚体变换 —— 类似 ROS TF 的最小实现。
 * 所有业务数据统一转换到 world 后进入 WorldState；
 * Three.js 渲染层只消费 world 帧，不理解 station/cad 语义。
 */
import type { Quaternion, Vector3 } from "three";

/** 命名坐标系节点 */
export interface Frame {
  name: string;
  parent: string | null;
}

/** 刚体变换：平移 + 旋转（translation 与 rotation 都描述 parent → child） */
export interface Transform {
  translation: Vector3;
  rotation: Quaternion;
}

/** 约定帧名称（初始树预置，标定后由外部 upsert 覆盖） */
export const FRAME_NAMES = {
  world: "world",
  map: "map",
  robotBase: "robot_base",
  station: "station",
  cad: "cad",
} as const;