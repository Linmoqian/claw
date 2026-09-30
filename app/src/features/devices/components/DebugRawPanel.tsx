// 原始报文面板：HEX 与 UTF-8 文本发送、等待回包时长与仅接收。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { useState, type FormEvent } from "react";
import { Cable } from "lucide-react";
import { parseHexBytes } from "../motor-debug/serialDebug";
import { useMotorDebugStore } from "../motor-debug/session";

interface DebugRawPanelProps {
  onInputError: (message: string | null) => void;
}

export default function DebugRawPanel({ onInputError }: DebugRawPanelProps) {
  const [format, setFormat] = useState<"hex" | "text">("hex");
  const [payload, setPayload] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "lf" | "crlf">("none");
  const [timeout, setTimeoutMs] = useState(500);
  const sessionPort = useMotorDebugStore((state) => state.port);
  const busy = useMotorDebugStore((state) => state.busy || state.transitioning);
  const transfer = useMotorDebugStore((state) => state.transfer);
  const connected = Boolean(sessionPort);

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onInputError(null);
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
      void transfer(bytes, timeout);
    } catch (error) {
      onInputError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
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
            onClick={() => void transfer([], timeout)}
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
  );
}
