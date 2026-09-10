/** 机器人 3D 视图：按 URDF 运动树构建 three 层级，逐帧应用仿真关节角。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { rpyToQuaternion } from "../robot/kinematics";
import type { SimulationLoop } from "../robot/simulation";
import type { JointDef, RobotModel, VisualDef } from "../robot/types";
import { interactionController, useInteractionStore } from "../stores/interactionStore";
import { useSceneStore } from "../stores/sceneStore";

interface LoadedVisual {
  linkName: string;
  visual: VisualDef;
  geometry: THREE.BufferGeometry;
}

/** 同一模型的 STL 资源缓存（current/ghost 双实例共享内存），key 用 def name */
const visualsCache = new Map<string, LoadedVisual[]>();

/** 末端轨迹采样上限（演示轨迹 10s×20Hz = 200 点，留足余量） */
const TRAIL_MAX_POINTS = 640;
const TRAIL_SAMPLE_SEC = 0.05;

const AXIS_COLORS = ["#e04f3c", "#37a86c", "#3c7de0"];
const TRAIL_MATERIAL = new THREE.LineBasicMaterial({
  color: "#d9684e",
  transparent: true,
  opacity: 0.9,
});

/** 无材质视觉的回退材质 */
let fallbackMaterial: THREE.MeshStandardMaterial | null = null;
const getFallbackMaterial = () => {
  if (!fallbackMaterial) {
    fallbackMaterial = new THREE.MeshStandardMaterial({
      color: "#d8dbdf",
      roughness: 0.9,
      metalness: 0.05,
    });
  }
  return fallbackMaterial;
};

interface RobotViewProps {
  model: RobotModel;
  sim: SimulationLoop;
  assetBase: string;
  /** "current"=现实实体（默认）；"ghost"=目标预览（半透明、无阴影、不参与拾取） */
  variant?: "current" | "ghost";
}

/** Ghost 实例熄灭火线拾取（Raycast 分组约束） */
const NO_RAYCAST = () => undefined as unknown as THREE.Intersection[];

/** Ghost 半透明预览材质（模块级共享） */
const GHOST_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#9db4d4",
  roughness: 0.6,
  metalness: 0.1,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

/** 首帧 effect 未就绪时的轴向量回退（X 轴） */
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);

/** 末端轨迹线（play 模式采样，世界坐标手算转发避免 alloc） */
function TcpTrail({ sim }: { sim: SimulationLoop }) {
  const showTrail = useSceneStore((s) => s.showTrail);
  const countRef = useRef(0);
  const lastSampleRef = useRef(0);
  const wasPlayRef = useRef(false);

  // 原生 THREE.Line：render 期懒初始化（不进入 hook 依赖，位数组随帧原地更新）
  const lineRef = useRef<THREE.Line | null>(null);
  if (lineRef.current === null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3),
    );
    geometry.setDrawRange(0, 0); // 初始不绘制（防全 0 点堆在原点）
    lineRef.current = new THREE.Line(geometry, TRAIL_MATERIAL);
    lineRef.current.frustumCulled = false;
  }

  useFrame(({ clock }) => {
    const currentLine = lineRef.current;
    if (!currentLine || !showTrail) return;
    const playing = sim.currentMode === "play";
    if (!playing) {
      // 离开轨迹模式：清空迹线
      if (wasPlayRef.current) {
        countRef.current = 0;
        currentLine.geometry.setDrawRange(0, 0);
        const attr0 = currentLine.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        attr0.needsUpdate = true;
        wasPlayRef.current = false;
      }
      return;
    }
    wasPlayRef.current = true;
    const t = clock.elapsedTime;
    if (t - lastSampleRef.current < TRAIL_SAMPLE_SEC) return;
    lastSampleRef.current = t;
    const p = sim.tcpPosition;
    // URDF (x, y, z) → three (x, z, -y)
    const wx = p.x;
    const wy = p.z;
    const wz = -p.y;
    const i = countRef.current;
    if (i >= TRAIL_MAX_POINTS) return; // 轨迹长度上限，不再追加
    const attr = currentLine.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    array[i * 3] = wx;
    array[i * 3 + 1] = wy;
    array[i * 3 + 2] = wz;
    countRef.current = i + 1;
    attr.needsUpdate = true;
    currentLine.geometry.setDrawRange(0, countRef.current);
  });

  return (
    <primitive ref={lineRef} object={lineRef.current} visible={showTrail} />
  );
}

