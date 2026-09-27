/** 工作台任务导航。Created on 2026-09-26; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import {
  Blocks,
  BookOpen,
  Box,
  BrainCircuit,
  ChevronDown,
  Clapperboard,
  FlaskConical,
  FolderOpen,
  House,
  Info,
  Cable,
  PanelLeftClose,
  PanelLeftOpen,
  ScanEye,
  type LucideIcon,
} from "lucide-react";
import "./Sidebar.css";

interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  activePaths?: string[];
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
      { to: "/motor-debug", label: "单电机调试", icon: Cable },
    ],
  },
  {
    id: "intelligence",
    label: "数据与智能",
    items: [
      { to: "/assets", label: "项目资产", icon: FolderOpen },
      { to: "/data", label: "视频与数据", icon: Clapperboard },
      { to: "/documents", label: "文档收集", icon: BookOpen },
      {
        to: "/training-center",
        label: "训练中心",
        icon: BrainCircuit,
        activePaths: ["/model-training", "/training"],
      },
      { to: "/vision", label: "视觉助手", icon: ScanEye },
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
  const renderItem = ({ to, label, icon: Icon, activePaths }: NavigationItem) => (
    <NavLink
      key={to}
      to={to}
      className={({ isActive }) =>
        `sidebar__item${isActive || activePaths?.includes(pathname) ? " active" : ""}`
      }
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
              pathname === item.to ||
              pathname.startsWith(`${item.to}/`) ||
              item.activePaths?.includes(pathname),
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
