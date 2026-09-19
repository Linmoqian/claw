import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { Info, Plug, RotateCw } from "lucide-react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import EstopButton from "./components/EstopButton";
import ContextMenu, { type ContextMenuItem } from "./components/ContextMenu";
import { DeviceProvider, useDevice } from "./store/DeviceContext";
import { emitDebug } from "./lib/debugBus";
import Connect from "./pages/Connect";
import Monitor from "./pages/Monitor";
import Control from "./pages/Control";
import ModeControl from "./pages/ModeControl";
import PidTuner from "./pages/PidTuner";
import Scope from "./pages/Scope";
import Safety from "./pages/Safety";
import About from "./pages/About";
import Studio from "./pages/Studio";
import DataCollection from "./pages/DataCollection";
import AdversarialTraining from "./pages/AdversarialTraining";
import ModelTraining from "./pages/ModelTraining";
import VisionAssistant from "./pages/VisionAssistant";
import BlockLab from "./pages/BlockLab";
import "./App.css";

const contextItems: ContextMenuItem[] = [
  { id: "reload", label: "刷新", icon: RotateCw, onClick: () => window.location.reload() },
  {
    id: "about",
    label: "关于",
    icon: Info,
    onClick: () => window.location.assign("#/about"),
  },
  { divider: true },
  {
    id: "connect",
    label: "设备连接",
    icon: Plug,
    onClick: () => window.location.assign("#/connect"),
  },
];

function DebugBridge() {
  const location = useLocation();
  const { connected, deviceId, estop, selectedId } = useDevice();

  useEffect(() => {
    emitDebug("info", "navigation", "页面切换", {
      path: location.pathname,
      connected,
      deviceId,
      estop,
      selectedId,
    });
  }, [connected, deviceId, estop, location.pathname, selectedId]);

  return null;
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <DeviceProvider>
        <div className="app-shell">
          <DebugBridge />
          <div className="app-aurora" aria-hidden="true" />
          <TitleBar />
          <div className="app-body">
            <Sidebar />
            <main className="app-content">
              <Routes>
                <Route path="/" element={<Navigate to="/studio" replace />} />
                <Route path="/studio" element={<Studio />} />
                <Route path="/blocks" element={<BlockLab />} />
                <Route path="/connect" element={<Connect />} />
                <Route path="/data" element={<DataCollection />} />
                <Route path="/training" element={<AdversarialTraining />} />
                <Route path="/model-training" element={<ModelTraining />} />
                <Route path="/vision" element={<VisionAssistant />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/control" element={<Control />} />
                <Route path="/mode" element={<ModeControl />} />
                <Route path="/pid" element={<PidTuner />} />
                <Route path="/scope" element={<Scope />} />
                <Route path="/safety" element={<Safety />} />
                <Route path="/about" element={<About />} />
                <Route path="*" element={<Navigate to="/connect" replace />} />
              </Routes>
            </main>
          </div>
          <ContextMenu items={contextItems} />
          <EstopButton />
        </div>
      </DeviceProvider>
    </MotionConfig>
  );
}

export default App;
