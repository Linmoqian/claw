/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 仿真场景道具：用 Three.js 原生几何搭建水杯与咖啡机，避免引入外部资产依赖。
 */
import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import {
  SCENE_PROP_LAYOUT,
  type ScenePropId,
} from "../robot/sceneGeometry";
import {
  clearScenePropPoses,
  setScenePropPose,
  snapshotScenePropPoses,
} from "../robot/scenePhysics";
import { useSceneStore } from "../stores/sceneStore";

/** 场景道具材质（模块级共享，避免每次渲染重复创建材质）。 */
const CUP_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#f5f1e8",
  roughness: 0.72,
  metalness: 0.03,
});
const CUP_RIM_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#fffaf0",
  roughness: 0.54,
  metalness: 0.04,
});
const COFFEE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#593422",
  roughness: 0.92,
  metalness: 0,
});
const MACHINE_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#353b44",
  roughness: 0.34,
  metalness: 0.52,
});
const MACHINE_ACCENT_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#8e9aaa",
  roughness: 0.42,
  metalness: 0.66,
});
const MACHINE_DARK_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1c2128",
  roughness: 0.62,
  metalness: 0.18,
});
const MACHINE_LED_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#64d8cb",
  emissive: "#2c9b94",
  emissiveIntensity: 1.7,
  roughness: 0.25,
  metalness: 0.12,
});
const WATER_TANK_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: "#8cc9d7",
  roughness: 0.16,
  metalness: 0.02,
  transmission: 0.28,
  transparent: true,
  opacity: 0.68,
});

const CUP_POSITION: [number, number, number] = [
  ...SCENE_PROP_LAYOUT.cup.positionThree,
];
const MACHINE_POSITION: [number, number, number] = [
  ...SCENE_PROP_LAYOUT.coffeeMachine.positionThree,
];

/** 一只带把手和咖啡液面的水杯（单位：米）。 */
function Cup({ bodyRef }: { bodyRef: RefObject<RapierRigidBody | null> }) {
  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      position={CUP_POSITION}
      linearDamping={1.2}
      angularDamping={1.5}
      restitution={0.08}
      ccd
    >
      <group name="scene-prop-cup">
        {/* 杯壁使用 openEnded，顶部由独立的液面和杯沿表示。 */}
        <mesh castShadow receiveShadow position={[0, 0.063, 0]}>
          <cylinderGeometry args={[0.052, 0.06, 0.11, 32, 1, true]} />
          <primitive object={CUP_BODY_MATERIAL} attach="material" />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.119, 0]}>
          <torusGeometry args={[0.052, 0.006, 12, 32]} />
          <primitive object={CUP_RIM_MATERIAL} attach="material" />
        </mesh>
        <mesh position={[0, 0.113, 0]}>
          <cylinderGeometry args={[0.047, 0.047, 0.003, 32]} />
          <primitive object={COFFEE_MATERIAL} attach="material" />
        </mesh>
        {/* 部分环面嵌入杯壁，形成简洁的竖直把手。 */}
        <mesh
          castShadow
          receiveShadow
          position={[0.058, 0.066, 0]}
          rotation={[0, 0, 0]}
        >
          <torusGeometry args={[0.035, 0.007, 12, 24, Math.PI * 1.65]} />
          <primitive object={CUP_RIM_MATERIAL} attach="material" />
        </mesh>
      </group>
      {/* 杯身胶囊碰撞体，保留把手视觉但不让细环面造成数值抖动。 */}
      <CylinderCollider
        args={[0.055, 0.06]}
        position={[0, 0.063, 0]}
        friction={0.86}
        restitution={0.04}
      />
    </RigidBody>
  );
}

