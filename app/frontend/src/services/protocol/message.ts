/**
 * protocol/message —— v2 统一消息包与编解码。
 * Wire 仅使用 SI 单位；时间戳为 Unix 秒，进入应用后再转 epoch ms。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
export const PROTOCOL_VERSION = 2 as const;

export const SI_UNITS = Object.freeze({
  position: "m",
  joint_position: "rad",
  linear_velocity: "m/s",
  angular_velocity: "rad/s",
  time: "s",
} as const);

export type ProtocolUnits = typeof SI_UNITS;

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
  protocol_version: typeof PROTOCOL_VERSION;
  units: ProtocolUnits;
  frame_id: string;
  /** Unix 秒。 */
  timestamp: number;
  /** 数据源内严格单调递增的消息序号。 */
  sequence: number;
  type: string;
  source?: string;
  data: T;
}

export interface EnvelopeOptions {
  frameId?: string;
  sequence?: number;
  source?: string;
  timestamp?: number;
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

let localSequence = 0;

export function unixSecondsNow(): number {
  return Date.now() / 1000;
}

export function unixSecondsToEpochMs(timestamp: number): number {
  return timestamp * 1000;
}

export function serializeMessage(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

export function makeEnvelope<T>(
  type: MsgType,
  data: T,
  options: EnvelopeOptions = {},
): MessageEnvelope<T> {
  return {
    protocol_version: PROTOCOL_VERSION,
    units: SI_UNITS,
    frame_id: options.frameId ?? "world",
    timestamp: options.timestamp ?? unixSecondsNow(),
    sequence: options.sequence ?? ++localSequence,
    type,
    source: options.source,
    data,
  };
}

function hasSiUnits(value: unknown): value is ProtocolUnits {
  if (value === null || typeof value !== "object") return false;
  const units = value as Record<string, unknown>;
  return Object.entries(SI_UNITS).every(([key, unit]) => units[key] === unit);
}

/** 严格解析 v2；缺字段、错误单位和任何其他版本均拒绝。 */
export function parseMessage(raw: string): MessageEnvelope {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ProtocolError("PROTOCOL_PARSE_FAILED", "message is not valid JSON");
  }
  if (obj === null || typeof obj !== "object") {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "message must be a JSON object");
  }
  const env = obj as Record<string, unknown>;
  if (env.protocol_version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "PROTOCOL_VERSION_MISMATCH",
      `sender version ${String(env.protocol_version)} != supported ${PROTOCOL_VERSION}`,
    );
  }
  if (typeof env.type !== "string" || env.type.length === 0) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing string field 'type'");
  }
  if (!hasSiUnits(env.units)) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing or invalid SI 'units'");
  }
  if (typeof env.frame_id !== "string" || env.frame_id.length === 0) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing string field 'frame_id'");
  }
  if (
    typeof env.timestamp !== "number" ||
    !Number.isFinite(env.timestamp) ||
    env.timestamp < 0
  ) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing finite field 'timestamp'");
  }
  if (!Number.isSafeInteger(env.sequence) || (env.sequence as number) < 0) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing non-negative integer 'sequence'");
  }
  if (!Object.prototype.hasOwnProperty.call(env, "data")) {
    throw new ProtocolError("PROTOCOL_INVALID_ENVELOPE", "missing field 'data'");
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    units: SI_UNITS,
    frame_id: env.frame_id,
    timestamp: env.timestamp,
    sequence: env.sequence as number,
    type: env.type,
    source: typeof env.source === "string" ? env.source : undefined,
    data: env.data,
  };
}

export interface PingData {
  sent_at: number;
}

export interface PongData {
  ping_timestamp: number;
}

export function makePing(options: EnvelopeOptions = {}): MessageEnvelope<PingData> {
  const timestamp = options.timestamp ?? unixSecondsNow();
  return makeEnvelope(MSG_TYPES.ping, { sent_at: timestamp }, { ...options, timestamp });
}

export function makePong(
  pingTimestamp: number,
  options: EnvelopeOptions = {},
): MessageEnvelope<PongData> {
  return makeEnvelope(MSG_TYPES.pong, { ping_timestamp: pingTimestamp }, options);
}
