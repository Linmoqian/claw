import { Routes, Route, Navigate, NavLink } from "react-router";
import TitleBar from "./components/TitleBar";
import ContextMenu, { type ContextMenuItem } from "./components/ContextMenu";
import Home from "./pages/Home";
import About from "./pages/About";
import "./App.css";

const contextItems: ContextMenuItem[] = [
  { id: "reload", label: "刷新", onClick: () => window.location.reload() },
  { id: "about", label: "关于", onClick: () => alert("claw - 自定义窗口示例") },
  { divider: true },
  { id: "back", label: "返回首页", onClick: () => window.location.assign("#/") },
];

function App() {
  return (
    <div className="app-shell">
      <TitleBar />
      <main className="app-content">
        <nav className="nav">
          <NavLink to="/" end>首页</NavLink>
          <NavLink to="/about">关于</NavLink>
        </nav>
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
