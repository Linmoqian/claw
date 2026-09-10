/**
 * protocol/station —— station_position 全站仪消息。
 * 点位语义为 world 帧（网关已完成 station → world 变换）；
 * timestamp 一律取 envelope 时间戳（数据采集时刻，不是到达时刻）。
 */
import type { StationPosition } from "../../core/world/state";

export interface StationPositionMessageData {
  robot_id: number;
  x: number;
  y: number;
  z?: number;
  /** 全站仪自身报告无效（丢目标/超差）时为 false */
  valid?: boolean;
}

export function stationFromMessage(
  data: StationPositionMessageData,
  envelopeTimestampMs?: number,
): StationPosition {
  return {
    timestamp: envelopeTimestampMs ?? Date.now(),
    targetId: data.robot_id,
    position: {
      x: data.x,
      y: data.y,
      z: typeof data.z === "number" ? data.z : 0,
    },
    valid: data.valid !== false,
  };
}
