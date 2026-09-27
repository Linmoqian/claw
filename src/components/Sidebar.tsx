/** 工作台任务导航。Created on 2026-09-26; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import {
  Activity,
  Blocks,
  BookOpen,
  Box,
  BrainCircuit,
  CarFront,
  ChevronDown,
  Cpu,
  Clapperboard,
  FlaskConical,
  FolderOpen,
  Gauge,
  House,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ScanEye,
  ShieldAlert,
  SlidersHorizontal,
  Swords,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";
import "./Sidebar.css";

interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
interface NavigationGroup {
  id: string;
  label: string;
  items: NavigationItem[];
}

const GROUPS: NavigationGroup[] = [
  {
    id: "experiment",
    label: "实验操作",
    items: [
      { to: "/studio", label: "仿真与调参", icon: Box },
      { to: "/blocks", label: "积木编程", icon: Blocks },
      { to: "/experiments", label: "实验记录", icon: FlaskConical },
    ],
  },
  {
    id: "intelligence",
    label: "数据与智能",
    items: [
      { to: "/assets", label: "项目资产", icon: FolderOpen },
      { to: "/data", label: "视频与数据", icon: Clapperboard },
      { to: "/documents", label: "文档收集", icon: BookOpen },
      { to: "/model-training", label: "智能训练", icon: BrainCircuit },
      { to: "/training", label: "对抗训练", icon: Swords },
      { to: "/vision", label: "视觉助手", icon: ScanEye },
    ],
  },
  {
    id: "device",
    label: "设备与诊断",
    items: [
      { to: "/devices", label: "设备目录", icon: CarFront },
      { to: "/connect", label: "设备连接", icon: Plug },
      { to: "/monitor", label: "关节状态", icon: Cpu },
      { to: "/control", label: "基础控制", icon: ToggleRight },
      { to: "/mode", label: "控制模式", icon: SlidersHorizontal },
      { to: "/pid", label: "PID 参数", icon: Gauge },
      { to: "/scope", label: "实时曲线", icon: Activity },
      { to: "/safety", label: "故障与安全", icon: ShieldAlert },
    ],
  },
];
const STORAGE_KEY = "xiakao:sidebar:collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    experiment: true,
    intelligence: true,
  });
  const { pathname } = useLocation();
  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* 布局偏好不可写时仍可在本次会话切换。 */
    }
  };
  const renderItem = ({ to, label, icon: Icon }: NavigationItem) => (
    <NavLink
      key={to}
      to={to}
      className="sidebar__item"
      title={collapsed ? label : undefined}
      aria-label={label}
    >
      <Icon className="sidebar__icon" aria-hidden="true" />
      <span className="sidebar__label">{label}</span>
    </NavLink>
  );

  return (
    <aside className="sidebar" data-collapsed={collapsed || undefined}>
      <NavLink
        to="/workbench"
        className="sidebar__brand"
        aria-label="虾烤工作台首页"
      >
        <img className="sidebar__logo" src="/brand/xiakao-mark.svg" alt="" />
        <span className="sidebar__brand-copy">
          <strong>虾烤工作台</strong>
          <small>实验室 · 本地工作空间</small>
        </span>
      </NavLink>
      <nav className="sidebar__nav" aria-label="主导航">
        {renderItem({ to: "/workbench", label: "工作台总览", icon: House })}
        {GROUPS.map((group) => {
          const active = group.items.some(
            (item) =>
              pathname === item.to || pathname.startsWith(`${item.to}/`),
          );
          const open = collapsed || expanded[group.id] || active;
          return (
            <div className="sidebar__group" key={group.id}>
              <button
                className="sidebar__group-heading"
                type="button"
                aria-expanded={open}
                aria-controls={`nav-${group.id}`}
                onClick={() =>
                  setExpanded((current) => ({ ...current, [group.id]: !open }))
                }
                title={active ? "当前页面所在分组保持展开" : undefined}
              >
                <span>{group.label}</span>
                <ChevronDown size={13} className={open ? "" : "is-closed"} />
              </button>
              {open && (
                <div id={`nav-${group.id}`} className="sidebar__group-items">
                  {group.items.map(renderItem)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="sidebar__footer">
        {renderItem({ to: "/about", label: "关于工作台", icon: Info })}
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
          <span className="sidebar__label">收起导航</span>
        </button>
      </div>
    </aside>
  );
}
