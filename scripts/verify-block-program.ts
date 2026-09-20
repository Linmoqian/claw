/**
 * 积木解释器、PnP 与舵机单位换算静态验证。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
import { executeWorkspace } from "../src/blockly/interpreter";
import { solveCoplanarPnp } from "../src/blockly/vision/pnp";
import { DEFAULT_TOOL_PROFILES } from "../src/blockly/toolProfiles";
import {
  angleToPosition,
  positionToAngle,
  speedDegPerSecToRaw,
} from "../src/lib/units";
import { makePoseRpyDeg, poseProperty } from "../src/blockly/poseMath";
import type { BlockDeviceGateway, Detection } from "../src/blockly/types";

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
  async selectArm(): Promise<void> {}
  async home(): Promise<void> {}
  async stop(): Promise<void> {}
  async setTool(): Promise<void> {}
  async setSpeedDegPerSec(): Promise<void> {}
  async setJointAngleDeg(index: number, angleDeg: number): Promise<void> {
    this.joints[index] = angleDeg;
  }
  async setJointAnglesDeg(anglesDeg: number[]): Promise<void> {
    this.joints = anglesDeg;
  }
  async setGripperOpenPercent(): Promise<void> {}
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
  async detectColor(): Promise<null> {
    return null;
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

await verifyVariablesBranchAndLoop();
await verifyFunctionCall();
await verifyRecursiveGuard();
verifyPnp();
verifyUnitsAndPose();
console.log("verify-block-program: ok");
