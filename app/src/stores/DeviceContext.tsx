// Created on 2026-09-26
// @author: https://github.com/Linmoqian
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SAFETY,
  DEFAULT_TUNE,
  MOTORS,
  NO_FAULT,
  type ControlMode,
  type FaultFlags,
  type Motor,
  type SafetyLimits,
  type SerialPort,
  type TuneParams,
} from "../core/motors";
import {
  isDesktop,
  serialConnect,
  serialDisconnect,
  listSerialPorts,
  servoSetTorque,
  servoSyncReadPositions,
  servoWritePosition,
} from "../lib/serial";
import { angleToPosition, positionToAngle } from "../lib/units";
import { useActivityStore } from "./activity";
import { useBridgeStore } from "./bridgeStore";
import { serialConnectionBlockedReason } from "../lib/serialConnectionGuard";

/** 波特率（与 claw_arm/script 一致，SO-100 走 1M） */
const BAUDRATE = 1_000_000;
/** 实时位置采样间隔（ms）；串口半双工，5Hz 安全 */
const TICK_MS = 200;

const round1 = (n: number) => Math.round(n * 10) / 10;

const initMotors = (): Motor[] => MOTORS.map((m) => ({ ...m }));

const initMap = <T,>(value: T): Record<string, T> =>
  Object.fromEntries(MOTORS.map((m) => [m.id, value]));

