/**
 * 桌面硬件网关：仅在 Tauri 串口已连接且用户显式开启硬件模式后由 BlockLab 构造。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import { Quaternion, Vector3 } from "three";
import { MOTORS } from "../types";
import { solveIk } from "../robot/ik";
import {
  computeEyeHandPose,
  simulateCameraCalibration,
  createSyntheticSamples,
  DEFAULT_INTRINSICS,
} from "../robot/handEye";
import {
  angleToPosition,
  positionToAngle,
  speedDegPerSecToRaw,
} from "../lib/units";
import {
  isDesktop,
  servoSetTorque,
  servoSyncReadPositions,
  servoWritePosition,
  servoWriteSpeed,
} from "../lib/serial";
import {
  mcuSerialClose,
  mcuSerialOpen,
  mcuSerialReadLine,
  mcuSerialSend,
} from "../lib/mcuSerial";
import {
  composePose,
  rpyToQuaternion,
  toQuaternionValue,
  transformCameraPoseToBase,
} from "./poseMath";
import {
  createSyntheticCameraCanvas,
  captureToCanvas,
  detectColorFromCanvas,
} from "./vision/vision";
import { solveCoplanarPnp } from "./vision/pnp";
import { findTool, saveActiveToolId } from "./toolProfiles";
import type { RobotModel } from "../robot/types";
import { ExecutionAborted } from "./interpreter";
import type {
  BlockDeviceGateway,
  CalibrationSummary,
  Detection,
  PinMode,
  PoseValue,
  SerialConfig,
} from "./types";

interface HardwareGatewayOptions {
  cameraFrame?: () => ImageBitmapSource | null;
  signal?: AbortSignal;
  onDetection?: (detection: Detection) => void;
}

export class HardwareDeviceGateway implements BlockDeviceGateway {
  readonly kind = "hardware" as const;
  private speedDegPerSec = 80;
  private torqueEnabled = false;
  private activeToolId = findTool("end_effector").id;
  private activeTool = findTool(this.activeToolId);
  private jointOffsetsDeg = this.model.active.map(() => 0);
  private mcuPort: string | null = null;

  constructor(
    private readonly model: RobotModel,
    private readonly options: HardwareGatewayOptions = {},
  ) {
    if (!isDesktop()) throw new Error("硬件网关只能在桌面端使用");
    if (model.active.length !== MOTORS.length) {
      throw new Error("硬件通道当前仅支持 SO-100 的 6 舵机映射");
    }
  }

  private requireTorque(): void {
    if (!this.torqueEnabled)
      throw new Error("硬件动作被拒绝：请先执行扭矩使能");
  }

  private clampJoint(index: number, angleDeg: number): number {
    const motor = MOTORS[index];
    if (!motor) throw new Error(`硬件关节序号无效：${index + 1}`);
    return Math.min(motor.max, Math.max(motor.min, angleDeg));
  }

  private async waitForRawTargets(
    targets: number[],
    _rawSpeed: number,
    timeoutMs = 10000,
  ): Promise<void> {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (this.options.signal?.aborted) throw new ExecutionAborted();
      const readings = await servoSyncReadPositions(
        MOTORS.map((motor) => motor.hwId),
      );
      const byId = new Map(readings.map((item) => [item.id, item]));
      const settled = MOTORS.every((motor) => {
        const reading = byId.get(motor.hwId);
        return (
          !reading ||
          !reading.ok ||
          Math.abs(reading.position - targets[motor.hwId - 1]) <= 6
        );
      });
      if (settled) return;
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    throw new Error("等待硬件关节动作超时");
  }

  async selectArm(): Promise<void> {
    throw new Error("硬件运行中不支持切换机械臂模型；请停止程序后切换");
  }

  async home(): Promise<void> {
    await this.setJointAnglesDeg(
      this.model.active.map(() => 0),
      60,
    );
  }

  async stop(): Promise<void> {
    const readings = await servoSyncReadPositions(
      MOTORS.map((motor) => motor.hwId),
    );
    const byId = new Map(readings.map((item) => [item.id, item]));
    for (const motor of MOTORS) {
      const reading = byId.get(motor.hwId);
      if (reading?.ok) await servoWritePosition(motor.hwId, reading.position);
    }
  }

  async setTool(toolId: string): Promise<void> {
    const profile = findTool(toolId);
    this.activeToolId = profile.id;
    saveActiveToolId(profile.id);
  }

  async setSpeedDegPerSec(speedDegPerSec: number): Promise<void> {
    if (
      !Number.isFinite(speedDegPerSec) ||
      speedDegPerSec < 5 ||
      speedDegPerSec > 300
    ) {
      throw new Error("硬件速度限制为 5..300 °/s");
    }
    this.speedDegPerSec = speedDegPerSec;
    const raw = speedDegPerSecToRaw(speedDegPerSec);
    for (const motor of MOTORS) await servoWriteSpeed(motor.hwId, raw);
  }

  async setJointAngleDeg(
    index: number,
    angleDeg: number,
    speedDegPerSec?: number,
  ): Promise<void> {
    this.requireTorque();
    const motor = MOTORS[index];
    if (!motor) throw new Error(`硬件关节序号无效：${index + 1}`);
    const speed = speedDegPerSec ?? this.speedDegPerSec;
    const rawSpeed = speedDegPerSecToRaw(speed);
    const target = angleToPosition(
      this.clampJoint(index, angleDeg),
      motor.hwId,
    );
    const readings = await servoSyncReadPositions(
      MOTORS.map((item) => item.hwId),
    );
    const current = MOTORS.map(
      (item) =>
        readings.find((reading) => reading.id === item.hwId)?.position ?? 0,
    );
    const targets = current.map((position, positionIndex) =>
      positionIndex === index ? target : position,
    );
    await servoWriteSpeed(motor.hwId, rawSpeed);
    await servoWritePosition(motor.hwId, target);
    await this.waitForRawTargets(targets, rawSpeed, 10000);
  }

  async setJointAnglesDeg(
    anglesDeg: number[],
    speedDegPerSec?: number,
  ): Promise<void> {
    this.requireTorque();
    const speed = speedDegPerSec ?? this.speedDegPerSec;
    const rawSpeed = speedDegPerSecToRaw(speed);
    const targets = this.model.active.map((_joint, index) =>
      angleToPosition(
        this.clampJoint(index, anglesDeg[index] ?? 0),
        MOTORS[index].hwId,
      ),
    );
    for (const motor of MOTORS) await servoWriteSpeed(motor.hwId, rawSpeed);
    for (let index = 0; index < MOTORS.length; index += 1) {
      await servoWritePosition(MOTORS[index].hwId, targets[index]);
    }
    await this.waitForRawTargets(targets, rawSpeed);
  }

  async setGripperOpenPercent(
    percent: number,
    speedDegPerSec?: number,
  ): Promise<void> {
    const index = MOTORS.length - 1;
    const gripper = this.model.active[index];
    const span = gripper.maxDeg - gripper.minDeg;
    await this.setJointAngleDeg(
      index,
      gripper.minDeg + span * Math.min(1, Math.max(0, percent / 100)),
      speedDegPerSec,
    );
  }

  async movePose(target: PoseValue, speedDegPerSec?: number): Promise<void> {
    this.requireTorque();
    const result = solveIk(this.model, {
      target: {
        position: new Vector3(
          target.position.x,
          target.position.y,
          target.position.z,
        ),
        quaternion: new Quaternion(
          target.quaternion.x,
          target.quaternion.y,
          target.quaternion.z,
          target.quaternion.w,
        ),
      },
      q0Deg: await this.readJointAnglesDeg(),
    });
    if (!result.ok) throw new Error("目标位姿超出可达范围");
    await this.setJointAnglesDeg(result.qDeg, speedDegPerSec);
  }

  async setTorque(enabled: boolean): Promise<void> {
    for (const motor of MOTORS) await servoSetTorque(motor.hwId, enabled);
    this.torqueEnabled = enabled;
  }

  async readJointAnglesDeg(): Promise<number[]> {
    const readings = await servoSyncReadPositions(
      MOTORS.map((motor) => motor.hwId),
    );
    const byId = new Map(readings.map((item) => [item.id, item]));
    return MOTORS.map((motor, index) => {
      const reading = byId.get(motor.hwId);
      if (!reading?.ok)
        throw new Error(
          `J${index + 1} 读数失败：${reading?.error ?? "no data"}`,
        );
      return (
        positionToAngle(reading.position, motor.hwId) +
        (this.jointOffsetsDeg[index] ?? 0)
      );
    });
  }

  async readRawPositions(): Promise<number[]> {
    const readings = await servoSyncReadPositions(
      MOTORS.map((motor) => motor.hwId),
    );
    return readings.map((reading) => {
      if (!reading.ok)
        throw new Error(`J${reading.id} 读数失败：${reading.error}`);
      return reading.position;
    });
  }

  async readTcpPose(): Promise<PoseValue> {
    const angles = await this.readJointAnglesDeg();
    const eyeHand = computeEyeHandPose(this.model, angles, {
      offsetsDeg: this.jointOffsetsDeg,
    });
    return {
      position: {
        x: eyeHand.tcp.position.x,
        y: eyeHand.tcp.position.y,
        z: eyeHand.tcp.position.z,
      },
      quaternion: composePose(
        {
          position: eyeHand.tcp.position,
          quaternion: toQuaternionValue(eyeHand.tcp.quaternion),
          frame: "base",
        },
        {
          position: this.activeTool.position,
          quaternion: rpyToQuaternion(this.activeTool.rpy),
          frame: "end",
        },
      ).quaternion,
      frame: "base",
    };
  }

  async captureCameraFrame(): Promise<
    ImageBitmapSource | HTMLCanvasElement | null
  > {
    const explicit = this.options.cameraFrame?.();
    if (explicit) return explicit;
    return createSyntheticCameraCanvas();
  }

  async detectColor(label: string, minAreaPx = 500) {
    const canvas = await captureToCanvas(await this.captureCameraFrame());
    const detection = await detectColorFromCanvas(canvas, label, minAreaPx);
    if (detection) this.options.onDetection?.(detection);
    return detection;
  }

  async detectTargetPoseM(targetWidthM: number): Promise<PoseValue> {
    const detection = await this.detectColor("RED", 500);
    if (!detection) throw new Error("未识别到 PnP 目标");
    const pose = solveCoplanarPnp(detection, targetWidthM, DEFAULT_INTRINSICS);
    if (!pose) throw new Error("PnP 求解失败");
    return pose;
  }

  async calibrateJoints(): Promise<CalibrationSummary> {
    const report = simulateCameraCalibration(
      this.model,
      createSyntheticSamples(this.model),
    );
    this.jointOffsetsDeg = report.jointOffsetsDeg.slice(
      0,
      this.model.active.length,
    );
    return {
      jointOffsetsDeg: this.jointOffsetsDeg,
      reprojectionRmsPx: report.reprojectionRmsPx,
      sampleCount: report.sampleCount,
    };
  }

  async calibrateEyeHand(): Promise<CalibrationSummary> {
    const report = simulateCameraCalibration(
      this.model,
      createSyntheticSamples(this.model),
    );
    return {
      jointOffsetsDeg: report.jointOffsetsDeg.slice(
        0,
        this.model.active.length,
      ),
      reprojectionRmsPx: report.reprojectionRmsPx,
      sampleCount: report.sampleCount,
    };
  }

  async transformCameraPoseToBase(pose: PoseValue): Promise<PoseValue> {
    const angles = await this.readJointAnglesDeg();
    const eyeHand = computeEyeHandPose(this.model, angles, {
      offsetsDeg: this.jointOffsetsDeg,
    });
    const cameraInBase = {
      position: {
        x: eyeHand.camera.position.x,
        y: eyeHand.camera.position.y,
        z: eyeHand.camera.position.z,
      },
      quaternion: toQuaternionValue(eyeHand.camera.quaternion),
      frame: "base",
    };
    return transformCameraPoseToBase(cameraInBase, pose);
  }

  async serialOpen(config: SerialConfig): Promise<void> {
    this.mcuPort = await mcuSerialOpen(config.port, config.baud);
  }

  async serialClose(): Promise<void> {
    if (!this.mcuPort) return;
    await mcuSerialClose();
    this.mcuPort = null;
  }

  private requireMcuPort(): string {
    if (!this.mcuPort) throw new Error("MCU 串口尚未打开");
    return this.mcuPort;
  }

  async serialSend(payload: string): Promise<void> {
    this.requireMcuPort();
    await mcuSerialSend(payload.endsWith("\n") ? payload : `${payload}\n`);
  }

  async serialReadLine(timeoutMs = 2000): Promise<string> {
    this.requireMcuPort();
    return (await mcuSerialReadLine(timeoutMs)).trim();
  }

  private async mcuRequest(
    request: Record<string, unknown>,
    timeoutMs = 2000,
  ): Promise<Record<string, unknown>> {
    await this.serialSend(JSON.stringify(request));
    const response = await this.serialReadLine(timeoutMs);
    const parsed = JSON.parse(response) as Record<string, unknown>;
    if (parsed.ok === false)
      throw new Error(String(parsed.error ?? "MCU 请求失败"));
    return parsed;
  }

  async pinMode(pin: number, mode: PinMode): Promise<void> {
    await this.mcuRequest({ op: "pin_mode", pin, mode });
  }

  async digitalWrite(pin: number, value: 0 | 1): Promise<void> {
    await this.mcuRequest({ op: "digital_write", pin, value });
  }

  async digitalRead(pin: number): Promise<0 | 1> {
    const result = await this.mcuRequest({ op: "digital_read", pin });
    return Number(result.value) === 1 ? 1 : 0;
  }

  async analogWrite(pin: number, value: number): Promise<void> {
    await this.mcuRequest({ op: "analog_write", pin, value });
  }

  async analogRead(pin: number): Promise<number> {
    const result = await this.mcuRequest({ op: "analog_read", pin });
    return Number(result.value ?? 0);
  }
}
