import { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Radio, ChevronDown, Save } from "lucide-react";
import MotorList from "../components/MotorList";
import WaveCanvas from "../components/WaveCanvas";
import PidSlider from "../components/PidSlider";
import { useDevice } from "../store/DeviceContext";
import type { AdvancedParams } from "../types";
import "./PidTuner.css";

function tempColor(temp: number) {
  if (temp >= 45) return "var(--danger)";
  if (temp >= 40) return "var(--warning)";
  return "var(--success)";
}

function Reading({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
}) {
  return (
    <div className="reading">
      <span className="reading__k">{label}</span>
      <span className="reading__v tnum" style={color ? { color } : undefined}>
        {value}
        <i className="reading__unit">{unit}</i>
      </span>
    </div>
  );
}

/** 高级参数分组配置（驱动仿真） */
type AdvItem = {
  key: keyof AdvancedParams;
  label: string;
  symbol: string;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  unit?: string;
};

const ADVANCED_GROUPS: { title: string; items: AdvItem[] }[] = [
  {
    title: "前馈与滤波",
    items: [
      { key: "kv", label: "速度前馈", symbol: "Kv", min: 0, max: 1, step: 0.02, decimals: 2 },
      { key: "kg", label: "重力补偿", symbol: "Kg", min: 0, max: 1, step: 0.02, decimals: 2 },
      { key: "dFilterHz", label: "微分滤波", symbol: "fc", min: 1, max: 50, step: 1, decimals: 0, unit: "Hz" },
      { key: "pvSmooth", label: "反馈平滑", symbol: "α", min: 0, max: 0.9, step: 0.05, decimals: 2 },
    ],
  },
  {
    title: "限幅与约束",
    items: [
      { key: "outLimit", label: "输出限幅", symbol: "ol", min: 50, max: 2000, step: 10, decimals: 0 },
      { key: "iLimit", label: "积分限幅", symbol: "il", min: 5, max: 500, step: 5, decimals: 0 },
      { key: "rampRate", label: "目标斜坡", symbol: "rp", min: 10, max: 3600, step: 10, decimals: 0, unit: "°/s" },
      { key: "deadZone", label: "死区", symbol: "dz", min: 0, max: 8, step: 0.1, decimals: 1, unit: "°" },
    ],
  },
];

