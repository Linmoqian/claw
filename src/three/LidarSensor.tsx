/**
 * Created on 2026-09-19
 * @author: https://github.com/Linmoqian
 *
 * MID-360S 激光雷达传感器：复用 STEP 转换后的 GLB 资产，供 Studio 与积木仿真共用。
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/** STEP 原始单位为 mm；导入 Three 后统一为 SI 米。 */
const MODEL_SCALE = 0.001;
/** STEP 模型为 Y-up；居中后 Y 半高即底盘安装面抬升量。 */
const MOUNT_HEIGHT = 0.03;
/** 扫描点云层数 / 每层点数：低模仿真下保持清晰但轻量。 */
const POINT_RINGS = 5;
const POINTS_PER_RING = 36;
const POINT_COUNT = POINT_RINGS * POINTS_PER_RING;

const SCAN_RING_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#67e8f9",
  transparent: true,
  opacity: 0.38,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const SWEEP_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#0891b2",
  transparent: true,
  opacity: 0.18,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const TRAIL_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#0e7490",
  transparent: true,
  opacity: 0.07,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const BEAM_WALL_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#0891b2",
  transparent: true,
  opacity: 0.085,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const POINT_MATERIAL = new THREE.PointsMaterial({
  color: "#06b6d4",
  size: 0.0052,
  transparent: true,
  opacity: 0.86,
  sizeAttenuation: true,
  depthWrite: false,
});

/** 生成 5 圈错相点云，模拟 MID-360 的多线扫描包络。 */
function createScanPointCloud() {
  const positions = new Float32Array(POINT_COUNT * 3);
  let index = 0;

  for (let ring = 0; ring < POINT_RINGS; ring += 1) {
    const radius = 0.072 + ring * 0.03;
    const height = 0.008 + ring * 0.015;
    const phase = (ring * Math.PI * 2) / POINT_RINGS;

    for (let point = 0; point < POINTS_PER_RING; point += 1) {
      const angle = phase + (point * Math.PI * 2) / POINTS_PER_RING;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
      index += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export interface LidarSensorProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  scanning?: boolean;
}

export default function LidarSensor({
  position = [0.14, 0, 0.072],
  rotation = [0, 0, 0],
  scale = 1,
  scanning = true,
}: LidarSensorProps) {
  const { scene } = useGLTF("/models/lidar/mid-360s.glb");
  const scanRingRef = useRef<THREE.Mesh>(null);
  const scanFieldRef = useRef<THREE.Group>(null);
  const sweepRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const wallRef = useRef<THREE.Mesh>(null);
  const pointCloudRef = useRef<THREE.Points>(null);
  const pointCloudGeometry = useMemo(() => createScanPointCloud(), []);

  const model = useMemo(() => {
    const cloned = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(cloned);
    const center = bounds.getCenter(new THREE.Vector3());
    cloned.position.sub(center);
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        material.color.set("#3f4751");
        material.roughness = 0.46;
        material.metalness = 0.24;
      });
    });
    return cloned;
  }, [scene]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const ring = scanRingRef.current;
    const field = scanFieldRef.current;
    const scanPhase = scanning ? 1 : 0.08;

    if (ring) {
      ring.rotation.z = time * 1.1;
      const material = ring.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = scanPhase * (0.28 + 0.14 * Math.sin(time * 5));
      }
    }

    if (field) {
      // 主波束连续旋转；点云错相分布，读起来更像 360° 非重复扫描。
      field.rotation.y = -time * 2.4;
      field.visible = scanPhase > 0.1;
      const sweep = sweepRef.current;
      const trail = trailRef.current;
      const wall = wallRef.current;
      const points = pointCloudRef.current;

      if (sweep?.material instanceof THREE.MeshBasicMaterial) {
        sweep.material.opacity = scanPhase * (0.14 + 0.06 * Math.sin(time * 9));
      }
      if (trail?.material instanceof THREE.MeshBasicMaterial) {
        trail.material.opacity = scanPhase * (0.055 + 0.025 * Math.sin(time * 9 + 0.8));
      }
      if (wall?.material instanceof THREE.MeshBasicMaterial) {
        wall.material.opacity = scanPhase * (0.07 + 0.03 * Math.sin(time * 8.2));
      }
      if (points?.material instanceof THREE.PointsMaterial) {
        points.material.opacity = scanPhase * (0.7 + 0.2 * Math.sin(time * 6.5));
        points.material.size = 0.0045 + 0.001 * Math.sin(time * 7);
      }
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position-y={MOUNT_HEIGHT}>
        {/* STEP 源模型已是 Y-up，不需要额外 Z-up 矫正。 */}
        <group scale={MODEL_SCALE}>
          <primitive object={model} />
        </group>
      </group>

      {/* 主扫描场：亮扇形表示当前波束，淡扇形形成余晖。 */}
      <group ref={scanFieldRef} position-y={MOUNT_HEIGHT + 0.008}>
        <mesh
          ref={wallRef}
          position-y={0.035}
          material={BEAM_WALL_MATERIAL}
        >
          <cylinderGeometry args={[0.225, 0.225, 0.065, 48, 1, true, -0.34, 0.72]} />
        </mesh>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <mesh ref={sweepRef} material={SWEEP_MATERIAL}>
            <circleGeometry args={[0.235, 48, -0.34, 0.72]} />
          </mesh>
          <mesh
            ref={trailRef}
            rotation-z={-0.9}
            material={TRAIL_MATERIAL}
          >
            <circleGeometry args={[0.255, 52, 0, 1.35]} />
          </mesh>
        </group>
        <points
          ref={pointCloudRef}
          geometry={pointCloudGeometry}
          material={POINT_MATERIAL}
        />
      </group>

      {/* 传感器安装圈：扫描停止时保留待机指示。 */}
      <mesh
        ref={scanRingRef}
        position-y={MOUNT_HEIGHT + 0.005}
        rotation={[-Math.PI / 2, 0, 0]}
        material={SCAN_RING_MATERIAL}
      >
        <torusGeometry args={[0.042, 0.0016, 8, 56]} />
      </mesh>
    </group>
  );
}

useGLTF.preload("/models/lidar/mid-360s.glb");
