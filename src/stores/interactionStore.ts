/**
 * interactionStore —— 交互模式机 / 拾取状态 / 控制器单例持有。
 * InteractionController 实例不进入 set 对比，挂 module 级并在此接线：
 * M4：拖拽意图 → sessionStore 预览通道（Ghost 跟手，松开才提交）；
 * 会话生命周期（begin/commit/cancel）经 onSession 同步。
 */
import { create } from "zustand";
import {
  InteractionController,
  type TcpDragState,
} from "../interaction/InteractionController";
import type { InputIntent, SelectedEntity, ToolMode } from "../interaction/types";
import { useSessionStore } from "./sessionStore";

/** 控制器单例（React 不订阅实例本身，事件读取用 getState） */
export const interactionController = new InteractionController();

// 意图路由：鼠标意图 → 预览通道（M4；无活动 mouse 会话时自动开启）
interactionController.onIntent = (intent: InputIntent) => {
  const st = useSessionStore.getState();
  const active = st.session?.source === "mouse" && st.session.phase === "preview";
  if (!active && !st.begin("mouse")) return;
  if (intent.kind === "joint-target") {
    st.previewJoint("mouse", intent.jointIndex, intent.jointName, intent.valueDeg);
  } else if (intent.kind === "tcp-pose") {
    st.previewTcp("mouse", intent);
  }
};

// 拖拽会话生命周期：beginJointDrag 成功 → begin；松开 → commit；中断 → cancel
interactionController.onSession = (phase) => {
  const st = useSessionStore.getState();
  if (phase === "begin") st.begin("mouse");
  else if (phase === "commit") st.commit("mouse");
  else st.cancel("mouse");
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