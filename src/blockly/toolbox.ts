/**
 * BlockLab 工具箱：程序语言、机器人、视觉与标定分组。
 *
 * Created on 2026-09-21; updated on 2026-09-27
 * @author:  https://github.com/Linmoqian
 */

export const BLOCK_TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "开始",
      colour: "#D39B2F",
      contents: [{ kind: "block", type: "event_start" }],
    },
    {
      kind: "category",
      name: "机械臂",
      colour: "#7C66CE",
      contents: [
        { kind: "block", type: "select_arm" },
        { kind: "block", type: "arm_home" },
        { kind: "block", type: "arm_joint_angle" },
        { kind: "block", type: "arm_joint_angles" },
        { kind: "block", type: "arm_pose" },
        { kind: "block", type: "gripper_open_percent" },
        { kind: "block", type: "read_joints" },
        { kind: "block", type: "read_tcp" },
        { kind: "block", type: "select_tool" },
      ],
    },
    {
      kind: "category",
      name: "电机",
      colour: "#E47B36",
      contents: [
        { kind: "block", type: "motor_speed" },
        { kind: "block", type: "motor_torque" },
        { kind: "block", type: "stop_robot" },
      ],
    },
    {
      kind: "category",
      name: "相机",
      colour: "#4A7FD6",
      contents: [
        { kind: "block", type: "camera_capture" },
        { kind: "block", type: "camera_detect_color" },
        { kind: "block", type: "camera_target_pose" },
        { kind: "block", type: "sense_color" },
      ],
    },
    {
      kind: "category",
      name: "标定",
      colour: "#278F88",
      contents: [
        { kind: "block", type: "calibrate_joints" },
        { kind: "block", type: "calibrate_eye_hand" },
        { kind: "block", type: "camera_pose_to_base" },
      ],
    },
    {
      kind: "category",
      name: "位姿",
      colour: "#686CC4",
      contents: [
        { kind: "block", type: "pose_make" },
        { kind: "block", type: "pose_property" },
        { kind: "block", type: "pose_compose" },
        { kind: "block", type: "pose_inverse" },
      ],
    },
    {
      kind: "category",
      name: "逻辑",
      colour: "#5C81A6",
      contents: [
        { kind: "block", type: "controls_if" },
        { kind: "block", type: "logic_compare" },
        { kind: "block", type: "logic_operation" },
        { kind: "block", type: "logic_negate" },
        { kind: "block", type: "logic_boolean" },
      ],
    },
    {
      kind: "category",
      name: "循环",
      colour: "#5BA55B",
      contents: [
        { kind: "block", type: "controls_repeat_ext" },
        { kind: "block", type: "controls_whileUntil" },
        { kind: "block", type: "controls_for" },
        { kind: "block", type: "controls_forEach" },
      ],
    },
    {
      kind: "category",
      name: "数学",
      colour: "#5B67A5",
      contents: [
        { kind: "block", type: "math_number" },
        { kind: "block", type: "math_arithmetic" },
        { kind: "block", type: "math_single" },
      ],
    },
    {
      kind: "category",
      name: "文本",
      colour: "#5BA58C",
      contents: [
        { kind: "block", type: "text" },
        { kind: "block", type: "text_join" },
      ],
    },
    { kind: "category", name: "变量", colour: "#A55B80", custom: "VARIABLE" },
    { kind: "category", name: "函数", colour: "#995BA5", custom: "PROCEDURE" },
  ],
};
