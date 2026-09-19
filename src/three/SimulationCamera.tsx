/**
 * Created on 2026-09-17
 * @author: https://github.com/Linmoqian
 */
import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { computeLinkPoses, computeTcpPose } from "../robot/kinematics";
import type { SimulationLoop } from "../robot/simulation";
import { useWorldStore } from "../stores/worldStore";
import { DECK_HEIGHT, ROOT_UP_ROTATION, worldYawOf } from "./MobileBase";

const CAMERA_POSITION = new THREE.Vector3(0.54, 0.42, 0.42);
const CAMERA_TARGET = new THREE.Vector3(0, 0.16, 0);

/** 仿真摄像头可拖拽范围：覆盖台面附近，同时避免被拖到无效远景。 */
/** 眼在手安装外参：相机位于 TCP 上方并向前下观察（Three Y-up 坐标）。 */
const EYE_MOUNT_OFFSET = new THREE.Vector3(0.018, 0.028, 0.004);
/** 相机光轴固定看向 TCP 前下方；该偏移仍随 TCP 姿态一起旋转。 */
const EYE_LOOK_OFFSET = new THREE.Vector3(0.115, -0.075, -0.018);
const ROOT_UP_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(...ROOT_UP_ROTATION),
);
const BASE_UP_AXIS = new THREE.Vector3(0, 1, 0);

/** useFrame 内复用临时对象，避免逐帧分配。 */
const eyeTransforms = {
  positionA: new THREE.Vector3(),
  positionB: new THREE.Vector3(),
  positionC: new THREE.Vector3(),
  positionD: new THREE.Vector3(),
  quaternionA: new THREE.Quaternion(),
  quaternionB: new THREE.Quaternion(),
  quaternionC: new THREE.Quaternion(),
  lookMatrix: new THREE.Matrix4(),
  lookTarget: new THREE.Vector3(),
};

const CAMERA_BOUNDS = {
  minX: -1.15,
  maxX: 1.15,
  minY: 0.08,
  maxY: 1.25,
  minZ: -1.15,
  maxZ: 1.15,
};

const clampVectorToCameraBounds = (value: THREE.Vector3) => {
  value.x = THREE.MathUtils.clamp(value.x, CAMERA_BOUNDS.minX, CAMERA_BOUNDS.maxX);
  value.y = THREE.MathUtils.clamp(value.y, CAMERA_BOUNDS.minY, CAMERA_BOUNDS.maxY);
  value.z = THREE.MathUtils.clamp(value.z, CAMERA_BOUNDS.minZ, CAMERA_BOUNDS.maxZ);
};

interface CameraModelProps {
  poseRef: { current: { position: THREE.Vector3; quaternion: THREE.Quaternion } };
  movable: boolean;
  modelScale: number;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function CameraModel({
  poseRef,
  movable,
  modelScale,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: CameraModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(poseRef.current.position);
    group.quaternion.copy(poseRef.current.quaternion);
  });

  return (
    <group
      ref={groupRef}
      name="__simulation_camera_model"
      scale={modelScale}
      onPointerDown={movable ? onPointerDown : undefined}
      onPointerEnter={movable ? onPointerEnter : undefined}
      onPointerLeave={movable ? onPointerLeave : undefined}
    >
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.075, 0.082]} />
        <meshStandardMaterial color="#1f2937" roughness={0.38} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, -0.043]}>
        <boxGeometry args={[0.093, 0.052, 0.008]} />
        <meshStandardMaterial color="#64748b" roughness={0.3} metalness={0.26} />
      </mesh>
      <mesh castShadow position={[0, 0, -0.058]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.027, 0.027, 0.014, 24]} />
        <meshStandardMaterial color="#0f172a" roughness={0.16} metalness={0.42} />
      </mesh>
      <mesh position={[0, 0, -0.067]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.006, 20]} />
        <meshStandardMaterial color="#93c5fd" roughness={0.08} metalness={0.1} />
      </mesh>
      <mesh position={[0.041, 0.021, -0.045]}>
        <sphereGeometry args={[0.006, 12, 8]} />
        <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={1.6} />
      </mesh>
      <mesh castShadow position={[0, -0.062, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.095, 16]} />
        <meshStandardMaterial color="#64748b" roughness={0.46} metalness={0.28} />
      </mesh>
      <mesh castShadow position={[0, -0.112, 0]}>
        <boxGeometry args={[0.09, 0.018, 0.07]} />
        <meshStandardMaterial color="#1f2937" roughness={0.42} metalness={0.18} />
      </mesh>
    </group>
  );
}

