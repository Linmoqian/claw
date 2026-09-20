/**
 * BlockLab 运行时共享类型与设备网关契约。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */

export type Vec3 = { x: number; y: number; z: number };
export type QuaternionValue = { x: number; y: number; z: number; w: number };
export type RpyDeg = { roll: number; pitch: number; yaw: number };

/** 运行时姿态统一使用 SI（米、rad）；块内显示角度在边界转换。 */
export interface PoseValue {
  position: Vec3;
  quaternion: QuaternionValue;
  frame: string;
}

export interface ToolProfile {
  id: string;
  name: string;
  /** 相对 URDF 末端 link 的 TCP 偏移（米） */
  position: Vec3;
  /** 相对末端的固定姿态（rad） */
  rpy: Vec3;
  maxPayloadKg: number;
}

export interface Detection {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  area: number;
  confidence: number;
}

export type PinMode = "input" | "output" | "input_pullup";

export interface CalibrationSummary {
  jointOffsetsDeg: number[];
  reprojectionRmsPx: number;
  sampleCount: number;
}

export interface SerialConfig {
  port: string;
  baud: number;
}

export interface BlockDeviceGateway {
  readonly kind: "simulation" | "hardware";
  selectArm(robotId: string): Promise<void>;
  home(): Promise<void>;
  stop(): Promise<void>;
  setTool(toolId: string): Promise<void>;
  setSpeedDegPerSec(speedDegPerSec: number): Promise<void>;
  setJointAngleDeg(
    index: number,
    angleDeg: number,
    speedDegPerSec?: number,
  ): Promise<void>;
  setJointAnglesDeg(
    anglesDeg: number[],
    speedDegPerSec?: number,
  ): Promise<void>;
  setGripperOpenPercent(
    percent: number,
    speedDegPerSec?: number,
  ): Promise<void>;
  movePose(target: PoseValue, speedDegPerSec?: number): Promise<void>;
  setTorque(enabled: boolean): Promise<void>;
  readJointAnglesDeg(): Promise<number[]>;
  readRawPositions(): Promise<number[]>;
  readTcpPose(): Promise<PoseValue>;
  captureCameraFrame(): Promise<ImageBitmapSource | HTMLCanvasElement | null>;
  detectColor(label: string, minAreaPx?: number): Promise<Detection | null>;
  detectTargetPoseM(targetWidthM: number): Promise<PoseValue>;
  calibrateJoints(): Promise<CalibrationSummary>;
  calibrateEyeHand(): Promise<CalibrationSummary>;
  transformCameraPoseToBase(pose: PoseValue): Promise<PoseValue>;
  serialOpen(config: SerialConfig): Promise<void>;
  serialClose(): Promise<void>;
  serialSend(payload: string): Promise<void>;
  serialReadLine(timeoutMs?: number): Promise<string>;
  pinMode(pin: number, mode: PinMode): Promise<void>;
  digitalWrite(pin: number, value: 0 | 1): Promise<void>;
  digitalRead(pin: number): Promise<0 | 1>;
  analogWrite(pin: number, value: number): Promise<void>;
  analogRead(pin: number): Promise<number>;
}
