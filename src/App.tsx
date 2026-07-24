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
  return (
    <div className="app-shell">
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
