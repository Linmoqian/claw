import { Power, Home, Minus, Plus, RotateCcw } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import MotorList from "../components/MotorList";
import "./Control.css";

/** 基础控制：使能 / 失能、回零、点动 */
export default function Control() {
  const { motors, selectedId, selectMotor, connected, setEnabled, setTarget } =
    useDevice();
  const selected = motors.find((m) => m.id === selectedId) ?? motors[0];

  const enableAll = () => motors.forEach((m) => setEnabled(m.id, true));
  const disableAll = () => motors.forEach((m) => setEnabled(m.id, false));
  const homeAll = () => motors.forEach((m) => setTarget(m.id, 0));
  const jog = (delta: number) => {
    const next = Math.max(
      selected.min,
      Math.min(selected.max, selected.target + delta),
    );
    setTarget(selectedId, next);
  };

  return (
    <div className="console">
      <aside className="motor-nav">
        <div className="console__label">
          <Power size={12} />
          <span>基础控制 · 选择关节</span>
        </div>
        <MotorList
          motors={motors}
          selectedId={selectedId}
          onSelect={selectMotor}
        />
      </aside>

      <section className="dashboard control-panel">
        <header className="motor-head">
          <div className="motor-head__id">
            <span className="motor-head__code tnum">{selected.code}</span>
            <span className="motor-head__name">{selected.name}</span>
          </div>
          <div className="motor-head__readings">
            <div className="reading">
              <span className="reading__k">位置</span>
              <span className="reading__v tnum">
                {selected.angle.toFixed(1)}
                <i className="reading__unit">°</i>
              </span>
            </div>
            <div className="reading">
              <span className="reading__k">目标</span>
              <span className="reading__v tnum">
                {selected.target.toFixed(1)}
                <i className="reading__unit">°</i>
              </span>
            </div>
            <div className="reading">
              <span className="reading__k">使能</span>
              <span
                className="reading__v"
                style={{
                  color: selected.enabled
                    ? "var(--success)"
                    : "var(--text-quaternary)",
                }}
              >
                {selected.enabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </header>

        {!connected && (
          <div className="control__notice">控制器未连接，控制操作已禁用</div>
        )}

        <div className="control__groups">
          <div className="control__group">
            <div className="control__group-title">批量操作</div>
            <div className="control__btns">
              <button
                type="button"
                className="ctrl-btn"
                onClick={enableAll}
                disabled={!connected}
              >
                <Power size={14} /> 全部锁定扭矩
              </button>
              <button
                type="button"
                className="ctrl-btn"
                onClick={disableAll}
                disabled={!connected}
              >
                全部释放扭矩
              </button>
              <button
                type="button"
                className="ctrl-btn"
                onClick={homeAll}
                disabled={!connected}
              >
                <Home size={14} /> 全部回零
              </button>
            </div>
          </div>

          <div className="control__group">
            <div className="control__group-title">当前关节 · 点动</div>
            <div className="control__jog">
              <button
                type="button"
                className="ctrl-btn"
                onClick={() => jog(-1)}
                disabled={!connected || !selected.enabled}
              >
                <Minus size={14} /> 1°
              </button>
              <button
                type="button"
                className="ctrl-btn"
                onClick={() => jog(1)}
                disabled={!connected || !selected.enabled}
              >
                <Plus size={14} /> 1°
              </button>
              <button
                type="button"
                className="ctrl-btn"
                onClick={() => setTarget(selectedId, 0)}
                disabled={!connected || !selected.enabled}
              >
                <RotateCcw size={14} /> 归零
              </button>
              <button
                type="button"
                className={`ctrl-btn ${selected.enabled ? "is-on" : ""}`}
                onClick={() => setEnabled(selectedId, !selected.enabled)}
                disabled={!connected}
              >
                <Power size={14} /> {selected.enabled ? "释放扭矩" : "锁定扭矩"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
