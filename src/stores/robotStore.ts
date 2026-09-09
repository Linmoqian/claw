/** robotStore：机器人模型加载状态（URDF → RobotDef → RobotModel）。 */
import { create } from "zustand";
import { buildRobotModel } from "../robot/model";
import { parseUrdf } from "../robot/urdf";
import type { RobotDef, RobotModel } from "../robot/types";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface RobotStore {
  status: LoadStatus;
  error: string | null;
  model: RobotModel | null;
  /** 模型资源根目录（相对 public/，供网格文件加载） */
  assetBase: string;
  loads: number;
  /** 加载内置 SO-100（第一版唯一入口，将来替换为"导入 URDF"） */
  loadSo100: () => Promise<void>;
}

export const useRobotStore = create<RobotStore>((set) => ({
  status: "idle",
  error: null,
  model: null,
  assetBase: "models/so100",
  loads: 0,
  loadSo100: async () => {
    set({ status: "loading", error: null });
    try {
      const res = await fetch("models/so100/so100.urdf");
      if (!res.ok) throw new Error(`URDF 请求失败：HTTP ${res.status}`);
      const def: RobotDef = parseUrdf(await res.text());
      const model = buildRobotModel(def);
      if (model.active.length === 0) {
        throw new Error("URDF 中没有可动关节");
      }
      set((s) => ({
        status: "ready",
        model,
        assetBase: "models/so100",
        loads: s.loads + 1,
      }));
    } catch (err) {
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