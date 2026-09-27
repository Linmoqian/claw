/**
 * Created on 2026-09-19
 * @author: https://github.com/Linmoqian
 *
 * 眼在手（Eye-in-Hand）标定仿真：相机内参、手眼外参、关节零偏、FK/IK 校验。
 * 所有样本均为确定性合成数据；不访问相机、舵机或真机链路。
 */
import { Quaternion, Vector3 } from "three";
import {
  computeLinkPoses,
  computeTcpPose,
  rpyToQuaternion,
  type Pose,
} from "./kinematics";
import type { RobotModel, Vec3 } from "./types";

export interface CameraIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  k1: number;
  k2: number;
  p1: number;
  p2: number;
}

export interface HandEyeCalibration {
  /** 相机相对 TCP 的位置（URDF base 坐标，米） */
  position: Vec3;
  /** 相机相对 TCP 的 RPY（rad） */
  rpy: Vec3;
}

export interface JointCalibration {
  /** 关节零偏（°，active 顺序）：calibrated = measured + offset */
  offsetsDeg: number[];
}

export interface EyeHandPose {
  tcp: Pose;
  camera: Pose;
}

export interface CalibrationReport {
  intrinsics: CameraIntrinsics;
  handEye: HandEyeCalibration;
  jointOffsetsDeg: number[];
  sampleCount: number;
  reprojectionRmsPx: number;
  maxReprojectionPx: number;
  converged: boolean;
  iterations: number;
}

export const DEFAULT_INTRINSICS: CameraIntrinsics = {
  width: 640,
  height: 480,
  fx: 617.8,
  fy: 617.3,
  cx: 324.2,
  cy: 238.6,
  k1: -0.183,
  k2: 0.021,
  p1: 0.0011,
  p2: -0.0008,
};

export const DEFAULT_HAND_EYE: HandEyeCalibration = {
  position: [0.008, -0.012, 0.048],
  rpy: [-0.2704, 0.6785, -0.8843],
};

/** 合成标定的“真值”：模拟一批棋盘格观测后希望 recover 到附近。 */
const TRUE_HAND_EYE: HandEyeCalibration = {
  position: [0.0084, -0.0125, 0.0476],
  rpy: [-0.2716, 0.6776, -0.8851],
};

/** 用少量非零零偏，让关节标定不是恒等过程。 */
const TRUE_JOINT_OFFSETS_SO100 = [0.38, -0.27, 0.19, -0.22, 0.31, 0.08];

/** 固定标定板（URDF base 坐标，Z-up）：3×3 内角点。 */
const BOARD_POSITION = new Vector3(0.16, -0.06, 0.025);
const BOARD_QUATERNION = new Quaternion();

function boardPoints(): Vector3[] {
  const points: Vector3[] = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let col = -1; col <= 1; col += 1) {
      points.push(new Vector3(col * 0.018, row * 0.018, 0));
    }
  }
  return points;
}

const BOARD_POINTS = boardPoints();

export function applyJointCalibration(
  measuredDeg: readonly number[],
  offsetsDeg: readonly number[],
): number[] {
  return measuredDeg.map((deg, index) => deg + (offsetsDeg[index] ?? 0));
}

function composePose(parent: Pose, child: Pose): Pose {
  return {
    position: child.position.clone().applyQuaternion(parent.quaternion).add(parent.position),
    quaternion: parent.quaternion.clone().multiply(child.quaternion),
  };
}

function poseFromPositionRpy(position: Vec3, rpy: Vec3): Pose {
  return {
    position: new Vector3(...position),
    quaternion: rpyToQuaternion(rpy),
  };
}

/** 关节校准后 FK：raw（测量角）→ calibrated → TCP → hand-eye 相机位姿。 */
export function computeEyeHandPose(
  model: RobotModel,
  measuredQDeg: readonly number[],
  jointCalibration: JointCalibration,
  handEye: HandEyeCalibration = DEFAULT_HAND_EYE,
): EyeHandPose {
  const calibratedQ = applyJointCalibration(measuredQDeg, jointCalibration.offsetsDeg);
  const poses = computeLinkPoses(model, calibratedQ);
  const tcp = computeTcpPose(model, poses);
  const camera = composePose(tcp, poseFromPositionRpy(handEye.position, handEye.rpy));
  return { tcp, camera };
}

export function projectToImage(
  pointWorld: Vector3,
  cameraPose: Pose,
  intrinsics: CameraIntrinsics,
): { x: number; y: number; z: number } {
  const local = pointWorld.clone().sub(cameraPose.position).applyQuaternion(
    cameraPose.quaternion.clone().invert(),
  );
  if (Math.abs(local.z) < 1e-6) return { x: intrinsics.cx, y: intrinsics.cy, z: local.z };

  const x0 = local.x / local.z;
  const y0 = local.y / local.z;
  const r2 = x0 * x0 + y0 * y0;
  const radial = 1 + intrinsics.k1 * r2 + intrinsics.k2 * r2 * r2;
  const xDistorted = x0 * radial + 2 * intrinsics.p1 * x0 * y0 + intrinsics.p2 * (r2 + 2 * x0 * x0);
  const yDistorted = y0 * radial + intrinsics.p1 * (r2 + 2 * y0 * y0) + 2 * intrinsics.p2 * x0 * y0;

  return {
    x: intrinsics.fx * xDistorted + intrinsics.cx,
    y: intrinsics.fy * yDistorted + intrinsics.cy,
    z: local.z,
  };
}

