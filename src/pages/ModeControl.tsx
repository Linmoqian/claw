import { SlidersHorizontal } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import MotorList from "../components/MotorList";
import type { ControlMode } from "../types";
import "./ModeControl.css";

const MODES: { key: ControlMode; label: string; unit: string }[] = [
  { key: "position", label: "位置", unit: "°" },
  { key: "velocity", label: "速度", unit: "°/s" },
  { key: "current", label: "电流", unit: "A" },
];

/** 控制模式：位置 / 速度 / 电流三模式 + 目标值设定，目标与实际双显 */
export default function ModeControl() {
  const {
    motors,
    selectedId,
    selectMotor,
    mode,
    setMode,
    setTarget,
    connected,
    safety,
  } = useDevice();
  const selected = motors.find((m) => m.id === selectedId) ?? motors[0];
  const unit = MODES.find((m) => m.key === mode)!.unit;

  const range =
    mode === "position"
      ? { min: selected.min, max: selected.max }
      : mode === "velocity"
        ? { min: -safety.velocityMax, max: safety.velocityMax }
        : { min: 0, max: safety.currentMax };

  const actual =
    mode === "position"
      ? selected.angle
      : mode === "velocity"
        ? selected.velocity
        : selected.current;

  const span = range.max - range.min;
  const pct = span === 0 ? 0 : ((selected.target - range.min) / span) * 100;
  const step = mode === "current" ? 0.05 : 0.5;
  const disabled = !connected || !selected.enabled;

  return (
    <div className="console">
      <aside className="motor-nav">
        <div className="console__label">
          <SlidersHorizontal size={12} />
          <span>控制模式 · 选择关节</span>
        </div>
        <MotorList motors={motors} selectedId={selectedId} onSelect={selectMotor} />
      </aside>

      <section className="dashboard mode-panel">
        {/* 模式切换 */}
        <div className="mode-tabs">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`mode-tab ${mode === m.key ? "is-active" : ""}`}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* 目标 / 实际 双显 */}
        <div className="mode-dual">
          <div className="mode-dual__cell">
            <span className="mode-dual__k">目标 SP</span>
            <span className="mode-dual__v tnum">
              {selected.target.toFixed(2)}
              <i>{unit}</i>
            </span>
          </div>
          <div className="mode-dual__sep" />
          <div className="mode-dual__cell">
            <span className="mode-dual__k">实际 PV</span>
            <span className="mode-dual__v tnum">
              {actual.toFixed(2)}
              <i>{unit}</i>
            </span>
          </div>
        </div>

        {/* 目标设定 */}
        <div className="mode-set">
          <div className="mode-set__label">目标值（{unit}）</div>
          <input
            type="range"
            className="mode-set__slider"
            min={range.min}
            max={range.max}
            step={step}
            value={selected.target}
            disabled={disabled}
            onChange={(e) => setTarget(selectedId, parseFloat(e.target.value))}
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
          />
          <div className="mode-set__range tnum">
            <span>{range.min}</span>
            <span>{range.max}</span>
          </div>
        </div>

        {!connected && (
          <div className="mode__notice">控制器未连接，目标设定已禁用</div>
        )}
        {connected && !selected.enabled && (
          <div className="mode__notice">该关节未使能，请先在「基础控制」使能</div>
        )}
      </section>
    </div>
  );
}
