/** 单电机与舵机串口调试台。Created on 2026-09-27; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
import { useEffect, useState, type FormEvent } from "react";
import {
  Cable,
  CircleAlert,
  LoaderCircle,
  PlugZap,
  Radio,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { isDesktop, listSerialPorts } from "../../../lib/serial";
import {
  parseHexBytes,
  type RawSerialOptions,
} from "../motor-debug/serialDebug";
import {
  useMotorDebugStore,
  type DebugInterface,
  type DebugProtocol,
} from "../motor-debug/session";
import { CAN_BITRATES, type CanBitrateCode } from "../motor-debug/slcan";
import BleDebug from "../bluetooth/BleDebug";
import { listBleCharacteristics } from "../bluetooth/ble";
import "./MotorDebug.css";

const BAUD_PRESETS = [
  9600, 19200, 38400, 57600, 115200, 250000, 500000, 1000000,
];

export default function MotorDebug() {
  const [mode, setMode] = useState<"serial" | "ble">("serial");
  const [bleConnected, setBleConnected] = useState(false);
  const serialConnected = useMotorDebugStore((state) => Boolean(state.port));
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void listBleCharacteristics().then(() => {
      if (!active) return;
      setBleConnected(true);
      setMode("ble");
    }).catch(() => {});
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
  const [interfaceType, setInterfaceType] = useState<DebugInterface>("ttl");
  const [protocol, setProtocol] = useState<DebugProtocol>("raw");
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [baud, setBaud] = useState("115200");
  const [canBitrate, setCanBitrate] = useState<CanBitrateCode>("S6");
  const [canId, setCanId] = useState("100");
  const [canExtended, setCanExtended] = useState(false);
  const [canPayload, setCanPayload] = useState("");
  const [canListening, setCanListening] = useState(false);
  const [dataBits, setDataBits] = useState<RawSerialOptions["dataBits"]>(8);
  const [parity, setParity] = useState<RawSerialOptions["parity"]>("none");
  const [stopBits, setStopBits] = useState<RawSerialOptions["stopBits"]>(1);
  const [motorId, setMotorId] = useState(1);
  const [speed, setSpeed] = useState(150);
  const [format, setFormat] = useState<"hex" | "text">("hex");
  const [payload, setPayload] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "lf" | "crlf">("none");
  const [timeout, setTimeoutMs] = useState(500);
  const [inputError, setInputError] = useState<string | null>(null);
  const session = useMotorDebugStore();
  const desktop = isDesktop();
  const connected = Boolean(session.port);
  const busy = session.busy || session.transitioning;
  const activeProtocol = session.protocol ?? protocol;
  const activeInterface = session.interfaceType ?? interfaceType;
  const activeMotorId = session.targetId ?? motorId;

  const scanPorts = async (): Promise<void> => {
    if (!desktop || scanning) return;
    setScanning(true);
    setScanError(null);
    try {
      const names = await listSerialPorts();
      setPorts(names);
      setPort((current) => current || names[0] || "");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void listSerialPorts()
      .then((names) => {
        if (!active) return;
        setPorts(names);
        setPort((current) => current || names[0] || "");
      })
      .catch((error: unknown) => {
        if (active)
          setScanError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (!canListening || session.protocol !== "slcan" || !session.port) return;
    const timer = window.setInterval(() => {
      void useMotorDebugStore.getState().receiveCanFrames();
    }, 400);
    return () => window.clearInterval(timer);
  }, [canListening, session.protocol, session.port]);

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setInputError(null);
    const selectedBaud = Number(baud);
    if (!port.trim()) {
      setInputError("请选择串口，或输入系统中的端口名。");
      return;
    }
    if (
      !Number.isInteger(selectedBaud) ||
      selectedBaud < 300 ||
      selectedBaud > 4000000
    ) {
      setInputError("波特率须为 300–4,000,000 的整数。");
      return;
    }
    void session.open({
      protocol,
      interfaceType,
      canBitrate,
      targetId: protocol === "feetech" ? motorId : null,
      port: port.trim(),
      baud: selectedBaud,
      dataBits,
      parity,
      stopBits,
    });
  };

  const sendCan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setInputError(null);
    try {
      const source = canId.trim().replace(/^0x/i, "");
      if (!/^[0-9a-f]+$/i.test(source))
        throw new Error("CAN ID 须为十六进制数。");
      const id = Number.parseInt(source, 16);
      const data = canPayload.trim() ? parseHexBytes(canPayload) : [];
      if (data.length > 8) throw new Error("经典 CAN 数据区最多 8 字节。");
      void session.sendCanFrame({ id, extended: canExtended, data });
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    }
  };

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setInputError(null);
    try {
      const bytes =
        format === "hex"
          ? parseHexBytes(payload)
          : Array.from(
              new TextEncoder().encode(
                payload +
                  (lineEnding === "lf"
                    ? "\n"
                    : lineEnding === "crlf"
                      ? "\r\n"
                      : ""),
              ),
            );
      if (!bytes.length) throw new Error("请先填写要发送的内容。");
      if (bytes.length > 512) throw new Error("单次发送最多 512 字节。");
      void session.transfer(bytes, timeout);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    }
  };

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
          {connected ? `${session.port} · 已连接` : "未连接"}
        </span>
      </header>

      {!desktop && (
        <div className="motor-debug__notice" role="status">
          <CircleAlert size={17} /> 浏览器仅供界面预览。扫描、连接和收发需要
          Tauri 桌面应用。
        </div>
      )}
      {(session.error || scanError || inputError) && (
        <div className="motor-debug__notice is-error" role="alert">
          <CircleAlert size={17} /> {inputError || session.error || scanError}
        </div>
      )}

      <div className="motor-debug__layout">
        <div className="motor-debug__controls">
          <form className="motor-debug__panel" onSubmit={connect}>
            <div className="motor-debug__panel-head">
              <span className="motor-debug__number">01</span>
              <div>
                <h2>通信连接</h2>
                <p>串口、协议和波特率在连接期间保持固定。</p>
              </div>
            </div>
            <div
              className="motor-debug__interfaces"
              role="group"
              aria-label="通信接口"
            >
              {(["ttl", "rs485", "can"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={activeInterface === item ? "is-active" : ""}
                  aria-pressed={activeInterface === item}
                  disabled={connected || busy}
                  onClick={() => {
                    setInterfaceType(item);
                    setProtocol(item === "can" ? "slcan" : "raw");
                    setBaud("115200");
                  }}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="motor-debug__fields">
              <label>
                协议
                <select
                  value={activeProtocol}
                  disabled={connected || busy}
                  onChange={(event) => {
                    const next = event.target.value as DebugProtocol;
                    setProtocol(next);
                    if (next === "feetech") setBaud("1000000");
                  }}
                >
                  {activeInterface === "can" ? (
                    <option value="slcan">SLCAN · Lawicel ASCII</option>
                  ) : (
                    <>
                      <option value="raw">原始串口 · HEX / UTF-8</option>
                      <option value="feetech">飞特 SCS/STS</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                串口
                <div className="motor-debug__port">
                  <input
                    list="motor-debug-ports"
                    value={connected ? (session.port ?? "") : port}
                    disabled={connected || busy}
                    onChange={(event) => setPort(event.target.value)}
                    placeholder="例如 COM3"
                  />
                  <datalist id="motor-debug-ports">
                    {ports.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => void scanPorts()}
                    disabled={!desktop || busy || scanning}
                    title="重新扫描串口"
                    aria-label="重新扫描串口"
                  >
                    {scanning ? (
                      <LoaderCircle className="wb-spin" size={16} />
                    ) : (
                      <RotateCw size={16} />
                    )}
                  </button>
                </div>
              </label>
              <label>
                {activeInterface === "can" ? "适配器串口波特率" : "波特率"}
                <input
                  list="motor-debug-baud"
                  inputMode="numeric"
                  value={connected ? String(session.baud ?? "") : baud}
                  disabled={connected || busy}
                  onChange={(event) => setBaud(event.target.value)}
                />
                <datalist id="motor-debug-baud">
                  {BAUD_PRESETS.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>
            </div>
            {activeProtocol === "raw" && (
              <div className="motor-debug__serial-options">
                <label>
                  数据位
                  <select
                    value={dataBits}
                    disabled={connected || busy}
                    onChange={(event) =>
                      setDataBits(
                        Number(
                          event.target.value,
                        ) as RawSerialOptions["dataBits"],
                      )
                    }
                  >
                    {[5, 6, 7, 8].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  校验位
                  <select
                    value={parity}
                    disabled={connected || busy}
                    onChange={(event) =>
                      setParity(
                        event.target.value as RawSerialOptions["parity"],
                      )
                    }
                  >
                    <option value="none">无</option>
                    <option value="even">偶校验</option>
                    <option value="odd">奇校验</option>
                  </select>
                </label>
                <label>
                  停止位
                  <select
                    value={stopBits}
                    disabled={connected || busy}
                    onChange={(event) =>
                      setStopBits(
                        Number(
                          event.target.value,
                        ) as RawSerialOptions["stopBits"],
                      )
                    }
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </label>
              </div>
            )}
            {activeProtocol === "slcan" && (
              <div className="motor-debug__serial-options is-can">
                <label>
                  CAN 总线速率
                  <select
                    value={session.canBitrate ?? canBitrate}
                    disabled={connected || busy}
                    onChange={(event) =>
                      setCanBitrate(event.target.value as CanBitrateCode)
                    }
                  >
                    {CAN_BITRATES.map((rate) => (
                      <option key={rate.code} value={rate.code}>
                        {rate.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span>经典 CAN · 标准帧与扩展帧 · 8N1</span>
              </div>
            )}
            <p className="motor-debug__hint">
              {activeProtocol === "feetech"
                ? "飞特串口协议使用 8N1；请确认所用 TTL/RS485 转接器与舵机电气接口匹配。"
                : activeProtocol === "slcan"
                  ? "仅支持提供虚拟 COM 串口且兼容 SLCAN/Lawicel ASCII 的 USB-CAN 适配器；串口波特率和 CAN 总线速率分别设置。"
                  : activeInterface === "rs485"
                    ? "RS485 需要自动收发方向控制的转接器；本页按设备手册收发原始字节。"
                    : "TTL 串口需要电平匹配的转接器；本页按设备手册收发原始字节。"}
            </p>
            <div className="motor-debug__actions">
              {connected ? (
                <button
                  type="button"
                  className="motor-debug__button"
                  disabled={busy}
                  onClick={() => {
                    setCanListening(false);
                    void session.close();
                  }}
                >
                  <Square size={15} /> 断开连接
                </button>
              ) : (
                <button
                  type="submit"
                  className="motor-debug__button is-primary"
                  disabled={!desktop || busy || !port.trim()}
                  title={
                    !desktop
                      ? "请在 Tauri 桌面应用中连接"
                      : !port.trim()
                        ? "请先选择串口"
                        : undefined
                  }
                >
                  <PlugZap size={15} />{" "}
                  {session.transitioning ? "连接中…" : "连接串口"}
                </button>
              )}
            </div>
          </form>

          {activeProtocol === "feetech" ? (
            <section
              className="motor-debug__panel"
              aria-labelledby="motor-debug-device-title"
            >
              <div className="motor-debug__panel-head">
                <span className="motor-debug__number">02</span>
                <div>
                  <h2 id="motor-debug-device-title">单 ID 舵机</h2>
                  <p>每次只对所选 ID 发送指令，不扫描整条总线。</p>
                </div>
              </div>
              <div className="motor-debug__fields is-two">
                <label>
                  舵机 ID
                  <input
                    type="number"
                    min={1}
                    max={253}
                    step={1}
                    value={activeMotorId}
                    disabled={connected || busy}
                    onChange={(event) => setMotorId(Number(event.target.value))}
                  />
                </label>
                <label>
                  限速 raw / s
                  <input
                    type="number"
                    min={1}
                    max={2400}
                    step={1}
                    value={speed}
                    disabled={busy}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="motor-debug__readout">
                <span>当前位置</span>
                <strong>
                  {session.position === null ? "—" : session.position}
                </strong>
                <small>raw / 0–4095</small>
              </div>
              <div className="motor-debug__action-grid">
                <button
                  type="button"
                  disabled={
                    !connected ||
                    busy ||
                    !Number.isInteger(activeMotorId) ||
                    activeMotorId < 1 ||
                    activeMotorId > 253
                  }
                  onClick={() => void session.ping(activeMotorId)}
                >
                  Ping / 型号
                </button>
                <button
                  type="button"
                  disabled={!connected || busy}
                  onClick={() => void session.readPosition(activeMotorId)}
                >
                  读取位置
                </button>
                <button
                  type="button"
                  disabled={!connected || busy || speed < 1 || speed > 2400}
                  onClick={() => void session.setSpeed(activeMotorId, speed)}
                >
                  写入限速
                </button>
                <button
                  type="button"
                  disabled={
                    !connected ||
                    busy ||
                    session.locked ||
                    activeMotorId < 1 ||
                    activeMotorId > 253
                  }
                  onClick={() =>
                    void session.setTorque(
                      activeMotorId,
                      !session.torqueEnabled,
                    )
                  }
                >
                  {session.torqueEnabled ? "释放扭矩" : "使能扭矩"}
                </button>
              </div>
              <div className="motor-debug__jog">
                <span>小步点动</span>
                {[-50, -10, 10, 50].map((delta) => (
                  <button
                    type="button"
                    key={delta}
                    disabled={
                      !connected ||
                      busy ||
                      !session.torqueEnabled ||
                      session.locked ||
                      speed < 1 ||
                      speed > 2400 ||
                      activeMotorId < 1 ||
                      activeMotorId > 253
                    }
                    title="每次先写入限速、读取实际位置，再写入相对目标"
                    onClick={() =>
                      void session.jog(activeMotorId, delta, speed)
                    }
                  >
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </button>
                ))}
              </div>
              <div className="motor-debug__actions">
                <button
                  type="button"
                  className="motor-debug__button is-stop"
                  disabled={!connected || busy || session.locked}
                  onClick={() => void session.hold(activeMotorId)}
                >
                  <Square size={15} /> 停止下发并保持当前位置
                </button>
                {session.locked && (
                  <button
                    type="button"
                    className="motor-debug__button"
                    disabled={busy}
                    onClick={session.unlock}
                  >
                    解除停止锁定
                  </button>
                )}
              </div>
              <p className="motor-debug__hint">
                保持动作会读取当前位置并写回目标，维持原有扭矩；断线或读数失败时不能保证电机立即停转。释放扭矩可能使负载下坠。
              </p>
            </section>
          ) : activeProtocol === "slcan" ? (
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
                    onClick={() => void session.receiveCanFrames()}
                  >
                    <Radio size={15} /> 读取接收缓冲
                  </button>
                  <button
                    type="button"
                    className={`motor-debug__button ${canListening ? "is-listening" : ""}`}
                    disabled={!connected}
                    aria-pressed={canListening}
                    onClick={() => setCanListening((current) => !current)}
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
          ) : (
            <section
              className="motor-debug__panel"
              aria-labelledby="motor-debug-raw-title"
            >
              <div className="motor-debug__panel-head">
                <span className="motor-debug__number">02</span>
                <div>
                  <h2 id="motor-debug-raw-title">原始报文</h2>
                  <p>支持 HEX 与 UTF-8；收包显示为十六进制字节。</p>
                </div>
              </div>
              <form onSubmit={send} className="motor-debug__send-form">
                <div className="motor-debug__serial-options">
                  <label>
                    发送格式
                    <select
                      value={format}
                      onChange={(event) =>
                        setFormat(event.target.value as "hex" | "text")
                      }
                    >
                      <option value="hex">十六进制</option>
                      <option value="text">UTF-8 文本</option>
                    </select>
                  </label>
                  <label>
                    等待回包 / ms
                    <input
                      type="number"
                      min={20}
                      max={2000}
                      step={10}
                      value={timeout}
                      onChange={(event) =>
                        setTimeoutMs(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    文本行尾
                    <select
                      value={lineEnding}
                      disabled={format !== "text"}
                      onChange={(event) =>
                        setLineEnding(event.target.value as typeof lineEnding)
                      }
                    >
                      <option value="none">无</option>
                      <option value="lf">LF</option>
                      <option value="crlf">CRLF</option>
                    </select>
                  </label>
                </div>
                <label>
                  发送内容
                  <textarea
                    value={payload}
                    onChange={(event) => setPayload(event.target.value)}
                    rows={4}
                    placeholder={
                      format === "hex"
                        ? "例如 FF FF 01 02 01 FB"
                        : "按设备协议输入文本"
                    }
                  />
                </label>
                <div className="motor-debug__actions">
                  <button
                    type="submit"
                    className="motor-debug__button is-primary"
                    disabled={
                      !connected ||
                      busy ||
                      !payload.trim() ||
                      timeout < 20 ||
                      timeout > 2000
                    }
                  >
                    <Cable size={15} /> 发送并读取
                  </button>
                  <button
                    type="button"
                    className="motor-debug__button"
                    disabled={!connected || busy}
                    onClick={() => void session.transfer([], timeout)}
                  >
                    仅接收
                  </button>
                </div>
              </form>
              <p className="motor-debug__hint">
                最多发送 512 字节，单次接收最多 2048
                字节。发送前请确认字节含义；当前模式不自动生成电机控制报文。
              </p>
            </section>
          )}
        </div>

        <section
          className="motor-debug__panel motor-debug__log"
          aria-labelledby="motor-debug-log-title"
        >
          <div className="motor-debug__log-head">
            <div>
              <span className="motor-debug__number">03</span>
              <h2 id="motor-debug-log-title">
                {activeProtocol === "feetech" ? "操作记录" : "串口收发"}
              </h2>
            </div>
            <button
              type="button"
              onClick={session.clearLogs}
              disabled={!session.logs.length}
              title="清空本次界面记录"
            >
              <Trash2 size={14} /> 清空
            </button>
          </div>
          {session.logs.length ? (
            <ol aria-live="polite">
              {session.logs.map((entry) => (
                <li key={entry.id} className={`is-${entry.kind}`}>
                  <time>
                    {new Date(entry.at).toLocaleTimeString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                  <span>
                    {entry.kind === "tx"
                      ? "TX"
                      : entry.kind === "rx"
                        ? "RX"
                        : entry.kind === "error"
                          ? "ERR"
                          : "SYS"}
                  </span>
                  <code>{entry.message}</code>
                </li>
              ))}
            </ol>
          ) : (
            <div className="motor-debug__empty">
              <Radio size={24} />
              <strong>等待调试记录</strong>
              <p>连接后，端口状态和每次操作会显示在这里。</p>
            </div>
          )}
          <div className="motor-debug__log-foot">
            最多保留最近 200 条记录，当前会话内存保存。
          </div>
        </section>
      </div>
    </div>
  );
}
