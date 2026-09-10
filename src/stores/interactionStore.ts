/**
 * interactionStore —— 交互模式机 / 拾取状态 / 控制器单例持有。
 * InteractionController 实例不进入 set 对比，挂 module 级并在此接线：
 * 控制器出口 onIntent → targetStore.publish（统一入闸）。
 */
import { create } from "zustand";
import {
  InteractionController,
  type TcpDragState,
} from "../interaction/InteractionController";
import type { SelectedEntity, ToolMode } from "../interaction/types";
import { useTargetStore } from "./targetStore";

/** 控制器单例（React 不订阅实例本身，事件读取用 getState） */
export const interactionController = new InteractionController();

// 出口接线：鼠标意图 → targetStore 入闸（M4 起此处换 CommandArbiter）
interactionController.onIntent = (intent) => {
  useTargetStore.getState().publish(intent);
};

interface InteractionStoreState {
  mode: ToolMode;
  selected: SelectedEntity | null;
  /** 拖拽中的关节名（Gizmo 高亮与面板指示） */
  activeJointName: string | null;
  /** 拖拽中的 TCP 手柄（徽标/高亮） */
  tcpDrag: TcpDragState | null;
  setMode: (mode: ToolMode) => void;
  setSelected: (sel: SelectedEntity | null) => void;
  setActiveJointName: (name: string | null) => void;
}

export const useInteractionStore = create<InteractionStoreState>()((set) => ({
  mode: "select",
  selected: null,
  activeJointName: null,
  tcpDrag: null,

  setMode: (mode) => {
    interactionController.setMode(mode);
    set({ mode });
  },

  setSelected: (sel) => set({ selected: sel }),

  setActiveJointName: (name) => set({ activeJointName: name }),
}));

// 拾取出口：写入 store（供左侧面板高亮对应关节卡）
interactionController.onSelection = (sel) => {
  useInteractionStore.setState({ selected: sel });
};

// TCP 拖拽活动轴出口：写入 store（Gizmo 高亮 + UI 徽标）
interactionController.onTcpDrag = (state) => {
  useInteractionStore.setState({ tcpDrag: state });
};