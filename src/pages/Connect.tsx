// Created on 2026-09-26
// @author: https://github.com/Linmoqian
import {
  ArrowRight,
  Cable,
  CheckCircle2,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link } from "react-router";
import { useDevice } from "../store/DeviceContext";
import { useBridgeStore } from "../stores/bridgeStore";
import { isDesktop } from "../lib/serial";
import { useActivityStore } from "../workbench/activity";
import { serialConnectionBlockedReason } from "../lib/serialConnectionGuard";
import "./Connect.css";

export default function Connect() {
  const {
    ports,
    scanning,
    connected,
    deviceId,
    connectingPort,
    disconnecting,
    connectionError,
    lastAttemptedPort,
    scanPorts,
    connect,
    disconnect,
  } = useDevice();
  const bridgeInfo = useBridgeStore((state) => state.info);
  const isLive = useBridgeStore((state) => state.isLive);
  const bridgeError = useBridgeStore((state) => state.lastError);
  const activity = useActivityStore();
  const replaying = useBridgeStore(
    (state) => state.bridge.kind === "replay" || state.replay !== null,
  );
  const blockedReason = serialConnectionBlockedReason(activity, replaying);
  const desktop = isDesktop();
  const busy = Boolean(connectingPort) || disconnecting;
  const hasWebSocket = bridgeInfo.kind === "websocket";
  const wsStatus = hasWebSocket
    ? (
        {
          connected: "已连接",
          connecting: "连接中",
          offline: "未连接",
          error: "连接异常",
        } as const
      )[bridgeInfo.status]
    : "未连接";

  return (
    <div className="stage connect">
      <header className="connect__hero">
        <span className="section-label">设备与诊断</span>
        <h1>设备连接</h1>
        <p>分别查看串口与 WebSocket 链路，连接后进入对应的监测与控制页面。</p>
      </header>

      {!desktop && (
        <section className="connect__notice" role="status">
          <strong>浏览器预览：串口功能需使用桌面应用</strong>
          <p>
            这里可以继续使用仿真与积木编程。打开桌面应用后，可扫描串口并连接控制器。
          </p>
          <div className="connect__links">
            <Link to="/studio">
              进入仿真 <ArrowRight size={14} />
            </Link>
            <Link to="/blocks">
              打开积木编程 <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      <section className="connect__panel" aria-labelledby="serial-heading">
        <div className="connect__panel-head">
          <div>
            <span className="connect__panel-kicker">串口通道</span>
            <h2 id="serial-heading">SO-100 控制器</h2>
          </div>
          <div
            className={`connect__state ${connected ? "is-online" : ""}`}
            aria-live="polite"
          >
            <i />
            <span>
              {connectingPort
                ? `正在连接 ${connectingPort}…`
                : disconnecting
                  ? "正在断开…"
                  : connected
                    ? `${deviceId ?? "串口"} 已连接`
                    : "未连接"}
            </span>
          </div>
        </div>

        {connectionError && (
          <div className="connect__error" role="alert">
            <span>{connectionError}</span>
            <button
              type="button"
              disabled={
                busy || scanning || (!connected && Boolean(blockedReason))
              }
              onClick={() => {
                if (connected) void disconnect();
                else if (lastAttemptedPort) void connect(lastAttemptedPort);
                else void scanPorts();
              }}
            >
              重试{connected ? "断开" : lastAttemptedPort ? "连接" : "扫描"}
            </button>
          </div>
        )}

        {!connected && desktop && (
          <>
            <div className="connect__scan-row">
              <div className="connect__scan-copy">
                <Cable size={18} />
                <div>
                  <strong>可用串口</strong>
                  <span>连接控制器后扫描设备端口</span>
                </div>
              </div>
              <button
                type="button"
                className="connect__scan"
                onClick={scanPorts}
                disabled={scanning || busy}
              >
                <RefreshCw size={14} className={scanning ? "spin" : ""} />
                {scanning ? "正在扫描…" : "扫描设备"}
              </button>
            </div>
            <ul className="port-list">
              {ports.length === 0 && !scanning && (
                <li className="port-list__empty">
                  <Search size={18} />
                  <span>暂无可用串口</span>
                  <small>
                    连接 USB 控制器后点击“扫描设备”；确认驱动已安装。
                  </small>
                </li>
              )}
              {ports.map((port) => (
                <li key={port.name} className="port-item">
                  <Plug size={16} />
                  <span className="port-item__main">
                    <strong className="tnum">{port.name}</strong>
                    <small className="tnum">
                      {port.baud.toLocaleString()} baud
                    </small>
                  </span>
                  <span className="port-item__tag">
                    {port.inUse ? "使用中" : "可尝试连接"}
                  </span>
                  <button
                    type="button"
                    className="port-item__btn"
                    onClick={() => void connect(port.name)}
                    disabled={
                      port.inUse || busy || scanning || Boolean(blockedReason)
                    }
                  >
                    {connectingPort === port.name ? "连接中…" : "连接"}
                    <ArrowRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {connected && (
          <div className="connect__success">
            <CheckCircle2 size={24} />
            <div>
              <strong>串口会话已建立</strong>
              <p>打开实时监测确认关节反馈，再进行参数调整。</p>
              <div className="connect__links">
                <Link to="/monitor">
                  查看串口监测 <ArrowRight size={14} />
                </Link>
                <Link to="/pid">
                  打开 PID 调参 <ArrowRight size={14} />
                </Link>
              </div>
            </div>
            <button
              type="button"
              className="connect__disconnect"
              onClick={disconnect}
              disabled={busy}
            >
              {disconnecting ? "正在断开…" : "断开串口"}
            </button>
          </div>
        )}
        {!desktop && (
          <p className="connect__hint">串口扫描和连接在浏览器中不可用。</p>
        )}
        {blockedReason && !connected && (
          <p className="connect__hint" role="status">
            {blockedReason}
          </p>
        )}
      </section>

      <section className="connect__panel" aria-labelledby="websocket-heading">
        <div className="connect__panel-head">
          <div>
            <span className="connect__panel-kicker">WebSocket 通道</span>
            <h2 id="websocket-heading">Studio 数据桥</h2>
          </div>
          <div
            className={`connect__state ${hasWebSocket && bridgeInfo.connected ? "is-online" : ""}`}
          >
            <i />
            <span>
              {wsStatus}
              {hasWebSocket ? ` · ${isLive ? "LIVE 控制" : "TWIN 观察"}` : ""}
            </span>
          </div>
        </div>
        <p className="connect__hint">
          在仿真页配置 WebSocket 地址与观察／控制模式；此链路和串口各自连接。
        </p>
        {hasWebSocket && bridgeError && (
          <p className="connect__error" role="alert">
            {bridgeError}
          </p>
        )}
        <div className="connect__links">
          <Link to="/studio">
            打开仿真与数据桥 <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <footer className="connect__footnote">
        串口当前支持关节位置读写；速度、电流、温度尚未接入。串口急停尝试保持当前位置与扭矩，不涵盖
        Studio LIVE 通道。
      </footer>
    </div>
  );
}
