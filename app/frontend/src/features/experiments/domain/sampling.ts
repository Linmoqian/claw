/** 将当前仿真快照转为 SI 实验帧，不推进或生成运动。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import { degreesToRadians, radiansToDegrees } from "../../../robot/model";
import type { BaseSim } from "../../../robot/baseSim";
import type { SimulationLoop } from "../../../robot/simulation";
import type { RobotModel } from "../../../robot/types";
import type { RecFrame } from "../../../services/protocol/recording";
import type { ExperimentSample } from "./types";
import type { SimulationFrame } from "../../workbench/runtime/desktopRuntime";

export function sampleRuntime(
  runtime: { model: RobotModel; sim: SimulationLoop; baseSim: BaseSim },
  t: number,
  timestampMs: number,
): ExperimentSample {
  const state = runtime.sim.getSnapshot();
  const base = runtime.baseSim.getSnapshot().current;
  return {
    t,
    timestampMs,
    joints: Object.fromEntries(
      runtime.model.active.map((joint, index) => [
        joint.def.name,
        degreesToRadians(state.currentDeg[index]),
      ]),
    ),
    base: { ...base, z: 0 },
    tcpPositionM: [
      state.tcp.position.x,
      state.tcp.position.y,
      state.tcp.position.z,
    ],
  };
}

/** 直接采集 Rust 的有序 SI 状态帧，避免渲染帧或定时器重复采样。 */
export function sampleAuthorityFrame(
  frame: SimulationFrame,
  model: RobotModel,
  startedAtMs: number,
): ExperimentSample {
  return {
    t: Math.max(0, (frame.timestampMs - startedAtMs) / 1000),
    timestampMs: frame.timestampMs,
    joints: Object.fromEntries(model.active.map((joint, index) => [
      joint.def.name, frame.jointsRad[index],
    ])),
    base: { ...frame.base, z: 0 },
    tcpPositionM: frame.tcpPositionM,
  };
}

// RecordingFile v1 的角度制只在旧格式边界转换，WorldState 始终使用弧度。
export function toLegacyFrames(samples: ExperimentSample[]): RecFrame[] {
  return samples.map((sample) => ({
    t: sample.t,
    pose: { ...sample.base },
    joints: Object.fromEntries(
      Object.entries(sample.joints).map(([key, value]) => [
        key,
        radiansToDegrees(value),
      ]),
    ),
  }));
}
