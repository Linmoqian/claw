import {
  ArrowRight,
  Cable,
  CheckCircle2,
  Plug,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import "./Connect.css";

/** 设备连接页：闭环入口——扫描串口 → 选择端口 → 连接 / 断开 */
export default function Connect() {
  const {
    ports,
    scanning,
    connected,
    deviceId,
    scanPorts,
    connect,
    disconnect,
  } = useDevice();

  return (
    <div className="stage connect">
      <header className="connect__hero">
        <div className="connect__hero-copy">
          <span className="connect__eyebrow">
            <Sparkles size={13} />
            虾烤工作台 · ROBOT ADAPTER
          </span>
          <h1>
            让每一次运动，
            <br />
            都贴近你的意图。
          </h1>
          <p>
            载入机器人模型与通信适配器，从数字孪生验证到实机调试，
            在同一张安静而精确的工作台上完成闭环。
          </p>
          <div className="connect__steps" aria-label="调试流程">
            <span className={connected ? "is-done" : "is-current"}>
              01 连接
            </span>
            <i />
            <span className={connected ? "is-current" : ""}>02 观测</span>
            <i />
            <span>03 调参</span>
          </div>
        </div>

        <div className="connect__orbit" aria-hidden="true">
          <span className="connect__orbit-ring" />
          <span className="connect__orbit-core">
            <i />
            <i />
            <i />
          </span>
          <small>SO-100 PROFILE · 6 ACTUATORS</small>
        </div>
      </header>

      <section className="connect__panel">
        <div className="connect__panel-head">
          <div>
            <span className="connect__panel-kicker">DEVICE LINK</span>
            <h2>{connected ? "机械臂已进入工作台" : "连接控制器"}</h2>
          </div>
          <div className={`connect__state ${connected ? "is-online" : ""}`}>
            <i />
            <span>{connected ? (deviceId ?? "控制器在线") : "等待连接"}</span>
          </div>
        </div>

        {!connected && (
          <>
            <div className="connect__scan-row">
              <div className="connect__scan-copy">
                <Cable size={18} />
                <div>
                  <strong>串口设备</strong>
                  <span>扫描 Windows 可用端口</span>
                </div>
              </div>
              <button
                type="button"
                className="connect__scan"
                onClick={scanPorts}
                disabled={scanning}
              >
                <RefreshCw size={14} className={scanning ? "spin" : ""} />
                {scanning ? "正在扫描…" : "扫描设备"}
              </button>
            </div>

            <ul className="port-list">
              {ports.length === 0 && !scanning && (
                <li className="port-list__empty">
                  <Search size={18} />
                  <span>尚未发现设备</span>
                  <small>请连接已适配的机器人控制器后开始扫描</small>
                </li>
              )}
              {ports.map((port) => (
                <li
                  key={port.name}
                  className={`port-item ${port.inUse ? "is-busy" : ""}`}
                >
                  <span className="port-item__icon">
                    <Plug size={16} />
                  </span>
                  <span className="port-item__main">
                    <strong className="tnum">{port.name}</strong>
                    <small className="tnum">
                      {port.baud.toLocaleString()} baud
                    </small>
                  </span>
                  <span
                    className={`port-item__tag ${port.inUse ? "busy" : "free"}`}
                  >
                    {port.inUse ? "使用中" : "可连接"}
                  </span>
                  <button
                    type="button"
                    className="port-item__btn"
                    onClick={() => connect(port.name)}
                    disabled={port.inUse}
                  >
                    连接 <ArrowRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {connected && (
          <div className="connect__success">
            <span className="connect__success-icon">
              <CheckCircle2 size={24} />
            </span>
            <div>
              <strong>设备链路稳定</strong>
              <p>现在可以进入“仿真与调参”，对比数字孪生与实机反馈。</p>
            </div>
            <button
              type="button"
              className="connect__disconnect"
              onClick={disconnect}
            >
              断开连接
            </button>
          </div>
        )}
      </section>

      <footer className="connect__footnote">
        <span>提示</span>
        关节位置读数与控制指令通过真实串口链路收发；速度/电流/温度暂未接入。
      </footer>
    </div>
  );
}
