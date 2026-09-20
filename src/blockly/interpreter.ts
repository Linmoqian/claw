/**
 * Blockly 异步解释器：直接遍历程序树，避免生成可执行 JS 带来的安全边界问题。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import type * as Blockly from "blockly/core";
import {
  inversePose,
  makePoseRpyDeg,
  poseProperty,
  composePose,
  transformCameraPoseToBase,
} from "./poseMath";
import type { BlockDeviceGateway } from "./types";

export type LogKind = "system" | "event" | "success" | "warning" | "error";

export interface InterpreterOptions {
  workspace: Blockly.Workspace;
  gateway: BlockDeviceGateway;
  signal: AbortSignal;
  log: (message: string, kind?: LogKind) => void;
}

const MAX_FUNCTION_DEPTH = 32;
const MAX_LOOP_ITERATIONS = 100000;
const EXECUTABLE_TYPES = new Set([
  "select_arm",
  "arm_home",
  "arm_joint_angle",
  "arm_joint_angles",
  "arm_pose",
  "gripper_open_percent",
  "motor_speed",
  "motor_torque",
  "stop_robot",
  "camera_capture",
  "lidar_scan",
  "select_tool",
  "serial_open",
  "serial_close",
  "serial_send",
  "pin_mode",
  "digital_write",
  "analog_write",
  "move_steps",
  "turn_left",
  "turn_right",
  "grab_object",
]);

export class ExecutionAborted extends Error {
  constructor(message = "程序已停止") {
    super(message);
    this.name = "ExecutionAborted";
  }
}

class FunctionReturn extends Error {
  constructor(readonly value: unknown) {
    super("function return");
  }
}

interface ProcedureDefinition {
  name: string;
  args: string[];
  hasReturn: boolean;
  block: Blockly.Block;
}

type AnyBlock = Blockly.Block & {
  getProcedureDef?: () => [string, string[], boolean];
  arguments_?: string[];
};

function assertOpen(signal: AbortSignal): void {
  if (signal.aborted) throw new ExecutionAborted();
}

async function yieldToUi(signal: AbortSignal): Promise<void> {
  assertOpen(signal);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  assertOpen(signal);
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function connected(
  block: Blockly.Block,
  inputName: string,
): Blockly.Block | null {
  return block.getInput(inputName)?.connection?.targetBlock() ?? null;
}

function fieldValue(block: Blockly.Block, name: string): string {
  return String(block.getFieldValue(name) ?? "");
}

function procedureMap(
  workspace: Blockly.Workspace,
): Map<string, ProcedureDefinition> {
  const definitions = new Map<string, ProcedureDefinition>();
  for (const raw of workspace.getTopBlocks(false)) {
    const block = raw as AnyBlock;
    const definition = block.getProcedureDef?.();
    if (!definition) continue;
    const [name, args, hasReturn] = definition;
    definitions.set(name, { name, args, hasReturn, block });
  }
  return definitions;
}

async function evaluateFunction(
  definition: ProcedureDefinition,
  callBlock: Blockly.Block,
  options: InterpreterOptions,
  globals: Map<string, unknown>,
  depth: number,
): Promise<unknown> {
  if (depth >= MAX_FUNCTION_DEPTH)
    throw new Error(`函数嵌套超过 ${MAX_FUNCTION_DEPTH} 层`);
  assertOpen(options.signal);
  const local = new Map<string, unknown>(globals);
  const args =
    (definition.block as AnyBlock).arguments_ ?? definition.args ?? [];
  args.forEach((argument, index) => {
    local.set(
      argument,
      evaluateInput(
        callBlock,
        `ARG${index}`,
        options,
        globals,
        definitionsOf(options),
        depth + 1,
      ),
    );
  });
  try {
    await executeSequence(
      connected(definition.block, "STACK"),
      options,
      globals,
      definitionsOf(options),
      depth + 1,
      local,
    );
  } catch (error) {
    if (error instanceof FunctionReturn) return error.value;
    throw error;
  }
  if (!definition.hasReturn) return undefined;
  const returnBlock = connected(definition.block, "RETURN");
  return returnBlock
    ? evaluateBlock(
        returnBlock,
        options,
        local,
        definitionsOf(options),
        depth + 1,
      )
    : undefined;
}

// 递归辅助：让函数定义表跟随 workspace 一次构建后传递，避免每次表达式重新扫描。
function definitionsOf(
  options: InterpreterOptions,
): Map<string, ProcedureDefinition> {
  const cache = functionCache.get(options.workspace);
  if (!cache) return procedureMap(options.workspace);
  return cache;
}

const functionCache = new WeakMap<
  Blockly.Workspace,
  Map<string, ProcedureDefinition>
>();

async function evaluateInput(
  parent: Blockly.Block,
  inputName: string,
  options: InterpreterOptions,
  scope: Map<string, unknown>,
  definitions: Map<string, ProcedureDefinition>,
  depth = 0,
): Promise<unknown> {
  const block = connected(parent, inputName);
  if (!block) throw new Error(`积木缺少输入：${inputName}`);
  return evaluateBlock(block, options, scope, definitions, depth);
}

async function evaluateBlock(
  block: Blockly.Block,
  options: InterpreterOptions,
  scope: Map<string, unknown>,
  definitions: Map<string, ProcedureDefinition>,
  depth = 0,
): Promise<unknown> {
  assertOpen(options.signal);
  if (!block.isEnabled()) return undefined;

  switch (block.type) {
    case "math_number":
      return number(fieldValue(block, "NUM"));
    case "logic_boolean":
      return fieldValue(block, "BOOL") === "TRUE";
    case "logic_negate":
      return !(await evaluateInput(
        block,
        "BOOL",
        options,
        scope,
        definitions,
        depth,
      ));
    case "logic_operation": {
      const left = await evaluateInput(
        block,
        "A",
        options,
        scope,
        definitions,
        depth,
      );
      const operator = fieldValue(block, "OP");
      if (operator === "OR" && Boolean(left)) return true;
      const right = await evaluateInput(
        block,
        "B",
        options,
        scope,
        definitions,
        depth,
      );
      return operator === "OR"
        ? Boolean(left) || Boolean(right)
        : Boolean(left) && Boolean(right);
    }
    case "logic_compare": {
      const left = await evaluateInput(
        block,
        "A",
        options,
        scope,
        definitions,
        depth,
      );
      const right = await evaluateInput(
        block,
        "B",
        options,
        scope,
        definitions,
        depth,
      );
      const op = fieldValue(block, "OP");
      if (typeof left === "object" || typeof right === "object") {
        const equal = JSON.stringify(left) === JSON.stringify(right);
        return op === "EQ" ? equal : op === "NEQ" ? !equal : false;
      }
      const a = number(left);
      const b = number(right);
      return op === "EQ"
        ? a === b
        : op === "NEQ"
          ? a !== b
          : op === "LT"
            ? a < b
            : op === "LTE"
              ? a <= b
              : op === "GT"
                ? a > b
                : a >= b;
    }
    case "math_arithmetic": {
      const a = number(
        await evaluateInput(block, "A", options, scope, definitions, depth),
      );
      const b = number(
        await evaluateInput(block, "B", options, scope, definitions, depth),
      );
      switch (fieldValue(block, "OP")) {
        case "ADD":
          return a + b;
        case "MINUS":
          return a - b;
        case "MULTIPLY":
          return a * b;
        case "DIVIDE":
          if (b === 0) throw new Error("除数不能为 0");
          return a / b;
        case "POWER":
          return a ** b;
        default:
          throw new Error("不支持的数学运算");
      }
    }
    case "math_single": {
      const value = number(
        await evaluateInput(block, "NUM", options, scope, definitions, depth),
      );
      const op = fieldValue(block, "OP");
      if (op === "NEG") return -value;
      if (op === "ABS") return Math.abs(value);
      if (op === "ROOT") {
        if (value < 0) throw new Error("平方根不能作用于负数");
        return Math.sqrt(value);
      }
      throw new Error("不支持的数学函数");
    }
    case "text":
      return fieldValue(block, "TEXT");
    case "text_join": {
      const first = await evaluateInput(
        block,
        "ADD0",
        options,
        scope,
        definitions,
        depth,
      );
      const second = await evaluateInput(
        block,
        "ADD1",
        options,
        scope,
        definitions,
        depth,
      );
      return `${text(first)}${text(second)}`;
    }
    case "variables_get":
      return scope.get(fieldValue(block, "VAR")) ?? 0;
    case "variables_set":
      scope.set(
        fieldValue(block, "VAR"),
        await evaluateInput(block, "VALUE", options, scope, definitions, depth),
      );
      return undefined;
    case "lists_create_with": {
      const values: unknown[] = [];
      let index = 0;
      while (block.getInput(`ADD${index}`)) {
        const item = connected(block, `ADD${index}`);
        if (item)
          values.push(
            await evaluateBlock(item, options, scope, definitions, depth),
          );
        index += 1;
      }
      return values;
    }
    case "decision_if":
    case "controls_if": {
      let index = 0;
      while (block.getInput(`IF${index}`)) {
        const condition = Boolean(
          await evaluateInput(
            block,
            `IF${index}`,
            options,
            scope,
            definitions,
            depth,
          ),
        );
        if (condition) {
          await executeSequence(
            connected(block, `DO${index}`),
            options,
            scope,
            definitions,
            depth,
          );
          return undefined;
        }
        index += 1;
      }
      if (block.getInput("ELSE")) {
        await executeSequence(
          connected(block, "ELSE"),
          options,
          scope,
          definitions,
          depth,
        );
      }
      return undefined;
    }
    case "controls_repeat_ext": {
      const count = Math.floor(
        number(
          await evaluateInput(
            block,
            "TIMES",
            options,
            scope,
            definitions,
            depth,
          ),
        ),
      );
      if (count < 0 || count > MAX_LOOP_ITERATIONS)
        throw new Error(`循环次数必须位于 0..${MAX_LOOP_ITERATIONS}`);
      for (let index = 0; index < count; index += 1) {
        await executeSequence(
          connected(block, "DO"),
          options,
          scope,
          definitions,
          depth,
        );
        await yieldToUi(options.signal);
      }
      return undefined;
    }
    case "controls_whileUntil": {
      const mode = fieldValue(block, "MODE");
      let iterations = 0;
      while (iterations < MAX_LOOP_ITERATIONS) {
        const condition = Boolean(
          await evaluateInput(
            block,
            "BOOL",
            options,
            scope,
            definitions,
            depth,
          ),
        );
        const shouldRun = mode === "WHILE" ? condition : !condition;
        if (!shouldRun) break;
        await executeSequence(
          connected(block, "DO"),
          options,
          scope,
          definitions,
          depth,
        );
        iterations += 1;
        await yieldToUi(options.signal);
      }
      if (iterations >= MAX_LOOP_ITERATIONS)
        throw new Error(`循环超过 ${MAX_LOOP_ITERATIONS} 次`);
      return undefined;
    }
    case "controls_for": {
      const variable = fieldValue(block, "VAR");
      const from = number(
        await evaluateInput(block, "FROM", options, scope, definitions, depth),
      );
      const to = number(
        await evaluateInput(block, "TO", options, scope, definitions, depth),
      );
      const stepInput = connected(block, "BY");
      const by = stepInput
        ? number(
            await evaluateBlock(stepInput, options, scope, definitions, depth),
          )
        : from <= to
          ? 1
          : -1;
      if (by === 0) throw new Error("循环步长不能为 0");
      let iterations = 0;
      for (let value = from; by > 0 ? value <= to : value >= to; value += by) {
        if (iterations >= MAX_LOOP_ITERATIONS)
          throw new Error(`循环超过 ${MAX_LOOP_ITERATIONS} 次`);
        scope.set(variable, value);
        await executeSequence(
          connected(block, "DO"),
          options,
          scope,
          definitions,
          depth,
        );
        iterations += 1;
        await yieldToUi(options.signal);
      }
      return undefined;
    }
    case "controls_forEach": {
      const variable = fieldValue(block, "VAR");
      const list = await evaluateInput(
        block,
        "LIST",
        options,
        scope,
        definitions,
        depth,
      );
      if (!Array.isArray(list)) throw new Error("遍历积木需要列表输入");
      for (const item of list) {
        scope.set(variable, item);
        await executeSequence(
          connected(block, "DO"),
          options,
          scope,
          definitions,
          depth,
        );
        await yieldToUi(options.signal);
      }
      return undefined;
    }
    case "procedures_callreturn":
    case "procedures_callnoreturn": {
      const name = fieldValue(block, "NAME");
      const definition = definitions.get(name);
      if (!definition) throw new Error(`函数不存在：${name}`);
      const result = await evaluateFunction(
        definition,
        block,
        options,
        scope,
        depth,
      );
      if (block.type === "procedures_callreturn") return result;
      options.log(`调用函数 ${name}`, "event");
      return undefined;
    }
    case "procedures_ifreturn": {
      const shouldReturn = Boolean(
        await evaluateInput(
          block,
          "CONDITION",
          options,
          scope,
          definitions,
          depth,
        ),
      );
      if (!shouldReturn) return;
      const value = connected(block, "VALUE")
        ? await evaluateInput(
            block,
            "VALUE",
            options,
            scope,
            definitions,
            depth,
          )
        : undefined;
      throw new FunctionReturn(value);
    }

    case "read_joints":
      return options.gateway.readJointAnglesDeg();
    case "read_tcp":
      return options.gateway.readTcpPose();
    case "camera_detect_color":
      return options.gateway.detectColor(
        fieldValue(block, "COLOR"),
        number(fieldValue(block, "MIN_AREA"), 500),
      );
    case "camera_target_pose":
      return options.gateway.detectTargetPoseM(
        number(fieldValue(block, "WIDTH_M"), 0.04),
      );
    case "calibrate_joints":
      return options.gateway.calibrateJoints();
    case "calibrate_eye_hand":
      return options.gateway.calibrateEyeHand();
    case "pose_make": {
      const value = makePoseRpyDeg(
        number(fieldValue(block, "X")),
        number(fieldValue(block, "Y")),
        number(fieldValue(block, "Z")),
        {
          roll: number(fieldValue(block, "ROLL")),
          pitch: number(fieldValue(block, "PITCH")),
          yaw: number(fieldValue(block, "YAW")),
        },
      );
      return value;
    }
    case "pose_property": {
      const value = await evaluateInput(
        block,
        "POSE",
        options,
        scope,
        definitions,
        depth,
      );
      if (!value || typeof value !== "object") throw new Error("位姿输入无效");
      return poseProperty(
        value as Parameters<typeof poseProperty>[0],
        fieldValue(block, "PROPERTY") as Parameters<typeof poseProperty>[1],
      );
    }
    case "pose_compose": {
      const parent = await evaluateInput(
        block,
        "PARENT",
        options,
        scope,
        definitions,
        depth,
      );
      const child = await evaluateInput(
        block,
        "CHILD",
        options,
        scope,
        definitions,
        depth,
      );
      return composePose(
        parent as Parameters<typeof composePose>[0],
        child as Parameters<typeof composePose>[1],
      );
    }
    case "pose_inverse":
      return inversePose(
        (await evaluateInput(
          block,
          "POSE",
          options,
          scope,
          definitions,
          depth,
        )) as Parameters<typeof inversePose>[0],
      );
    case "camera_pose_to_base":
      return options.gateway.transformCameraPoseToBase(
        (await evaluateInput(
          block,
          "POSE",
          options,
          scope,
          definitions,
          depth,
        )) as Parameters<typeof transformCameraPoseToBase>[1],
      );
    case "serial_read_line":
      return options.gateway.serialReadLine(2000);
    case "digital_read":
      return (
        (await options.gateway.digitalRead(
          Math.trunc(number(fieldValue(block, "PIN"))),
        )) === 1
      );
    case "analog_read":
      return options.gateway.analogRead(
        Math.trunc(number(fieldValue(block, "PIN"))),
      );
    case "sense_color":
      return (
        (await options.gateway.detectColor(fieldValue(block, "COLOR"), 500)) !==
        null
      );
    default:
      throw new Error(`不支持的表达式积木：${block.type}`);
  }
}

async function executeStatement(
  block: Blockly.Block,
  options: InterpreterOptions,
  globals: Map<string, unknown>,
  definitions: Map<string, ProcedureDefinition>,
  local?: Map<string, unknown>,
  depth = 0,
): Promise<void> {
  const scope = local ?? globals;
  assertOpen(options.signal);
  if (!block.isEnabled()) return;
  const gateway = options.gateway;

  switch (block.type) {
    case "select_arm": {
      const robotId = fieldValue(block, "ARM_ID");
      await gateway.selectArm(robotId);
      options.log(`已选择机械臂 ${robotId}`, "event");
      return;
    }
    case "arm_home":
      await gateway.home();
      options.log("机械臂回零完成", "event");
      return;
    case "arm_joint_angle": {
      await gateway.setJointAngleDeg(
        Math.trunc(number(fieldValue(block, "JOINT"))),
        number(fieldValue(block, "ANGLE")),
        number(fieldValue(block, "SPEED"), 80),
      );
      options.log(
        `关节 J${Math.trunc(number(fieldValue(block, "JOINT"))) + 1} 到 ${fieldValue(block, "ANGLE")}°`,
        "event",
      );
      return;
    }
    case "arm_joint_angles": {
      const angles = fieldValue(block, "ANGLES")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      if (angles.length === 0) throw new Error("多关节角度列表无效");
      await gateway.setJointAnglesDeg(
        angles,
        number(fieldValue(block, "SPEED"), 80),
      );
      options.log(
        `多关节目标：${angles.map((value) => value.toFixed(1)).join(", ")}°`,
        "event",
      );
      return;
    }
    case "arm_pose": {
      const target = makePoseRpyDeg(
        number(fieldValue(block, "X")),
        number(fieldValue(block, "Y")),
        number(fieldValue(block, "Z")),
        {
          roll: number(fieldValue(block, "ROLL")),
          pitch: number(fieldValue(block, "PITCH")),
          yaw: number(fieldValue(block, "YAW")),
        },
      );
      await gateway.movePose(target, number(fieldValue(block, "SPEED"), 80));
      options.log(
        `TCP 移动到 ${target.position.x.toFixed(3)}, ${target.position.y.toFixed(3)}, ${target.position.z.toFixed(3)} m`,
        "event",
      );
      return;
    }
    case "gripper_open_percent":
      await gateway.setGripperOpenPercent(
        number(fieldValue(block, "PERCENT")),
        number(fieldValue(block, "SPEED"), 80),
      );
      options.log(`夹爪开度 ${fieldValue(block, "PERCENT")}%`, "event");
      return;
    case "motor_speed":
      await gateway.setSpeedDegPerSec(number(fieldValue(block, "SPEED")));
      options.log(`默认速度 ${fieldValue(block, "SPEED")}°/s`, "event");
      return;
    case "motor_torque":
      await gateway.setTorque(fieldValue(block, "ON") === "1");
      options.log(
        fieldValue(block, "ON") === "1" ? "扭矩已使能" : "扭矩已失能",
        "event",
      );
      return;
    case "stop_robot":
      await gateway.stop();
      options.log("机器人已停止", "warning");
      return;
    case "select_tool": {
      const toolId = fieldValue(block, "TOOL_ID");
      await gateway.setTool(toolId);
      options.log(`切换工具 ${toolId}`, "event");
      return;
    }
    case "camera_capture": {
      const frame = await gateway.captureCameraFrame();
      if (!frame) throw new Error("摄像头帧不可用");
      options.log("摄像头画面已更新", "event");
      return;
    }
    case "lidar_scan":
      await yieldToUi(options.signal);
      options.log("点云已更新", "event");
      return;
    case "serial_open": {
      await gateway.serialOpen({
        port: fieldValue(block, "PORT"),
        baud: Number(fieldValue(block, "BAUD")),
      });
      options.log(`串口 ${fieldValue(block, "PORT")} 已打开`, "event");
      return;
    }
    case "serial_close":
      await gateway.serialClose();
      options.log("串口已关闭", "event");
      return;
    case "serial_send": {
      const payload = await evaluateInput(
        block,
        "PAYLOAD",
        options,
        scope,
        definitions,
        depth,
      );
      await gateway.serialSend(text(payload));
      options.log(`串口已发送 ${text(payload)}`, "event");
      return;
    }
    case "pin_mode": {
      const mode = fieldValue(block, "MODE") as
        "input" | "output" | "input_pullup";
      await gateway.pinMode(Math.trunc(number(fieldValue(block, "PIN"))), mode);
      options.log(`引脚 ${fieldValue(block, "PIN")} 设为 ${mode}`, "event");
      return;
    }
    case "digital_write":
      await gateway.digitalWrite(
        Math.trunc(number(fieldValue(block, "PIN"))),
        fieldValue(block, "VALUE") === "1" ? 1 : 0,
      );
      options.log(
        `引脚 ${fieldValue(block, "PIN")} 写入 ${fieldValue(block, "VALUE")}`,
        "event",
      );
      return;
    case "analog_write":
      await gateway.analogWrite(
        Math.trunc(number(fieldValue(block, "PIN"))),
        number(fieldValue(block, "VALUE")),
      );
      options.log(
        `引脚 ${fieldValue(block, "PIN")} PWM ${fieldValue(block, "VALUE")}`,
        "event",
      );
      return;

    case "move_steps":
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 80);
        options.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            reject(new ExecutionAborted());
          },
          { once: true },
        );
      });
      options.log(`向前移动 ${fieldValue(block, "STEPS")} 格`, "event");
      return;
    case "turn_left":
      await gateway.setJointAngleDeg(0, -20, 60);
      options.log("向左转 20°", "event");
      return;
    case "turn_right":
      await gateway.setJointAngleDeg(0, 20, 60);
      options.log("向右转 20°", "event");
      return;
    case "grab_object":
      await gateway.setGripperOpenPercent(5, 80);
      options.log("夹爪闭合", "event");
      return;

    case "variables_set": {
      scope.set(
        fieldValue(block, "VAR"),
        await evaluateInput(block, "VALUE", options, scope, definitions, depth),
      );
      return;
    }
    case "decision_if":
    case "controls_if":
    case "controls_repeat_ext":
    case "controls_whileUntil":
    case "controls_for":
    case "controls_forEach":
      await evaluateBlock(block, options, scope, definitions, depth);
      return;
    case "procedures_callnoreturn":
      await evaluateBlock(block, options, scope, definitions, depth);
      return;
    default:
      if (EXECUTABLE_TYPES.has(block.type)) return;
      throw new Error(`不支持的语句积木：${block.type}`);
  }
}

async function executeSequence(
  start: Blockly.Block | null,
  options: InterpreterOptions,
  globals: Map<string, unknown>,
  definitions: Map<string, ProcedureDefinition>,
  depth = 0,
  local?: Map<string, unknown>,
): Promise<void> {
  let block = start;
  while (block) {
    assertOpen(options.signal);
    await executeStatement(block, options, globals, definitions, local, depth);
    block = block.getNextBlock();
    if (block) await yieldToUi(options.signal);
  }
}

export async function executeWorkspace(
  options: InterpreterOptions,
): Promise<void> {
  const definitions = procedureMap(options.workspace);
  functionCache.set(options.workspace, definitions);
  const start = options.workspace
    .getTopBlocks(false)
    .find((block) => block.type === "event_start");
  if (!start) throw new Error("程序缺少“开始运行”积木");
  const hasAction =
    EXECUTABLE_TYPES.has(start.getNextBlock()?.type ?? "") ||
    Boolean(start.getNextBlock());
  if (!start.getNextBlock() || !hasAction)
    throw new Error("开始积木后没有可执行动作");
  try {
    await executeSequence(
      start.getNextBlock(),
      options,
      new Map(),
      definitions,
    );
    options.log("程序执行完成", "success");
  } finally {
    functionCache.delete(options.workspace);
  }
}

export function workspaceHasProgram(workspace: Blockly.Workspace): boolean {
  const start = workspace
    .getTopBlocks(false)
    .find((block) => block.type === "event_start");
  return Boolean(start?.getNextBlock());
}

export { EXECUTABLE_TYPES };
