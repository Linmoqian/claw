/** sceneStore：3D 视图层低频状态与命令令牌（重置视角/聚焦由 token 触发）。 */
import { create } from "zustand";

/** 机器人涂装：chalk = 浅灰材质（默认），urdf = URDF 原始配色 */
export type MaterialStyle = "chalk" | "urdf";

interface SceneStore {
  showJointAxes: boolean;
  showTcpAxes: boolean;
  showTrail: boolean;
  materialStyle: MaterialStyle;
  /** 每次自增触发一次视角复位（OrbitControls.reset） */
  resetViewToken: number;
  /** 每次自增触发一次聚焦机器人 */
  focusToken: number;
  toggleJointAxes: () => void;
  toggleTcpAxes: () => void;
  toggleTrail: () => void;
  setMaterialStyle: (style: MaterialStyle) => void;
  requestResetView: () => void;
  requestFocus: () => void;
}

export const useSceneStore = create<SceneStore>((set) => ({
  showJointAxes: true,
  showTcpAxes: true,
  showTrail: true,
  materialStyle: "chalk",
  resetViewToken: 0,
  focusToken: 0,
  toggleJointAxes: () =>
    set((s) => ({ showJointAxes: !s.showJointAxes })),
  toggleTcpAxes: () => set((s) => ({ showTcpAxes: !s.showTcpAxes })),
  toggleTrail: () => set((s) => ({ showTrail: !s.showTrail })),
  setMaterialStyle: (materialStyle) => set({ materialStyle }),
  requestResetView: () => set((s) => ({ resetViewToken: s.resetViewToken + 1 })),
  requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
}));