interface CameraDragState {
  pointerId: number;
  plane: THREE.Plane;
  offset: THREE.Vector3;
}

/**
 * Renders the movable simulation camera and a second view into the existing
 * WebGL canvas. The scene and physics objects are shared with the main view.
 */
export interface SimulationCameraProps {
  feedRef?: RefObject<HTMLDivElement | null>;
  sim?: SimulationLoop | null;
  eyeInHand?: boolean;
}

export function SimulationCamera({
  feedRef,
  sim,
  eyeInHand = false,
}: SimulationCameraProps) {
  const { gl, scene, raycaster, camera: mainCamera } = useThree();
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  const feedCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraPositionRef = useRef(CAMERA_POSITION.clone());
  const cameraQuaternionRef = useRef(new THREE.Quaternion());
  const cameraPoseRef = useRef({
    position: cameraPositionRef.current,
    quaternion: cameraQuaternionRef.current,
  });
  const dragStateRef = useRef<CameraDragState | null>(null);
  const pointerNdcRef = useRef(new THREE.Vector2());
  const workPointRef = useRef(new THREE.Vector3());

  const setCanvasCursor = (cursor: string) => {
    const renderer = rendererRef.current;
    if (renderer) renderer.domElement.style.cursor = cursor;
  };

  /** 在主相机视平面拖拽：位移方向与屏幕拖动方向一致，取景更直观。 */
  const beginCameraDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (eyeInHand || dragStateRef.current) return;

    const startPosition = cameraPositionRef.current.clone();
    const planeNormal = mainCamera.getWorldDirection(workPointRef.current).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, startPosition);
    const hitPoint = event.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hitPoint) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      plane,
      offset: startPosition.sub(hitPoint),
    };
    if (controlsRef.current) controlsRef.current.enabled = false;
    setCanvasCursor("grabbing");

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const canvasRect = gl.domElement.getBoundingClientRect();
      pointerNdcRef.current.set(
        ((moveEvent.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
        -((moveEvent.clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointerNdcRef.current, mainCamera);
      const nextPoint = raycaster.ray.intersectPlane(drag.plane, workPointRef.current);
      if (!nextPoint) return;
      nextPoint.add(drag.offset);
      clampVectorToCameraBounds(nextPoint);
      cameraPositionRef.current.copy(nextPoint);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (!dragStateRef.current || upEvent.pointerId !== dragStateRef.current.pointerId) return;
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (controlsRef.current) controlsRef.current.enabled = true;
      setCanvasCursor("");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const enterCameraHover = () => {
    if (!eyeInHand && !dragStateRef.current) setCanvasCursor("grab");
  };

  const leaveCameraHover = () => {
    if (!eyeInHand && !dragStateRef.current) setCanvasCursor("");
  };

  useEffect(() => {
    const orientation = new THREE.Matrix4().lookAt(
      CAMERA_POSITION,
      CAMERA_TARGET,
      BASE_UP_AXIS,
    );
    cameraQuaternionRef.current.setFromRotationMatrix(orientation);
    cameraPoseRef.current = {
      position: cameraPositionRef.current,
      quaternion: cameraQuaternionRef.current,
    };
  }, []);

  useEffect(() => {
    rendererRef.current = gl;
    controlsRef.current = controls;
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 20);
    camera.position.copy(cameraPositionRef.current);
    camera.quaternion.copy(cameraQuaternionRef.current);
    camera.updateProjectionMatrix();
    feedCameraRef.current = camera;

    return () => {
      camera.removeFromParent();
      feedCameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
  }, [gl, controls]);

  useFrame(() => {
    const renderer = rendererRef.current;
    const feedCamera = feedCameraRef.current;
    if (!renderer || !feedCamera) return;

    if (sim && eyeInHand) {
      const poses = computeLinkPoses(sim.model, [...sim.currentDegrees]);
      const tcp = computeTcpPose(sim.model, poses);
      const robot = useWorldStore.getState().world.robot;
      const pose = robot?.pose.position;
      const yaw = robot ? -worldYawOf(robot.pose.orientation) : 0;
      const basePosition = eyeTransforms.positionA.set(pose?.x ?? 0, 0, -(pose?.y ?? 0));
      const baseQuaternion = eyeTransforms.quaternionA.setFromAxisAngle(BASE_UP_AXIS, yaw);
      const rootTcp = eyeTransforms.positionB.set(
        tcp.position.x,
        tcp.position.z + DECK_HEIGHT,
        -tcp.position.y,
      ).applyQuaternion(baseQuaternion);
      const tcpWorld = eyeTransforms.positionC.copy(basePosition).add(rootTcp);
      const tcpWorldQuaternion = eyeTransforms.quaternionB
        .copy(baseQuaternion)
        .multiply(ROOT_UP_QUATERNION)
        .multiply(tcp.quaternion);
      const eyePosition = eyeTransforms.positionD
        .copy(EYE_MOUNT_OFFSET)
        .applyQuaternion(tcpWorldQuaternion)
        .add(tcpWorld);
      const eyeTarget = eyeTransforms.lookTarget
        .copy(EYE_LOOK_OFFSET)
        .applyQuaternion(tcpWorldQuaternion)
        .add(tcpWorld);
      const eyeLookMatrix = eyeTransforms.lookMatrix.lookAt(
        eyePosition,
        eyeTarget,
        BASE_UP_AXIS,
      );
      const eyeQuaternion = eyeTransforms.quaternionC.setFromRotationMatrix(eyeLookMatrix);

      cameraPositionRef.current.copy(eyePosition);
      cameraQuaternionRef.current.copy(eyeQuaternion);
    }

    feedCamera.position.copy(cameraPositionRef.current);
    feedCamera.quaternion.copy(cameraQuaternionRef.current);

    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const canvasWidth = Math.max(1, canvas.width);
    const canvasHeight = Math.max(1, canvas.height);
    const cssWidth = Math.max(1, canvasRect.width);
    const cssHeight = Math.max(1, canvasRect.height);
    const scaleX = canvasWidth / cssWidth;
    const scaleY = canvasHeight / cssHeight;
    const previousAutoClear = renderer.autoClear;
    const previousScissorTest = renderer.getScissorTest();
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());

    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvasWidth, canvasHeight);
    renderer.clear(true, true, true);
    renderer.render(scene, mainCamera);

    const feedElement = feedRef?.current ?? document.querySelector<HTMLDivElement>(".studio__camera-feed");
    const feedRect = feedElement?.getBoundingClientRect();
    if (feedRect && feedRect.width > 0 && feedRect.height > 0) {
      const feedWidth = Math.max(1, Math.floor(feedRect.width * scaleX));
      const feedHeight = Math.max(1, Math.floor(feedRect.height * scaleY));
      const rawLeft = Math.floor((feedRect.left - canvasRect.left) * scaleX);
      const rawBottom = Math.floor((canvasRect.bottom - feedRect.bottom) * scaleY);
      const left = Math.max(0, Math.min(canvasWidth - 1, rawLeft));
      const bottom = Math.max(0, Math.min(canvasHeight - 1, rawBottom));
      const visibleWidth = Math.min(feedWidth, canvasWidth - left);
      const visibleHeight = Math.min(feedHeight, canvasHeight - bottom);

      if (visibleWidth > 0 && visibleHeight > 0) {
        feedCamera.aspect = visibleWidth / visibleHeight;
        feedCamera.updateProjectionMatrix();
        renderer.setScissorTest(true);
        renderer.setViewport(left, bottom, visibleWidth, visibleHeight);
        renderer.setScissor(left, bottom, visibleWidth, visibleHeight);
        renderer.clear(true, true, true);

        // 相机模型挂在同一场景中；眼在手第二视口不能拍到自身外壳。
        const cameraModel = scene.getObjectByName("__simulation_camera_model");
        const cameraModelVisible = cameraModel?.visible ?? false;
        if (cameraModel) cameraModel.visible = false;
        renderer.render(scene, feedCamera);
        if (cameraModel) cameraModel.visible = cameraModelVisible;
      }
    }

    renderer.setScissorTest(previousScissorTest);
    renderer.setScissor(previousScissor.x, previousScissor.y, previousScissor.z, previousScissor.w);
    renderer.setViewport(previousViewport.x, previousViewport.y, previousViewport.z, previousViewport.w);
    renderer.autoClear = previousAutoClear;
  }, 1);

  return (
    <CameraModel
      poseRef={cameraPoseRef}
      movable={!eyeInHand}
      modelScale={eyeInHand ? 0.34 : 0.48}
      onPointerDown={beginCameraDrag}
      onPointerEnter={enterCameraHover}
      onPointerLeave={leaveCameraHover}
    />
  );
}
