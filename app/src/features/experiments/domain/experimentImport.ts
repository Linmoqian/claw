/** 导出实验 JSON 的解析与校验：纯函数，便于离线验证。
 * Created on 2026-09-30
 * @author:  https://github.com/Linmoqian
 */
import type {
  ExperimentBundle,
  ExperimentRecord,
  ExperimentSample,
  ExperimentSnapshot,
} from "./types";

/** 导入文件上限，防止异常大文件冻结界面。 */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseImportJoints(
  value: unknown,
  index: number,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`第 ${index + 1} 帧缺少关节读数`);
  const result: Record<string, number> = {};
  for (const [code, angle] of Object.entries(value)) {
    if (!isFiniteNumber(angle))
      throw new Error(`第 ${index + 1} 帧关节 ${code} 读数无效`);
    result[code] = angle;
  }
  return result;
}

function parseImportBase(
  value: unknown,
  index: number,
): ExperimentSample["base"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`第 ${index + 1} 帧缺少底盘位姿`);
  const base = value as Record<string, unknown>;
  if (
    !isFiniteNumber(base.x) ||
    !isFiniteNumber(base.y) ||
    !isFiniteNumber(base.z) ||
    !isFiniteNumber(base.yaw)
  )
    throw new Error(`第 ${index + 1} 帧底盘位姿数值无效`);
  return { x: base.x, y: base.y, z: base.z, yaw: base.yaw };
}

function parseImportTcp(
  value: unknown,
  index: number,
): ExperimentSample["tcpPositionM"] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber))
    throw new Error(`第 ${index + 1} 帧 TCP 坐标无效`);
  return [value[0], value[1], value[2]];
}

/** 快照字段宽容解析：曲线与回放只依赖 samples 与 robotId，快照缺失时给安全默认值。 */
function parseImportSnapshot(value: unknown): ExperimentSnapshot {
  const raw = (value ?? {}) as Record<string, unknown>;
  const jointMapping = Array.isArray(raw.jointMapping)
    ? raw.jointMapping
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object",
        )
        .map((item) => ({
          name: typeof item.name === "string" ? item.name : "",
          code: typeof item.code === "string" ? item.code : "",
        }))
        .filter((item) => item.code)
    : [];
  const sceneRaw = (raw.scene ?? {}) as Record<string, unknown>;
  return {
    jointMapping,
    scene: {
      workspace:
        sceneRaw.workspace && typeof sceneRaw.workspace === "object"
          ? (sceneRaw.workspace as ExperimentSnapshot["scene"]["workspace"])
          : null,
      path: Array.isArray(sceneRaw.path)
        ? (sceneRaw.path as ExperimentSnapshot["scene"]["path"])
        : [],
    },
    programRuns: Array.isArray(raw.programRuns) ? raw.programRuns : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
  };
}

/** 解析导出的实验 JSON：校验信封与逐帧数值，重生成 id 并强制置为已保存。 */
export function parseExperimentExport(
  text: string,
  fileName: string,
): ExperimentBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("导出文件结构不正确");
  const envelope = parsed as Record<string, unknown>;
  if (envelope.kind !== "claw-experiment" || envelope.version !== 1)
    throw new Error("这不是本工作台导出的实验 JSON（kind 或 version 不符）");
  if (!Array.isArray(envelope.samples))
    throw new Error("导出文件缺少运动帧数组 samples");
  const rawRecord = (envelope.record ?? {}) as Record<string, unknown>;
  const robotId = typeof rawRecord.robotId === "string" ? rawRecord.robotId : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(robotId))
    throw new Error("导出记录的机型标识无效");
  if (rawRecord.sampleRateHz !== 20)
    throw new Error("导出记录的采样率不是 20 Hz，无法导入");
  const samples: ExperimentSample[] = envelope.samples.map(
    (item: unknown, index: number) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error(`第 ${index + 1} 帧结构无效`);
      const sample = item as Record<string, unknown>;
      if (!isFiniteNumber(sample.t) || sample.t < 0)
        throw new Error(`第 ${index + 1} 帧时间戳无效`);
      if (!isFiniteNumber(sample.timestampMs))
        throw new Error(`第 ${index + 1} 帧绝对时间无效`);
      return {
        t: sample.t,
        timestampMs: sample.timestampMs,
        joints: parseImportJoints(sample.joints, index),
        base: parseImportBase(sample.base, index),
        tcpPositionM: parseImportTcp(sample.tcpPositionM, index),
      };
    },
  );
  const lastT = samples.length ? samples[samples.length - 1].t : 0;
  const durationS =
    isFiniteNumber(rawRecord.durationS) && rawRecord.durationS >= 0
      ? rawRecord.durationS
      : lastT;
  const createdAt = isFiniteNumber(rawRecord.createdAt)
    ? rawRecord.createdAt
    : Date.now();
  const fallbackName =
    fileName
      .replace(/\.experiment\.json$/i, "")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim()
      .slice(0, 80) || "导入的实验";
  const name =
    typeof rawRecord.name === "string" && rawRecord.name.trim()
      ? rawRecord.name.trim().slice(0, 80)
      : fallbackName;
  const record: ExperimentRecord = {
    id: crypto.randomUUID(),
    name,
    source: rawRecord.source === "blocks" ? "blocks" : "studio",
    status: "saved",
    createdAt,
    endedAt: isFiniteNumber(rawRecord.endedAt)
      ? rawRecord.endedAt
      : createdAt + Math.round(durationS * 1000),
    durationS,
    sampleCount: samples.length,
    robotId,
    robotLabel:
      typeof rawRecord.robotLabel === "string" && rawRecord.robotLabel
        ? rawRecord.robotLabel
        : robotId,
    sampleRateHz: 20,
  };
  return { record, snapshot: parseImportSnapshot(envelope.snapshot), samples };
}
