/**
 * ConnectionManager —— 连接生命周期管理：建链 / 断线 / 自动重连（指数退避）/
 * 心跳与延迟测量 / 消息速率滑窗统计 / 数据新鲜度。
 * 与协议类型解耦：只解析 ping/pong 做健康探测，业务消息原样上抛。
 */
import type { ConnectionStatus } from "../../core/world/state";
import {
  MSG_TYPES,
  makePing,
  makePong,
  parseMessage,
  serializeMessage,
  type MessageEnvelope,
  type PongData,
} from "../protocol/message";
import type { Transport, TransportFactory } from "../transport/types";

export interface ConnectionInfo {
  url: string;
  status: ConnectionStatus;
  latencyMs: number | null;
  /** 滑窗消息速率（Hz） */
  messageRateHz: number | null;
  /** 最近一条任意消息时间（epoch ms；null = 从未收到） */
  lastMessageAt: number | null;
  /** 累计建链尝试次数 */
  connectAttempt: number;
  lastError: string | null;
}

export interface ReconnectPolicy {
  autoReconnect: boolean;
  /** 重连退避基数 ms */
  baseMs: number;
  /** 退避上限 ms */
  maxMs: number;
}

export interface ConnectionManagerOptions extends Partial<ReconnectPolicy> {
  /** 主动心跳间隔 ms（<=0 关闭主动 ping） */
  heartbeatMs?: number;
  /** 数据新鲜度窗口：lastMessageAt 距今超过即视为 stale */
  staleTimeoutMs?: number;
  /** 消息速率统计窗口 ms */
  rateWindowMs?: number;
}

/** 默认值拼接后的必填配置（运行时实际类型） */
interface ResolvedOptions {
  autoReconnect: boolean;
  baseMs: number;
  maxMs: number;
  heartbeatMs: number;
  staleTimeoutMs: number;
  rateWindowMs: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  autoReconnect: true,
  baseMs: 500,
  maxMs: 8000,
  heartbeatMs: 5000,
  staleTimeoutMs: 1000,
  rateWindowMs: 2000,
};

export class ConnectionManager {
  private readonly factory: TransportFactory;
  private readonly url: string;
  private readonly options: ResolvedOptions;

  private started = false;
  private generation = 0; // 代际守卫：旧 transport 的回调全部过期
  private transport: Transport | null = null;
  private status: ConnectionStatus = "offline";
  private attempts = 0;
  private latencyMs: number | null = null;
  private lastMessageAt: number | null = null;
  private lastError: string | null = null;
  private readonly messageTimes: number[] = [];
  /** 最近一次 ping 的 Unix 秒时间戳。 */
  private pendingPingTs: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stateListeners = new Set<(info: ConnectionInfo) => void>();
  private readonly messageListeners = new Set<(text: string) => void>();

  constructor(factory: TransportFactory, url: string, options?: Partial<ConnectionManagerOptions>) {
    this.factory = factory;
    this.url = url;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** 启动并建链（幂等） */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.openConnection();
  }

  /** 彻底停止：关闭连接、清定时器、终止自动重连、归零统计 */
  stop(): void {
    this.started = false;
    this.clearTimers();
    this.stopHeartbeat();
    this.generation++;
    this.transport?.close(1000, "stop");
    this.transport = null;
    this.status = "offline";
    this.latencyMs = null;
    this.lastError = null;
    this.messageTimes.length = 0;
    this.emitState();
  }

  /** 手动触发一次建链（重连周期中可提前拉起） */
  connect(): void {
    if (!this.started) return;
    this.clearTimers();
    if (this.status === "connected" || this.status === "connecting") return;
    this.openConnection();
  }

  send(text: string): void {
    this.transport?.send(text);
  }

  getInfo(): ConnectionInfo {
    const now = Date.now();
    const windowStart = now - this.options.rateWindowMs;
    while (
      this.messageTimes.length > 0 &&
      this.messageTimes[0] < windowStart
    ) {
      this.messageTimes.shift();
    }
    const rateHz =
      this.messageTimes.length > 0
        ? (this.messageTimes.length * 1000) / this.options.rateWindowMs
        : null;
    return {
      url: this.url,
      status: this.status,
      latencyMs: this.latencyMs,
      messageRateHz: rateHz,
      lastMessageAt: this.lastMessageAt,
      connectAttempt: this.attempts,
      lastError: this.lastError,
    };
  }

