/**
 * 仿真网关：BlockLab 所有设备类积木在浏览器/仿真通道中的真实执行实现。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import { Quaternion, Vector3 } from "three";
import { SimulationLoop } from "../robot/simulation";
import { computeLinkPoses, computeTcpPose } from "../robot/kinematics";
import { solveIk } from "../robot/ik";
import {
  computeEyeHandPose,
  createSyntheticSamples,
  DEFAULT_INTRINSICS,
  simulateCameraCalibration,
  type CalibrationReport,
} from "../robot/handEye";
import type { RobotModel } from "../robot/types";
import {
  composePose,
  rpyDegToQuaternion,
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
import type {
  BlockDeviceGateway,
  CalibrationSummary,
  Detection,
  PoseValue,
} from "./types";

type RuntimeGetter = () => { sim: SimulationLoop } | null;

interface SimulationGatewayOptions {
  getRuntime: RuntimeGetter;
  getModel: () => RobotModel | null;
  selectArm: (robotId: string) => Promise<void>;
  onDetection?: (detection: Detection) => void;
}

export class SimulationDeviceGateway implements BlockDeviceGateway {
  readonly kind = "simulation" as const;
  private speedDegPerSec = 80;
  private activeToolId = findTool("end_effector").id;
  private jointOffsetsDeg: number[] = [];
  private calibration: CalibrationReport | null = null;

  constructor(private readonly options: SimulationGatewayOptions) {}

  private requireRuntime(): { sim: SimulationLoop } {
    const runtime = this.options.getRuntime();
    if (!runtime) throw new Error("仿真运行时尚未就绪");
    return runtime;
  }

  private requireModel(): RobotModel {
    const model = this.options.getModel();
    if (!model) throw new Error("机械臂模型尚未就绪");
    return model;
  }

  private tool() {
    return findTool(this.activeToolId);
  }

  private waitForJointTargets(timeoutMs = 8000): Promise<void> {
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const runtime = this.options.getRuntime();
        if (!runtime) {
          reject(new Error("仿真运行时已断开"));
          return;
        }
        const snapshot = runtime.sim.getSnapshot();
        const done = snapshot.targetDeg.every(
          (target, index) =>
            Math.abs(target - (snapshot.currentDeg[index] ?? 0)) < 1.2,
        );
        if (done) {
          resolve();
          return;
        }
        if (performance.now() - started > timeoutMs) {
          reject(new Error("等待关节动作超时"));
          return;
        }
        window.setTimeout(check, 32);
      };
      check();
    });
  }

  async selectArm(robotId: string): Promise<void> {
    await this.options.selectArm(robotId);
  }

  async home(): Promise<void> {
    const sim = this.requireRuntime().sim;
    sim.stop();
    sim.goHome();
    await this.waitForJointTargets(12000);
  }

  async stop(): Promise<void> {
    this.requireRuntime().sim.stop();
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
      throw new Error("速度必须在 5..300 °/s");
    }
    this.speedDegPerSec = speedDegPerSec;
  }

  private applySpeed(speedDegPerSec?: number): number {
    const speed = speedDegPerSec ?? this.speedDegPerSec;
    if (!Number.isFinite(speed) || speed < 5 || speed > 300)
      throw new Error("速度必须在 5..300 °/s");
    // SimulationLoop.speed 是时间倍率；300°/s 是其手动模式内部速率。
    this.requireRuntime().sim.speed = speed / 300;
    return speed;
  }

  async setJointAngleDeg(
    index: number,
    angleDeg: number,
    speedDegPerSec?: number,
  ): Promise<void> {
    this.applySpeed(speedDegPerSec);
    const model = this.requireModel();
    if (index < 0 || index >= model.active.length)
      throw new Error(`关节序号无效：J${index + 1}`);
    const snapshot = this.requireRuntime().sim.getSnapshot();
    const targets = [...snapshot.targetDeg];
    targets[index] = angleDeg;
    this.requireRuntime().sim.setJointTargets(targets);
    await this.waitForJointTargets();
  }

  async setJointAnglesDeg(
    anglesDeg: number[],
    speedDegPerSec?: number,
  ): Promise<void> {
    this.applySpeed(speedDegPerSec);
    const model = this.requireModel();
    const targets = model.active.map((_joint, index) => anglesDeg[index] ?? 0);
    this.requireRuntime().sim.setJointTargets(targets);
    await this.waitForJointTargets();
  }

  async setGripperOpenPercent(
    percent: number,
    speedDegPerSec?: number,
  ): Promise<void> {
    const model = this.requireModel();
    const gripper = model.active[model.active.length - 1];
    const span = gripper.maxDeg - gripper.minDeg;
    await this.setJointAngleDeg(
      model.active.length - 1,
      gripper.minDeg + span * Math.min(1, Math.max(0, percent / 100)),
      speedDegPerSec,
    );
  }

  async movePose(target: PoseValue, speedDegPerSec?: number): Promise<void> {
    this.applySpeed(speedDegPerSec);
    const model = this.requireModel();
    const snapshot = this.requireRuntime().sim.getSnapshot();
    const result = solveIk(model, {
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
      q0Deg: snapshot.currentDeg,
    });
    if (!result.ok)
      throw new Error(`IK 无解：残差 ${result.residualPos.toFixed(3)} m`);
    const rejected = this.requireRuntime().sim.setJointTargets(result.qDeg);
    if (rejected) throw new Error("目标位姿触发碰撞保护");
    await this.waitForJointTargets();
  }

  async setTorque(enabled: boolean): Promise<void> {
    // 仿真通道的扭矩只改变状态语义；真正的使能由硬件网关下发。
    if (!enabled) this.requireRuntime().sim.stop();
  }

  async readJointAnglesDeg(): Promise<number[]> {
    const snapshot = this.requireRuntime().sim.getSnapshot();
    return snapshot.currentDeg.map(
      (angle, index) => angle + (this.jointOffsetsDeg[index] ?? 0),
    );
  }

  async readRawPositions(): Promise<number[]> {
    const angles = await this.readJointAnglesDeg();
    return angles.map((angle) => Math.round((angle / 270) * 4095) + 2048);
  }

  async readTcpPose(): Promise<PoseValue> {
    const model = this.requireModel();
    const angles = await this.readJointAnglesDeg();
    const poses = computeLinkPoses(model, angles);
    const tool = this.tool();
    const toolPose = {
      position: { x: tool.position.x, y: tool.position.y, z: tool.position.z },
      quaternion: rpyDegToQuaternion({
        roll: tool.rpy.x,
        pitch: tool.rpy.y,
        yaw: tool.rpy.z,
      }),
      frame: "end",
    };
    const tcp = composePose(
      { ...computeTcpPose(model, poses), frame: "base" },
      toolPose,
    );
    return {
      position: tcp.position,
      quaternion: tcp.quaternion,
      frame: "base",
    };
  }

  async captureCameraFrame(): Promise<HTMLCanvasElement | null> {
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
    if (!detection) throw new Error("未识别到可做 PnP 的目标");
    const target = solveCoplanarPnp(
      detection,
      targetWidthM,
      DEFAULT_INTRINSICS,
    );
    if (!target) throw new Error("PnP 求解失败");
    return target;
  }

  async calibrateJoints(): Promise<CalibrationSummary> {
    const report = simulateCameraCalibration(
      this.requireModel(),
      createSyntheticSamples(this.requireModel()),
    );
    this.calibration = report;
    this.jointOffsetsDeg = report.jointOffsetsDeg.slice(
      0,
      this.requireModel().active.length,
    );
    return this.toSummary(report);
  }

  async calibrateEyeHand(): Promise<CalibrationSummary> {
    const report = simulateCameraCalibration(
      this.requireModel(),
      createSyntheticSamples(this.requireModel()),
    );
    this.calibration = report;
    return this.toSummary(report);
  }

  private toSummary(report: CalibrationReport): CalibrationSummary {
    return {
      jointOffsetsDeg: report.jointOffsetsDeg,
      reprojectionRmsPx: report.reprojectionRmsPx,
      sampleCount: report.sampleCount,
    };
  }

  async transformCameraPoseToBase(pose: PoseValue): Promise<PoseValue> {
    const model = this.requireModel();
    const angles = await this.readJointAnglesDeg();
    const eyeHand = computeEyeHandPose(
      model,
      angles,
      {
        offsetsDeg: this.jointOffsetsDeg,
      },
      this.calibration?.handEye,
    );
    const cameraInBase = {
      position: {
        x: eyeHand.camera.position.x,
        y: eyeHand.camera.position.y,
        z: eyeHand.camera.position.z,
      },
      quaternion: toQuaternionValue(eyeHand.camera.quaternion),
      frame: "base",
    };
    return transformPose(cameraInBase, pose);
  }

  async serialOpen(): Promise<void> {
    throw new Error("当前工作台已停用串口积木；请移除旧程序中的串口指令");
  }

  async serialClose(): Promise<void> {}
  async serialSend(): Promise<void> {
    throw new Error("仿真模式不支持串口发送");
  }
  async serialReadLine(): Promise<string> {
    throw new Error("仿真模式不支持串口读取");
  }
  async pinMode(): Promise<void> {
    throw new Error("当前工作台已停用引脚积木；请移除旧程序中的引脚指令");
  }
  async digitalWrite(): Promise<void> {
    throw new Error("仿真模式不支持数字输出");
  }
  async digitalRead(): Promise<0 | 1> {
    throw new Error("仿真模式不支持数字输入");
  }
  async analogWrite(): Promise<void> {
    throw new Error("仿真模式不支持 PWM 输出");
  }
  async analogRead(): Promise<number> {
    throw new Error("仿真模式不支持模拟输入");
  }
}

// 避免与 poseMath 的纯函数重名冲突。
function transformPose(
  cameraInBase: PoseValue,
  targetInCamera: PoseValue,
): PoseValue {
  return transformCameraPoseToBase(cameraInBase, targetInCamera);
}
