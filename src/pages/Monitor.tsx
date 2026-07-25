import { Radio } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import MotorCard from "../components/MotorCard";
import "./Monitor.css";

/** 状态监控：7 电机的实时读数网格 */
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
          {motors.length} 关节 · 使能 {enabledCount} · 故障 {faultCount}
        </span>
      </div>

      {!connected && (
        <div className="monitor__notice">控制器未连接，显示为最近一次读数</div>
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
