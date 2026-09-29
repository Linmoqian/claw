// Rust 仿真状态流的纯帧流访问：类型、订阅与桌面环境探测。
// 连接生命周期（connectDesktopRuntime）由 features/workbench/runtime 负责，
// 该文件只保存最新帧与监听器，供渲染层（three/）与实验域零业务依赖地读取。
// Created on 2026-09-29; Updated on 2026-09-29 @author: https://github.com/Linmoqian
import { isTauri } from "@tauri-apps/api/core";
import type { SimMode } from "../robot/simulation";
import type { BasePose } from "../robot/baseSim";
import type { CollisionStatus } from "../robot/collision";

export interface PropPose {
  id: string;
  position_m: [number, number, number];
  rotation_xyzw: [number, number, number, number];
}

export interface SimulationFrame {
  version: number;
  robotId: string;
  sequence: number;
  timestampMs: number;
  jointsRad: number[];
  targetRad: number[];
  mode: SimMode;
  speed: number;
  progress: number;
  base: BasePose;
  tcpPositionM: [number, number, number];
  props: PropPose[];
  collision: CollisionStatus;
}

let latestFrame: SimulationFrame | null = null;
const frameListeners = new Set<(frame: SimulationFrame) => void>();
let pauseControl: ((paused: boolean) => void) | null = null;

export function getDesktopFrame(): SimulationFrame | null {
  return latestFrame;
}

export function subscribeDesktopFrames(listener: (frame: SimulationFrame) => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** 由连接方注册/清除暂停控制；帧流层不关心实现 */
export function registerDesktopPauseControl(control: ((paused: boolean) => void) | null): void {
  pauseControl = control;
}

export function setDesktopPaused(paused: boolean): void {
  pauseControl?.(paused);
}

export function desktopRuntimeEnabled(): boolean {
  return isTauri();
}

/** 连接方在收到帧时统一走这里分发，保证订阅者看到单调递增的 sequence */
export function publishDesktopFrame(frame: SimulationFrame): void {
  latestFrame = frame;
  for (const listener of frameListeners) listener(frame);
}

/** 连接关闭时清空帧流状态，避免渲染层读到陈旧帧 */
export function clearDesktopFrame(): void {
  latestFrame = null;
}
