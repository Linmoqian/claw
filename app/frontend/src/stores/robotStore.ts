// 机器人模型加载与实验期间机型锁。Created on 2026-09-26; Updated on 2026-09-27
// @author: https://github.com/Linmoqian
import { create } from "zustand";
import { buildRobotModel } from "../robot/model";
import { parseUrdf } from "../robot/urdf";
import type { RobotDef, RobotModel } from "../robot/types";
import { useActivityStore } from "../features/workbench/runtime/activity";

type LoadStatus = "idle" | "loading" | "ready" | "error";
/** 可选机型条目（id = public/models 下的目录名） */
export interface RobotCatalogEntry {
  id: string;
  /** 界面显示名 */
  label: string;
  /** URDF 路径（相对 public/） */
  urdfPath: string;
  /** STL 资源根目录（相对 public/，供网格文件加载） */
  assetBase: string;
}

/** 内置机型目录：public/models 下两种机械臂 */
export const ROBOT_CATALOG: RobotCatalogEntry[] = [
  {
    id: "so100",
    label: "SO-100",
    urdfPath: "models/so100/so100.urdf",
    assetBase: "models/so100",
  },
  {
    id: "111",
    label: "Panthera HT",
    urdfPath: "models/111/urdf/panthera_ht_ros_description.urdf",
    assetBase: "models/111",
  },
];

/** 默认机型（首次进入自动加载） */
export const DEFAULT_ROBOT_ID = "so100";

/** 按 id 查机型条目 */
export function findRobotEntry(id: string): RobotCatalogEntry | undefined {
  return ROBOT_CATALOG.find((e) => e.id === id);
}

interface RobotStore {
  status: LoadStatus;
  error: string | null;
  model: RobotModel | null;
  /** 当前（或正在加载的）机型 id，未选择时为 null */
  currentId: string | null;
  /** 模型资源根目录（相对 public/，供网格文件加载） */
  assetBase: string;
  loads: number;
  /** 按机型 id 加载 URDF 并构建运行时模型（同机型已就绪时跳过，切换期间旧请求结果作废） */
  loadRobot: (id: string, options?: { replayPreparation?: boolean }) => Promise<void>;
}

/** 加载请求序号：仅最新一次请求允许落地（防快速切换时的竞态回写） */
let loadSeq = 0;

export const useRobotStore = create<RobotStore>((set, get) => ({
  status: "idle",
  error: null,
  model: null,
  currentId: null,
  assetBase: "models/so100",
  loads: 0,
  loadRobot: async (id, options) => {
    if (useActivityStore.getState().replayPreparing && !options?.replayPreparation) {
      set({ error: "正在准备回放，请等待完成后切换机型" });
      return;
    }
    if (useActivityStore.getState().recordingLocked && get().currentId !== id) {
      set({ error: "实验采集或保存期间不能切换机型，请先结束实验" });
      return;
    }
    const entry = findRobotEntry(id);
    if (!entry) {
      set({ status: "error", error: `未知机型：${id}` });
      return;
    }
    // 同机型已就绪：无需重复加载
    if (get().currentId === id && get().status === "ready") return;
    // 乐观更新选中项：下拉与装配文案立即跟手（失败时保留选中，便于重试）
    const seq = ++loadSeq;
    set({ status: "loading", error: null, currentId: id });
    try {
      const res = await fetch(entry.urdfPath);
      if (!res.ok) throw new Error(`URDF 请求失败：HTTP ${res.status}`);
      const def: RobotDef = parseUrdf(await res.text());
      const model = buildRobotModel(def);
      if (model.active.length === 0) {
        throw new Error("URDF 中没有可动关节");
      }
      // 期间用户又切换了机型：丢弃本次结果
      if (seq !== loadSeq) return;
      set((s) => ({
        status: "ready",
        model,
        currentId: id,
        assetBase: entry.assetBase,
        loads: s.loads + 1,
      }));
    } catch (err) {
      if (seq !== loadSeq) return;
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

/** 模型已就绪时的窄化模型引用（避免组件里到处判空） */
export function useReadyModel(): RobotModel | null {
  return useRobotStore((s) => (s.status === "ready" ? s.model : null));
}
