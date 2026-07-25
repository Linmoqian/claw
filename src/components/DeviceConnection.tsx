import { motion } from "motion/react";
import "./DeviceConnection.css";

type Props = {
  connected: boolean;
  onToggle: () => void;
};

const PORT = "COM3";
const BAUD = "115200";
const DEVICE_ID = "CLW-7A4F-209B";

/** 设备连接紧凑条：状态点 + 端口/波特率 + 设备 ID + 连接按钮 */
export default function DeviceConnection({ connected, onToggle }: Props) {
  return (
    <motion.div
      className={`device-bar ${connected ? "is-active" : "is-idle"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <span className="device-bar__status">
        <i className={`device-bar__dot ${connected ? "on" : "off"}`} />
        <span className="device-bar__label">
          {connected ? "控制器在线" : "控制器离线"}
        </span>
      </span>

      <span className="device-bar__sep" />

      <span className="device-bar__field">
        <span className="device-bar__k">串口</span>
        <span className="device-bar__v tnum">
          {PORT} · {BAUD}
        </span>
      </span>

      <span className="device-bar__field">
        <span className="device-bar__k">设备 ID</span>
        <span className="device-bar__v tnum">{connected ? DEVICE_ID : "--------"}</span>
      </span>

      <button
        type="button"
        className={`device-bar__btn ${connected ? "connected" : ""}`}
        onClick={onToggle}
      >
        {connected ? "断开" : "连接设备"}
      </button>
    </motion.div>
  );
}
