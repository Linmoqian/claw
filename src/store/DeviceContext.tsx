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
} from "../types";

/** mock 扫描到的串口列表 */
const MOCK_PORTS: SerialPort[] = [
  { name: "COM3", baud: 115200, inUse: false },
  { name: "COM5", baud: 115200, inUse: true },
  { name: "COM7", baud: 921600, inUse: false },
];

const MOCK_DEVICE_ID = "CLW-7A4F-209B";

const initMotors = (): Motor[] => MOTORS.map((m) => ({ ...m, enabled: false }));

const initMap = <T,>(value: T): Record<string, T> =>
  Object.fromEntries(MOTORS.map((m) => [m.id, value]));

export type DeviceContextValue = {
  // 连接
  ports: SerialPort[];
  scanning: boolean;
  connected: boolean;
  deviceId: string | null;
  scanPorts: () => void;
  connect: (portName: string) => void;
  disconnect: () => void;

  // 电机
  motors: Motor[];
  selectedId: string;
  selectMotor: (id: string) => void;
  setEnabled: (id: string, on: boolean) => void;
  setTarget: (id: string, value: number) => void;

  // 模式
  mode: ControlMode;
  setMode: (m: ControlMode) => void;

  // 参数
  tuneByMotor: Record<string, TuneParams>;
  dirtyByMotor: Record<string, boolean>;
  flashByMotor: Record<string, boolean>;
  updateTune: (id: string, patch: Partial<TuneParams>) => void;
  saveToFlash: (id: string) => void;
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
  const [connected, setConnected] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const [motors, setMotors] = useState<Motor[]>(initMotors);
  const [selectedId, setSelectedId] = useState(MOTORS[0].id);

  const [mode, setMode] = useState<ControlMode>("position");

  const [tuneByMotor, setTuneByMotor] = useState<Record<string, TuneParams>>(() =>
    initMap({ ...DEFAULT_TUNE }),
  );
  const [dirtyByMotor, setDirtyByMotor] = useState<Record<string, boolean>>(() =>
    initMap(false),
  );
  const [flashByMotor, setFlashByMotor] = useState<Record<string, boolean>>(() =>
    initMap(true),
  );

  const [running, setRunning] = useState(true);

  const [estop, setEstop] = useState(false);
  const [safety, setSafetyState] = useState<SafetyLimits>({ ...DEFAULT_SAFETY });
  const [faults] = useState<Record<string, FaultFlags>>(() =>
    initMap({ ...NO_FAULT }),
  );

  // ---- 连接动作 ----
  const scanPorts = useCallback(() => {
    setScanning(true);
    window.setTimeout(() => {
      setPorts(MOCK_PORTS);
      setScanning(false);
    }, 500);
  }, []);

  const connect = useCallback((portName: string) => {
    setPorts((prev) =>
      prev.map((p) => (p.name === portName ? { ...p, inUse: true } : p)),
    );
    setConnected(true);
    setDeviceId(MOCK_DEVICE_ID);
  }, []);

  const disconnect = useCallback(() => {
    setPorts((prev) => prev.map((p) => ({ ...p, inUse: false })));
    setConnected(false);
    setDeviceId(null);
    setMotors((prev) => prev.map((m) => ({ ...m, enabled: false })));
  }, []);

  // ---- 电机动作 ----
  const selectMotor = useCallback((id: string) => setSelectedId(id), []);

  const setEnabled = useCallback((id: string, on: boolean) => {
    setMotors((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: on } : m)),
    );
  }, []);

  const setTarget = useCallback((id: string, value: number) => {
    setMotors((prev) =>
      prev.map((m) => (m.id === id ? { ...m, target: value } : m)),
    );
  }, []);

  // ---- 参数动作 ----
  const updateTune = useCallback((id: string, patch: Partial<TuneParams>) => {
    setTuneByMotor((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setDirtyByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  const saveToFlash = useCallback((id: string) => {
    setDirtyByMotor((prev) => ({ ...prev, [id]: false }));
    setFlashByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  const resetTune = useCallback((id: string) => {
    setTuneByMotor((prev) => ({ ...prev, [id]: { ...DEFAULT_TUNE } }));
    setDirtyByMotor((prev) => ({ ...prev, [id]: true }));
  }, []);

  // ---- 安全动作 ----
  const triggerEstop = useCallback(() => {
    setEstop(true);
    setMotors((prev) => prev.map((m) => ({ ...m, enabled: false })));
    setRunning(false);
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
        code: m.code,
        min: m.min,
        max: m.max,
      })),
      tune: tuneByMotor,
    };
    return JSON.stringify(dump, null, 2);
  }, [deviceId, mode, safety, motors, tuneByMotor]);

  // ---- mock 实时数据 tick（仅连接且运行且未急停时更新已使能电机） ----
  const runningRef = useRef(running);
  const estopRef = useRef(estop);
  const connectedRef = useRef(connected);
  runningRef.current = running;
  estopRef.current = estop;
  connectedRef.current = connected;

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (!connectedRef.current || estopRef.current || !runningRef.current) return;
      setMotors((prev) =>
        prev.map((m) => {
          if (!m.enabled) return m;
          const err = m.target - m.angle;
          const next = m.angle + err * 0.08 + (Math.random() - 0.5) * 0.3;
          const vel = Math.abs(err) * 6 + (Math.random() - 0.5);
          const clamped = Math.max(m.min, Math.min(m.max, next));
          return {
            ...m,
            angle: clamped,
            velocity: Math.round(vel * 10) / 10,
            current: Math.max(0, m.current + (Math.random() - 0.5) * 0.08),
            temp: Math.max(25, m.temp + (Math.random() - 0.5) * 0.15),
          };
        }),
      );
    }, 200);
    return () => window.clearInterval(tick);
  }, []);

  const value: DeviceContextValue = {
    ports,
    scanning,
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
    flashByMotor,
    updateTune,
    saveToFlash,
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
