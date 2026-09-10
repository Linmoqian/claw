/**
 * websocketRobotBridge —— TWIN/LIVE 模式的 RobotBridge 实现。
 * 内部持有 ConnectionManager（自动重连/心跳/速率/延迟）：
 * 收到 robot_state / joint_state → parseMessage 校验 → 合成 RobotState → 订阅回调。
 * 控制方向：TWIN（writable=false，默认）只读；LIVE（writable=true）
 * 经 sendCommand 下发统一指令（经 M4 会话门禁后的目标）。 */
import { makeRobotState, type RobotState } from "../../core/world/state";
import { ConnectionManager } from "../connection/connectionManager";
import {
  MSG_TYPES,
  makeEnvelope,
  parseMessage,
  serializeMessage,
  unixSecondsToEpochMs,
} from "../protocol/message";
import type { JointStateMessageData, RobotStateMessageData } from "../protocol/robot";
import { jointsFromMessage, robotStateFromMessage } from "../protocol/robot";
import type { RobotCommand } from "../protocol/command";
import { createWebSocketTransportFactory } from "../transport/websocket";
import type { BridgeOptions, BridgeStatus, RobotBridge } from "./robotBridge";

export class WebSocketRobotBridge implements RobotBridge {
  readonly kind = "websocket";
  /** LIVE 标记（writable 构造参数；UI 判断能否下发控制用） */
  readonly live: boolean;
  private readonly manager: ConnectionManager;
  private readonly robotListeners = new Set<
    (state: RobotState, timestampMs: number) => void
  >();
  private robotState = makeRobotState();
  private readonly inboundSequence = new Map<string, number>();
  /** 控制指令序号（网关可回执对账） */
  private seq = 0;

  constructor(options: BridgeOptions & { writable?: boolean }) {
    this.live = options.writable ?? false;
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
      const source = envelope.source ?? "anonymous";
      const previousSequence = this.inboundSequence.get(source);
      if (previousSequence !== undefined && envelope.sequence <= previousSequence) return;
      this.inboundSequence.set(source, envelope.sequence);
      if (envelope.type === MSG_TYPES.robotState) {
        const observed = robotStateFromMessage(envelope.data as RobotStateMessageData);
        this.robotState = { ...observed, joints: this.robotState.joints };
      } else if (envelope.type === MSG_TYPES.jointState) {
        this.robotState = {
          ...this.robotState,
          joints: jointsFromMessage(envelope.data as JointStateMessageData),
        };
      } else {
        return;
      }
      const timestampMs = unixSecondsToEpochMs(envelope.timestamp);
      for (const cb of this.robotListeners) cb(this.robotState, timestampMs);
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

  /** TWIN 只读；LIVE 经统一信封下发控制指令 */
  async sendCommand(command: RobotCommand): Promise<void> {
    if (!this.live) {
      throw new Error("TWIN 模式禁止下发控制指令（连接时勾选 LIVE）");
    }
    this.seq += 1;
    const commandId = `ui-${Date.now()}-${this.seq}`;
    this.manager.send(serializeMessage(makeEnvelope(
      MSG_TYPES.command,
      { command_id: commandId, lifecycle: "DISPATCHED", command },
      { frameId: "robot_base", sequence: this.seq, source: "xiakao_workbench" },
    )));
  }
}
