/**
 * 可保存法兰工具档案；本地保存仅含结构参数，不包含秘钥或个人数据。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import type { ToolProfile } from "./types";

const TOOL_STORAGE_KEY = "xiakao:block-tool-profiles:v1";
const ACTIVE_TOOL_KEY = "xiakao:block-active-tool:v1";

export const DEFAULT_TOOL_PROFILES: ToolProfile[] = [
  {
    id: "end_effector",
    name: "末端原点",
    position: { x: 0, y: 0, z: 0 },
    rpy: { x: 0, y: 0, z: 0 },
    maxPayloadKg: 0.2,
  },
  {
    id: "gripper_tip",
    name: "夹爪尖端",
    position: { x: 0, y: 0, z: 0.055 },
    rpy: { x: 0, y: 0, z: 0 },
    maxPayloadKg: 0.2,
  },
  {
    id: "camera_mount",
    name: "法兰相机",
    position: { x: 0.008, y: -0.012, z: 0.048 },
    rpy: { x: -0.2704, y: 0.6785, z: -0.8843 },
    maxPayloadKg: 0.1,
  },
];

export function readToolProfiles(): ToolProfile[] {
  if (typeof window === "undefined") return DEFAULT_TOOL_PROFILES;
  try {
    const raw = window.localStorage.getItem(TOOL_STORAGE_KEY);
    if (!raw) return DEFAULT_TOOL_PROFILES;
    const parsed = JSON.parse(raw) as ToolProfile[];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : DEFAULT_TOOL_PROFILES;
  } catch {
    return DEFAULT_TOOL_PROFILES;
  }
}

export function saveToolProfiles(profiles: ToolProfile[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // 隐私模式下运行时可继续使用默认档案。
  }
}

export function readActiveToolId(): string {
  if (typeof window === "undefined") return DEFAULT_TOOL_PROFILES[0].id;
  return (
    window.localStorage.getItem(ACTIVE_TOOL_KEY) ?? DEFAULT_TOOL_PROFILES[0].id
  );
}

export function saveActiveToolId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_TOOL_KEY, id);
  } catch {
    // 忽略本地持久化失败。
  }
}

export function findTool(id: string): ToolProfile {
  return (
    readToolProfiles().find((tool) => tool.id === id) ??
    DEFAULT_TOOL_PROFILES[0]
  );
}
