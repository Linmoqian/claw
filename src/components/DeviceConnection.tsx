import { useState } from "react";
import { motion } from "motion/react";
import { Usb, Cpu, Circle, ChevronDown } from "lucide-react";
import "./DeviceConnection.css";

type Props = {
  connected: boolean;
  onToggle: () => void;
};

/** 设备 ID 卡片：连接后激活，展示设备身份信息 */
function DeviceIdCard({ connected }: { connected: boolean }) {
  return (
    <motion.div
      className={`device-card device-card--id ${connected ? "is-active" : "is-idle"}`}
      initial={{ opacity: 0, y: 18, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: "spring", bounce: 0, duration: 0.55, delay: 0.1 }}
    >
      <div className="device-card__sheen" aria-hidden />
      {connected && (
        <motion.span
          className="device-card__pulse"
          aria-hidden
          initial={{ opacity: 0.45, scale: 0.88 }}
          animate={{ opacity: 0, scale: 1.4 }}
          transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <header className="device-card__head">
        <span className="device-card__label">
          <Cpu size={13} /> 设备 ID
        </span>
        <span className={`device-card__chip ${connected ? "on" : "off"}`}>
          <Circle size={7} fill="currentColor" stroke="none" />
          {connected ? "在线" : "离线"}
        </span>
      </header>

      <div className="device-id tnum">
        {connected ? "CLW-7A4F-209B" : "--------"}
      </div>

      <dl className="device-meta">
        <div>
          <dt>固件</dt>
          <dd className="tnum">{connected ? "v2.4.1" : "—"}</dd>
        </div>
        <div>
          <dt>协议</dt>
          <dd className="tnum">{connected ? "MODBUS-RTU" : "—"}</dd>
        </div>
        <div>
          <dt>在线时长</dt>
          <dd className="tnum">{connected ? "00:12:47" : "—"}</dd>
        </div>
      </dl>
    </motion.div>
  );
}

/** USB 连接卡：端口、波特率、连接按钮 */
function UsbCard({ connected, onToggle }: Props) {
  const [port] = useState("COM3");
  const [baud] = useState("115200");

  return (
    <motion.div
      className={`device-card device-card--usb ${connected ? "is-active" : "is-idle"}`}
      initial={{ opacity: 0, y: 18, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: "spring", bounce: 0, duration: 0.55 }}
    >
      <div className="device-card__sheen" aria-hidden />
      <header className="device-card__head">
        <span className="device-card__label">
          <Usb size={13} /> USB 串口
        </span>
        <span className={`device-card__chip ${connected ? "on" : "off"}`}>
          <Circle size={7} fill="currentColor" stroke="none" />
          {connected ? "已连接" : "未连接"}
        </span>
      </header>

      <div className="port-row">
        <button type="button" className="port-select" disabled={connected}>
          <span className="tnum">{port}</span>
          <ChevronDown size={14} />
        </button>
        <div className="baud-pill tnum">{baud} bps</div>
      </div>

      <button
        type="button"
        className={`connect-btn ${connected ? "connected" : ""}`}
        onClick={onToggle}
      >
        <span className="connect-btn__dot" />
        {connected ? "断开连接" : "连接设备"}
      </button>
    </motion.div>
  );
}

export default function DeviceConnection({ connected, onToggle }: Props) {
  return (
    <section className="connection-row">
      <UsbCard connected={connected} onToggle={onToggle} />
      <DeviceIdCard connected={connected} />
    </section>
  );
}
