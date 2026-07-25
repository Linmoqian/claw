import { useState, type ComponentType } from "react";
import { NavLink } from "react-router";
import {
  Plug,
  Cpu,
  ToggleRight,
  SlidersHorizontal,
  Gauge,
  Activity,
  ShieldAlert,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import "./Sidebar.css";

type NavItem = {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/connect", label: "设备连接", Icon: Plug },
  { to: "/monitor", label: "状态监控", Icon: Cpu },
  { to: "/control", label: "基础控制", Icon: ToggleRight },
  { to: "/mode", label: "控制模式", Icon: SlidersHorizontal },
  { to: "/pid", label: "PID 调参", Icon: Gauge },
  { to: "/scope", label: "实时曲线", Icon: Activity },
  { to: "/safety", label: "故障与安全", Icon: ShieldAlert },
  { to: "/about", label: "关于", Icon: Info },
];

const STORAGE_KEY = "claw:sidebar:collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 忽略存储失败（隐私模式等）
      }
      return next;
    });
  };

  return (
    <aside className="sidebar" data-collapsed={collapsed || undefined}>
      <nav className="sidebar__nav" aria-label="主导航">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="sidebar__item"
            title={collapsed ? label : undefined}
          >
            <Icon className="sidebar__icon" />
            <span className="sidebar__label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        className="sidebar__toggle"
        onClick={toggle}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        aria-expanded={!collapsed}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {collapsed ? (
          <PanelLeftOpen className="sidebar__icon" />
        ) : (
          <PanelLeftClose className="sidebar__icon" />
        )}
        <span className="sidebar__label">收起</span>
      </button>
    </aside>
  );
}
