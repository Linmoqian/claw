/**
 * 积木解释器、PnP 与舵机单位换算静态验证。
 *
 * Created on 2026-09-27
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
// 从应用依赖读取同一份 Blockly 注册表，避免工具目录加载另一份实例。
import * as Blockly from "../../app/node_modules/blockly/index.mjs";
import "../../app/node_modules/blockly/blocks.mjs";
import { registerBlockLabBlocks } from "../../app/src/features/blocks/blockly/blocks";
import { DEFAULT_WORKSPACE } from "../../app/src/features/blocks/blockly/defaultWorkspace";
import { createProgramSnapshot, parseProgramSnapshot } from "../../app/src/features/workbench/runtime/programSnapshot";
import { createProgramAst } from "../../app/src/features/blocks/blockly/programAst";
import { executeWorkspace } from "../../app/src/features/blocks/blockly/interpreter";
import { solveCoplanarPnp } from "../../app/src/features/blocks/blockly/vision/pnp";
import { DEFAULT_TOOL_PROFILES } from "../../app/src/features/blocks/blockly/toolProfiles";
import {
  angleToPosition,
  positionToAngle,
  speedDegPerSecToRaw,
} from "../../app/src/lib/units";
import { makePoseRpyDeg, poseProperty } from "../../app/src/features/blocks/blockly/poseMath";
import type { BlockDeviceGateway, Detection } from "../../app/src/features/blocks/blockly/types";

(globalThis as typeof globalThis & { window: typeof globalThis }).window =
  globalThis;

type Fields = Record<string, unknown>;
type Inputs = Record<string, FakeBlock | null>;

class FakeBlock {
  readonly type: string;
  private readonly fields: Fields;
  private readonly inputs: Inputs;
  next: FakeBlock | null = null;

  constructor(
    type: string,
    options: { fields?: Fields; inputs?: Inputs; next?: FakeBlock | null } = {},
  ) {
    this.type = type;
    this.fields = options.fields ?? {};
    this.inputs = options.inputs ?? {};
    this.next = options.next ?? null;
  }
  getFieldValue(name: string): unknown {
    return this.fields[name];
  }
  getInput(
    name: string,
  ): { connection: { targetBlock(): FakeBlock | null } } | null {
    if (!(name in this.inputs)) return null;
    return { connection: { targetBlock: () => this.inputs[name] } };
  }
  getNextBlock(): FakeBlock | null {
    return this.next;
  }
  isEnabled(): boolean {
    return true;
  }
}

class VerifyGateway {
  readonly kind = "simulation" as const;
  joints: number[] = [0, 0, 0, 0, 0, 0];
  detection: Detection | null = null;
  calls: string[] = [];
  async selectArm(): Promise<void> {}
  async home(): Promise<void> {}
  async stop(): Promise<void> {}
  async setTool(): Promise<void> {}
  async setSpeedDegPerSec(): Promise<void> {}
  async setJointAngleDeg(index: number, angleDeg: number): Promise<void> {
    this.calls.push(`joint:${index}:${angleDeg}`);
    this.joints[index] = angleDeg;
  }
  async setJointAnglesDeg(anglesDeg: number[]): Promise<void> {
    this.joints = anglesDeg;
  }
  async setGripperOpenPercent(percent: number): Promise<void> {
    this.calls.push(`gripper:${percent}`);
  }
  async movePose(): Promise<void> {}
  async setTorque(): Promise<void> {}
  async readJointAnglesDeg(): Promise<number[]> {
    return this.joints;
  }
  async readRawPositions(): Promise<number[]> {
    return [];
  }
  async readTcpPose(): Promise<never> {
    throw new Error("unused");
  }
  async captureCameraFrame(): Promise<null> {
    return null;
  }
  async detectColor(label: string): Promise<Detection | null> {
    this.calls.push(`detect:${label}`);
    return this.detection;
  }
  async detectTargetPoseM(): Promise<never> {
    throw new Error("unused");
  }
  async calibrateJoints(): Promise<never> {
    throw new Error("unused");
  }
  async calibrateEyeHand(): Promise<never> {
    throw new Error("unused");
  }
  async transformCameraPoseToBase(): Promise<never> {
    throw new Error("unused");
  }
  async serialOpen(): Promise<never> {
    throw new Error("unused");
  }
  async serialClose(): Promise<void> {}
  async serialSend(): Promise<never> {
    throw new Error("unused");
  }
  async serialReadLine(): Promise<never> {
    throw new Error("unused");
  }
  async pinMode(): Promise<never> {
    throw new Error("unused");
  }
  async digitalWrite(): Promise<never> {
    throw new Error("unused");
  }
  async digitalRead(): Promise<never> {
    throw new Error("unused");
  }
  async analogWrite(): Promise<never> {
    throw new Error("unused");
  }
  async analogRead(): Promise<never> {
    throw new Error("unused");
  }
}

const gateway = new VerifyGateway();
const verifyGateway = gateway as unknown as BlockDeviceGateway;
const logs: string[] = [];

async function runProgram(
  statements: FakeBlock,
  topBlocks: FakeBlock[] = [statements],
): Promise<void> {
  await executeWorkspace({
    workspace: { getTopBlocks: () => topBlocks } as never,
    gateway: verifyGateway,
    signal: new AbortController().signal,
    log: (message) => logs.push(message),
  });
}

function variableSet(name: string, value: FakeBlock): FakeBlock {
  return new FakeBlock("variables_set", {
    fields: { VAR: name },
    inputs: { VALUE: value },
  });
}

async function verifyVariablesBranchAndLoop() {
  const result = new FakeBlock("math_number", { fields: { NUM: 1 } });
  const loop = new FakeBlock("controls_repeat_ext", {
    inputs: {
      TIMES: new FakeBlock("math_number", { fields: { NUM: 2 } }),
      DO: variableSet(
        "x",
        new FakeBlock("math_arithmetic", {
          fields: { OP: "ADD" },
          inputs: {
            A: new FakeBlock("variables_get", { fields: { VAR: "x" } }),
            B: new FakeBlock("math_number", { fields: { NUM: 3 } }),
          },
        }),
      ),
    },
  });
  const branch = new FakeBlock("controls_if", {
    inputs: {
      IF0: new FakeBlock("logic_boolean", { fields: { BOOL: "TRUE" } }),
      DO0: variableSet(
        "x",
        new FakeBlock("math_number", { fields: { NUM: 10 } }),
      ),
    },
  });
  const start = new FakeBlock("event_start");
  start.next = variableSet("x", result);
  variableSet("x", result).next = loop;
  loop.next = branch;
  // 上一行只是便于类型阅读；重建正确链条。
  start.next.next = loop;
  loop.next = branch;
  await runProgram(start);
  assert.equal(gateway.joints.length, 6);
}

async function verifyFunctionCall() {
  const definition = new FakeBlock("procedures_defreturn", {
    inputs: { RETURN: new FakeBlock("math_number", { fields: { NUM: 7 } }) },
  });
  Object.assign(definition, {
    getProcedureDef: () => ["value", [], true],
  });
  const call = new FakeBlock("procedures_callreturn", {
    fields: { NAME: "value" },
  });
  const start = new FakeBlock("event_start");
  start.next = variableSet("x", call);
  await runProgram(start, [definition, start]);
}

async function verifyRecursiveGuard() {
  const definition = new FakeBlock("procedures_defreturn", {
    inputs: {
      RETURN: new FakeBlock("procedures_callreturn", {
        fields: { NAME: "recursive" },
      }),
    },
  });
  Object.assign(definition, {
    getProcedureDef: () => ["recursive", [], true],
  });
  const start = new FakeBlock("event_start");
  start.next = variableSet(
    "x",
    new FakeBlock("procedures_callreturn", { fields: { NAME: "recursive" } }),
  );
  await assert.rejects(
    () => runProgram(start, [definition, start]),
    /函数嵌套超过/,
  );
}

function verifyPnp() {
  const detection: Detection = {
    label: "RED",
    x: 240,
    y: 170,
    width: 160,
    height: 160,
    centerX: 320,
    centerY: 250,
    area: 25000,
    confidence: 0.95,
  };
  const pose = solveCoplanarPnp(detection, 0.04, {
    width: 640,
    height: 480,
    fx: 617.8,
    fy: 617.3,
    cx: 324.2,
    cy: 238.6,
  });
  assert.ok(pose, "PnP pose is expected");
  assert.ok(
    pose.position.z > 0.01 && pose.position.z < 1,
    "PnP depth should be physical",
  );
}

function verifyUnitsAndPose() {
  assert.equal(positionToAngle(angleToPosition(30, 1), 1), 30);
  assert.equal(speedDegPerSecToRaw(0), speedDegPerSecToRaw(1));
  assert.ok(speedDegPerSecToRaw(300) <= 2400);
  const pose = makePoseRpyDeg(1, 2, 3, { roll: 0, pitch: 0, yaw: 90 });
  assert.equal(poseProperty(pose, "Z"), 3);
  assert.ok(Math.abs(poseProperty(pose, "YAW") - 90) < 1e-6);
  assert.ok(DEFAULT_TOOL_PROFILES.length > 1);
}

async function verifyProgramSnapshotIsolation() {
  registerBlockLabBlocks();
  const editor = new Blockly.Workspace();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{
    type: "event_start", next: { block: {
      type: "arm_joint_angle", fields: { JOINT: "0", ANGLE: 30 },
    } },
  }] } }, editor);
  const frozen = createProgramSnapshot(editor);
  const edited = editor.getAllBlocks(false).find((block) => block.type === "arm_joint_angle");
  assert.ok(edited);
  edited.setFieldValue(80, "ANGLE");
  editor.dispose();
  const executionBlock = frozen.workspace.getAllBlocks(false)
    .find((block) => block.type === "arm_joint_angle");
  assert.equal(executionBlock?.getFieldValue("ANGLE"), 30, "编辑和销毁页面不能改变运行快照");
  const desktopAst = createProgramAst(frozen.workspace);
  assert.equal(desktopAst.top.find((block) => block.type === "event_start")?.next?.fields.ANGLE,
    "30", "Rust 执行树应保留冻结时的角度");
  await executeWorkspace({
    workspace: frozen.workspace,
    gateway,
    signal: new AbortController().signal,
    log: () => undefined,
  });
  assert.equal(gateway.joints[0], 30, "运行副本应执行冻结时的关节目标");
  frozen.workspace.dispose();
}

async function verifyDefaultProgramBranches() {
  registerBlockLabBlocks();
  const detected: Detection = {
    label: "RED", x: 210, y: 170, width: 130, height: 130,
    centerX: 275, centerY: 235, area: 16900, confidence: 1,
  };
  for (const condition of [true, false]) {
    const editor = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(DEFAULT_WORKSPACE, editor);
    const frozen = createProgramSnapshot(editor);
    editor.dispose();
    assert.equal(frozen.workspace.getAllBlocks(false).length, 5);
    const exampleGateway = new VerifyGateway();
    exampleGateway.detection = condition ? detected : null;
    const logs: string[] = [];
    await executeWorkspace({ workspace: frozen.workspace, gateway: exampleGateway,
      signal: new AbortController().signal, log: (message) => logs.push(message) });
    assert.deepEqual(exampleGateway.calls, condition
      ? ["detect:RED", "joint:0:15", "gripper:5"] : ["detect:RED"]);
    assert.ok(logs.includes(condition ? "条件满足，执行分支" : "条件未满足，跳过分支"));
    frozen.workspace.dispose();
  }
  const legacy = new Blockly.Workspace();
  const legacyState = structuredClone(DEFAULT_WORKSPACE);
  legacyState.blocks.blocks[0].next.block.inputs.DO.block.type = "move_steps";
  legacyState.blocks.blocks[0].next.block.inputs.DO.block.fields = { STEPS: 2 };
  Blockly.serialization.workspaces.load(legacyState, legacy);
  const legacyGateway = new VerifyGateway();
  legacyGateway.detection = detected;
  const legacyLogs: string[] = [];
  await executeWorkspace({ workspace: legacy, gateway: legacyGateway,
    signal: new AbortController().signal, log: (message) => legacyLogs.push(message) });
  assert.deepEqual(legacyGateway.calls, ["detect:RED", "gripper:5"]);
  assert.ok(legacyLogs.some((line) => line.includes("旧演示步数块不驱动运动")));
  assert.ok(!legacyLogs.some((line) => line.includes("向前移动")));
  legacy.dispose();
}

function verifyEmptyWorkspacePersistence() {
  const empty = new Blockly.Workspace();
  const saved = Blockly.serialization.workspaces.save(empty);
  empty.dispose();
  assert.equal(JSON.stringify(saved), "{}", "Blockly 合法空草稿没有 blocks 字段");
  const stored = JSON.stringify(saved);
  const restored = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(parseProgramSnapshot(stored), restored);
  assert.equal(restored.getAllBlocks(false).length, 0, "空草稿恢复后不得替换为默认运动示例");
  assert.equal(JSON.stringify(Blockly.serialization.workspaces.save(restored)), "{}");
  restored.dispose();
  // 真实 loader 会默默丢弃这些损坏数据，解析边界必须阻止后续自动保存覆盖原文。
  for (const ignored of [{ unexpected: true }, { blocks: null }]) {
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(ignored, workspace);
    assert.equal(JSON.stringify(Blockly.serialization.workspaces.save(workspace)), "{}");
    workspace.dispose();
    assert.throws(() => parseProgramSnapshot(JSON.stringify(ignored)));
  }
  for (const valid of [{ blocks: { languageVersion: 0, blocks: [] } }, { variables: [] }, { workspaceComments: [] }]) {
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(parseProgramSnapshot(JSON.stringify(valid)), workspace);
    assert.equal(workspace.getAllBlocks(false).length, 0);
    workspace.dispose();
  }
  for (const corrupt of ["null", "[]", "\"text\"", "{", "",
    '{"blocks":{}}', '{"blocks":[]}', '{"blocks":{"blocks":null}}',
    '{"blocks":{"blocks":[null]}}', '{"blocks":{"blocks":[{}]}}',
    '{"blocks":{"languageVersion":"0","blocks":[]}}',
    '{"blocks":{"blocks":[],"unexpected":true}}',
    '{"variables":null}', '{"workspaceComments":{}}',
    '{"variables":[],"unexpected":true}',
  ])
    assert.throws(() => parseProgramSnapshot(corrupt), "损坏草稿应触发保留原值的错误路径");
}

verifyEmptyWorkspacePersistence();
await verifyDefaultProgramBranches();
await verifyProgramSnapshotIsolation();
await verifyVariablesBranchAndLoop();
await verifyFunctionCall();
await verifyRecursiveGuard();
verifyPnp();
verifyUnitsAndPose();
console.log("verify-block-program: ok");
