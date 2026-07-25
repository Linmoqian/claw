import { useState, type ComponentType } from "react";
import { NavLink } from "react-router";
import { Gauge, Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "./Sidebar.css";

type NavItem = {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "控制台", Icon: Gauge, end: true },
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