/** 一台桌面咖啡机：机身、水箱、面板、出液口和接水托盘。 */
function CoffeeMachine({
  bodyRef,
}: {
  bodyRef: RefObject<RapierRigidBody | null>;
}) {
  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      position={MACHINE_POSITION}
      linearDamping={1.4}
      angularDamping={1.8}
      restitution={0.06}
      ccd
    >
      <group name="scene-prop-coffee-machine">
        {/* 主机身 */}
        <mesh castShadow receiveShadow position={[0, 0.125, 0]}>
          <boxGeometry args={[0.18, 0.25, 0.16]} />
          <primitive object={MACHINE_BODY_MATERIAL} attach="material" />
        </mesh>
        {/* 顶部透明水箱 */}
        <mesh castShadow receiveShadow position={[0, 0.278, -0.01]}>
          <boxGeometry args={[0.14, 0.075, 0.12]} />
          <primitive object={WATER_TANK_MATERIAL} attach="material" />
        </mesh>
        <mesh position={[0, 0.321, -0.01]}>
          <boxGeometry args={[0.145, 0.012, 0.125]} />
          <primitive object={MACHINE_ACCENT_MATERIAL} attach="material" />
        </mesh>
        {/* 前方面板和两个实体按键 */}
        <mesh castShadow position={[0, 0.19, 0.084]}>
          <boxGeometry args={[0.142, 0.058, 0.008]} />
          <primitive object={MACHINE_DARK_MATERIAL} attach="material" />
        </mesh>
        {[-0.045, 0.045].map((x) => (
          <mesh
            key={x}
            castShadow
            position={[x, 0.205, 0.091]}
            rotation-x={Math.PI / 2}
          >
            <cylinderGeometry args={[0.012, 0.012, 0.007, 20]} />
            <primitive object={MACHINE_LED_MATERIAL} attach="material" />
          </mesh>
        ))}
        {/* 金属出液口 */}
        <mesh castShadow position={[0, 0.116, 0.094]}>
          <cylinderGeometry args={[0.012, 0.012, 0.07, 20]} />
          <primitive object={MACHINE_ACCENT_MATERIAL} attach="material" />
        </mesh>
        <mesh castShadow position={[0, 0.078, 0.094]}>
          <sphereGeometry args={[0.015, 18, 10]} />
          <primitive object={MACHINE_DARK_MATERIAL} attach="material" />
        </mesh>
        {/* 接水托盘向前伸出，带防滑栅格 */}
        <mesh castShadow receiveShadow position={[0, 0.027, 0.087]}>
          <boxGeometry args={[0.16, 0.018, 0.075]} />
          <primitive object={MACHINE_ACCENT_MATERIAL} attach="material" />
        </mesh>
        <mesh receiveShadow position={[0, 0.039, 0.094]}>
          <boxGeometry args={[0.125, 0.004, 0.045]} />
          <primitive object={MACHINE_DARK_MATERIAL} attach="material" />
        </mesh>
      </group>
      {/* 机身、水箱、托盘的复合碰撞体，近似真实外轮廓并允许翻倒。 */}
      <CuboidCollider
        args={[0.09, 0.125, 0.08]}
        position={[0, 0.125, 0]}
        friction={0.92}
        restitution={0.03}
      />
      <CuboidCollider
        args={[0.07, 0.0375, 0.06]}
        position={[0, 0.278, -0.01]}
        friction={0.8}
        restitution={0.03}
      />
      <CuboidCollider
        args={[0.08, 0.009, 0.0375]}
        position={[0, 0.027, 0.087]}
        friction={0.92}
        restitution={0.03}
      />
    </RigidBody>
  );
}

function syncPropPose(
  id: ScenePropId,
  body: RapierRigidBody | null,
): void {
  if (!body) return;
  setScenePropPose(id, body.translation(), body.rotation());
}

function resetRigidBody(
  body: RapierRigidBody | null,
  position: readonly [number, number, number],
): void {
  if (!body) return;
  body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
  body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.resetForces(true);
  body.resetTorques(true);
  body.wakeUp();
}

/** 固定在机器人工作区旁的场景道具层。 */
export default function SceneProps() {
  const cupRef = useRef<RapierRigidBody | null>(null);
  const machineRef = useRef<RapierRigidBody | null>(null);
  const resetPropsToken = useSceneStore((s) => s.resetPropsToken);

  useFrame(() => {
    syncPropPose("cup", cupRef.current);
    syncPropPose("coffee-machine", machineRef.current);
  });

  useEffect(() => {
    clearScenePropPoses();
    if (import.meta.env.DEV) {
      const debugWindow = window as unknown as Record<string, unknown>;
      debugWindow.__scenePropPhysics = { get: snapshotScenePropPoses };
      return () => {
        delete debugWindow.__scenePropPhysics;
        clearScenePropPoses();
      };
    }
    return () => clearScenePropPoses();
  }, []);

  useEffect(() => {
    if (resetPropsToken === 0) return;
    resetRigidBody(cupRef.current, CUP_POSITION);
    resetRigidBody(machineRef.current, MACHINE_POSITION);
    clearScenePropPoses();
  }, [resetPropsToken]);

  return (
    <>
      <Cup bodyRef={cupRef} />
      <CoffeeMachine bodyRef={machineRef} />
    </>
  );
}
