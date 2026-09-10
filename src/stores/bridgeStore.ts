/**
 * bridgeStore —— 当前数据桥（SIM / TWIN 真数据 / LIVE / 回放）与连接健康快照。
 * 接线规则（高频纪律）：
 *  - robot 遥测（50Hz）由本 store 统一订阅 → worldStore（Three 用 ref 直读，不订阅）；
 *  - 本 store 的 info 快照由 UI 以 10Hz refresh 拉取，绝不逐条消息触发 React。
 */
import { create } from "zustand";
import type { RobotState } from "../core/world/state";
import {
  ReplayBridge,
  simulationBridge,
  WebSocketRobotBridge,
  type BridgeStatus,
  type RobotBridge,
} from "../services/bridge";
import type { RecFrame } from "../services/protocol/recording";
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
  /** 当前 LIVE 连接（可下发控制；TWIN 为只读观察） */
  isLive: boolean;
  /** 回放状态（回放桥活动时非 null） */
  replay: { position: number; duration: number; playing: boolean; rate: number } | null;
  /** 切换桥：断开旧的 → 挂新 → 连接新（robot 遥测订阅一并换线） */
  setBridge: (bridge: RobotBridge) => Promise<void>;
  /** 拉取当前桥健康快照（并同步进 WorldState.connection.robot） */
  refresh: () => void;
  /** 便捷入口：连接 mock 真数据（TWIN 观察态） */
  connectMock: () => Promise<void>;
  /** 连接真机/自定义 WS（live=true 可下发控制） */
  connectRemote: (url: string, live: boolean) => Promise<void>;
  /** 进入回放（载入录像并自动播放） */
  enterReplay: (frames: RecFrame[]) => Promise<void>;
  /** 回放控制 */
  replayControl: (cmd: "play" | "pause" | "seek" | "rate", value?: number) => void;
  /** 退出回放（回到 SIM） */
  exitReplay: () => Promise<void>;
  /** LIVE 下发统一控制指令（TWIN/SIM/回放下发被拒） */
  sendCommand: (command: import("../services/protocol/command").RobotCommand) => Promise<void>;
  /** 便捷入口：回到 SIM（断链，3D 保持最后位姿） */
  backToSim: () => Promise<void>;
}

/** 当前桥的 robot 订阅退订句柄（模块级，不随 store 重渲染） */
let unsubscribeRobot: (() => void) | null = null;

/** 反复连接 mock 时复用同一实例，避免连接泄漏 */
let mockBridge: WebSocketRobotBridge | null = null;

/** 回放桥单例（录像载入/控制均经它；复用避免订阅泄漏） */
const replayBridge = new ReplayBridge();

/** 回放进度低频刷新（回放中 UI 拉取；100ms 与遥测刷新纪律一致） */
export function refreshReplayState(): void {
  const st = useBridgeStore.getState();
  if (!st.replay) return;
  useBridgeStore.setState({
    replay: {
      position: replayBridge.position,
      duration: replayBridge.duration,
      playing: replayBridge.isPlaying,
      rate: replayBridge.rateGetter,
    },
  });
}

/** robot 遥测 → worldStore（50Hz set，无 React 订阅方，见文件头纪律） */
function routeRobotState(state: RobotState): void {
  useWorldStore.getState().updateRobotState(state);
}

export const useBridgeStore = create<BridgeStoreState>()((set, get) => ({
  bridge: simulationBridge,
  info: simulationBridge.getStatus(),
  lastError: null,
  isLive: false,
  replay: null,

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
    set({ isLive: false });
    await get().setBridge(mockBridge);
  },

  connectRemote: async (url, live) => {
    const remote = new WebSocketRobotBridge({ url, writable: live });
    set({ isLive: live });
    await get().setBridge(remote);
  },

  enterReplay: async (frames) => {
    replayBridge.load(frames);
    replayBridge.play();
    set({
      isLive: false,
      replay: { position: 0, duration: replayBridge.duration, playing: true, rate: 1 },
    });
    await get().setBridge(replayBridge);
  },

  replayControl: (cmd, value) => {
    if (cmd === "play") replayBridge.play();
    else if (cmd === "pause") replayBridge.pause();
    else if (cmd === "seek" && typeof value === "number") replayBridge.seek(value);
    else if (cmd === "rate" && typeof value === "number") replayBridge.setRate(value);
    set({
      replay: {
        position: replayBridge.position,
        duration: replayBridge.duration,
        playing: replayBridge.isPlaying,
        rate: replayBridge.rateGetter,
      },
    });
  },

  exitReplay: async () => {
    replayBridge.pause();
    set({ replay: null });
    await get().setBridge(simulationBridge);
  },

  sendCommand: async (command) => {
    await get().bridge.sendCommand(command);
  },

  backToSim: async () => {
    set({ isLive: false });
    await get().setBridge(simulationBridge);
  },
}));