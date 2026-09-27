// 脱离页面生命周期执行积木程序快照。Created on 2026-09-26
// @author: https://github.com/Linmoqian
import type * as Blockly from "blockly/core";
import "blockly/blocks";
import { create } from "zustand";
import { executeWorkspace, ExecutionAborted, workspaceHasProgram, type LogKind } from "../blockly/interpreter";
import { registerBlockLabBlocks } from "../blockly/blocks";
import { SimulationDeviceGateway } from "../blockly/simulationGateway";
import type { BlockDeviceGateway, Detection } from "../blockly/types";
import { useBridgeStore } from "../stores/bridgeStore";
import { useRobotStore } from "../stores/robotStore";
import { useActivityStore } from "./activity";
import { awaitRuntimeReady, getRuntime, stopRuntime } from "./runtime";
import { createProgramSnapshot } from "./programSnapshot";

export type ProgramStatus = "idle" | "running" | "complete" | "error" | "stopped";
export interface ProgramLog { time: string; text: string; kind: LogKind }
export interface ProgramEvent {
  type: "start" | "log" | "complete" | "stopped" | "error";
  snapshot?: unknown;
  message?: string;
}
interface ProgramState {
  status: ProgramStatus;
  logs: ProgramLog[];
  lastDetection: Detection | null;
}
export const useProgramStore = create<ProgramState>(() => ({
  status: "idle", logs: [], lastDetection: null,
}));
const listeners = new Set<(event: ProgramEvent) => void>();
let controller: AbortController | null = null;
let activeGateway: BlockDeviceGateway | null = null;

export function subscribeProgramEvents(listener: (event: ProgramEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(event: ProgramEvent): void {
  for (const listener of listeners) listener(event);
}
export function appendProgramLog(text: string, kind: LogKind = "event"): void {
  useProgramStore.setState((state) => ({ logs: [...state.logs.slice(-199), {
    text, kind, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  }] }));
  emit({ type: "log", message: text });
}
export function stopProgram(): void {
  controller?.abort();
  if (activeGateway) void activeGateway.stop().catch(() => undefined);
  stopRuntime();
}
export function resetProgramStatus(): void {
  if (controller) return;
  useProgramStore.setState({ status: "idle", logs: [], lastDetection: null });
}
export async function runProgram(source: Blockly.Workspace): Promise<void> {
  if (controller) return;
  const bridge = useBridgeStore.getState();
  const activity = useActivityStore.getState();
  if (activity.replayPreparing) {
    appendProgramLog("正在准备回放，请等待完成后运行", "warning");
    return;
  }
  if (activity.recordingSuspended) {
    appendProgramLog("实验正在保存或等待保存重试，请完成保存后再运行", "warning");
    return;
  }
  if (activity.serialTransition) {
    appendProgramLog("串口正在连接或断开，请稍候再运行", "warning");
    return;
  }
  if (activity.hardwareConnected) {
    appendProgramLog("真机串口已连接，请先断开单电机调试再运行仿真程序", "warning");
    return;
  }
  if (bridge.replay || bridge.bridge.kind !== "simulation" || activity.channelTransition) {
    appendProgramLog("请退出回放或断开遥测链路后运行积木程序", "warning");
    return;
  }
  if (!workspaceHasProgram(source)) {
    appendProgramLog("开始积木后没有可执行动作", "warning");
    return;
  }
  registerBlockLabBlocks();
  let frozen: ReturnType<typeof createProgramSnapshot>;
  try {
    frozen = createProgramSnapshot(source);
  } catch (error: unknown) {
    useProgramStore.setState({ status: "error" });
    appendProgramLog(error instanceof Error ? error.message : "无法创建程序快照", "error");
    return;
  }
  const { snapshot, workspace } = frozen;
  const runController = new AbortController();
  controller = runController;
  useActivityStore.setState({ programRunning: true });
  useProgramStore.setState({ status: "running" });
  try {
    const onDetection = (lastDetection: Detection) => useProgramStore.setState({ lastDetection });
    const model = useRobotStore.getState().model;
    if (!model) throw new Error("请等待机械臂模型就绪");
    activeGateway = new SimulationDeviceGateway({
        getRuntime,
        getModel: () => useRobotStore.getState().model,
        selectArm: async (robotId) => {
          const current = useRobotStore.getState();
          if (activity.recordingLocked && current.currentId !== robotId)
            throw new Error("实验采集中不能切换机型，请先结束实验");
          await current.loadRobot(robotId);
          const loaded = useRobotStore.getState();
          if (loaded.currentId !== robotId || loaded.status !== "ready")
            throw new Error(loaded.error ?? "机械臂模型加载失败");
          await awaitRuntimeReady(loaded.model);
        },
        onDetection,
      });
    stopRuntime();
    emit({ type: "start", snapshot });
    appendProgramLog("仿真程序开始运行；视觉使用合成图像");
    await executeWorkspace({ workspace, gateway: activeGateway, signal: runController.signal, log: appendProgramLog });
    if (runController.signal.aborted) throw new ExecutionAborted();
    useProgramStore.setState({ status: "complete" });
    appendProgramLog(useActivityStore.getState().recordingLocked
      ? "程序已完成，实验仍在采集；请结束实验保存记录" : "程序已完成", "success");
    emit({ type: "complete" });
  } catch (error: unknown) {
    const aborted = error instanceof ExecutionAborted || runController.signal.aborted;
    const message = aborted ? "程序已停止" : error instanceof Error ? error.message : "程序执行失败";
    useProgramStore.setState({ status: aborted ? "stopped" : "error" });
    appendProgramLog(message, aborted ? "warning" : "error");
    emit({ type: aborted ? "stopped" : "error", message });
    if (activeGateway) await activeGateway.stop().catch(() => undefined);
  } finally {
    workspace.dispose();
    activeGateway = null;
    controller = null;
    useActivityStore.setState({ programRunning: false });
  }
}
