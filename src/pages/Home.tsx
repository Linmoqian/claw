import { useMemo, useState } from "react";
import DeviceConnection from "../components/DeviceConnection";
import MotorGrid from "../components/MotorGrid";
import PidTuner from "../components/PidTuner";
import { MOTORS, DEFAULT_PID, type PidGains } from "../types";

function Home() {
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState(MOTORS[0].id);
  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);

  // 每电机的 PID 参数（初始为默认值）
  const [pidByMotor, setPidByMotor] = useState<Record<string, PidGains>>(() =>
    Object.fromEntries(MOTORS.map((m) => [m.id, { ...DEFAULT_PID }])),
  );

  const selectedMotor = useMemo(
    () => MOTORS.find((m) => m.id === selectedId) ?? MOTORS[0],
    [selectedId],
  );
  const selectedPid = pidByMotor[selectedId];

  const updatePid = (next: PidGains) =>
    setPidByMotor((prev) => ({ ...prev, [selectedId]: next }));

  return (
    <div className="stage">
      {/* 区域 1：连接 */}
      <div>
        <div className="section-label">
          <span className="section-label__title">连接</span>
          <span className="section-label__hint">
            {connected ? "设备已就绪" : "请通过 USB 连接机械臂控制器"}
          </span>
        </div>
        <DeviceConnection
          connected={connected}
          onToggle={() => setConnected((v) => !v)}
        />
      </div>

      {/* 区域 2：7 电机卡片（2.5D 弧面） */}
      <div>
        <div className="section-label">
          <span className="section-label__title">关节 · 7 DOF</span>
          <span className="section-label__hint">
            选中 <b className="section-label__accent">{selectedMotor.code} {selectedMotor.name}</b> 查看波形
          </span>
        </div>
        <MotorGrid motors={MOTORS} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* 区域 3：PID 波形 + 调参 */}
      <div>
        <div className="section-label">
          <span className="section-label__title">PID 调参</span>
          <span className="section-label__hint">实时仿真，调节 P/I/D 观察阶跃响应</span>
        </div>
        <PidTuner
          key={`${selectedId}-${resetKey}`}
          motor={selectedMotor}
          pid={selectedPid}
          running={running}
          onPidChange={updatePid}
          onToggleRun={() => setRunning((v) => !v)}
          onReset={() => setResetKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}

export default Home;