/** 末端 TCP 坐标系（挂在 ee link 下的 X/Y/Z 三色轴） */
function TcpAxes() {
  return (
    <group>
      {[0, 1, 2].map((axis) => {
        const len = 0.034;
        const th = 0.0022;
        const position = [0, 0, 0] as [number, number, number];
        position[axis] = len / 2;
        // X 轴：box 已长向 X，无需旋转；Y 轴：长向 Y；Z 轴：绕 X 转 90° 把 Y 长向转到 Z
        const quaternion = new THREE.Quaternion();
        if (axis === 2) quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        return (
          <mesh key={axis} position={position} quaternion={quaternion}>
            <boxGeometry args={axis === 0 ? [len, th, th] : [th, len, th]} />
            <meshStandardMaterial color={AXIS_COLORS[axis]} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 渲染主体：加载 STL → 构建 link/joint 层级 → 逐帧驱动关节 */
export default function RobotView({
  model,
  sim,
  assetBase,
  variant = "current",
}: RobotViewProps) {
  const showTcpAxes = useSceneStore((s) => s.showTcpAxes);
  const showTrail = useSceneStore((s) => s.showTrail);
  const materialStyle = useSceneStore((s) => s.materialStyle);
  const interactionMode = useInteractionStore((s) => s.mode);
  const isGhost = variant === "ghost";

  const [loadError, setLoadError] = useState<string | null>(null);

  // 资源缓存键（渲染期常量；模型切换由上层 key 重挂载，实例内 model 恒定）
  const cacheKey = `so:${model.def.name}:${assetBase}`;
  // 缓存命中：直接作为初始状态（避免 effect 内同步 setState）；Ghost/重挂载实例零开销
  const [visuals, setVisuals] = useState<LoadedVisual[] | null>(
    () => visualsCache.get(cacheKey) ?? null,
  );

  // 资源加载：cache miss 时异步拉取 URDF visual 网格（STL）
  useEffect(() => {
    if (visualsCache.get(cacheKey)) return;
    let alive = true;
    const loader = new STLLoader();
    (async () => {
      const entries: LoadedVisual[] = [];
      for (const link of model.def.links) {
        for (const visual of link.visuals) {
          if (!visual.meshFile) continue;
          const res = await fetch(`${assetBase}/${visual.meshFile}`);
          if (!res.ok) {
            throw new Error(`网格加载失败 ${visual.meshFile}：HTTP ${res.status}`);
          }
          const geometry = loader.parse(await res.arrayBuffer());
          geometry.computeBoundingSphere();
          entries.push({ linkName: link.name, visual, geometry });
        }
      }
      visualsCache.set(cacheKey, entries);
      if (alive) setVisuals(entries);
    })().catch((err: unknown) => {
      if (alive) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      alive = false;
    };
  }, [model, assetBase, cacheKey]);

  // 材质表：URDF 配色 / chalk 浅灰涂装；ghost 覆盖为半透明双层预览
  const materials: Record<string, THREE.MeshStandardMaterial> = useMemo(() => {
    if (isGhost) {
      return { ghost: GHOST_MATERIAL };
    }
    const map: Record<string, THREE.MeshStandardMaterial> = {};
    Object.entries(model.def.materials).forEach(([name, color]) => {
      map[name] = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.08,
        name,
      });
    });
    if (materialStyle === "chalk") {
      const printed = map["3d_printed"];
      if (printed) {
        printed.color.set("#d8dbdf");
        printed.roughness = 0.92;
        printed.metalness = 0.04;
      }
      const motor = map["sts3215"];
      if (motor) {
        motor.color.set("#3d434b");
        motor.roughness = 0.5;
        motor.metalness = 0.4;
      }
    }
    return map;
  }, [model, materialStyle, isGhost]);

  // 每帧驱动：可动关节轴组 + 预分配临时对象（避免 GC）
  const axisGroups = useRef<THREE.Group[]>([]);
  const axisVectors = useRef<THREE.Vector3[]>([]);
  const tmpQuats = useRef<THREE.Quaternion[]>([]);
  const active = model.active;

  useEffect(() => {
    axisGroups.current = [];
    axisVectors.current = active.map((a) => new THREE.Vector3(...a.def.axis).normalize());
    tmpQuats.current = active.map(() => new THREE.Quaternion());
  }, [active, model]);

  const registerAxisGroup = (index: number) => (group: THREE.Group | null) => {
    if (group) axisGroups.current[index] = group;
  };

  useFrame(() => {
    // ghost 实例跟随目标角（预览），current 实例跟随现实角
    const q = isGhost ? sim.targetDegrees : sim.currentDegrees;
    for (let i = 0; i < active.length; i++) {
      const group = axisGroups.current[i];
      const tmpQuat = tmpQuats.current[i];
      if (!group || !tmpQuat) continue;
      tmpQuat.setFromAxisAngle(
        axisVectors.current[i] ?? FALLBACK_AXIS,
        THREE.MathUtils.degToRad(q[i]),
      );
      group.quaternion.copy(tmpQuat);
    }
  });

  // —— 层级构建（模型与资源就绪后静态展开；toggle 改变时重建） ——
  const visualsByLink = useMemo(() => {
    const map = new Map<string, LoadedVisual[]>();
    (visuals ?? []).forEach((v) => {
      const list = map.get(v.linkName);
      if (list) list.push(v);
      else map.set(v.linkName, [v]);
    });
    return map;
  }, [visuals]);

  const jointsByParent = useMemo(() => {
    const map = new Map<string, JointDef[]>();
    model.def.joints.forEach((j) => {
      const list = map.get(j.parent);
      if (list) list.push(j);
      else map.set(j.parent, [j]);
    });
    return map;
  }, [model]);

  const rootLink = useMemo(
    () =>
      model.def.links.find((l) => model.jointOfLink.get(l.name) === null)
        ?.name ?? model.def.links[0]?.name,
    [model],
  );

  if (loadError) {
    return null;
  }

  /** 递归渲染 link（含其视觉与出向关节链） */
  const renderLink = (linkName: string): React.ReactNode => {
    const linkVisuals = visualsByLink.get(linkName) ?? [];
    const childJoints = jointsByParent.get(linkName) ?? [];
    return (
      <group name={`link:${linkName}`} key={linkName}>
        {linkVisuals.map((entry, vi) => (
          <group
            key={vi}
            position={entry.visual.originXyz}
            quaternion={rpyToQuaternion(entry.visual.originRpy)}
          >
            <mesh
              castShadow={!isGhost}
              receiveShadow={!isGhost}
              geometry={entry.geometry}
              material={
                isGhost
                  ? materials.ghost
                  : materials[entry.visual.materialName ?? ""] ??
                    getFallbackMaterial()
              }
              userData={isGhost ? { ghost: true } : { linkName }}
              raycast={isGhost ? (NO_RAYCAST as unknown as THREE.Object3D["raycast"]) : undefined}
              onClick={
                isGhost
                  ? undefined
                  : (e) => {
                      // 仅 SELECT 模式且近乎未拖动时视为拾取（避免旋转视角误选）
                      if (interactionMode === "select" && e.delta < 6) {
                        interactionController.pick(linkName);
                      }
                    }
              }
            />
          </group>
        ))}
        {childJoints.map((joint) => {
          const jointIndex = model.def.joints.indexOf(joint);
          const activeIdx = model.activeIndexByJoint.get(jointIndex);
          const isActive = activeIdx !== undefined;
          return (
            <group
              key={joint.name}
              name={`joint:${joint.name}`}
              position={joint.originXyz}
              quaternion={rpyToQuaternion(joint.originRpy)}
            >
              <group
                name={`joint-axis:${joint.name}`}
                ref={
                  isActive ? registerAxisGroup(activeIdx as number) : undefined
                }
              >
                {renderLink(joint.child)}
              </group>
            </group>
          );
        })}
        {linkName === model.eeLink && showTcpAxes && !isGhost && <TcpAxes />}
      </group>
    );
  };

  return (
    <>
      {renderLink(rootLink)}
      {showTrail && !isGhost && <TcpTrail sim={sim} />}
    </>
  );
}