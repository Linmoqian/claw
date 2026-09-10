/**
 * BaseDragHandle —— BASE 模式底盘拖拽手柄（M5）。
 * 跟随现实底盘（worldStore 位姿）的透明地面圆盘命中体；
 * pointerdown 命中 → InteractionController.beginBaseDrag（world y=0 平面拖拽）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { interactionController } from "../stores/interactionStore";
import { useInteractionStore } from "../stores/interactionStore";
import { useWorldStore } from "../stores/worldStore";

/** 命中圆盘半径（与 BASE_GRAB_RADIUS 对应的视觉提示） */
const HANDLE_RADIUS = 0.22;

const HIT_MAT = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

/** 底盘航向提取（Z-up 平面四元数 → yaw） */
function worldYawOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export default function BaseDragHandle() {
  const mode = useInteractionStore((s) => s.mode);
  const { raycaster, camera, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const diskRef = useRef<THREE.Mesh>(null);

  // 跟随现实底盘（无遥测时 world.robot 可能 null → 停原点）
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const robot = useWorldStore.getState().world.robot;
    const p = robot?.pose.position;
    g.position.set(p?.x ?? 0, 0.001, -(p?.y ?? 0));
    g.rotation.y = robot ? -worldYawOf(robot.pose.orientation) : 0;
  });

  /** 按下：命中体在底盘上 → 接管 window 级 move/up */
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const began = interactionController.beginBaseDrag(
      e.ray,
      groupRef.current!.position.clone().setY(0),
    );
    if (!began) return;

    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      interactionController.updateBaseDrag(raycaster.ray);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      interactionController.endBaseDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  if (mode !== "base") return null;

  return (
    <group ref={groupRef}>
      <mesh
        ref={diskRef}
        rotation={[-Math.PI / 2, 0, 0]}
        material={HIT_MAT}
        onPointerDown={onPointerDown}
      >
        <circleGeometry args={[HANDLE_RADIUS, 32]} />
      </mesh>
    </group>
  );
}
