/**
 * BaseGhost —— 底座预览/目标标记（M5）：半透明圆环 + 航向箭头。
 * 读 BaseSim.previewOrTargetPose（预览期跟手，平时显示目标位置）；
 * world(x, y, yaw) → three(x, 0.004, -y) 旋转 Ry(-yaw)（与 MobileBase 一致）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BaseSim } from "../robot/baseSim";

/** 共享几何与材质（模块级） */
const RING_GEO = new THREE.RingGeometry(0.13, 0.15, 40);
const ARROW_GEO = new THREE.ConeGeometry(0.018, 0.05, 12);
const PREVIEW_MAT = new THREE.MeshBasicMaterial({
  color: "#3b82f6",
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const TARGET_MAT = new THREE.MeshBasicMaterial({
  color: "#22c55e",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export default function BaseGhost({ baseSim }: { baseSim: BaseSim }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const p = baseSim.previewOrTargetPose;
    // 预览标记只在“与现实分离”时可见（目标点与现实重合即隐藏）
    const snap = baseSim.getSnapshot();
    const separated =
      baseSim.previewActive ||
      baseSim.isPlaying ||
      Math.hypot(p.x - snap.current.x, p.y - snap.current.y) > 0.01;
    g.visible = separated;
    g.position.set(p.x, 0.004, -p.y);
    g.rotation.y = -p.yaw;
    // 预览期蓝，平时目标绿
    const mat = baseSim.previewActive ? PREVIEW_MAT : TARGET_MAT;
    g.children.forEach((child) => {
      if (child instanceof THREE.Mesh) child.material = mat;
    });
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh geometry={RING_GEO} material={TARGET_MAT} rotation={[-Math.PI / 2, 0, 0]} />
      {/* 航向箭头（world +x 方向，即底盘前向） */}
      <mesh
        geometry={ARROW_GEO}
        material={TARGET_MAT}
        position={[0.14, 0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      />
    </group>
  );
}
