/** 验证实验采样单位、写入失败重试、事务队列和旧录像回放。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
import { ExperimentJournal } from "../../../app/frontend/src/features/experiments/domain/journal";
import {
  sampleRuntime,
  toLegacyFrames,
} from "../../../app/frontend/src/features/experiments/domain/sampling";
import type {
  ExperimentBundle,
  ExperimentSample,
} from "../../../app/frontend/src/features/experiments/domain/types";
import { BaseSim } from "../../../app/frontend/src/robot/baseSim";
import { buildRobotModel } from "../../../app/frontend/src/robot/model";
import { SimulationLoop } from "../../../app/frontend/src/robot/simulation";
import { ReplayBridge } from "../../../app/frontend/src/services/bridge/replayBridge";
import {
  parseRecording,
  type RecordingFile,
} from "../../../app/frontend/src/services/protocol/recording";

const model = buildRobotModel({
  name: "test",
  materials: {},
  links: [
    { name: "base", visuals: [] },
    { name: "arm", visuals: [] },
  ],
  joints: [
    {
      name: "joint",
      kind: "revolute",
      parent: "base",
      child: "arm",
      originXyz: [0, 0, 0],
      originRpy: [0, 0, 0],
      axis: [0, 0, 1],
      lower: -Math.PI,
      upper: Math.PI,
    },
  ],
});
const sim = new SimulationLoop(model);
const baseSim = new BaseSim();
sim.applyTelemetry([90]);
baseSim.teleport({ x: 1.5, y: -0.4, yaw: Math.PI / 3 });
const sample = sampleRuntime({ model, sim, baseSim }, 0.053, 1800000000053);
assert.equal(sample.t, 0.053);
assert.equal(sample.joints.joint, Math.PI / 2);
assert.equal(sample.base.x, 1.5);
assert.equal(sample.base.yaw, Math.PI / 3);
assert.deepEqual(sim.currentDegrees, [90], "采样不能推进或生成仿真运动");
assert.equal(toLegacyFrames([sample])[0].joints.joint, 90);

const legacy: RecordingFile = {
  kind: "claw-recording",
  version: 1,
  fps: 20,
  recordedAt: 1800000000000,
  frames: [
    {
      t: 0,
      pose: { x: 0, y: 0, z: 0, yaw: Math.PI * 0.9 },
      joints: { joint: 90 },
    },
    {
      t: 1,
      pose: { x: 2, y: 1, z: 0, yaw: -Math.PI * 0.9 },
      joints: { joint: 90 },
    },
  ],
};
const bridge = new ReplayBridge();
const angles: number[] = [];
const positions: number[] = [];
const unsubscribe = bridge.subscribeRobotState((state) => {
  angles.push(state.joints.joint);
  positions.push(state.pose.position.x);
});
bridge.load(parseRecording(JSON.stringify(legacy)).frames);
bridge.seek(0.5);
bridge.seek(1);
assert.deepEqual(
  angles,
  [Math.PI / 2, Math.PI / 2, Math.PI / 2],
  "90 度首帧、中间插值及末帧均转换为弧度",
);
assert.deepEqual(positions, [0, 1, 2]);
unsubscribe();
assert.throws(() => parseRecording(JSON.stringify({ ...legacy, version: 2 })));
assert.throws(() =>
  parseRecording(
    JSON.stringify({ ...legacy, frames: [legacy.frames[1], legacy.frames[0]] }),
  ),
);
assert.throws(() =>
  parseRecording(
    JSON.stringify({
      ...legacy,
      frames: [{ ...legacy.frames[0], joints: { joint: null } }],
    }),
  ),
);

function emptyBundle(): ExperimentBundle {
  return {
    record: {
      id: "test",
      name: "test",
      source: "studio",
      status: "recording",
      createdAt: 1,
      endedAt: null,
      durationS: 0,
      sampleCount: 0,
      robotId: "test",
      robotLabel: "test",
      sampleRateHz: 20,
    },
    snapshot: {
      jointMapping: [{ code: "J1", name: "joint" }],
      scene: { workspace: null, path: [] },
      programRuns: [],
      logs: [],
    },
    samples: [],
  };
}

const writes: { offset: number; samples: ExperimentSample[] }[] = [];
let failOnce = true;
const journal = new ExperimentJournal(
  emptyBundle(),
  async (_record, _snapshot, samples, offset) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("模拟空间不足，事务回滚");
    }
    writes.push({ samples, offset });
  },
);
journal.append(sample);
await assert.rejects(journal.flush(), /空间不足/);
assert.equal(journal.committedRecord, null, "失败事务不能产生已保存元信息");
assert.equal(journal.bundle.samples.length, 1, "保存失败保留完整内存采样");
journal.append({ ...sample, t: 0.103 });
await journal.flush();
assert.equal(writes[0].offset, 0, "失败不推进写入偏移");
assert.equal(writes[0].samples.length, 2, "重试包括失败批次和新采样");
journal.append({ ...sample, t: 0.153 });
await journal.flush();
assert.equal(writes[1].offset, 2);
assert.equal(writes[1].samples.length, 1, "成功批次不重复写入");
assert.equal(journal.committedRecord?.status, "recording");
journal.bundle.record.status = "saved";
assert.equal(
  journal.committedRecord?.status,
  "recording",
  "内存结束状态不能提前修改已提交记录",
);
await journal.flush();
assert.equal(journal.committedRecord?.status, "saved");

let release: (() => void) | undefined;
const blocked = new Promise<void>((resolve) => {
  release = resolve;
});
const orderedWrites: number[] = [];
const queue = new ExperimentJournal(
  emptyBundle(),
  async (_record, _snapshot, _samples, offset) => {
    orderedWrites.push(offset);
    if (orderedWrites.length === 1) await blocked;
  },
);
queue.append(sample);
const first = queue.flush();
await new Promise((resolve) => setTimeout(resolve, 0));
queue.append({ ...sample, t: 0.2 });
const final = queue.flush();
assert.deepEqual(orderedWrites, [0], "同一会话的保存事务必须串行");
release?.();
await Promise.all([first, final]);
assert.deepEqual(orderedWrites, [0, 1]);
assert.equal(queue.bundle.samples.length, 2);
console.log(
  "实验验证通过：实际状态 SI 采样、旧录像 90° 首/中/末帧、损坏帧拒绝、失败重试无丢帧、写入队列顺序。",
);
