/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 仿真场景物体的统一布局：渲染层和碰撞层共用同一份米制坐标。
 */
import type { Vec3 } from "./types";

export type ScenePropId = "cup" | "coffee-machine";

/** 场景物体初始姿态的胶囊近似（URDF/ROS 坐标，z 轴向上，单位：米）。 */
export interface ScenePropCollider {
  id: ScenePropId;
  label: string;
  /** 胶囊中心线两端点。 */
  p0: Vec3;
  p1: Vec3;
  /** 胶囊中心线两端点相对 Three 刚体原点的局部坐标。 */
  localP0Three: Vec3;
  localP1Three: Vec3;
  /** 物体包络半径；与机械臂 ENV_RADIUS 一起形成安全余量。 */
  radius: number;
}

/** Three 场景摆放坐标与对应解析碰撞体初始布局。 */
export const SCENE_PROP_LAYOUT = {
  cup: {
    positionThree: [-0.3, 0, 0.23] as Vec3,
    collider: {
      id: "cup",
      label: "水杯",
      p0: [-0.3, -0.23, 0.01] as Vec3,
      p1: [-0.3, -0.23, 0.11] as Vec3,
      localP0Three: [0, 0.01, 0] as Vec3,
      localP1Three: [0, 0.11, 0] as Vec3,
      radius: 0.06,
    } satisfies ScenePropCollider,
  },
  coffeeMachine: {
    positionThree: [0.3, 0, 0.22] as Vec3,
    collider: {
      id: "coffee-machine",
      label: "咖啡机",
      // 机身、水箱和向前伸出的托盘合并为一个保守包络。
      p0: [0.3, -0.245, 0.01] as Vec3,
      p1: [0.3, -0.245, 0.335] as Vec3,
      localP0Three: [0, 0.01, 0.025] as Vec3,
      localP1Three: [0, 0.335, 0.025] as Vec3,
      radius: 0.145,
    } satisfies ScenePropCollider,
  },
} as const;

/** 碰撞系统按稳定顺序读取的场景物体列表。 */
export const SCENE_PROP_COLLIDERS: readonly ScenePropCollider[] = [
  SCENE_PROP_LAYOUT.cup.collider,
  SCENE_PROP_LAYOUT.coffeeMachine.collider,
];
