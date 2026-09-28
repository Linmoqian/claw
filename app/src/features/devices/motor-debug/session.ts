/** 单电机调试界面状态和有限长度通信日志。Created on 2026-09-27; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
import { create } from "zustand";
import {
  serialConnect,
  serialDisconnect,
  servoPing,
  servoReadPosition,
  servoSetTorque,
  servoWritePosition,
  servoWriteSpeed,
} from "../../../lib/serial";
import { serialConnectionBlockedReason } from "../../../lib/serialConnectionGuard";
import { useActivityStore } from "../../workbench/runtime/activity";
import { useBridgeStore } from "../../../stores/bridgeStore";
import {
  closeRawSerial,
  closeSlcan,
  formatHexBytes,
  initializeSlcan,
  openRawSerial,
  receiveSlcanFrames,
  sendSlcanFrame,
  transferRawSerial,
  type RawSerialOptions,
} from "./serialDebug";
import {
  decodeSlcanRecords,
  describeSlcanRecord,
  encodeSlcanFrame,
  type CanBitrateCode,
  type CanFrame,
} from "./slcan";

export type DebugProtocol = "feetech" | "raw" | "slcan";
export type DebugInterface = "ttl" | "rs485" | "can";
export interface DebugLogEntry {
  id: number;
  at: number;
  kind: "tx" | "rx" | "info" | "error";
  message: string;
}
interface OpenOptions extends RawSerialOptions {
  protocol: DebugProtocol;
  interfaceType: DebugInterface;
  canBitrate: CanBitrateCode;
  targetId: number | null;
}
interface DebugSessionState {
  protocol: DebugProtocol | null;
  interfaceType: DebugInterface | null;
  port: string | null;
  baud: number | null;
  canBitrate: CanBitrateCode | null;
  targetId: number | null;
  transitioning: boolean;
  busy: boolean;
  error: string | null;
  logs: DebugLogEntry[];
  position: number | null;
  torqueEnabled: boolean;
  locked: boolean;
  open: (options: OpenOptions) => Promise<void>;
  close: () => Promise<void>;
  ping: (id: number) => Promise<void>;
  readPosition: (id: number) => Promise<void>;
  setTorque: (id: number, enabled: boolean) => Promise<void>;
  setSpeed: (id: number, speed: number) => Promise<void>;
  jog: (id: number, delta: number, speed: number) => Promise<void>;
  hold: (id: number) => Promise<void>;
  unlock: () => void;
  transfer: (tx: number[], timeoutMs: number) => Promise<void>;
  sendCanFrame: (frame: CanFrame) => Promise<void>;
  receiveCanFrames: () => Promise<void>;
  clearLogs: () => void;
}

let nextLogId = 1;
let slcanCarry = "";
function appendLog(kind: DebugLogEntry["kind"], message: string): void {
  useMotorDebugStore.setState((state) => ({
    logs: [
      ...state.logs,
      { id: nextLogId++, at: Date.now(), kind, message },
    ].slice(-200),
  }));
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function logSlcanResponse(bytes: number[]): string[] {
  const decoded = decodeSlcanRecords(bytes, slcanCarry);
  slcanCarry = decoded.carry.slice(-256);
  for (const record of decoded.records)
    appendLog(
      record.includes("\x07") ? "error" : "rx",
      describeSlcanRecord(record),
    );
  return decoded.records;
}
async function runFeetech<T>(
  id: number,
  label: string,
  command: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const state = useMotorDebugStore.getState();
  if (
    state.protocol !== "feetech" ||
    !state.port ||
    state.busy ||
    state.transitioning ||
    state.targetId !== id
  )
    return { ok: false };
  useMotorDebugStore.setState({ busy: true, error: null });
  appendLog("tx", label);
  try {
    const result = await command();
    appendLog(
      "rx",
      result === undefined
        ? `${label} · 已确认`
        : `${label} · ${String(result)}`,
    );
    return { ok: true, value: result };
  } catch (error) {
    const message = errorMessage(error);
    useMotorDebugStore.setState({ error: message });
    appendLog("error", `${label} · ${message}`);
    return { ok: false };
  } finally {
    useMotorDebugStore.setState({ busy: false });
  }
}

export const useMotorDebugStore = create<DebugSessionState>()((set, get) => ({
  protocol: null,
  interfaceType: null,
  port: null,
  baud: null,
  canBitrate: null,
  targetId: null,
  transitioning: false,
  busy: false,
  error: null,
  logs: [],
  position: null,
  torqueEnabled: false,
  locked: false,
  open: async (options) => {
    if (get().port || get().transitioning || get().busy) return;
    const activity = useActivityStore.getState();
    const bridge = useBridgeStore.getState();
    const blocked = serialConnectionBlockedReason(
      activity,
      bridge.bridge.kind === "replay" || bridge.replay !== null,
    );
    if (
      blocked ||
      activity.hardwareConnected ||
      bridge.bridge.kind !== "simulation"
    ) {
      set({ error: blocked ?? "已有真机链路，请先断开并返回仿真。" });
      return;
    }
    if (
      options.protocol === "feetech" &&
      (!Number.isInteger(options.targetId) ||
        options.targetId === null ||
        options.targetId < 1 ||
        options.targetId > 253)
    ) {
      set({ error: "舵机 ID 须为 1–253 的整数。" });
      return;
    }
    if ((options.interfaceType === "can") !== (options.protocol === "slcan")) {
      set({ error: "CAN 接口请选择 SLCAN 适配器；TTL/RS485 请选择串口协议。" });
      return;
    }
    set({ transitioning: true, error: null });
    useActivityStore.setState({ serialTransition: true });
    try {
      if (options.protocol === "feetech")
        await serialConnect(options.port, options.baud);
      else if (options.protocol === "slcan") {
        await openRawSerial({
          ...options,
          dataBits: 8,
          parity: "none",
          stopBits: 1,
        });
        try {
          await initializeSlcan(options.canBitrate);
          slcanCarry = "";
        } catch (error) {
          await closeRawSerial();
          throw error;
        }
      } else await openRawSerial(options);
      set({
        protocol: options.protocol,
        interfaceType: options.interfaceType,
        port: options.port,
        baud: options.baud,
        canBitrate: options.protocol === "slcan" ? options.canBitrate : null,
        targetId: options.protocol === "feetech" ? options.targetId : null,
        position: null,
        torqueEnabled: false,
        locked: false,
      });
      useActivityStore.setState({
        serialConnected: true,
        hardwareConnected: true,
      });
      appendLog(
        "info",
        `已连接 ${options.port} · ${options.baud} baud · ${options.interfaceType.toUpperCase()} · ${options.protocol === "feetech" ? `飞特 SCS/STS · ID ${options.targetId}` : options.protocol === "slcan" ? `SLCAN ${options.canBitrate}` : "原始串口"}`,
      );
    } catch (error) {
      set({ error: errorMessage(error) });
      appendLog("error", `连接失败 · ${errorMessage(error)}`);
    } finally {
      set({ transitioning: false });
      useActivityStore.setState({ serialTransition: false });
    }
  },
  close: async () => {
    if (!get().port || get().transitioning) return;
    set({ transitioning: true, error: null });
    useActivityStore.setState({ serialTransition: true });
    try {
      const deadline = Date.now() + 2500;
      while (get().busy) {
        if (Date.now() >= deadline)
          throw new Error("当前通信尚未结束，请稍候再断开串口。");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
      }
      if (get().protocol === "feetech") await serialDisconnect();
      else {
        if (get().protocol === "slcan") {
          try {
            await closeSlcan();
          } catch (error) {
            appendLog("error", `关闭 CAN 通道未确认 · ${errorMessage(error)}`);
          }
        }
        await closeRawSerial();
      }
      appendLog("info", `已断开 ${get().port}`);
      set({
        protocol: null,
        interfaceType: null,
        port: null,
        baud: null,
        canBitrate: null,
        targetId: null,
        position: null,
        torqueEnabled: false,
        locked: false,
      });
      slcanCarry = "";
      useActivityStore.setState({
        serialConnected: false,
        hardwareConnected: false,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
      appendLog("error", `断开失败 · ${errorMessage(error)}`);
    } finally {
      set({ transitioning: false });
      useActivityStore.setState({ serialTransition: false });
    }
  },
  ping: async (id) => {
    await runFeetech(id, `Ping ID ${id}`, () => servoPing(id));
  },
  readPosition: async (id) => {
    const result = await runFeetech(id, `读取 ID ${id} 位置`, () =>
      servoReadPosition(id),
    );
    if (result.ok) set({ position: result.value });
  },
  setTorque: async (id, enabled) => {
    if (get().locked && enabled) return;
    const result = await runFeetech(
      id,
      `${enabled ? "使能" : "释放"} ID ${id} 扭矩`,
      () => servoSetTorque(id, enabled),
    );
    if (result.ok) set({ torqueEnabled: enabled });
  },
  setSpeed: async (id, speed) => {
    await runFeetech(id, `设置 ID ${id} 速度 ${speed} raw`, () =>
      servoWriteSpeed(id, speed),
    );
  },
  jog: async (id, delta, speed) => {
    if (
      !get().torqueEnabled ||
      get().locked ||
      !Number.isInteger(delta) ||
      Math.abs(delta) > 100 ||
      !Number.isInteger(speed) ||
      speed < 1 ||
      speed > 2400
    )
      return;
    await runFeetech(id, `读取 ID ${id} 当前位置`, async () => {
      await servoWriteSpeed(id, speed);
      const current = await servoReadPosition(id);
      set({ position: current });
      const target = Math.max(0, Math.min(4095, current + delta));
      await servoWritePosition(id, target);
      appendLog(
        "tx",
        `ID ${id} 目标位置 ${target} raw (${delta > 0 ? "+" : ""}${delta})`,
      );
      return `${current} → ${target} raw`;
    });
  },
  hold: async (id) => {
    if (
      get().protocol !== "feetech" ||
      !get().port ||
      get().busy ||
      get().targetId !== id
    )
      return;
    set({ locked: true });
    await runFeetech(id, `停止下发并保持 ID ${id} 当前位置`, async () => {
      const current = await servoReadPosition(id);
      await servoWritePosition(id, current);
      set({ position: current });
      return `${current} raw`;
    });
  },
  unlock: () => set({ locked: false }),
  transfer: async (tx, timeoutMs) => {
    if (
      get().protocol !== "raw" ||
      !get().port ||
      get().busy ||
      get().transitioning ||
      get().locked
    )
      return;
    set({ busy: true, error: null });
    if (tx.length) appendLog("tx", formatHexBytes(tx));
    try {
      const rx = await transferRawSerial(tx, timeoutMs);
      appendLog(
        "rx",
        rx.length ? formatHexBytes(rx) : `等待 ${timeoutMs} ms，未收到数据`,
      );
    } catch (error) {
      set({ error: errorMessage(error) });
      appendLog("error", errorMessage(error));
    } finally {
      set({ busy: false });
    }
  },
  sendCanFrame: async (frame) => {
    if (
      get().protocol !== "slcan" ||
      !get().port ||
      get().busy ||
      get().transitioning
    )
      return;
    let command: string;
    try {
      command = encodeSlcanFrame(frame);
    } catch (error) {
      set({ error: errorMessage(error) });
      return;
    }
    set({ busy: true, error: null });
    appendLog("tx", describeSlcanRecord(command));
    try {
      const rx = await sendSlcanFrame(frame);
      const records = logSlcanResponse(rx);
      if (!records.length) appendLog("info", "CAN 帧已由 Rust 串口会话确认");
    } catch (error) {
      set({ error: errorMessage(error) });
      appendLog("error", errorMessage(error));
    } finally {
      set({ busy: false });
    }
  },
  receiveCanFrames: async () => {
    if (
      get().protocol !== "slcan" ||
      !get().port ||
      get().busy ||
      get().transitioning
    )
      return;
    set({ busy: true, error: null });
    try {
      const rx = await receiveSlcanFrames();
      if (rx.length) logSlcanResponse(rx);
    } catch (error) {
      set({ error: errorMessage(error) });
      appendLog("error", errorMessage(error));
    } finally {
      set({ busy: false });
    }
  },
  clearLogs: () => set({ logs: [] }),
}));