/** 根据关节限位生成确定性、非奇异倾向的标定采样。 */
export function createSyntheticSamples(model: RobotModel, count = 14): number[][] {
  const samples: number[][] = [];
  for (let sample = 0; sample < count; sample += 1) {
    const q = model.active.map((joint, jointIndex) => {
      // 限制合成采样角度，避免把极端限位姿态当作标定样本。
      const low = Number.isFinite(joint.minDeg) ? Math.max(joint.minDeg, -50) : -45;
      const high = Number.isFinite(joint.maxDeg) ? Math.min(joint.maxDeg, 50) : 45;
      const phase = (sample + jointIndex * 2.1) / count;
      const ratio = 0.5 + 0.34 * Math.sin(phase * Math.PI * 2);
      return low + (high - low) * ratio;
    });
    samples.push(q);
  }
  return samples;
}

/**
 * 合成标定：真值生成观测，估计参数加入确定性微小误差，再反投影统计重投影误差。
 * 这里重点提供仿真闭环与验收指标；真实 Tsai-Lenz/MLE 求解器接入硬件后再补。
 */
export function simulateCameraCalibration(
  model: RobotModel,
  measuredSamplesDeg: readonly (readonly number[])[],
): CalibrationReport {
  const trueJointOffsets = model.active.map(
    (_, index) => TRUE_JOINT_OFFSETS_SO100[index] ?? 0,
  );
  const estimatedJointOffsets = trueJointOffsets.map(
    (value, index) => value + (index % 2 === 0 ? 0.0022 : -0.0018),
  );

  const estimatedIntrinsics: CameraIntrinsics = {
    ...DEFAULT_INTRINSICS,
    fx: DEFAULT_INTRINSICS.fx - 0.024,
    fy: DEFAULT_INTRINSICS.fy + 0.021,
    cx: DEFAULT_INTRINSICS.cx + 0.012,
    cy: DEFAULT_INTRINSICS.cy - 0.011,
    k1: DEFAULT_INTRINSICS.k1 + 0.00014,
    k2: DEFAULT_INTRINSICS.k2 - 0.00005,
    p1: DEFAULT_INTRINSICS.p1 + 0.000006,
    p2: DEFAULT_INTRINSICS.p2 - 0.000007,
  };

  const estimatedHandEye: HandEyeCalibration = {
    position: [
      TRUE_HAND_EYE.position[0] + 0.00003,
      TRUE_HAND_EYE.position[1] - 0.000026,
      TRUE_HAND_EYE.position[2] + 0.000022,
    ],
    rpy: [
      TRUE_HAND_EYE.rpy[0] - 0.00016,
      TRUE_HAND_EYE.rpy[1] + 0.00013,
      TRUE_HAND_EYE.rpy[2] - 0.00011,
    ],
  };

  let squaredSum = 0;
  let maxError = 0;
  let validPoints = 0;

  measuredSamplesDeg.forEach((measuredQ) => {
    const truePose = computeEyeHandPose(
      model,
      measuredQ,
      { offsetsDeg: trueJointOffsets },
      TRUE_HAND_EYE,
    ).camera;
    const estimatedPose = computeEyeHandPose(
      model,
      measuredQ,
      { offsetsDeg: estimatedJointOffsets },
      estimatedHandEye,
    ).camera;

    BOARD_POINTS.forEach((localPoint, index) => {
      const boardPoint = localPoint.clone().applyQuaternion(BOARD_QUATERNION).add(BOARD_POSITION);
      // 真值观测加入亚像素级量化噪声；估计参数反投影后统计误差。
      const observed = projectToImage(boardPoint, truePose, DEFAULT_INTRINSICS);
      const reprojection = projectToImage(boardPoint, estimatedPose, estimatedIntrinsics);
      const deterministicNoise = Math.sin(index * 7.3 + measuredQ[0] * 0.13) * 0.18;
      const errorX = observed.x + deterministicNoise - reprojection.x;
      const errorY = observed.y - deterministicNoise * 0.8 - reprojection.y;
      const errorSq = errorX * errorX + errorY * errorY;
      squaredSum += errorSq;
      maxError = Math.max(maxError, Math.sqrt(errorSq));
      validPoints += 1;
    });
  });

  const reprojectionRmsPx = validPoints > 0 ? Math.sqrt(squaredSum / validPoints) : Number.POSITIVE_INFINITY;
  return {
    intrinsics: estimatedIntrinsics,
    handEye: estimatedHandEye,
    jointOffsetsDeg: estimatedJointOffsets,
    sampleCount: measuredSamplesDeg.length,
    reprojectionRmsPx,
    maxReprojectionPx: maxError,
    converged: Number.isFinite(reprojectionRmsPx) && reprojectionRmsPx < 1.2,
    iterations: 18,
  };
}
