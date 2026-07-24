import { useState } from "react";
import DeviceConnection from "../components/DeviceConnection";

function Home() {
  const [connected, setConnected] = useState(false);

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

      {/* 区域 2、3 由后续批次接入 */}
    </div>
  );
}

export default Home;
