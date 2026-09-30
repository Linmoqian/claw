// 调试日志面板：订阅会话日志切片，展示收发与操作记录并支持清空。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { Radio, Trash2 } from "lucide-react";
import {
  useMotorDebugStore,
  type DebugProtocol,
} from "../motor-debug/session";

interface DebugLogPanelProps {
  activeProtocol: DebugProtocol;
}

export default function DebugLogPanel({ activeProtocol }: DebugLogPanelProps) {
  const logs = useMotorDebugStore((state) => state.logs);
  const clearLogs = useMotorDebugStore((state) => state.clearLogs);

  return (
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
          onClick={clearLogs}
          disabled={!logs.length}
          title="清空本次界面记录"
        >
          <Trash2 size={14} /> 清空
        </button>
      </div>
      {logs.length ? (
        <ol aria-live="polite">
          {logs.map((entry) => (
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
  );
}
