/**
 * TCP Gizmo —— 末端 6DoF 拖拽手柄（TCP 模式）。
 * 每帧跟随现实末端位姿（FK），平移轴沿世界轴滑动 / 旋转环绕世界轴转角；
 * 拖动只产生 TcpPoseIntent（经 InteractionController → targetStore），绝不直改状态。
 */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  computeLinkPoses,
  computeTcpPose,
} from "../robot/kinematics";
import type { SimulationLoop } from "../robot/simulation";
import type { RobotModel } from "../robot/types";
import {
  interactionController,
  useInteractionStore,
} from "../stores/interactionStore";

/** 手柄尺寸参数 */
const TRANSLATE_LEN = 0.075;
const TRANSLATE_TIP = 0.022;
const SHAFT_RADIUS = 0.0045;
/** 平移轴不可见拾取包络半径（易握手感） */
const HIT_RADIUS = 0.02;
const ROTATE_RING_RADIUS = 0.052;
const ROTATE_RING_TUBE = 0.0035;

/** 轴色：X 红 / Y 绿 / Z 蓝（浅色主题降饱和） */
const AXIS_COLORS = ["#e0685d", "#4ca873", "#4a7fd6"];
const HIGHLIGHT_EMISSIVE = "#ffffff";

/** 共享几何与材质（模块级，不随重渲染新建） */
const shaftGeo = new THREE.CylinderGeometry(
  SHAFT_RADIUS,
  SHAFT_RADIUS,
  TRANSLATE_LEN,
  8,
);
const tipGeo = new THREE.ConeGeometry(SHAFT_RADIUS * 2.4, TRANSLATE_TIP, 12);
const hitGeo = new THREE.CylinderGeometry(
  HIT_RADIUS,
  HIT_RADIUS,
  TRANSLATE_LEN + TRANSLATE_TIP,
  8,
);
const ringGeo = new THREE.TorusGeometry(ROTATE_RING_RADIUS, ROTATE_RING_TUBE, 10, 56);
const ringHitGeo = new THREE.CircleGeometry(ROTATE_RING_RADIUS * 1.35, 48);
const AXIS_VECTORS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

function axisMaterial(axis: number, highlighted: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: AXIS_COLORS[axis],
    roughness: 0.35,
    metalness: 0.2,
    emissive: highlighted ? HIGHLIGHT_EMISSIVE : "#000000",
    emissiveIntensity: highlighted ? 0.25 : 0,
  });
}

const HIT_MAT = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

interface TcpGizmoProps {
  model: RobotModel;
  sim: SimulationLoop;
}

export default function TcpGizmo({ model, sim }: TcpGizmoProps) {
  const active = useInteractionStore((s) => s.tcpDrag);
  const { raycaster, camera, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  // 每帧 FK：现实末端位姿（URDF 坐标）→ Gizmo 基点
  // 注意：只取位置；手柄/环保持在世界轴姿态（与拖拽增量计算的世界轴一致）
  useFrame(() => {
    const poses = computeLinkPoses(model, [...sim.currentDegrees]);
    const tcp = computeTcpPose(model, poses);
    const g = groupRef.current;
    if (!g) return;
    g.position.copy(tcp.position);
  });

  /** 手柄按下 → 控制器 begin，成功则接管 window 级 move/up（同时持续驱动意图） */
  const beginDrag = (
    kind: "translate" | "rotate",
    axisIndex: 0 | 1 | 2,
    ray: THREE.Ray,
  ) => {
    const tcp = currentTcpPose(model, sim);
    const began = interactionController.beginTcpDrag(
      {
        kind,
        axis: AXIS_VECTORS[axisIndex],
        axisIndex,
        startPosition: tcp.position,
        startQuaternion: tcp.quaternion,
      },
      ray,
    );
    if (!began) return;

    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      interactionController.updateTcpDrag(raycaster.ray);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      interactionController.endTcpDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const highlighted =
    (i: number) =>
    active !== null && active.axisIndex === i;

  return (
    <group ref={groupRef}>
      {/* 平移手柄：3 世界轴（URDF 空间），可视轴+包络命中体 */}
      {AXIS_VECTORS.map((axis, i) => (
        <group
          key={`t-${i}`}
          position={new THREE.Vector3().copy(axis).multiplyScalar((TRANSLATE_LEN + TRANSLATE_TIP) / 2 + 0.012)}
          quaternion={alignZTo(axis)}
        >
          <mesh
            geometry={shaftGeo}
            material={axisMaterial(i, false)}
            castShadow={false}
            receiveShadow={false}
          />
          <mesh
            geometry={tipGeo}
            position={[0, 0, (TRANSLATE_LEN + TRANSLATE_TIP) / 2]}
            material={axisMaterial(i, highlighted(i))}
            castShadow={false}
            receiveShadow={false}
          />
          <mesh
            geometry={hitGeo}
            material={HIT_MAT}
            onPointerDown={(e) => {
              e.stopPropagation();
              beginDrag("translate", i as 0 | 1 | 2, e.ray);
            }}
          />
        </group>
      ))}
      {/* 旋转环：3 世界轴平面 */}
      {AXIS_VECTORS.map((axis, i) => (
        <group key={`r-${i}`} quaternion={alignZTo(axis)}>
          <mesh
            geometry={ringGeo}
            material={axisMaterial(i, highlighted(i))}
            castShadow={false}
            receiveShadow={false}
          />
          <mesh
            geometry={ringHitGeo}
            material={HIT_MAT}
            onPointerDown={(e) => {
              e.stopPropagation();
              beginDrag("rotate", i as 0 | 1 | 2, e.ray);
            }}
          />
        </group>
      ))}
    </group>
  );
}

/** 末端当前位姿（begin 时快照，避免闭包持有过期引用） */
function currentTcpPose(model: RobotModel, sim: SimulationLoop) {
  const poses = computeLinkPoses(model, [...sim.currentDegrees]);
  return computeTcpPose(model, poses);
}

/** 本地 Z 轴对齐到目标轴的四元数（手柄几何沿 Z 建造） */
function alignZTo(axis: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    axis,
  );
}