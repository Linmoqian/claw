import { MotionConfig } from "motion/react";
import { Routes, Route, Navigate } from "react-router";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ContextMenu, { type ContextMenuItem } from "./components/ContextMenu";
import Home from "./pages/Home";
import About from "./pages/About";
import "./App.css";

const contextItems: ContextMenuItem[] = [
  { id: "reload", label: "刷新", onClick: () => window.location.reload() },
  { id: "about", label: "关于", onClick: () => window.location.assign("#/about") },
  { divider: true },
  { id: "back", label: "返回首页", onClick: () => window.location.assign("#/") },
];

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="app-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        <ContextMenu items={contextItems} />
      </div>
    </MotionConfig>
  );
}

export default App;
