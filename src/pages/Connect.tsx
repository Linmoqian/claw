import { Plug, RefreshCw, Search } from "lucide-react";
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
      <div className="section-label">
        <span className="section-label__title">设备连接</span>
        <span className="connect__hint">扫描控制器串口并建立连接</span>
      </div>

      <div className="connect__panel">
        <div className="connect__head">
          <div className="connect__state">
            <i className={`connect__dot ${connected ? "on" : "off"}`} />
            <span>{connected ? "控制器在线" : "控制器离线"}</span>
            {deviceId && <span className="connect__id tnum">{deviceId}</span>}
          </div>
          <button
            type="button"
            className="connect__scan"
            onClick={scanPorts}
            disabled={scanning || connected}
          >
            <RefreshCw size={14} className={scanning ? "spin" : ""} />
            {scanning ? "扫描中…" : "扫描串口"}
          </button>
        </div>

        <ul className="port-list">
          {ports.length === 0 && !scanning && (
            <li className="port-list__empty">
              <Search size={16} />
              <span>暂无端口，点击「扫描串口」</span>
            </li>
          )}
          {ports.map((p) => (
            <li key={p.name} className={`port-item ${p.inUse ? "is-busy" : ""}`}>
              <Plug size={16} className="port-item__icon" />
              <span className="port-item__name tnum">{p.name}</span>
              <span className="port-item__baud tnum">{p.baud}</span>
              <span className={`port-item__tag ${p.inUse ? "busy" : "free"}`}>
                {p.inUse ? "占用" : "可用"}
              </span>
              <button
                type="button"
                className="port-item__btn"
                onClick={() => connect(p.name)}
                disabled={connected || p.inUse}
              >
                连接
              </button>
            </li>
          ))}
        </ul>

        {connected && (
          <button
            type="button"
            className="connect__disconnect"
            onClick={disconnect}
          >
            断开连接
          </button>
        )}
      </div>
    </div>
  );
}
