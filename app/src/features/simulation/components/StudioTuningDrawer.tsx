// PID 调参抽屉：响应模型对象选择、阶跃响应曲线与 PID 参数编辑保存。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { Pause, Play, Save, X } from "lucide-react";
import PidSlider from "./PidSlider";
import WaveCanvas from "./WaveCanvas";
import { useDevice } from "../../../stores/DeviceContext";

type StudioTuningDrawerProps = {
  tuningOpen: boolean;
  setTuningOpen: (open: boolean) => void;
};

export default function StudioTuningDrawer({
  tuningOpen,
  setTuningOpen,
}: StudioTuningDrawerProps) {
  // 设备状态直接取自 DeviceContext（与页面共享同一 provider）
  const {
    motors,
    selectedId,
    selectMotor,
    running: responseRunning,
    setRunning: setResponseRunning,
    tuneByMotor,
    dirtyByMotor,
    updateTune,
    saveTunePlan,
  } = useDevice();
  const tuningMotor = motors.find((motor) => motor.id === selectedId) ?? motors[0];
  const selectedTune = tuneByMotor[tuningMotor.id];
  const tuningDirty = dirtyByMotor[tuningMotor.id];

  return (
    <aside
      className={`studio__tuning ${tuningOpen ? "is-open" : ""}`}
      aria-label="PID 调参检查器"
    >
      <header className="studio__tuning-head">
        <div>
          <span className="studio__tuning-eyebrow">响应模型</span>
          <h2>PID 调参</h2>
        </div>
        <button
          type="button"
          className="studio__tuning-close"
          onClick={() => setTuningOpen(false)}
          aria-label="关闭调参检查器"
        >
          <X size={15} />
        </button>
      </header>

      <div className="studio__tuning-source">
        <span>当前对象</span>
        <strong>{tuningMotor.code} · {tuningMotor.name}</strong>
        <i>SIM</i>
      </div>

      <div className="studio__tuning-joints" role="tablist" aria-label="调参关节">
        {motors.map((motor) => (
          <button
            key={motor.id}
            type="button"
            role="tab"
            className={motor.id === tuningMotor.id ? "is-on" : ""}
            aria-selected={motor.id === tuningMotor.id}
            onClick={() => selectMotor(motor.id)}
          >
            {motor.code}
          </button>
        ))}
      </div>

      <section className="studio__response" aria-label="PID 响应仿真曲线">
        <div className="studio__response-head">
          <span>阶跃响应</span>
          <span><i className="is-sp" />目标 SP</span>
          <span><i className="is-pv" />仿真 PV</span>
        </div>
        <WaveCanvas
          motor={tuningMotor}
          tune={selectedTune}
          running={responseRunning}
        />
      </section>

      <p className="studio__tuning-note">
        参数仅作用于响应模型；通过仿真验证后，再由机器人适配器决定是否允许下发实机。
      </p>

      <div className="studio__tuning-params">
        <PidSlider
          label="比例"
          symbol="P"
          value={selectedTune.kp}
          min={0}
          max={50}
          step={0.1}
          onChange={(value) => updateTune(tuningMotor.id, { kp: value })}
        />
        <PidSlider
          label="积分"
          symbol="I"
          value={selectedTune.ki}
          min={0}
          max={5}
          step={0.01}
          onChange={(value) => updateTune(tuningMotor.id, { ki: value })}
        />
        <PidSlider
          label="微分"
          symbol="D"
          value={selectedTune.kd}
          min={0}
          max={10}
          step={0.05}
          onChange={(value) => updateTune(tuningMotor.id, { kd: value })}
        />
      </div>

      <footer className="studio__tuning-actions">
        <button
          type="button"
          className={`studio__tuning-run ${responseRunning ? "is-running" : ""}`}
          onClick={() => setResponseRunning(!responseRunning)}
        >
          {responseRunning ? <Pause size={14} /> : <Play size={14} />}
          {responseRunning ? "暂停响应" : "运行响应"}
        </button>
        <button
          type="button"
          className={`studio__tuning-save ${tuningDirty ? "is-dirty" : ""}`}
          onClick={() => saveTunePlan(tuningMotor.id)}
        >
          <Save size={14} />
          {tuningDirty ? "保存草案" : "已保存"}
        </button>
      </footer>
    </aside>
  );
}
