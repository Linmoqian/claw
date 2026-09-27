/** 跨页面实验会话：采集、保存、恢复、导出与回放入口。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import { create } from "zustand";
import { useWorkspaceStore } from "../../../cad/workspaceStore";
import { useBridgeStore } from "../../../stores/bridgeStore";
import { findRobotEntry, useRobotStore } from "../../../stores/robotStore";
import { useActivityStore } from "../../workbench/runtime/activity";
import {
  awaitRuntimeReady,
  getRuntime,
  stopRuntime,
} from "../../workbench/runtime/runtime";
import {
  stopProgram,
  subscribeProgramEvents,
} from "../../workbench/runtime/programRunner";
import { ExperimentJournal } from "./journal";
import { experimentRepository } from "./repository";
import { sampleRuntime, toLegacyFrames } from "./sampling";
import type {
  ExperimentBundle,
  ExperimentExport,
  ExperimentRecord,
} from "./types";

interface ExperimentState {
  records: ExperimentRecord[];
  active: ExperimentRecord | null;
  lastSavedRecord: ExperimentRecord | null;
  sampleCount: number;
  elapsedS: number;
  saving: boolean;
  error: string | null;
  initialized: boolean;
  replayRecordId: string | null;
  initialize: () => Promise<void>;
  start: (name: string, source: "studio" | "blocks") => Promise<void>;
  finish: () => Promise<void>;
  dismissSaveNotice: () => void;
  retrySave: () => Promise<void>;
  exportActive: () => void;
  exportRecord: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  beginReplay: (id: string) => Promise<boolean>;
}

let initializing: Promise<void> | null = null;
let journal: ExperimentJournal | null = null;
let samplingTimer: number | null = null;
let writingTimer: number | null = null;
let unsubscribeProgram: (() => void) | null = null;
let startedAt = 0;
let replayOpening = false;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopCapture(): void {
  if (samplingTimer !== null) window.clearInterval(samplingTimer);
  if (writingTimer !== null) window.clearInterval(writingTimer);
  samplingTimer = null;
  writingTimer = null;
}

function interruptCapture(error: unknown): void {
  stopCapture();
  useActivityStore.setState({ recordingSuspended: true });
  stopProgram();
  stopRuntime();
  if (journal) {
    journal.bundle.record.status = "interrupted";
    journal.bundle.record.endedAt = Date.now();
    unsubscribeProgram?.();
    unsubscribeProgram = null;
    useExperimentStore.setState({
      active: { ...journal.bundle.record },
      saving: false,
    });
  }
  useExperimentStore.setState({
    error: `${errorText(error)}。未保存数据仍在当前会话，请重试保存或导出。`,
  });
}

function downloadBundle(bundle: ExperimentBundle): void {
  const file: ExperimentExport = {
    kind: "claw-experiment",
    version: 1,
    units: { position: "m", angle: "rad", time: "s" },
    ...bundle,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bundle.record.name.replace(/[<>:"/\\|?*]/g, "_")}.experiment.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  records: [],
  active: null,
  lastSavedRecord: null,
  sampleCount: 0,
  elapsedS: 0,
  saving: false,
  error: null,
  initialized: false,
  replayRecordId: null,

  initialize: async () => {
    if (get().initialized) return;
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const records = await experimentRepository.list();
        for (const record of records) {
          if (record.status !== "recording") continue;
          record.status = "interrupted";
          record.endedAt = record.createdAt + record.durationS * 1000;
          await experimentRepository.updateRecord(record);
        }
        set({ records, initialized: true, error: null });
      } catch (error) {
        set({ error: `无法读取实验记录：${errorText(error)}` });
      } finally {
        initializing = null;
      }
    })();
    return initializing;
  },

  start: async (name, source) => {
    if (get().active || get().saving || replayOpening) return;
    await get().initialize();
    if (get().active || get().saving) return;
    const runtime = getRuntime();
    const robot = useRobotStore.getState();
    const activity = useActivityStore.getState();
    if (activity.replayPreparing) {
      set({ error: "正在准备回放，请等待完成后再开始实验。" });
      return;
    }
    if (activity.serialTransition) {
      set({ error: "串口正在连接或断开，请稍候再开始实验。" });
      return;
    }
    if (
      activity.channelTransition ||
      useBridgeStore.getState().info.status === "connecting"
    ) {
      set({ error: "数据通道正在切换，请连接操作完成后再开始实验。" });
      return;
    }
    if (
      !runtime ||
      runtime.model !== robot.model ||
      robot.status !== "ready" ||
      !robot.currentId
    ) {
      set({ error: "机器人尚未就绪，请先进入仿真工作区完成加载。" });
      return;
    }
    if (
      useBridgeStore.getState().bridge.kind !== "simulation" ||
      activity.hardwareConnected
    ) {
      set({
        error:
          "实验采集使用仿真通道，请先退出回放并显式断开串口和 WebSocket 真机连接。",
      });
      return;
    }
    if (activity.programRunning) {
      set({ error: "请先停止当前程序，再开始实验，以完整保存本次程序快照。" });
      return;
    }
    const workspace = useWorkspaceStore.getState();
    const createdAt = Date.now();
    const record: ExperimentRecord = {
      id: crypto.randomUUID(),
      name:
        name.trim().slice(0, 80) ||
        `实验 ${new Date(createdAt).toLocaleString("zh-CN")}`,
      source,
      status: "recording",
      createdAt,
      endedAt: null,
      durationS: 0,
      sampleCount: 0,
      robotId: robot.currentId,
      robotLabel: findRobotEntry(robot.currentId)?.label ?? robot.currentId,
      sampleRateHz: 20,
    };
    journal = new ExperimentJournal(
      {
        record,
        snapshot: {
          jointMapping: runtime.model.active.map((joint) => ({
            name: joint.def.name,
            code: joint.code,
          })),
          scene: structuredClone({
            workspace: workspace.workspace,
            path: workspace.path,
          }),
          programRuns: [],
          logs: [],
        },
        samples: [],
      },
      experimentRepository.write,
    );
    const currentJournal = journal;
    useActivityStore.getState().setRecordingLocked(true);
    useActivityStore.setState({ recordingSuspended: true });
    set({
      active: { ...record },
      lastSavedRecord: null,
      sampleCount: 0,
      elapsedS: 0,
      saving: true,
      error: null,
    });
    try {
      await currentJournal.flush();
      startedAt = performance.now();
      const capture = (): boolean => {
        if (
          getRuntime() !== runtime ||
          useBridgeStore.getState().bridge.kind !== "simulation" ||
          useActivityStore.getState().hardwareConnected ||
          useActivityStore.getState().serialTransition
        ) {
          interruptCapture(new Error("采集机型或通道已改变，已停止本次实验"));
          return false;
        }
        const t = (performance.now() - startedAt) / 1000;
        currentJournal.append(sampleRuntime(runtime, t, Date.now()));
        set({ sampleCount: currentJournal.bundle.samples.length, elapsedS: t });
        return true;
      };
      unsubscribeProgram = subscribeProgramEvents((event) => {
        const t = (performance.now() - startedAt) / 1000;
        if (event.type === "start")
          currentJournal.bundle.snapshot.programRuns.push({
            startedAtS: t,
            snapshot: structuredClone(event.snapshot ?? null),
          });
        currentJournal.bundle.snapshot.logs.push({
          t,
          type: event.type,
          message:
            event.message ??
            {
              start: "程序开始",
              complete: "程序已完成，可结束并保存实验",
              stopped: "程序停止",
              error: "程序失败",
              log: "",
            }[event.type],
        });
      });
      if (!capture()) return;
      samplingTimer = window.setInterval(capture, 50);
      writingTimer = window.setInterval(() => {
        void currentJournal
          .flush()
          .then(() => {
            const committed = currentJournal.committedRecord;
            if (journal === currentJournal && committed)
              set({
                records: get().records.map((item) =>
                  item.id === committed.id ? committed : item,
                ),
              });
          })
          .catch(interruptCapture);
      }, 1000);
      useActivityStore.setState({ recordingSuspended: false });
      set({ saving: false, records: [{ ...record }, ...get().records] });
    } catch (error) {
      interruptCapture(error);
    }
  },

  finish: async () => {
    if (!journal || get().saving) return;
    stopCapture();
    useActivityStore.setState({ recordingSuspended: true });
    if (useActivityStore.getState().programRunning)
      journal.bundle.snapshot.logs.push({
        t: (performance.now() - startedAt) / 1000,
        type: "stopped",
        message: "结束实验，已请求停止程序和仿真运动",
      });
    stopProgram();
    stopRuntime();
    unsubscribeProgram?.();
    unsubscribeProgram = null;
    const currentJournal = journal;
    const wasInterrupted =
      currentJournal.bundle.record.status === "interrupted";
    currentJournal.bundle.record.endedAt = Date.now();
    currentJournal.bundle.record.status = wasInterrupted
      ? "interrupted"
      : "saved";
    set({ saving: true, error: null });
    try {
      await currentJournal.flush();
      const saved = { ...currentJournal.bundle.record };
      set({
        active: null,
        lastSavedRecord: saved,
        saving: false,
        error: null,
        records: [
          saved,
          ...get().records.filter((item) => item.id !== saved.id),
        ],
      });
      journal = null;
      useActivityStore.getState().setRecordingLocked(false);
      useActivityStore.setState({ recordingSuspended: false });
    } catch (error) {
      interruptCapture(error);
    }
  },

  retrySave: async () => {
    if (journal) await get().finish();
    else await get().initialize();
  },

  dismissSaveNotice: () => set({ lastSavedRecord: null }),

  exportActive: () => {
    if (journal) downloadBundle(journal.bundle);
  },

  exportRecord: async (id) => {
    try {
      if (journal?.bundle.record.id === id) {
        downloadBundle(journal.bundle);
        return;
      }
      const bundle = await experimentRepository.get(id);
      if (!bundle) throw new Error("找不到此实验记录");
      downloadBundle(bundle);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  rename: async (id, name) => {
    const record = get().records.find((item) => item.id === id);
    if (!record || !name.trim() || get().active?.id === id) return;
    try {
      const updated = { ...record, name: name.trim().slice(0, 80) };
      await experimentRepository.updateRecord(updated);
      set({
        records: get().records.map((item) => (item.id === id ? updated : item)),
        error: null,
      });
    } catch (error) {
      set({ error: `改名失败：${errorText(error)}` });
    }
  },

  beginReplay: async (id) => {
    if (replayOpening || useActivityStore.getState().replayPreparing)
      return false;
    let preparationOwned = false;
    try {
      if (get().active) throw new Error("请先结束并保存当前实验，再进入回放。");
      const activity = useActivityStore.getState();
      const bridge = useBridgeStore.getState();
      if (activity.serialTransition)
        throw new Error("串口正在连接或断开，请稍候再回放。");
      if (activity.channelTransition || bridge.info.status === "connecting")
        throw new Error("数据通道正在切换，请等待连接操作完成后再回放。");
      if (
        activity.hardwareConnected ||
        (bridge.bridge.kind !== "simulation" &&
          bridge.bridge.kind !== "replay" &&
          bridge.info.status !== "offline")
      )
        throw new Error(
          "请先断开串口和 WebSocket 真机连接，再进入回放。",
        );
      const runtime = getRuntime();
      const motion = runtime?.sim.getSnapshot();
      const baseMotion = runtime?.baseSim.getSnapshot();
      if (
        activity.programRunning ||
        runtime?.baseSim.isPlaying ||
        (baseMotion &&
          (Math.hypot(
            baseMotion.current.x - baseMotion.target.x,
            baseMotion.current.y - baseMotion.target.y,
          ) > 0.00001 ||
            Math.abs(baseMotion.current.yaw - baseMotion.target.yaw) >
              0.00001)) ||
        motion?.mode === "play" ||
        motion?.currentDeg.some(
          (angle, index) => Math.abs(angle - motion.targetDeg[index]) > 0.01,
        )
      )
        throw new Error("请先停止正在运行的程序和仿真运动，再进入回放。");
      replayOpening = true;
      preparationOwned = true;
      useActivityStore.setState({ replayPreparing: true });
      if (bridge.replay) bridge.replayControl("pause");
      const bundle = await experimentRepository.get(id);
      if (!bundle || !bundle.samples.length)
        throw new Error("此记录没有可回放的运动帧。");
      await useRobotStore
        .getState()
        .loadRobot(bundle.record.robotId, { replayPreparation: true });
      const robot = useRobotStore.getState();
      if (
        robot.status !== "ready" ||
        !robot.model ||
        robot.currentId !== bundle.record.robotId
      )
        throw new Error("记录机型加载失败，请重试。");
      await awaitRuntimeReady(robot.model);
      useWorkspaceStore.setState({
        workspace: structuredClone(bundle.snapshot.scene.workspace),
        path: structuredClone(bundle.snapshot.scene.path),
        source: bundle.snapshot.scene.workspace ? "实验场景快照" : null,
      });
      await useBridgeStore
        .getState()
        .enterReplay(toLegacyFrames(bundle.samples), {
          replayPreparation: true,
        });
      set({ replayRecordId: id, error: null });
      return true;
    } catch (error) {
      set({ error: errorText(error) });
      return false;
    } finally {
      replayOpening = false;
      if (preparationOwned)
        useActivityStore.setState({ replayPreparing: false });
    }
  },
}));

useBridgeStore.subscribe((state) => {
  if (!state.replay && useExperimentStore.getState().replayRecordId)
    useExperimentStore.setState({ replayRecordId: null });
});
