/**
 * bridgeStore —— 当前数据桥（SIM / TWIN 真数据）与连接健康快照。
 * 接线规则（高频纪律）：
 *  - robot 遥测（50Hz）由本 store 统一订阅 → worldStore（Three 用 ref 直读，不订阅）；
 *  - 本 store 的 info 快照由 UI 以 10Hz refresh 拉取，绝不逐条消息触发 React。
 */
import { create } from "zustand";
import type { RobotState } from "../core/world/state";
import {
  simulationBridge,
  type BridgeStatus,
  type RobotBridge,
} from "../services/bridge";
import { WebSocketRobotBridge } from "../services/bridge/websocketRobotBridge";
import { useWorldStore } from "./worldStore";

/** mock 真数据源地址（环境变量可覆盖，供联调切换端口） */
const MOCK_ROBOT_URL =
  (import.meta.env.VITE_MOCK_WS_URL as string | undefined) ??
  "ws://127.0.0.1:15551";

interface BridgeStoreState {
  /** 当前生效的桥（默认 SIM；实例不参与响应式比较） */
  bridge: RobotBridge;
  /** 连接健康快照（refresh 频率刷新，UI 只读） */
  info: BridgeStatus;
  lastError: string | null;
  /** 切换桥：断开旧的 → 挂新 → 连接新（robot 遥测订阅一并换线） */
  setBridge: (bridge: RobotBridge) => Promise<void>;
  /** 拉取当前桥健康快照（并同步进 WorldState.connection.robot） */
  refresh: () => void;
  /** 便捷入口：连接 mock 真数据（TWIN 观察态） */
  connectMock: () => Promise<void>;
  /** 便捷入口：回到 SIM（断链，3D 保持最后位姿） */
  backToSim: () => Promise<void>;
}

/** 当前桥的 robot 订阅退订句柄（模块级，不随 store 重渲染） */
let unsubscribeRobot: (() => void) | null = null;

/** 反复连接 mock 时复用同一实例，避免连接泄漏 */
let mockBridge: WebSocketRobotBridge | null = null;

/** robot 遥测 → worldStore（50Hz set，无 React 订阅方，见文件头纪律） */
function routeRobotState(state: RobotState): void {
  useWorldStore.getState().updateRobotState(state);
}

export const useBridgeStore = create<BridgeStoreState>()((set, get) => ({
  bridge: simulationBridge,
  info: simulationBridge.getStatus(),
  lastError: null,

  setBridge: async (bridge) => {
    const prev = get().bridge;
    if (prev === bridge) return;
    // 断开旧桥（SIM 断开为 no-op）
    await prev.disconnect();
    if (unsubscribeRobot) {
      unsubscribeRobot();
      unsubscribeRobot = null;
    }
    // 挂新桥并接好遥测路由
    unsubscribeRobot = bridge.subscribeRobotState(routeRobotState);
    set({ bridge, info: bridge.getStatus(), lastError: null });
    try {
      await bridge.connect();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
    set({ info: bridge.getStatus() });
  },

  refresh: () => {
    const { bridge } = get();
    const info = bridge.getStatus();
    set({ info });
    // 镜像到 WorldState.connection.robot（数据流唯一事实源不散落）
    useWorldStore.getState().publish({
      connection: {
        ...useWorldStore.getState().world.connection,
        robot: {
          status: info.status,
          lastMessageAt: info.lastMessageAt,
          latencyMs: info.latencyMs,
          messageRateHz: info.messageRateHz,
        },
      },
    });
  },

  connectMock: async () => {
    if (!mockBridge) mockBridge = new WebSocketRobotBridge({ url: MOCK_ROBOT_URL });
    await get().setBridge(mockBridge);
  },

  backToSim: async () => {
    await get().setBridge(simulationBridge);
  },
}));