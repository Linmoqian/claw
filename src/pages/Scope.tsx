import { useState } from "react";
import { Activity } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import MotorList from "../components/MotorList";
import ScopeCanvas from "../components/ScopeCanvas";
import "./Scope.css";

type Channels = { position: boolean; velocity: boolean; current: boolean };

/** 实时曲线：多通道示波器（位置 / 速度 / 电流 vs 时间） */
export default function Scope() {
  const { motors, selectedId, selectMotor, connected, safety } = useDevice();
  const selected = motors.find((m) => m.id === selectedId) ?? motors[0];
  const [show, setShow] = useState<Channels>({
    position: true,
    velocity: true,
    current: true,
  });

  const toggle = (k: keyof Channels) =>
    setShow((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="console">
      <aside className="motor-nav">
        <div className="console__label">
          <Activity size={12} />
          <span>实时曲线 · 选择关节</span>
        </div>
        <MotorList motors={motors} selectedId={selectedId} onSelect={selectMotor} />
      </aside>

      <section className="dashboard scope-panel">
        <div className="scope-region">
          <div className="wave-region__head">
            <div className="console__label">
              <span>
                {selected.code} {selected.name} · 多通道
              </span>
            </div>
            <div className="scope-toggles">
              <label className={`scope-toggle pos ${show.position ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={show.position}
                  onChange={() => toggle("position")}
                />
                <i className="scope-toggle__dot pos" />
                位置
              </label>
              <label className={`scope-toggle vel ${show.velocity ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={show.velocity}
                  onChange={() => toggle("velocity")}
                />
                <i className="scope-toggle__dot vel" />
                速度
              </label>
              <label className={`scope-toggle cur ${show.current ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={show.current}
                  onChange={() => toggle("current")}
                />
                <i className="scope-toggle__dot cur" />
                电流
              </label>
            </div>
          </div>
          {/* 切换关节时重置缓冲，避免不同电机的值混叠 */}
          <ScopeCanvas key={selectedId} motor={selected} safety={safety} show={show} />
        </div>

        {!connected && (
          <div className="scope__notice">控制器未连接，曲线为静态读数</div>
        )}
      </section>
    </div>
  );
}
