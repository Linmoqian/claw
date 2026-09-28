/**
 * recording —— 录像帧格式与导入导出（录制回放功能的数据层）。
 * 帧直接录 RobotState 快照（底盘位姿 + 关节角），回放侧逐帧重建。
 *
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import type { RobotState } from "../../core/world/state";

/** 录像文件格式版本 */
export const RECORDING_VERSION = 1;

/** 单帧（相对录像起点的秒数） */
export interface RecFrame {
  t: number;
  pose: { x: number; y: number; z: number; yaw: number };
  /** 关节角（°；键 = URDF 关节名或 J1..J6 面板代号） */
  joints: Record<string, number>;
}

/** 录像文件（JSON 序列化形态） */
export interface RecordingFile {
  version: number;
  kind: "claw-recording";
  /** 采样标称频率（Hz，信息性字段；回放按帧时间戳插值） */
  fps: number;
  /** 录制时间（epoch ms，信息性） */
  recordedAt: number;
  frames: RecFrame[];
}

/** 录像总时长（s） */
export function recordingDuration(frames: RecFrame[]): number {
  return frames.length > 0 ? frames[frames.length - 1].t : 0;
}

/** JSON 文本 → 录像（结构校验，失败抛错） */
export function parseRecording(text: string): RecordingFile {
  const raw: unknown = JSON.parse(text);
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as RecordingFile).kind !== "claw-recording" ||
    !Array.isArray((raw as RecordingFile).frames)
  ) {
    throw new Error("不是合法的 claw 录像文件");
  }
  const file = raw as RecordingFile;
  if (file.version !== RECORDING_VERSION) throw new Error("不支持的录像版本");
  if (
    !Number.isFinite(file.fps) ||
    file.fps <= 0 ||
    !Number.isFinite(file.recordedAt)
  )
    throw new Error("录像元信息损坏");
  if (file.frames.length === 0) throw new Error("录像是空的");
  let previousTime = -Infinity;
  for (const f of file.frames) {
    if (
      !f ||
      !Number.isFinite(f.t) ||
      f.t < 0 ||
      f.t <= previousTime ||
      !f.pose ||
      ![f.pose.x, f.pose.y, f.pose.z, f.pose.yaw].every(Number.isFinite) ||
      !f.joints ||
      typeof f.joints !== "object" ||
      Array.isArray(f.joints) ||
      !Object.values(f.joints).every(Number.isFinite)
    ) {
      throw new Error("录像帧结构损坏");
    }
    previousTime = f.t;
  }
  return file;
}

/** RobotState → 帧（关节默认取调用方注入的关节读数） */
export function frameFromRobotState(
  t: number,
  robot: RobotState,
  joints: Record<string, number>,
): RecFrame {
  const p = robot.pose.position;
  const q = robot.pose.orientation;
  // 平面航向从四元数提取（与 world 侧 Z-up 语义一致）
  const yaw = Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z),
  );
  return { t, pose: { x: p.x, y: p.y, z: p.z, yaw }, joints };
}

/** 触发浏览器下载（Blob + a[download]） */
export function downloadRecording(file: RecordingFile, name: string): void {
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
