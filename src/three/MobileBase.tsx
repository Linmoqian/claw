/** 移动底座（X-line 占位视觉）：world 遥测位姿 → three，臂平台挂载点。 */
import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Orientation } from "../core/world/pose";
import { useWorldStore } from "../stores/worldStore";

/** URDF（Z 上）→ three（Y 上）根旋转，与 RobotView 原约定一致 */
export const ROOT_UP_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

/** 臂安装平面高度（视觉占位；X-line 真实底盘几何在 DXF 阶段接入） */
export const DECK_HEIGHT = 0.062;

/** world 平面航向的 three 旋转轴（Y 上，负向补偿 z-up→y-up 翻转） */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** 轮位（车身长向 X = 车头方向，yaw=0 朝 map +X） */
const WHEELS: [number, number][] = [
  [0.13, 0.1],
  [0.13, -0.1],
  [-0.13, 0.1],
  [-0.13, -0.1],
];

/** 共享材质（模块级，不随重渲染新建） */
const DECK_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#c9ced6",
  roughness: 0.55,
  metalness: 0.18,
});
const SKIRT_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#3d434b",
  roughness: 0.9,
  metalness: 0.05,
});
const LIGHT_BAR_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#5b8bd4",
  roughness: 0.35,
  metalness: 0.2,
});
const WHEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#2a2e34",
  roughness: 0.85,
  metalness: 0.05,
});

/** 从 world 四元数提取平面航向 yaw（M0 假设：robot_state 为 Z-up 平面姿态） */
export function worldYawOf(q: Orientation): number {
  return Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z),
  );
}

/** 底盘视觉（极简几何占位；castShadow） */
function Chassis() {
  return (
    <group>
      {/* 车体板 */}
      <mesh
        castShadow
        receiveShadow
        position={[0, 0.034, 0]}
      >
        <boxGeometry args={[0.36, 0.048, 0.26]} />
        <primitive object={DECK_MATERIAL} attach="material" />
      </mesh>
      {/* 裙边底架 */}
      <mesh castShadow receiveShadow position={[0, 0.011, 0]}>
        <boxGeometry args={[0.4, 0.022, 0.3]} />
        <primitive object={SKIRT_MATERIAL} attach="material" />
      </mesh>
      {/* 车头灯条（+X 方向） */}
      <mesh position={[0.185, 0.045, 0]}>
        <boxGeometry args={[0.012, 0.014, 0.09]} />
        <primitive object={LIGHT_BAR_MATERIAL} attach="material" />
      </mesh>
      {/* 轮子 */}
      {WHEELS.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.015, z]} castShadow>
          <boxGeometry args={[0.1, 0.03, 0.026]} />
          <primitive object={WHEEL_MATERIAL} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

interface MobileBaseProps {
  children?: ReactNode;
}

/**
 * 世界遥测位置 → three（上层 group）：
 * map(x, y, yaw|Z-up) → three(x, z=-y, Ry(-yaw))。
 * SIM 模式下 world.robot 为 null：底盘停在原点。遥测断流时保持最后位姿（不清零）。
 */
export default function MobileBase({ children }: MobileBaseProps) {
  const groupRef = useRef<THREE.Group>(null);
  const tmpQuat = useRef(new THREE.Quaternion());

  useFrame(() => {
    const robot = useWorldStore.getState().world.robot;
    const group = groupRef.current;
    if (!group || !robot) return;
    const p = robot.pose.position;
    group.position.set(p.x, 0, -p.y);
    tmpQuat.current.setFromAxisAngle(
      UP_AXIS,
      -worldYawOf(robot.pose.orientation),
    );
    group.quaternion.copy(tmpQuat.current);
  });

  return (
    <group ref={groupRef}>
      <Chassis />
      {/* 臂平台：deck 高 + URDF Z-up → three Y-up 翻转 */}
      <group position-y={DECK_HEIGHT}>
        <group rotation={ROOT_UP_ROTATION}>{children}</group>
      </group>
    </group>
  );
}
