/** 实验记录：持久化边界统一使用米、弧度、秒。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import type { DxfWorkspace } from "../../../cad/dxf";
import type { BaseWaypoint } from "../../../cad/workspaceStore";

export interface ExperimentRecord {
  id: string;
  name: string;
  source: "studio" | "blocks";
  status: "recording" | "saved" | "interrupted";
  createdAt: number;
  endedAt: number | null;
  durationS: number;
  sampleCount: number;
  robotId: string;
  robotLabel: string;
  sampleRateHz: 20;
}

export interface ExperimentSample {
  t: number;
  timestampMs: number;
  joints: Record<string, number>;
  base: { x: number; y: number; z: number; yaw: number };
  tcpPositionM: [number, number, number];
}

export interface ExperimentProgramRun {
  startedAtS: number;
  snapshot: unknown;
}

export interface ExperimentLog {
  t: number;
  type: "start" | "log" | "complete" | "stopped" | "error";
  message: string;
}

export interface ExperimentSnapshot {
  jointMapping: { name: string; code: string }[];
  scene: { workspace: DxfWorkspace | null; path: BaseWaypoint[] };
  programRuns: ExperimentProgramRun[];
  logs: ExperimentLog[];
}

export interface ExperimentBundle {
  record: ExperimentRecord;
  snapshot: ExperimentSnapshot;
  samples: ExperimentSample[];
}

export interface ExperimentExport extends ExperimentBundle {
  kind: "claw-experiment";
  version: 1;
  units: { position: "m"; angle: "rad"; time: "s" };
}