  /** 数据新鲜度：最近一条消息（含心跳）超窗即 stale */
  isDataStale(): boolean {
    if (this.status !== "connected") return true;
    if (this.lastMessageAt === null) return true;
    return Date.now() - this.lastMessageAt > this.options.staleTimeoutMs;
  }

  onState(cb: (info: ConnectionInfo) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** 业务消息出口（心跳包已被拦截处理） */
  onMessage(cb: (text: string) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  /* ================= 状态机内部 ================= */

  private openConnection(): void {
    const gen = ++this.generation;
    this.clearTimers();
    this.attempts++;
    this.setStatus("connecting");
    let transport: Transport;
    try {
      transport = this.factory(this.url);
    } catch (e) {
      this.lastError = String(e);
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.transport = transport;

    transport.onOpen(() => {
      if (gen !== this.generation) return;
      this.lastError = null;
      this.latencyMs = null;
      this.setStatus("connected");
      this.startHeartbeat();
    });

    transport.onMessage((text) => {
      if (gen !== this.generation) return;
      this.recordMessage();
      if (!this.handleProbe(text)) {
        for (const cb of this.messageListeners) cb(text);
      }
    });

    transport.onClose((e) => {
      if (gen !== this.generation) return;
      this.stopHeartbeat();
      this.transport = null;
      if (!this.started) return; // stop() 主动关闭
      this.lastError =
        e.code !== 1000 ? `closed code=${e.code} ${e.reason}` : null;
      this.setStatus(this.options.autoReconnect ? "connecting" : "offline");
      this.scheduleReconnect();
    });

    transport.onError((e) => {
      if (gen !== this.generation) return;
      this.lastError = String(e);
    });
  }

  /** 重连调度：指数退避 */
  private scheduleReconnect(): void {
    if (!this.started) return;
    if (!this.options.autoReconnect) return;
    if (this.reconnectTimer) return; // 已有排程
    const delay = Math.min(
      this.options.maxMs,
      this.options.baseMs * 2 ** Math.max(0, this.attempts - 1),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.started) return;
      if (this.transport) return; // 已连上（竞态保险）
      this.openConnection();
    }, delay);
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.emitState();
  }

  private emitState(): void {
    const info = this.getInfo();
    for (const cb of this.stateListeners) cb(info);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatMs;
    if (interval <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.status !== "connected") return;
      const ping = makePing({ frameId: "system", source: "xiakao_workbench" });
      this.pendingPingTs = ping.timestamp;
      this.transport?.send(serializeMessage(ping));
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingPingTs = null;
  }

  /** ping/pong 与业务消息的计数与延迟测算 */
  private recordMessage(): void {
    const now = Date.now();
    this.lastMessageAt = now;
    this.messageTimes.push(now);
  }

/** 心跳句柄：返回 true 表示已消费（pong 或应答 ping），不外抛 */
  private handleProbe(text: string): boolean {
    if (text.length > 1024) return false; // 业务大消息直接外抛
    const obj = this.tryParseProbe(text);
    if (obj === null) return false;
    if (obj.type === MSG_TYPES.pong) {
      const data = obj.data as Partial<PongData>;
      if (this.pendingPingTs !== null && data.ping_timestamp === this.pendingPingTs) {
        this.latencyMs = Math.max(0, Date.now() - data.ping_timestamp * 1000);
      }
      return true;
    }
    if (obj.type === MSG_TYPES.ping) {
      this.transport?.send(serializeMessage(makePong(obj.timestamp, {
        frameId: "system",
        source: "xiakao_workbench",
      })));
      return true;
    }
    return false;
  }

  private tryParseProbe(
    text: string,
  ): MessageEnvelope | null {
    try {
      return parseMessage(text);
    } catch {
      return null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
