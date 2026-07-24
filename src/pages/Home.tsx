import { useState } from "react";
import DeviceConnection from "../components/DeviceConnection";
import MotorGrid from "../components/MotorGrid";
import { MOTORS } from "../types";

function Home() {
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState(MOTORS[0].id);
  const selectedMotor = MOTORS.find((m) => m.id === selectedId) ?? MOTORS[0];

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

      {/* 区域 3：PID 波形（批次3接入） */}
    </div>
  );
}

export default Home;
