import { motion } from "motion/react";
import { Play, Pause, RotateCcw, Activity } from "lucide-react";
import WaveCanvas from "./WaveCanvas";
import PidSlider from "./PidSlider";
import type { Motor, PidGains } from "../types";
import "./PidTuner.css";

type Props = {
  motor: Motor;
  pid: PidGains;
  running: boolean;
  onPidChange: (next: PidGains) => void;
  onToggleRun: () => void;
  onReset: () => void;
};

export default function PidTuner({
  motor,
  pid,
  running,
  onPidChange,
  onToggleRun,
  onReset,
}: Props) {
  const error = Math.abs(motor.angle - motor.target);

  return (
    <motion.div
      className="pid-tuner"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", bounce: 0, duration: 0.6 }}
    >
      <div className="pid-tuner__sheen" aria-hidden />

      {/* 左：波形 */}
      <div className="pid-tuner__wave">
        <header className="pid-tuner__head">
          <div className="pid-tuner__title">
            <Activity size={14} />
            <span>PID 响应 · {motor.code} {motor.name}</span>
          </div>
          <div className="pid-tuner__legend">
            <span className="legend legend--sp">目标 SP</span>
            <span className="legend legend--pv">实测 PV</span>
          </div>
        </header>
        <WaveCanvas motor={motor} pid={pid} running={running} />
      </div>

      {/* 右：调参面板 */}
      <aside className="pid-panel">
        <header className="pid-panel__head">
          <div>
            <div className="pid-panel__k">当前关节</div>
            <div className="pid-panel__name">
              {motor.code} <span>{motor.name}</span>
            </div>
          </div>
          <div className="pid-panel__run">
            <button
              type="button"
              className={`run-btn ${running ? "running" : ""}`}
              onClick={onToggleRun}
            >
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? "暂停" : "运行"}
            </button>
            <button type="button" className="reset-btn" onClick={onReset} title="重置仿真">
              <RotateCcw size={14} />
            </button>
          </div>
        </header>

        <div className="pid-panel__sliders">
          <PidSlider
            label="比例"
            symbol="P"
            value={pid.kp}
            min={0}
            max={50}
            step={0.1}
            onChange={(v) => onPidChange({ ...pid, kp: v })}
          />
          <PidSlider
            label="积分"
            symbol="I"
            value={pid.ki}
            min={0}
            max={5}
            step={0.01}
            onChange={(v) => onPidChange({ ...pid, ki: v })}
          />
          <PidSlider
            label="微分"
            symbol="D"
            value={pid.kd}
            min={0}
            max={10}
            step={0.05}
            onChange={(v) => onPidChange({ ...pid, kd: v })}
          />
        </div>

        <div className="pid-panel__stats">
          <div className="stat">
            <span className="stat__k">稳态误差</span>
            <span className="stat__v tnum">{error.toFixed(2)}°</span>
          </div>
          <div className="stat">
            <span className="stat__k">目标</span>
            <span className="stat__v tnum">{motor.target.toFixed(1)}°</span>
          </div>
          <div className="stat">
            <span className="stat__k">实测</span>
            <span className="stat__v tnum">{motor.angle.toFixed(1)}°</span>
          </div>
        </div>
      </aside>
    </motion.div>
  );
}
