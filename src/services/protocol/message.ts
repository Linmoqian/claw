/**
 * protocol/message —— 统一消息包（envelope）与编解码。
 * 所有 WebSocket 消息共享此信封；version 字段是协议演化的安全带。
 */
export const PROTOCOL_VERSION = 1;

/** 已注册消息类型（未知类型：解析不报错，由消费者决定忽略并记 warning） */
export const MSG_TYPES = {
  robotState: "robot_state",
  jointState: "joint_state",
  stationPosition: "station_position",
  deviceStatus: "device_status",
  trajectory: "trajectory",
  command: "command",
  ping: "ping",
  pong: "pong",
} as const;

export type MsgType = (typeof MSG_TYPES)[keyof typeof MSG_TYPES];

export interface MessageEnvelope<T = unknown> {
  version: number;
  type: string;
  /** epoch ms；device_status 等无时间语义的消息可缺省 */
  timestamp?: number;
  /** 数据源标识（如 "x_line_bot" / "total_station"） */
  source?: string;
  data: T;
}

export type ProtocolErrorCode =
  | "PROTOCOL_PARSE_FAILED"
  | "PROTOCOL_VERSION_MISMATCH"
  | "PROTOCOL_INVALID_ENVELOPE";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

/** 序列化发出 */
export function serializeMessage(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

/** 便捷构造一个标准信封 */
export function makeEnvelope<T>(
  type: MsgType,
  data: T,
  source?: string,
): MessageEnvelope<T> {
  return {
    version: PROTOCOL_VERSION,
    type,
    timestamp: Date.now(),
    source,
    data,
  };
}

/** 解析入站文本：结构校验，不校验业务字段（业务字段由各消息模块宽松处理） */
export function parseMessage(raw: string): MessageEnvelope {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ProtocolError(
      "PROTOCOL_PARSE_FAILED",
      "message is not valid JSON",
    );
  }
  if (obj === null || typeof obj !== "object") {
    throw new ProtocolError(
      "PROTOCOL_INVALID_ENVELOPE",
      "message must be a JSON object",
    );
  }
  const env = obj as Record<string, unknown>;
  if (typeof env.type !== "string" || env.type.length === 0) {
    throw new ProtocolError(
      "PROTOCOL_INVALID_ENVELOPE",
      "missing string field 'type'",
    );
  }
  if (typeof env.version !== "number") {
    throw new ProtocolError(
      "PROTOCOL_VERSION_MISMATCH",
      "missing numeric field 'version'",
    );
  }
  if (env.version > PROTOCOL_VERSION) {
    throw new ProtocolError(
      "PROTOCOL_VERSION_MISMATCH",
      `sender version ${env.version} > supported ${PROTOCOL_VERSION}`,
    );
  }
  return {
    version: env.version,
    type: env.type,
    timestamp:
      typeof env.timestamp === "number" ? env.timestamp : undefined,
    source: typeof env.source === "string" ? env.source : undefined,
    data: env.data ?? {},
  };
}

/** 心跳包（ConnectionManager 主动探测延迟用） */
export function makePing(): MessageEnvelope<Record<string, never>> {
  return makeEnvelope(MSG_TYPES.ping, {});
}