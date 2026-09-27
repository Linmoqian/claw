// Rust 程序动作请求到仿真设备网关的边界。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import type { BlockDeviceGateway, PinMode, PoseValue } from "./types";

function value(args: Record<string, unknown>, key: string): unknown {
  if (!(key in args)) throw new Error(`程序动作缺少参数：${key}`);
  return args[key];
}
function number(args: Record<string, unknown>, key: string): number {
  const result = Number(value(args, key));
  if (!Number.isFinite(result)) throw new Error(`程序动作参数无效：${key}`);
  return result;
}
function text(args: Record<string, unknown>, key: string): string {
  return String(value(args, key));
}
function pose(args: Record<string, unknown>, key: string): PoseValue {
  const raw = value(args, key);
  if (!raw || typeof raw !== "object" || !("position" in raw) || !("quaternion" in raw))
    throw new Error("程序位姿参数无效");
  return raw as PoseValue;
}

export async function dispatchDesktopProgramAction(
  gateway: BlockDeviceGateway,
  op: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (op) {
    case "select_arm": return gateway.selectArm(text(args, "robotId"));
    case "arm_home": return gateway.home();
    case "arm_joint_angle": return gateway.setJointAngleDeg(number(args, "index"), number(args, "angleDeg"), number(args, "speed"));
    case "arm_joint_angles": {
      const angles = value(args, "anglesDeg");
      if (!Array.isArray(angles) || angles.some((angle) => !Number.isFinite(angle)))
        throw new Error("多关节角度列表无效");
      return gateway.setJointAnglesDeg(angles as number[], number(args, "speed"));
    }
    case "arm_pose": return gateway.movePose(pose(args, "target"), number(args, "speed"));
    case "gripper_open_percent": return gateway.setGripperOpenPercent(number(args, "percent"), number(args, "speed"));
    case "motor_speed": return gateway.setSpeedDegPerSec(number(args, "speed"));
    case "motor_torque": return gateway.setTorque(Boolean(value(args, "enabled")));
    case "stop_robot": return gateway.stop();
    case "select_tool": return gateway.setTool(text(args, "toolId"));
    case "camera_capture": return Boolean(await gateway.captureCameraFrame());
    case "lidar_scan": return null;
    case "serial_open": return gateway.serialOpen({ port: text(args, "port"), baud: number(args, "baud") });
    case "serial_close": return gateway.serialClose();
    case "serial_send": return gateway.serialSend(text(args, "payload"));
    case "pin_mode": return gateway.pinMode(number(args, "pin"), text(args, "mode") as PinMode);
    case "digital_write": return gateway.digitalWrite(number(args, "pin"), number(args, "value") as 0 | 1);
    case "analog_write": return gateway.analogWrite(number(args, "pin"), number(args, "value"));
    case "read_joints": return gateway.readJointAnglesDeg();
    case "read_tcp": return gateway.readTcpPose();
    case "camera_detect_color": return gateway.detectColor(text(args, "color"), number(args, "minArea"));
    case "camera_target_pose": return gateway.detectTargetPoseM(number(args, "widthM"));
    case "calibrate_joints": return gateway.calibrateJoints();
    case "calibrate_eye_hand": return gateway.calibrateEyeHand();
    case "camera_pose_to_base": return gateway.transformCameraPoseToBase(pose(args, "target"));
    case "serial_read_line": return gateway.serialReadLine(number(args, "timeoutMs"));
    case "digital_read": return (await gateway.digitalRead(number(args, "pin"))) === 1;
    case "analog_read": return gateway.analogRead(number(args, "pin"));
    case "sense_color": return (await gateway.detectColor(text(args, "color"), 500)) !== null;
    case "turn_left": return gateway.setJointAngleDeg(0, -20, 60);
    case "turn_right": return gateway.setJointAngleDeg(0, 20, 60);
    case "grab_object": return gateway.setGripperOpenPercent(5, 80);
    default: throw new Error(`不支持的桌面程序动作：${op}`);
  }
}