/** PID 调参页：电机选择 + 实时仿真波形 + PID/高级参数 + Flash 保存 */
function PidTuner() {
  const {
    motors,
    selectedId,
    selectMotor,
    running,
    setRunning,
    tuneByMotor,
    dirtyByMotor,
    updateTune,
    saveToFlash,
    resetTune,
  } = useDevice();

  const [resetKey, setResetKey] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedMotor = motors.find((m) => m.id === selectedId) ?? motors[0];
  const selectedTune = tuneByMotor[selectedId];
  const dirty = dirtyByMotor[selectedId];
  const error = Math.abs(selectedMotor.angle - selectedMotor.target);

  // 方向键切换关节
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = motors.findIndex((m) => m.id === selectedId);
      if (e.key === "ArrowLeft" && idx > 0) selectMotor(motors[idx - 1].id);
      else if (e.key === "ArrowRight" && idx < motors.length - 1)
        selectMotor(motors[idx + 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [motors, selectedId, selectMotor]);

  return (
    <div className="console">
      {/* 左：电机导航 */}
      <aside className="motor-nav">
        <div className="console__label">
          <Radio size={12} />
          <span>关节 · 7 DOF</span>
        </div>
        <MotorList motors={motors} selectedId={selectedId} onSelect={selectMotor} />
      </aside>

      {/* 右：仪表盘主区 */}
      <section className="dashboard">
        {/* 选中电机详情 head */}
        <header className="motor-head">
          <div className="motor-head__id">
            <span className="motor-head__code tnum">{selectedMotor.code}</span>
            <span className="motor-head__name">{selectedMotor.name}</span>
          </div>
          <div className="motor-head__readings">
            <Reading label="实测" value={selectedMotor.angle.toFixed(1)} unit="°" />
            <Reading label="目标" value={selectedMotor.target.toFixed(1)} unit="°" />
            <Reading
              label="误差"
              value={error.toFixed(2)}
              unit="°"
              color="var(--warning)"
            />
            <Reading label="电流" value={selectedMotor.current.toFixed(2)} unit="A" />
            <Reading
              label="温度"
              value={selectedMotor.temp.toFixed(1)}
              unit="°"
              color={tempColor(selectedMotor.temp)}
            />
          </div>
        </header>

        {/* 大波形 */}
        <div className="wave-region">
          <div className="wave-region__head">
            <div className="console__label">
              <span>PID 响应 · 实时仿真</span>
            </div>
            <div className="wave-region__legend">
              <span className="legend legend--sp">目标 SP</span>
              <span className="legend legend--pv">实测 PV</span>
            </div>
          </div>
          <WaveCanvas
            key={`${selectedId}-${resetKey}`}
            motor={selectedMotor}
            tune={selectedTune}
            running={running}
          />
        </div>

        {/* PID 控制条 */}
        <div className="pid-bar">
          <PidSlider
            label="比例"
            symbol="P"
            value={selectedTune.kp}
            min={0}
            max={50}
            step={0.1}
            onChange={(v) => updateTune(selectedId, { kp: v })}
          />
          <PidSlider
            label="积分"
            symbol="I"
            value={selectedTune.ki}
            min={0}
            max={5}
            step={0.01}
            onChange={(v) => updateTune(selectedId, { ki: v })}
          />
          <PidSlider
            label="微分"
            symbol="D"
            value={selectedTune.kd}
            min={0}
            max={10}
            step={0.05}
            onChange={(v) => updateTune(selectedId, { kd: v })}
          />
          <div className="pid-bar__run">
            <button
              type="button"
              className={`run-btn ${running ? "running" : ""}`}
              onClick={() => setRunning(!running)}
            >
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? "暂停" : "运行"}
            </button>
            <button
              type="button"
              className="reset-btn"
              onClick={() => setResetKey((k) => k + 1)}
              title="重置仿真"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className={`save-btn ${dirty ? "dirty" : ""}`}
              onClick={() => saveToFlash(selectedId)}
              title={dirty ? "参数已修改，点击保存到 Flash" : "参数已与 Flash 一致"}
            >
              <Save size={14} />
              {dirty ? "存 Flash" : "已保存"}
            </button>
          </div>
        </div>

        {/* 高级调试参数（折叠） */}
        <button
          type="button"
          className={`advanced-toggle ${advancedOpen ? "is-open" : ""}`}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <ChevronDown size={14} className="advanced-toggle__chevron" />
          <span className="advanced-toggle__title">高级参数</span>
          <span className="advanced-toggle__hint">前馈 · 滤波 · 限幅 · 约束</span>
        </button>

        {advancedOpen && (
          <div className="advanced">
            {ADVANCED_GROUPS.map((g) => (
              <div className="advanced-group" key={g.title}>
                <div className="advanced-group__title">{g.title}</div>
                <div className="advanced-group__grid">
                  {g.items.map((it) => (
                    <PidSlider
                      key={it.key}
                      label={it.label}
                      symbol={it.symbol}
                      value={selectedTune[it.key]}
                      min={it.min}
                      max={it.max}
                      step={it.step}
                      decimals={it.decimals}
                      unit={it.unit}
                      onChange={(v) => updateTune(selectedId, { [it.key]: v })}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="advanced-actions">
              <button
                type="button"
                className="reset-btn"
                onClick={() => resetTune(selectedId)}
              >
                <RotateCcw size={13} /> 恢复默认
              </button>
              <button
                type="button"
                className={`save-btn ${dirty ? "dirty" : ""}`}
                onClick={() => saveToFlash(selectedId)}
              >
                <Save size={13} /> {dirty ? "保存到 Flash" : "已与 Flash 一致"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default PidTuner;
