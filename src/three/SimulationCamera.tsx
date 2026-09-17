/**
 * Created on 2026-09-17
 * @author: https://github.com/Linmoqian
 */
import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const CAMERA_POSITION = new THREE.Vector3(0.54, 0.42, 0.42);
const CAMERA_TARGET = new THREE.Vector3(0, 0.16, 0);
const CAMERA_VIEW_POSITION = CAMERA_POSITION.clone().lerp(CAMERA_TARGET, 0.12);

function CameraModel() {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    groupRef.current?.lookAt(CAMERA_TARGET);
  }, []);

  return (
    <group ref={groupRef} position={[0.54, 0.42, 0.42]}>
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

export interface SimulationCameraProps {
  feedRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Renders the fixed simulation camera and a second view into the existing
 * WebGL canvas. The scene and physics objects are shared with the main view.
 */
export function SimulationCamera({ feedRef }: SimulationCameraProps) {
  const { gl, scene, camera: mainCamera } = useThree();
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const feedCameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    rendererRef.current = gl;
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 20);
    camera.position.copy(CAMERA_VIEW_POSITION);
    camera.lookAt(CAMERA_TARGET);
    camera.updateProjectionMatrix();
    feedCameraRef.current = camera;

    return () => {
      camera.removeFromParent();
      feedCameraRef.current = null;
      rendererRef.current = null;
    };
  }, [gl]);

  useFrame(() => {
    const renderer = rendererRef.current;
    const feedCamera = feedCameraRef.current;
    if (!renderer || !feedCamera) return;

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
        renderer.render(scene, feedCamera);
      }
    }

    renderer.setScissorTest(previousScissorTest);
    renderer.setScissor(previousScissor.x, previousScissor.y, previousScissor.z, previousScissor.w);
    renderer.setViewport(previousViewport.x, previousViewport.y, previousViewport.z, previousViewport.w);
    renderer.autoClear = previousAutoClear;
  }, 1);

  return <CameraModel />;
}
