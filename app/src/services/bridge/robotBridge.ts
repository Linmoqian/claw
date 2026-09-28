/**
 * RobotBridge —— 机器人业务统一入口（蓝图第五节官方接口）。
 *
 * UI 只看到「订阅机器人状态 / 发送统一 Command」两个动作；
 * 背后由 SimulationBridge（SIM）、WebSocketRobotBridge（TWIN/LIVE）、
 * ReplayBridge（复盘）之一实现，Three.js 全程不知数据来自录像还是真机。
 */
import type { RobotState } from "../../core/world/state";
import type { ConnectionStatus } from "../../core/world/state";
import type { RobotCommand } from "../protocol/command";

export interface BridgeStatus {
  /** 实现类型标识："simulation" | "websocket" | "replay" | "ros2"… */
  kind: string;
  /** 语义连接（SIM 恒为 true；TWIN/LIVE 取决于 transport） */
  connected: boolean;
  status: ConnectionStatus;
  latencyMs: number | null;
  messageRateHz: number | null;
  lastMessageAt: number | null;
}

export interface RobotBridge {
  readonly kind: string;

  /** 建立连接（SIM 实现为 no-op） */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
  /** 连接健康状态（UI 顶部显示用） */
  getStatus(): BridgeStatus;

  /** 订阅机器人状态（RobotBridge 内部完成消息解析与升维） */
  subscribeRobotState(
    cb: (state: RobotState, timestampMs: number) => void,
  ): () => void;

  /** 发送统一控制指令；非 LIVE 实现应拒绝并在日志层报 warning */
  sendCommand(command: RobotCommand): Promise<void>;
}

/** TWIN/LIVE 侧桥的构造配置示例（阶段三 WebSocketRobotBridge 使用） */
export interface BridgeOptions {
  url: string;
  /** 自动重连（真实链路默认开） */
  autoReconnect?: boolean;
}