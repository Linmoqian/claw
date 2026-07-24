import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router";
import TitleBar from "./components/TitleBar";
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
  // 环境光晕跟随鼠标
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const root = document.documentElement;
      root.style.setProperty("--mx", `${e.clientX}px`);
      root.style.setProperty("--my", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden />
      <TitleBar />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ContextMenu items={contextItems} />
    </div>
  );
}

export default App;
