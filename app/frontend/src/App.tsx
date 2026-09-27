/** 工作台入口与持久运行宿主。Created on 2026-09-26; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { Suspense, lazy, useEffect, useLayoutEffect } from "react";
import { MotionConfig } from "motion/react";
import { Info, RotateCw } from "lucide-react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import EstopButton from "./components/EstopButton";
import ContextMenu, { type ContextMenuItem } from "./components/ContextMenu";
import { DeviceProvider, useDevice } from "./store/DeviceContext";
import { emitDebug } from "./lib/debugBus";
import About from "./pages/About";
import DataCollection from "./pages/DataCollection";
import WorkbenchHome from "./pages/WorkbenchHome";
import Experiments from "./pages/Experiments";
import ExperimentDetail from "./pages/ExperimentDetail";
import ExperimentBar from "./components/workbench/ExperimentBar";
import PageBoundary from "./components/workbench/PageBoundary";
import RuntimeBoundary from "./components/workbench/RuntimeBoundary";
import LoadingState from "./components/workbench/LoadingState";
import RuntimeHost from "./workbench/RuntimeHost";
import "./App.css";
import "./workbench-theme.css";

const Studio = lazy(() => import("./pages/Studio"));
const BlockLab = lazy(() => import("./pages/BlockLab"));
const AdversarialTraining = lazy(() => import("./pages/AdversarialTraining"));
const ModelTraining = lazy(() => import("./pages/ModelTraining"));
const TrainingCenter = lazy(() => import("./pages/TrainingCenter"));
const VisionAssistant = lazy(() => import("./pages/VisionAssistant"));
const Documents = lazy(() => import("./pages/Documents"));
const AssetLibrary = lazy(() => import("./pages/AssetLibrary"));
const MotorDebug = lazy(() => import("./pages/MotorDebug"));

const contextItems: ContextMenuItem[] = [
  {
    id: "reload",
    label: "刷新",
    icon: RotateCw,
    onClick: () => window.location.reload(),
  },
  {
    id: "about",
    label: "关于",
    icon: Info,
    onClick: () => window.location.assign("#/about"),
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
  const location = useLocation();
  useLayoutEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);
  return (
    <MotionConfig reducedMotion="user">
      <DeviceProvider>
        <div className="app-shell">
          <a
            className="wb-skip-link"
            href="#main-content"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("main-content")?.focus();
            }}
          >
            跳到主要内容
          </a>
          <DebugBridge />
          <TitleBar />
          <div className="app-body">
            <Sidebar />
            <div className="app-workspace">
              <ExperimentBar />
              <main className="app-content" id="main-content" tabIndex={-1}>
                <PageBoundary key={location.pathname}>
                  <Suspense
                    fallback={
                      <LoadingState
                        label="正在准备工作区"
                        detail="载入实验工具与页面…"
                      />
                    }
                  >
                    <Routes>
                      <Route
                        path="/"
                        element={<Navigate to="/workbench" replace />}
                      />
                      <Route path="/workbench" element={<WorkbenchHome />} />
                      <Route path="/experiments" element={<Experiments />} />
                      <Route
                        path="/experiments/:id"
                        element={<ExperimentDetail />}
                      />
                      <Route path="/studio" element={<Studio />} />
                      <Route path="/blocks" element={<BlockLab />} />
                      <Route path="/motor-debug" element={<MotorDebug />} />
                      <Route path="/data" element={<DataCollection />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/assets" element={<AssetLibrary />} />
                      <Route path="/training-center" element={<TrainingCenter />} />
                      <Route
                        path="/training"
                        element={<AdversarialTraining />}
                      />
                      <Route
                        path="/model-training"
                        element={<ModelTraining />}
                      />
                      <Route path="/vision" element={<VisionAssistant />} />
                      <Route path="/about" element={<About />} />
                      <Route
                        path="*"
                        element={<Navigate to="/workbench" replace />}
                      />
                    </Routes>
                  </Suspense>
                </PageBoundary>
              </main>
            </div>
          </div>
          <RuntimeBoundary>
            <RuntimeHost />
          </RuntimeBoundary>
          <ContextMenu items={contextItems} />
          <EstopButton />
        </div>
      </DeviceProvider>
    </MotionConfig>
  );
}

export default App;
