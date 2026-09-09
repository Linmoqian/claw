/** 交互工具 Gizmo：可拖拽关节旋转环（位姿随 FK 每帧更新）。 */
import { useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { computeLinkPoses, rpyToQuaternion } from "../robot/kinematics";
import type { SimulationLoop } from "../robot/simulation";
import type { RobotModel } from "../robot/types";
import { interactionController, useInteractionStore } from "../stores/interactionStore";
import { useSceneStore } from "../stores/sceneStore";

/** 关节环视觉参数（比 V1 轴环略大，兼顾展示与可握持） */
const RING_RADIUS = 0.048;
const RING_TUBE = 0.0035;
/** 透明拾取圆盘半径（远大于环，可握手感） */
const HIT_RADIUS = 0.075;

const RING_COLOR_NORMAL = "#8592a6";
const RING_COLOR_HOVER = "#3c7de0";
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** 共享几何与材质（模块级，不随重渲染新建） */
const ringGeometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 64);
const hitGeometry = new THREE.CircleGeometry(HIT_RADIUS, 48);
const RING_MAT_NORMAL = new THREE.MeshStandardMaterial({
  color: RING_COLOR_NORMAL,
  roughness: 0.4,
  metalness: 0.25,
  transparent: true,
  opacity: 0.95,
});
const RING_MAT_HOVER = new THREE.MeshStandardMaterial({
  color: RING_COLOR_HOVER,
  roughness: 0.4,
  metalness: 0.25,
  transparent: true,
  opacity: 0.95,
});
const HIT_MAT = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

interface InteractionGizmosProps {
  model: RobotModel;
  sim: SimulationLoop;
}

export default function InteractionGizmos({
  model,
  sim,
}: InteractionGizmosProps) {
  const mode = useInteractionStore((s) => s.mode);
  const activeJointName = useInteractionStore((s) => s.activeJointName);
  const showJointAxes = useSceneStore((s) => s.showJointAxes);
  const { raycaster, camera, gl } = useThree();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  const frameCache = useRef(
    model.active.map(() => ({
      center: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      align: new THREE.Quaternion(),
    })),
  );

  // 拖拽流程：down 命中 → begin → window 级 move/up 持续驱动
  const beginDrag = (
    e: ThreeEvent<PointerEvent>,
    index: number,
    name: string,
  ) => {
    e.stopPropagation();
    const frame = frameCache.current[index];
    const began = interactionController.beginJointDrag(
      {
        jointIndex: index,
        jointName: name,
        center: frame.center,
        axis: frame.axis,
        startValueDeg: sim.getSnapshot().targetDeg[index] ?? 0,
      },
      e.ray,
    );
    if (!began) return;
    useInteractionStore.setState({ activeJointName: name });

    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      interactionController.updateDrag(raycaster.ray);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      interactionController.endDrag();
      useInteractionStore.setState({ activeJointName: null });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  // 每帧 FK → 关节环中心/轴（与机械臂同在 ROOT_UP_ROTATION 翻转空间内）
  useFrame(() => {
    const poses = computeLinkPoses(model, [...sim.currentDegrees]);
    const tmpQ = new THREE.Quaternion();
    model.active.forEach((joint, index) => {
      const pp = poses.get(joint.def.parent);
      if (!pp) return;
      const frame = frameCache.current[index];
      rpyToQuaternion(joint.def.originRpy, tmpQ);
      // 中心：parent 位姿 × joint origin 平移
      frame.center
        .copy(new THREE.Vector3(...joint.def.originXyz))
        .applyQuaternion(pp.quaternion)
        .add(pp.position);
      // 轴：parent 旋转 × origin 旋转 × 声明轴
      frame.axis
        .copy(new THREE.Vector3(...joint.def.axis))
        .applyQuaternion(pp.quaternion)
        .applyQuaternion(tmpQ)
        .normalize();
      frame.align.setFromUnitVectors(Z_AXIS, frame.axis);
      const group = groupRefs.current[index];
      if (group) {
        group.position.copy(frame.center);
        group.quaternion.copy(frame.align);
      }
    });
  });

  // 非关节模式且未开启关节轴显示时隐藏
  const visible = mode === "joint" || showJointAxes;

  return (
    <group visible={visible}>
      {model.active.map((joint, index) => {
        const highlighted = hoverIndex === index || activeJointName === joint.def.name;
        return (
          <group
            key={joint.def.name}
            ref={(g) => {
              groupRefs.current[index] = g;
            }}
          >
            <mesh
              geometry={ringGeometry}
              material={highlighted ? RING_MAT_HOVER : RING_MAT_NORMAL}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (mode === "joint") setHoverIndex(index);
              }}
              onPointerOut={() => setHoverIndex(null)}
              onPointerDown={(e) => beginDrag(e, index, joint.def.name)}
              castShadow={false}
              receiveShadow={false}
            />
            {mode === "joint" && (
              <mesh
                geometry={hitGeometry}
                material={HIT_MAT}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoverIndex(index);
                }}
                onPointerOut={() => setHoverIndex(null)}
                onPointerDown={(e) => beginDrag(e, index, joint.def.name)}
                castShadow={false}
                receiveShadow={false}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}