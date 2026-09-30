// CAN 帧收发面板：仲裁 ID 与数据字节发送，读取缓冲与 400ms 连续监听轮询。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { useEffect, useState, type FormEvent } from "react";
import { Cable, Radio } from "lucide-react";
import { parseHexBytes } from "../motor-debug/serialDebug";
import { useMotorDebugStore } from "../motor-debug/session";

interface DebugCanPanelProps {
  canListening: boolean;
  onToggleListening: () => void;
  onInputError: (message: string | null) => void;
}

export default function DebugCanPanel({
  canListening,
  onToggleListening,
  onInputError,
}: DebugCanPanelProps) {
  const [canId, setCanId] = useState("100");
  const [canExtended, setCanExtended] = useState(false);
  const [canPayload, setCanPayload] = useState("");
  const sessionPort = useMotorDebugStore((state) => state.port);
  const sessionProtocol = useMotorDebugStore((state) => state.protocol);
  const busy = useMotorDebugStore((state) => state.busy || state.transitioning);
  const sendCanFrame = useMotorDebugStore((state) => state.sendCanFrame);
  const receiveCanFrames = useMotorDebugStore(
    (state) => state.receiveCanFrames,
  );
  const connected = Boolean(sessionPort);

  useEffect(() => {
    if (!canListening || sessionProtocol !== "slcan" || !sessionPort) return;
    const timer = window.setInterval(() => {
      void useMotorDebugStore.getState().receiveCanFrames();
    }, 400);
    return () => window.clearInterval(timer);
  }, [canListening, sessionProtocol, sessionPort]);

  const sendCan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onInputError(null);
    try {
      const source = canId.trim().replace(/^0x/i, "");
      if (!/^[0-9a-f]+$/i.test(source))
        throw new Error("CAN ID 须为十六进制数。");
      const id = Number.parseInt(source, 16);
      const data = canPayload.trim() ? parseHexBytes(canPayload) : [];
      if (data.length > 8) throw new Error("经典 CAN 数据区最多 8 字节。");
      void sendCanFrame({ id, extended: canExtended, data });
    } catch (error) {
      onInputError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section
      className="motor-debug__panel"
      aria-labelledby="motor-debug-can-title"
    >
      <div className="motor-debug__panel-head">
        <span className="motor-debug__number">02</span>
        <div>
          <h2 id="motor-debug-can-title">CAN 帧收发</h2>
          <p>
            填写仲裁 ID 与最多 8 字节数据，查看适配器确认及总线回帧。
          </p>
        </div>
      </div>
      <form onSubmit={sendCan} className="motor-debug__send-form">
        <div className="motor-debug__fields is-two">
          <label>
            仲裁 ID（HEX）
            <input
              value={canId}
              onChange={(event) => setCanId(event.target.value)}
              placeholder="例如 100"
            />
          </label>
          <label>
            帧格式
            <select
              value={canExtended ? "extended" : "standard"}
              onChange={(event) =>
                setCanExtended(event.target.value === "extended")
              }
            >
              <option value="standard">标准帧 · 11 位</option>
              <option value="extended">扩展帧 · 29 位</option>
            </select>
          </label>
        </div>
        <label>
          数据字节（HEX，可空）
          <textarea
            rows={3}
            value={canPayload}
            onChange={(event) => setCanPayload(event.target.value)}
            placeholder="例如 01 02 03 04"
          />
        </label>
        <div className="motor-debug__actions">
          <button
            type="submit"
            className="motor-debug__button is-primary"
            disabled={!connected || busy}
          >
            <Cable size={15} /> 发送 CAN 帧
          </button>
          <button
            type="button"
            className="motor-debug__button"
            disabled={!connected || busy}
            onClick={() => void receiveCanFrames()}
          >
            <Radio size={15} /> 读取接收缓冲
          </button>
          <button
            type="button"
            className={`motor-debug__button ${canListening ? "is-listening" : ""}`}
            disabled={!connected}
            aria-pressed={canListening}
            onClick={onToggleListening}
          >
            <Radio size={15} />{" "}
            {canListening ? "停止连续监听" : "连续监听"}
          </button>
        </div>
      </form>
      <p className="motor-debug__hint">
        发送只表示适配器接受帧，不代表电机已执行；收到的总线帧显示在右侧日志。此入口不支持
        CAN FD 或厂商私有 USB-CAN 驱动。
      </p>
    </section>
  );
}
