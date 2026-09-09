/**
 * websocketRobotBridge —— TWIN/LIVE 模式的 RobotBridge 实现。
 * 内部持有 ConnectionManager（自动重连/心跳/速率/延迟）：
 * 收到 robot_state 消息 → parseMessage 校验 → 升维 RobotState → 订阅回调。
 * 控制方向：M4 之前保留 sendCommand 拒绝语义（TWIN 只读）。
 */
import type { RobotState } from "../../core/world/state";
import { ConnectionManager } from "../connection/connectionManager";
import { parseMessage } from "../protocol/message";
import type { RobotStateMessageData } from "../protocol/robot";
import { robotStateFromMessage } from "../protocol/robot";
import { createWebSocketTransportFactory } from "../transport/websocket";
import type { BridgeOptions, BridgeStatus, RobotBridge } from "./robotBridge";

export class WebSocketRobotBridge implements RobotBridge {
  readonly kind = "websocket";
  private readonly manager: ConnectionManager;
  private readonly robotListeners = new Set<
    (state: RobotState, timestampMs: number) => void
  >();

  constructor(options: BridgeOptions) {
    this.manager = new ConnectionManager(
      createWebSocketTransportFactory(),
      options.url,
      {
        autoReconnect: options.autoReconnect ?? true,
        staleTimeoutMs: 400,
      },
    );
    // 桥层职责：协议解析 + 升维（原样文本 → 业务状态）
    this.manager.onMessage((text) => {
      let envelope;
      try {
        envelope = parseMessage(text);
      } catch {
        return; // 坏包静默丢弃（错误计数在 ConnectionManager 外层统计）
      }
      if (envelope.type !== "robot_state") return;
      const robot = robotStateFromMessage(envelope.data as RobotStateMessageData);
      for (const cb of this.robotListeners) cb(robot, envelope.timestamp ?? Date.now());
    });
  }

  async connect(): Promise<void> {
    this.manager.start();
  }

  async disconnect(): Promise<void> {
    this.manager.stop();
  }

  getStatus(): BridgeStatus {
    const info = this.manager.getInfo();
    return {
      kind: this.kind,
      connected: info.status === "connected",
      status: info.status,
      latencyMs: info.latencyMs,
      messageRateHz: info.messageRateHz,
      lastMessageAt: info.lastMessageAt,
    };
  }

  subscribeRobotState(
    cb: (state: RobotState, timestampMs: number) => void,
  ): () => void {
    this.robotListeners.add(cb);
    return () => this.robotListeners.delete(cb);
  }

  /** TWIN 只读：控制指令在 M4（CommandArbiter + LIVE）才放行 */
  async sendCommand(): Promise<void> {
    throw new Error("TWIN 模式禁止下发控制指令（LIVE 阶段接入 CommandBus）");
  }
}