export type DeviceContextValue = {
  // 连接
  ports: SerialPort[];
  scanning: boolean;
  connectingPort: string | null;
  disconnecting: boolean;
  connectionError: string | null;
  lastAttemptedPort: string | null;
  connected: boolean;
  deviceId: string | null;
  scanPorts: () => Promise<void>;
  connect: (portName: string) => Promise<void>;
  disconnect: () => Promise<void>;

  // 电机
  motors: Motor[];
  selectedId: string;
  selectMotor: (id: string) => void;
  setEnabled: (id: string, on: boolean) => Promise<void>;
  setTarget: (id: string, value: number) => Promise<void>;

  // 模式
  mode: ControlMode;
  setMode: (m: ControlMode) => void;

  // 参数
  tuneByMotor: Record<string, TuneParams>;
  dirtyByMotor: Record<string, boolean>;
  planSavedByMotor: Record<string, boolean>;
  updateTune: (id: string, patch: Partial<TuneParams>) => void;
  saveTunePlan: (id: string) => void;
  resetTune: (id: string) => void;

  // 运行
  running: boolean;
  setRunning: (on: boolean) => void;

  // 安全
  estop: boolean;
  triggerEstop: () => void;
  clearEstop: () => void;
  safety: SafetyLimits;
  setSafety: (patch: Partial<SafetyLimits>) => void;
  faults: Record<string, FaultFlags>;

  // 导出
  exportConfig: () => string;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDevice 必须在 DeviceProvider 内使用");
  return ctx;
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingPort, setConnectingPort] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastAttemptedPort, setLastAttemptedPort] = useState<string | null>(
    null,
  );
  const connectionBusyRef = useRef(false);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const [motors, setMotors] = useState<Motor[]>(initMotors);
  const [selectedId, setSelectedId] = useState(MOTORS[0].id);

  const [mode, setMode] = useState<ControlMode>("position");

  const [tuneByMotor, setTuneByMotor] = useState<Record<string, TuneParams>>(
    () => initMap({ ...DEFAULT_TUNE }),
  );
  const [dirtyByMotor, setDirtyByMotor] = useState<Record<string, boolean>>(
    () => initMap(false),
  );
  const [planSavedByMotor, setPlanSavedByMotor] = useState<
    Record<string, boolean>
  >(() => initMap(true));

  const [running, setRunning] = useState(true);

  const [estop, setEstop] = useState(false);
  const [safety, setSafetyState] = useState<SafetyLimits>({
    ...DEFAULT_SAFETY,
  });
  const [faults] = useState<Record<string, FaultFlags>>(() =>
    initMap({ ...NO_FAULT }),
  );

  // 写操作需要最新 motors/connected，用 ref 镜像避免回调频繁重建
  const motorsRef = useRef(motors);
  motorsRef.current = motors;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  // 平滑插值动画 token（per-motor，新请求自增以取消旧动画）
  const animTokens = useRef<Record<string, number>>({});
  // 通信丢失标志：tick 检测到链路整体失败时置 true，写操作据此停止下发
  const commLostRef = useRef(false);

  const sleep = (ms: number) =>
    new Promise<void>((r) => window.setTimeout(r, ms));

  // ---- 连接动作 ----
  const scanPorts = useCallback(async () => {
    if (scanningRef.current || connectionBusyRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setConnectionError(null);
    try {
      if (isDesktop()) {
        const names = await listSerialPorts();
        setPorts(names.map((name) => ({ name, baud: BAUDRATE, inUse: false })));
      } else {
        // 浏览器预览模式：无串口访问能力，置空由 UI 给出占位提示
        setPorts([]);
      }
    } catch (e) {
      console.error("[scanPorts]", e);
      setConnectionError(`扫描失败：${String(e)}。请检查设备连接后重试。`);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  const connect = useCallback(async (portName: string) => {
    // 浏览器端无串口能力，不建立连接
    if (connectionBusyRef.current || connectedRef.current) return;
    const bridge = useBridgeStore.getState();
    const blockedReason = serialConnectionBlockedReason(
      useActivityStore.getState(),
      bridge.bridge.kind === "replay" || bridge.replay !== null,
    );
    if (blockedReason) {
      setConnectionError(blockedReason);
      return;
    }
    if (!isDesktop()) {
      setConnectionError(
        "串口连接需要桌面应用；浏览器中可以继续使用仿真与积木编程。",
      );
      return;
    }
    connectionBusyRef.current = true;
    useActivityStore.setState({ serialTransition: true });
    setConnectingPort(portName);
    setLastAttemptedPort(portName);
    setConnectionError(null);
    try {
      const id = await serialConnect(portName, BAUDRATE);
      setDeviceId(id);
      setPorts((prev) =>
        prev.map((p) => (p.name === portName ? { ...p, inUse: true } : p)),
      );
      setConnected(true);
      useActivityStore.setState({
        serialConnected: true,
        hardwareConnected: true,
      });
    } catch (e) {
      console.error("[connect]", e);
      setConnectionError(
        `连接 ${portName} 失败：${String(e)}。请确认端口未被其他程序占用后重试。`,
      );
    } finally {
      connectionBusyRef.current = false;
      useActivityStore.setState({ serialTransition: false });
      setConnectingPort(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (connectionBusyRef.current) return;
    connectionBusyRef.current = true;
    useActivityStore.setState({ serialTransition: true });
    setDisconnecting(true);
    setConnectionError(null);
    try {
      if (isDesktop()) {
        await serialDisconnect();
      }
      setPorts((prev) => prev.map((p) => ({ ...p, inUse: false })));
      setConnected(false);
      useActivityStore.setState({
        serialConnected: false,
        hardwareConnected: false,
      });
      setDeviceId(null);
      commLostRef.current = false;
      animTokens.current = {};
      setMotors((prev) =>
        prev.map((m) => ({
          ...m,
          enabled: false,
          angle: 0,
          velocity: 0,
          target: 0,
        })),
      );
    } catch (e) {
      console.error("[disconnect]", e);
      setConnectionError(`断开失败：${String(e)}。尚未确认串口断开，请重试。`);
    } finally {
      connectionBusyRef.current = false;
      useActivityStore.setState({ serialTransition: false });
      setDisconnecting(false);
    }
  }, []);

  // ---- 电机动作 ----
  const selectMotor = useCallback((id: string) => setSelectedId(id), []);

  const setEnabled = useCallback(async (id: string, on: boolean) => {
    const m = motorsRef.current.find((x) => x.id === id);
    if (!m) return;
    // 通信丢失：停止发送指令，保持当前力矩（skill 规则）
    if (isDesktop() && connectedRef.current && !commLostRef.current) {
      try {
        await servoSetTorque(m.hwId, on);
      } catch (e) {
        console.error("[setEnabled]", e);
        return; // 硬件失败则不更新本地状态
      }
    }
    setMotors((prev) =>
      prev.map((x) => (x.id === id ? { ...x, enabled: on } : x)),
    );
  }, []);

  const setTarget = useCallback(async (id: string, value: number) => {
    const m = motorsRef.current.find((x) => x.id === id);
    if (!m) return;
    const clamped = Math.max(m.min, Math.min(m.max, value));
    setMotors((prev) =>
      prev.map((x) => (x.id === id ? { ...x, target: clamped } : x)),
    );
    // 通信丢失或未连接：仅更新本地目标，不下发（skill：停止发送指令，保持当前力矩）
    if (!isDesktop() || !connectedRef.current || commLostRef.current) return;

    // 低速平滑插值（参考 move_smooth）：30 步 × 20ms，消除抖动
    const myToken = (animTokens.current[id] ?? 0) + 1;
    animTokens.current[id] = myToken;
    const start = m.angle;
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      if (animTokens.current[id] !== myToken) return; // 被新请求取消
      if (estopRef.current) return; // 急停中断
      const interp = start + (clamped - start) * (i / steps);
      try {
        await servoWritePosition(m.hwId, angleToPosition(interp, m.hwId));
      } catch (e) {
        console.error("[setTarget]", e);
        return;
      }
      await sleep(20);
    }
  }, []);

  // ---- 参数动作 ----
  const updateTune = useCallback((id: string, patch: Partial<TuneParams>) => {
    setTuneByMotor((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setDirtyByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  const saveTunePlan = useCallback((id: string) => {
    setDirtyByMotor((prev) => ({ ...prev, [id]: false }));
    setPlanSavedByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  const resetTune = useCallback((id: string) => {
    setTuneByMotor((prev) => ({ ...prev, [id]: { ...DEFAULT_TUNE } }));
    setDirtyByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  // ---- 安全动作 ----
  const triggerEstop = useCallback(async () => {
    setEstop(true);
    setRunning(false);
    animTokens.current = {}; // 取消所有平滑动画（进行中的循环检测 token 失配后退出）
    if (isDesktop() && connectedRef.current && !commLostRef.current) {
      // 急停 = 原地停住：读当前 present 写入 goal，保持扭矩。
      // 不 disable torque，避免抗重力关节失力坠落（skill 第一守则：确保用户安全）。
      try {
        const ids = MOTORS.map((m) => m.hwId);
        const readings = await servoSyncReadPositions(ids);
        for (const r of readings) {
          if (!r.ok) continue;
          try {
            await servoWritePosition(r.id, r.position);
          } catch (e) {
            console.error("[estop write]", e);
          }
        }
      } catch (e) {
        console.error("[estop read]", e);
      }
    }
  }, []);

  const clearEstop = useCallback(() => setEstop(false), []);

  const setSafety = useCallback(
    (patch: Partial<SafetyLimits>) =>
      setSafetyState((prev) => ({ ...prev, ...patch })),
    [],
  );

  // ---- 导出 ----
  const exportConfig = useCallback(() => {
    const dump = {
      version: 1,
      deviceId,
      mode,
      safety,
      motors: motors.map((m) => ({
        id: m.id,
        hwId: m.hwId,
        code: m.code,
        min: m.min,
        max: m.max,
      })),
      tune: tuneByMotor,
    };
    return JSON.stringify(dump, null, 2);
  }, [deviceId, mode, safety, motors, tuneByMotor]);

  // ---- 实时位置采样：仅桌面端连接且运行且未急停时，批量读取舵机当前位置 ----

  const runningRef = useRef(running);
  const estopRef = useRef({ value: false });
  runningRef.current = running;
  // eslint-disable-next-line react-hooks/immutability -- 提供同步只读镜像，供采样回调判断急停
  estopRef.current.value = estop;

  useEffect(() => {
    if (!isDesktop()) return; // 浏览器端无硬件，不开采样
    let active = true;
    let busy = false;

    const tick = async () => {
      if (!active || busy) return;
      if (
        !connectedRef.current ||
        estopRef.current.value ||
        !runningRef.current
      )
        return;
      busy = true;
      try {
        const ids = MOTORS.map((m) => m.hwId);
        const readings = await servoSyncReadPositions(ids);
        if (!active) return;
        // 链路整体失败 → 通信丢失：停止下发（写操作据此保持当前力矩），读数保持上次
        const allFailed = readings.length > 0 && readings.every((r) => !r.ok);
        commLostRef.current = allFailed;
        if (allFailed) return;
        const byId = new Map(readings.map((r) => [r.id, r]));
        setMotors((prev) =>
          prev.map((m) => {
            const r = byId.get(m.hwId);
            // 单电机读数失败（掉线）时保持上一次角度，避免跳变
            if (!r || !r.ok) return m;
            return { ...m, angle: round1(positionToAngle(r.position, m.hwId)) };
          }),
        );
      } catch (e) {
        console.error("[tick]", e);
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const value: DeviceContextValue = {
    ports,
    scanning,
    connectingPort,
    disconnecting,
    connectionError,
    lastAttemptedPort,
    connected,
    deviceId,
    scanPorts,
    connect,
    disconnect,
    motors,
    selectedId,
    selectMotor,
    setEnabled,
    setTarget,
    mode,
    setMode,
    tuneByMotor,
    dirtyByMotor,
    planSavedByMotor,
    updateTune,
    saveTunePlan,
    resetTune,
    running,
    setRunning,
    estop,
    triggerEstop,
    clearEstop,
    safety,
    setSafety,
    faults,
    exportConfig,
  };

  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}
