import { Radio } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import MotorCard from "../components/MotorCard";
import "./Monitor.css";

/** 状态监控：SO-100 六个执行器的实时位置读数网格 */
export default function Monitor() {
  const { motors, selectedId, selectMotor, connected, safety, faults } =
    useDevice();
  const enabledCount = motors.filter((m) => m.enabled).length;
  const faultCount = motors.filter((m) => {
    const f = faults[m.id];
    return f && (f.overTravel || f.overCurrent || f.overTemp || f.commLost);
  }).length;

  return (
    <div className="stage monitor">
      <div className="section-label">
        <span className="section-label__title">状态监控</span>
        <span className="monitor__summary">
          <Radio size={12} />
          {motors.length} 执行器 · 锁定 {enabledCount} · 故障 {faultCount} ·
          位置实时
        </span>
      </div>

      {!connected && (
        <div className="monitor__notice">
          控制器未连接，请先在连接页建立串口链路
        </div>
      )}

      <div className="motor-grid">
        {motors.map((m) => (
          <MotorCard
            key={m.id}
            motor={m}
            selected={m.id === selectedId}
            safety={safety}
            fault={faults[m.id]}
            onSelect={selectMotor}
          />
        ))}
      </div>
    </div>
  );
}
