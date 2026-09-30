/** 单电机与舵机串口调试台。Created on 2026-09-27; Updated on 2026-09-30 @author: https://github.com/Linmoqian */
import { useEffect, useState } from "react";
import { CircleAlert, Radio } from "lucide-react";
import { isDesktop } from "../../../lib/serial";
import { activeDebugProtocol, closeDebugProtocol } from "../motor-debug/serialDebug";
import {
  useMotorDebugStore,
  type DebugProtocol,
} from "../motor-debug/session";
import BleDebug from "../bluetooth/BleDebug";
import { listBleCharacteristics } from "../bluetooth/ble";
import DebugCanPanel from "../components/DebugCanPanel";
import DebugConnectionForm from "../components/DebugConnectionForm";
import DebugFeetechPanel from "../components/DebugFeetechPanel";
import DebugLogPanel from "../components/DebugLogPanel";
import DebugRawPanel from "../components/DebugRawPanel";
import "./MotorDebug.css";

export default function MotorDebug() {
  const [mode, setMode] = useState<"serial" | "ble">("serial");
  const [bleConnected, setBleConnected] = useState(false);
  const serialConnected = useMotorDebugStore((state) => Boolean(state.port));
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void activeDebugProtocol()
      .then((selectedProtocol) => {
        if (selectedProtocol !== "ble-gatt") return;
        return listBleCharacteristics();
      })
      .then((characteristics) => {
        if (!characteristics || !active) return;
        setBleConnected(true);
        setMode("ble");
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <>
      <nav className="motor-debug__mode" aria-label="调试通信方式">
        <button type="button" className={mode === "serial" ? "is-active" : ""} disabled={bleConnected} onClick={() => setMode("serial")}>串口 / CAN</button>
        <button type="button" className={mode === "ble" ? "is-active" : ""} disabled={serialConnected} onClick={() => setMode("ble")}>蓝牙 BLE</button>
      </nav>
      {mode === "ble" ? <BleDebug onConnectionChange={setBleConnected} /> : <SerialDebug />}
    </>
  );
}

function SerialDebug() {
  const [orphanedProtocol, setOrphanedProtocol] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<DebugProtocol>("raw");
  const [motorId, setMotorId] = useState(1);
  const [canListening, setCanListening] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const sessionPort = useMotorDebugStore((state) => state.port);
  const sessionProtocol = useMotorDebugStore((state) => state.protocol);
  const sessionError = useMotorDebugStore((state) => state.error);
  const desktop = isDesktop();
  const connected = Boolean(sessionPort);
  const activeProtocol = sessionProtocol ?? protocol;

  useEffect(() => {
    if (!isDesktop() || sessionPort) return;
    let active = true;
    void activeDebugProtocol().then((selectedProtocol) => {
      if (active && selectedProtocol && selectedProtocol !== "ble-gatt")
        setOrphanedProtocol(selectedProtocol);
    }).catch(() => {});
    return () => { active = false; };
  }, [sessionPort]);

  return (
    <div className="motor-debug">
      <header className="motor-debug__header">
        <div>
          <span className="motor-debug__eyebrow">实验操作 / HARDWARE LAB</span>
          <h1>单电机调试</h1>
          <p>
            选择 TTL、RS485 或 CAN 接口，设置通信参数，再对单个设备收发与调试。
          </p>
        </div>
        <span
          className={`motor-debug__status ${connected ? "is-connected" : ""}`}
        >
          <Radio size={15} />{" "}
          {connected ? `${sessionPort} · 已连接` : "未连接"}
        </span>
      </header>

      {!desktop && (
        <div className="motor-debug__notice" role="status">
          <CircleAlert size={17} /> 浏览器仅供界面预览。扫描、连接和收发需要
          Tauri 桌面应用。
        </div>
      )}
      {orphanedProtocol && !connected && (
        <div className="motor-debug__notice" role="status">
          <CircleAlert size={17} /> 桌面后端仍保留 {orphanedProtocol} 调试连接。
          <button type="button" className="motor-debug__button" onClick={() => {
            void closeDebugProtocol().then((warning) => {
              setOrphanedProtocol(null);
              setInputError(warning ? `已断开，适配器警告：${warning}` : null);
            }).catch((error: unknown) => setInputError(error instanceof Error ? error.message : String(error)));
          }}>断开旧会话</button>
        </div>
      )}
      {(sessionError || scanError || inputError) && (
        <div className="motor-debug__notice is-error" role="alert">
          <CircleAlert size={17} /> {inputError || sessionError || scanError}
        </div>
      )}

      <div className="motor-debug__layout">
        <div className="motor-debug__controls">
          <DebugConnectionForm
            protocol={protocol}
            onProtocolChange={setProtocol}
            motorId={motorId}
            onStopListening={() => setCanListening(false)}
            onScanError={setScanError}
            onInputError={setInputError}
          />

          {activeProtocol === "feetech" ? (
            <DebugFeetechPanel motorId={motorId} onMotorIdChange={setMotorId} />
          ) : activeProtocol === "slcan" ? (
            <DebugCanPanel
              canListening={canListening}
              onToggleListening={() => setCanListening((current) => !current)}
              onInputError={setInputError}
            />
          ) : (
            <DebugRawPanel onInputError={setInputError} />
          )}
        </div>

        <DebugLogPanel activeProtocol={activeProtocol} />
      </div>
    </div>
  );
}
