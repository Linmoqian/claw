// 通信连接面板：接口、协议、串口与波特率表单，负责建立和断开调试连接。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, PlugZap, RotateCw, Square } from "lucide-react";
import { isDesktop, listSerialPorts } from "../../../lib/serial";
import type { RawSerialOptions } from "../motor-debug/serialDebug";
import {
  useMotorDebugStore,
  type DebugInterface,
  type DebugProtocol,
} from "../motor-debug/session";
import { CAN_BITRATES, type CanBitrateCode } from "../motor-debug/slcan";

const BAUD_PRESETS = [
  9600, 19200, 38400, 57600, 115200, 250000, 500000, 1000000,
];

interface DebugConnectionFormProps {
  protocol: DebugProtocol;
  onProtocolChange: (value: DebugProtocol) => void;
  motorId: number;
  onStopListening: () => void;
  onScanError: (message: string | null) => void;
  onInputError: (message: string | null) => void;
}

export default function DebugConnectionForm({
  protocol,
  onProtocolChange,
  motorId,
  onStopListening,
  onScanError,
  onInputError,
}: DebugConnectionFormProps) {
  const [interfaceType, setInterfaceType] = useState<DebugInterface>("ttl");
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState("");
  const [scanning, setScanning] = useState(false);
  const [baud, setBaud] = useState("115200");
  const [canBitrate, setCanBitrate] = useState<CanBitrateCode>("S6");
  const [dataBits, setDataBits] = useState<RawSerialOptions["dataBits"]>(8);
  const [parity, setParity] = useState<RawSerialOptions["parity"]>("none");
  const [stopBits, setStopBits] = useState<RawSerialOptions["stopBits"]>(1);
  const sessionPort = useMotorDebugStore((state) => state.port);
  const sessionProtocol = useMotorDebugStore((state) => state.protocol);
  const sessionInterface = useMotorDebugStore((state) => state.interfaceType);
  const sessionBaud = useMotorDebugStore((state) => state.baud);
  const sessionCanBitrate = useMotorDebugStore((state) => state.canBitrate);
  const transitioning = useMotorDebugStore((state) => state.transitioning);
  const busy = useMotorDebugStore((state) => state.busy || state.transitioning);
  const open = useMotorDebugStore((state) => state.open);
  const close = useMotorDebugStore((state) => state.close);
  const desktop = isDesktop();
  const connected = Boolean(sessionPort);
  const activeProtocol = sessionProtocol ?? protocol;
  const activeInterface = sessionInterface ?? interfaceType;

  const scanPorts = async (): Promise<void> => {
    if (!desktop || scanning) return;
    setScanning(true);
    onScanError(null);
    try {
      const names = await listSerialPorts();
      setPorts(names);
      setPort((current) => current || names[0] || "");
    } catch (error) {
      onScanError(error instanceof Error ? error.message : String(error));
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
          onScanError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [desktop, onScanError]);

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onInputError(null);
    const selectedBaud = Number(baud);
    if (!port.trim()) {
      onInputError("请选择串口，或输入系统中的端口名。");
      return;
    }
    if (
      !Number.isInteger(selectedBaud) ||
      selectedBaud < 300 ||
      selectedBaud > 4000000
    ) {
      onInputError("波特率须为 300–4,000,000 的整数。");
      return;
    }
    void open({
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

  return (
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
              onProtocolChange(item === "can" ? "slcan" : "raw");
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
              onProtocolChange(next);
              if (next === "feetech") setBaud("1000000");
            }}
          >
            {activeInterface === "can" ? (
              <>
                <option value="slcan">SLCAN · Lawicel ASCII</option>
                <option value="raw">原始适配器字节 · HEX / UTF-8</option>
              </>
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
              value={connected ? (sessionPort ?? "") : port}
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
            value={connected ? String(sessionBaud ?? "") : baud}
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
              value={sessionCanBitrate ?? canBitrate}
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
            : activeInterface === "can"
              ? "原始模式只与适配器虚拟串口交换字节，不自动生成 CAN 帧；请按适配器手册输入命令。"
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
              onStopListening();
              void close();
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
            {transitioning ? "连接中…" : "连接串口"}
          </button>
        )}
      </div>
    </form>
  );
}
