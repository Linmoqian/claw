import { useState, type ComponentType } from "react";
import { NavLink } from "react-router";
import {
  Plug,
  Box,
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
import { useDevice } from "../store/DeviceContext";

type NavItem = {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  group: "observe" | "tune" | "system";
};

const NAV_ITEMS: NavItem[] = [
  { to: "/studio", label: "3D 仿真", Icon: Box, group: "observe" },
  { to: "/connect", label: "设备连接", Icon: Plug, group: "observe" },
  { to: "/monitor", label: "关节状态", Icon: Cpu, group: "observe" },
  { to: "/control", label: "基础控制", Icon: ToggleRight, group: "tune" },
  { to: "/mode", label: "控制模式", Icon: SlidersHorizontal, group: "tune" },
  { to: "/pid", label: "PID 调参", Icon: Gauge, group: "tune" },
  { to: "/scope", label: "实时曲线", Icon: Activity, group: "tune" },
  { to: "/safety", label: "故障与安全", Icon: ShieldAlert, group: "system" },
  { to: "/about", label: "关于应用", Icon: Info, group: "system" },
];

const GROUP_LABELS = {
  observe: "工作台",
  tune: "运动与调参",
  system: "系统",
};

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
  const { connected, selectedId, motors } = useDevice();
  const selected = motors.find((motor) => motor.id === selectedId);

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
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="sidebar__brand-copy">
          <strong>Claw</strong>
          <small>Motor Atelier</small>
        </span>
      </div>
      <nav className="sidebar__nav" aria-label="主导航">
        {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map(
          (group) => (
            <div className="sidebar__group" key={group}>
              <span className="sidebar__group-label">
                {GROUP_LABELS[group]}
              </span>
              {NAV_ITEMS.filter((item) => item.group === group).map(
                ({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className="sidebar__item"
                    title={collapsed ? label : undefined}
                  >
                    <Icon className="sidebar__icon" />
                    <span className="sidebar__label">{label}</span>
                  </NavLink>
                ),
              )}
            </div>
          ),
        )}
      </nav>
      <div className="sidebar__context">
        <span
          className={`sidebar__context-dot ${connected ? "is-online" : ""}`}
        />
        <span className="sidebar__context-copy">
          <strong>{connected ? "设备已连接" : "未连接"}</strong>
          <small>
            {selected?.code ?? "J1"} · {selected?.name ?? "基座旋转"}
          </small>
        </span>
      </div>
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
