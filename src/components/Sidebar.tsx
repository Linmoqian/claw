import { useState, type ComponentType } from "react";
import { NavLink } from "react-router";
import {
  Plug,
  Box,
  Cpu,
  ToggleRight,
  SlidersHorizontal,
  Activity,
  Database,
  ShieldAlert,
  Info,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Swords,
  BrainCircuit,
} from "lucide-react";
import "./Sidebar.css";
import { useDevice } from "../store/DeviceContext";
import { useLocation } from "react-router";

type NavItem = {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  group: "workspace" | "system";
};

const NAV_ITEMS: NavItem[] = [
  { to: "/studio", label: "仿真与调参", Icon: Box, group: "workspace" },
  { to: "/connect", label: "设备连接", Icon: Plug, group: "workspace" },
  { to: "/data", label: "数据采集", Icon: Database, group: "workspace" },
  { to: "/safety", label: "故障与安全", Icon: ShieldAlert, group: "system" },
  { to: "/about", label: "关于应用", Icon: Info, group: "system" },
];

const MORE_ITEMS: NavItem[] = [
  { to: "/monitor", label: "关节状态", Icon: Cpu, group: "workspace" },
  { to: "/control", label: "基础控制", Icon: ToggleRight, group: "workspace" },
  {
    to: "/mode",
    label: "控制模式",
    Icon: SlidersHorizontal,
    group: "workspace",
  },
  { to: "/scope", label: "实时曲线", Icon: Activity, group: "workspace" },
  { to: "/training", label: "对抗训练", Icon: Swords, group: "workspace" },
  { to: "/model-training", label: "智能训练", Icon: BrainCircuit, group: "workspace" },
];

const GROUP_LABELS = {
  workspace: "工作台",
  system: "诊断与系统",
};

const STORAGE_KEY = "xiakao:sidebar:collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const { connected, selectedId, motors } = useDevice();
  const selected = motors.find((motor) => motor.id === selectedId);
  const moreActive = MORE_ITEMS.some((item) => location.pathname === item.to);
  const showMore = moreOpen || moreActive;

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
        <img
          className="sidebar__logo"
          src="/brand/xiakao-logo.png"
          alt="虾烤工作台"
        />
        <span className="sidebar__brand-copy">
          <strong>虾烤</strong>
          <small>Robot Workbench</small>
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
        <div className="sidebar__group sidebar__advanced">
          <button
            type="button"
            className={`sidebar__item sidebar__more-toggle ${showMore ? "is-open" : ""}`}
            onClick={() => setMoreOpen((prev) => !prev)}
            aria-expanded={showMore}
            title={collapsed ? "更多工具" : undefined}
          >
            <MoreHorizontal className="sidebar__icon" />
            <span className="sidebar__label">更多工具</span>
            {showMore ? (
              <ChevronDown
                className="sidebar__more-chevron"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="sidebar__more-chevron"
                aria-hidden="true"
              />
            )}
          </button>
          {showMore && (
            <div className="sidebar__more-items" aria-label="更多工具">
              {MORE_ITEMS.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className="sidebar__item"
                  title={collapsed ? label : undefined}
                >
                  <Icon className="sidebar__icon" />
                  <span className="sidebar__label">{label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
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
