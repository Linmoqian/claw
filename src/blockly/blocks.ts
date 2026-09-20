/**
 * BlockLab 自定义积木定义；编程语言积木复用 Blockly 内建实现。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import * as Blockly from "blockly/core";
import * as ZhHans from "blockly/msg/zh-hans";
import { ROBOT_CATALOG } from "../stores/robotStore";
import { DEFAULT_TOOL_PROFILES } from "./toolProfiles";

const JOINTS = [
  ["J1 底部旋转", "0"],
  ["J2 大臂升降", "1"],
  ["J3 肘部弯曲", "2"],
  ["J4 手腕俯仰", "3"],
  ["J5 手腕旋转", "4"],
  ["J6 夹爪", "5"],
];

let registered = false;

export function registerBlockLabBlocks(): void {
  if (registered) return;
  registered = true;
  // 重复调用发生在 React Strict Mode；Blockly 会合并注册，因此这里仅保证语言包先设置。
  if (
    typeof (Blockly as unknown as { setLocale?: (locale: unknown) => void })
      .setLocale === "function"
  ) {
    (Blockly as unknown as { setLocale: (locale: unknown) => void }).setLocale(
      ZhHans,
    );
  }
  Blockly.defineBlocksWithJsonArray([
    {
      type: "event_start",
      message0: "开始运行",
      nextStatement: null,
      colour: "#D39B2F",
      tooltip: "程序从这里开始。",
    },
    {
      type: "select_arm",
      message0: "使用机械臂 %1",
      args0: [
        {
          type: "field_dropdown",
          name: "ARM_ID",
          options: ROBOT_CATALOG.map(({ id, label }) => [label, id]),
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "sense_color",
      message0: "看见颜色 %1",
      args0: [
        {
          type: "field_dropdown",
          name: "COLOR",
          options: [
            ["红色", "RED"],
            ["蓝色", "BLUE"],
            ["黄色", "YELLOW"],
          ],
        },
      ],
      output: "Boolean",
      colour: "#278F88",
    },
    {
      type: "camera_capture",
      message0: "获取摄像头画面",
      previousStatement: null,
      nextStatement: null,
      colour: "#4A7FD6",
    },
    {
      type: "lidar_scan",
      message0: "获取点云",
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "decision_if",
      message0: "如果 %1",
      args0: [{ type: "input_value", name: "CONDITION", check: "Boolean" }],
      message1: "那么 %1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      nextStatement: null,
      colour: "#686CC4",
    },
    {
      type: "move_steps",
      message0: "向前走 %1 格",
      args0: [
        {
          type: "field_number",
          name: "STEPS",
          value: 2,
          min: 1,
          max: 5,
          precision: 1,
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "turn_left",
      message0: "向左转",
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "turn_right",
      message0: "向右转",
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "grab_object",
      message0: "夹住目标",
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "stop_robot",
      message0: "停止",
      previousStatement: null,
      nextStatement: null,
      colour: "#B85A54",
    },

    {
      type: "arm_home",
      message0: "机械臂回零",
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "arm_joint_angle",
      message0: "关节 %1 角度 %2 ° 速度 %3 °/s",
      args0: [
        { type: "field_dropdown", name: "JOINT", options: JOINTS },
        { type: "field_number", name: "ANGLE", value: 0, min: -180, max: 220 },
        { type: "field_number", name: "SPEED", value: 80, min: 5, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "arm_joint_angles",
      message0: "多关节角度 %1 °/s %2",
      args0: [
        { type: "field_input", name: "ANGLES", text: "0, 20, -20, 10, 0, 40" },
        { type: "field_number", name: "SPEED", value: 80, min: 5, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "arm_pose",
      message0: "移动到 X %1 Y %2 Z %3 m RPY %4 %5 %6 ° 速度 %7 °/s",
      args0: [
        {
          type: "field_number",
          name: "X",
          value: 0.16,
          min: -1,
          max: 1,
          precision: 0.001,
        },
        {
          type: "field_number",
          name: "Y",
          value: 0,
          min: -1,
          max: 1,
          precision: 0.001,
        },
        {
          type: "field_number",
          name: "Z",
          value: 0.12,
          min: -1,
          max: 1,
          precision: 0.001,
        },
        { type: "field_number", name: "ROLL", value: 0, min: -180, max: 180 },
        { type: "field_number", name: "PITCH", value: 0, min: -180, max: 180 },
        { type: "field_number", name: "YAW", value: 0, min: -180, max: 180 },
        { type: "field_number", name: "SPEED", value: 80, min: 5, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "gripper_open_percent",
      message0: "夹爪张开 %1 %% 速度 %2 °/s",
      args0: [
        { type: "field_number", name: "PERCENT", value: 80, min: 0, max: 100 },
        { type: "field_number", name: "SPEED", value: 80, min: 5, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },
    {
      type: "motor_speed",
      message0: "设置默认电机速度 %1 °/s",
      args0: [
        { type: "field_number", name: "SPEED", value: 80, min: 5, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "motor_torque",
      message0: "扭矩 %1",
      args0: [
        {
          type: "field_dropdown",
          name: "ON",
          options: [
            ["使能", "1"],
            ["失能", "0"],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#E47B36",
    },
    {
      type: "read_joints",
      message0: "读取关节角度",
      output: "Number[]",
      colour: "#5D68A6",
    },
    {
      type: "read_tcp",
      message0: "读取 TCP 位姿",
      output: "Pose",
      colour: "#5D68A6",
    },
    {
      type: "select_tool",
      message0: "使用法兰工具 %1",
      args0: [
        {
          type: "field_dropdown",
          name: "TOOL_ID",
          options: DEFAULT_TOOL_PROFILES.map(({ id, name }) => [name, id]),
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#7C66CE",
    },

    {
      type: "camera_detect_color",
      message0: "识别颜色 %1 最小面积 %2",
      args0: [
        {
          type: "field_dropdown",
          name: "COLOR",
          options: [
            ["红色", "RED"],
            ["蓝色", "BLUE"],
            ["黄色", "YELLOW"],
            ["绿色", "GREEN"],
          ],
        },
        {
          type: "field_number",
          name: "MIN_AREA",
          value: 500,
          min: 20,
          max: 200000,
        },
      ],
      output: "Detection",
      colour: "#4A7FD6",
    },
    {
      type: "camera_target_pose",
      message0: "目标宽度 %1 m 的 PnP 位姿",
      args0: [
        {
          type: "field_number",
          name: "WIDTH_M",
          value: 0.04,
          min: 0.002,
          max: 2,
          precision: 0.001,
        },
      ],
      output: "Pose",
      colour: "#4A7FD6",
    },
    {
      type: "calibrate_joints",
      message0: "执行关节校准",
      output: "Calibration",
      colour: "#278F88",
    },
    {
      type: "calibrate_eye_hand",
      message0: "执行手眼标定",
      output: "Calibration",
      colour: "#278F88",
    },

    {
      type: "pose_make",
      message0: "位姿 X %1 Y %2 Z %3 Roll %4 Pitch %5 Yaw %6 °",
      args0: [
        { type: "field_number", name: "X", value: 0.16, precision: 0.001 },
        { type: "field_number", name: "Y", value: 0, precision: 0.001 },
        { type: "field_number", name: "Z", value: 0.12, precision: 0.001 },
        { type: "field_number", name: "ROLL", value: 0 },
        { type: "field_number", name: "PITCH", value: 0 },
        { type: "field_number", name: "YAW", value: 0 },
      ],
      output: "Pose",
      colour: "#686CC4",
    },
    {
      type: "pose_property",
      message0: "取位姿 %1 的 %2",
      args0: [
        { type: "input_value", name: "POSE", check: "Pose" },
        {
          type: "field_dropdown",
          name: "PROPERTY",
          options: [
            ["X", "X"],
            ["Y", "Y"],
            ["Z", "Z"],
            ["Roll", "ROLL"],
            ["Pitch", "PITCH"],
            ["Yaw", "YAW"],
          ],
        },
      ],
      output: "Number",
      inputsInline: true,
      colour: "#686CC4",
    },
    {
      type: "pose_compose",
      message0: "组合位姿 %1 × %2",
      args0: [
        { type: "input_value", name: "PARENT", check: "Pose" },
        { type: "input_value", name: "CHILD", check: "Pose" },
      ],
      output: "Pose",
      inputsInline: true,
      colour: "#686CC4",
    },
    {
      type: "pose_inverse",
      message0: "求逆位姿 %1",
      args0: [{ type: "input_value", name: "POSE", check: "Pose" }],
      output: "Pose",
      colour: "#686CC4",
    },
    {
      type: "camera_pose_to_base",
      message0: "相机位姿转基座 %1",
      args0: [{ type: "input_value", name: "POSE", check: "Pose" }],
      output: "Pose",
      colour: "#686CC4",
    },

    {
      type: "serial_open",
      message0: "打开串口 %1 波特率 %2",
      args0: [
        { type: "field_input", name: "PORT", text: "COM3" },
        {
          type: "field_dropdown",
          name: "BAUD",
          options: [
            ["9600", "9600"],
            ["57600", "57600"],
            ["115200", "115200"],
            ["1000000", "1000000"],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "serial_close",
      message0: "关闭串口",
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "serial_send",
      message0: "串口发送 %1",
      args0: [{ type: "input_value", name: "PAYLOAD", check: "String" }],
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "serial_read_line",
      message0: "串口读取一行",
      output: "String",
      colour: "#0F9BA8",
    },

    {
      type: "pin_mode",
      message0: "引脚 %1 模式 %2",
      args0: [
        {
          type: "field_number",
          name: "PIN",
          value: 2,
          min: 0,
          max: 99,
          precision: 1,
        },
        {
          type: "field_dropdown",
          name: "MODE",
          options: [
            ["输入", "input"],
            ["输入上拉", "input_pullup"],
            ["输出", "output"],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "digital_write",
      message0: "数字写引脚 %1 值 %2",
      args0: [
        {
          type: "field_number",
          name: "PIN",
          value: 2,
          min: 0,
          max: 99,
          precision: 1,
        },
        {
          type: "field_dropdown",
          name: "VALUE",
          options: [
            ["高", "1"],
            ["低", "0"],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "digital_read",
      message0: "数字读引脚 %1",
      args0: [
        {
          type: "field_number",
          name: "PIN",
          value: 2,
          min: 0,
          max: 99,
          precision: 1,
        },
      ],
      output: "Boolean",
      colour: "#0F9BA8",
    },
    {
      type: "analog_write",
      message0: "模拟写引脚 %1 值 %2",
      args0: [
        {
          type: "field_number",
          name: "PIN",
          value: 9,
          min: 0,
          max: 99,
          precision: 1,
        },
        {
          type: "field_number",
          name: "VALUE",
          value: 128,
          min: 0,
          max: 255,
          precision: 1,
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#0F9BA8",
    },
    {
      type: "analog_read",
      message0: "模拟读引脚 %1",
      args0: [
        {
          type: "field_number",
          name: "PIN",
          value: 0,
          min: 0,
          max: 99,
          precision: 1,
        },
      ],
      output: "Number",
      colour: "#0F9BA8",
    },
  ]);
}
