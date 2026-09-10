/** 3D 舞台：Canvas + 环境光 + 网格地面 + OrbitControls + 机器人视图。 */
import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import RobotView from "./RobotView";
import MobileBase from "./MobileBase";
import InteractionGizmos from "../interaction/InteractionGizmos";
import TcpGizmo from "../interaction/TcpGizmo";
import { useInteractionStore } from "../stores/interactionStore";
import type { SimulationLoop } from "../robot/simulation";
import type { RobotModel } from "../robot/types";
import { useRobotStore } from "../stores/robotStore";
import { useSceneStore } from "../stores/sceneStore";
import { useWorldStore } from "../stores/worldStore";

/** 初始视角目标点（机器人基座附近，模型高度中段） */
const INITIAL_TARGET = new THREE.Vector3(0, 0.22, 0);

/** 世界坐标轴摆放（右侧地面角落，避开机器人工作区） */
const WORLD_AXES_POSITION: [number, number, number] = [0.52, 0.001, 0.42];

interface StageContentProps {
  model: RobotModel;
  sim: SimulationLoop;
  assetBase: string;
}

function StageContent({ model, sim, assetBase }: StageContentProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const resetViewToken = useSceneStore((s) => s.resetViewToken);
  const focusToken = useSceneStore((s) => s.focusToken);
  // 模型加载代次：切换模型时以此 key 重挂 RobotView（重置其内部加载状态）
  const loads = useRobotStore((s) => s.loads);
  // 交互模式：SELECT 才允许拖转/平移视角，其余模式保留滚轮缩放
  const interactionMode = useInteractionStore((s) => s.mode);

  // 仿真驱动：渲染循环即仿真循环（step 内含碰撞评估→档位限速）
  useFrame((_, delta) => {
    sim.step(delta);
  });

  // 记录初始视角（相机位置 + 目标点），供"重置视角"恢复
  useEffect(() => {
    controlsRef.current?.saveState();
  }, []);

  // 重置视角：恢复到保存的相机姿态
  useEffect(() => {
    if (resetViewToken > 0) controlsRef.current?.reset();
  }, [resetViewToken]);

  // 聚焦机器人：目标回到基座（接入遥测后跟随 world 位姿；先保留当前视角）
  useEffect(() => {
    if (focusToken > 0 && controlsRef.current) {
      const robot = useWorldStore.getState().world.robot;
      const target = robot
        ? new THREE.Vector3(
            robot.pose.position.x,
            INITIAL_TARGET.y,
            -robot.pose.position.y,
          )
        : INITIAL_TARGET;
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [focusToken]);

  return (
    <>
      <color attach="background" args={["#eef0f3"]} />
      <ambientLight intensity={1.05} />
      <directionalLight
        position={[2.4, 3.6, 1.6]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-0.9}
        shadow-camera-right={0.9}
        shadow-camera-top={0.9}
        shadow-camera-bottom={-0.9}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-2.2, 1.6, -2.4]} intensity={0.35} />

      {/* 极细无限网格地面 */}
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        infiniteGrid
        cellSize={0.1}
        sectionSize={0.5}
        sectionThickness={1}
        cellThickness={0.55}
        cellColor="#d8dce2"
        sectionColor="#c3cad4"
        fadeDistance={7}
        fadeStrength={1.1}
        followCamera={false}
      />

      {/* 阴影承接面（透明，网格下方） */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.004} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial transparent opacity={0.09} />
      </mesh>

      {/* 移动底盘（world 遥测位姿） + 机械臂双实例现实/目标 + 交互 Gizmo */}
      <MobileBase>
        <RobotView key={loads} model={model} sim={sim} assetBase={assetBase} />
        {interactionMode === "tcp" && (
          <RobotView
            key={`${loads}-ghost`}
            model={model}
            sim={sim}
            assetBase={assetBase}
            variant="ghost"
          />
        )}
        <InteractionGizmos model={model} sim={sim} />
        {interactionMode === "tcp" && <TcpGizmo model={model} sim={sim} />}
      </MobileBase>
      <axesHelper position={WORLD_AXES_POSITION} args={[0.16]} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enableRotate={interactionMode === "select"}
        enablePan={interactionMode === "select"}
        target={INITIAL_TARGET}
        minDistance={0.22}
        maxDistance={2.8}
        minPolarAngle={0.06}
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
    </>
  );
}

interface RobotStageProps {
  model: RobotModel;
  sim: SimulationLoop;
  assetBase: string;
}

/** 3D 画布容器（分帧不触发 React 重渲染，状态由 non-reactive JS 对象驱动） */
export default function RobotStage({ model, sim, assetBase }: RobotStageProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.88, 0.72, 0.95], fov: 42, near: 0.01, far: 60 }}
      gl={{ antialias: true }}
    >
      <StageContent model={model} sim={sim} assetBase={assetBase} />
    </Canvas>
  );
}