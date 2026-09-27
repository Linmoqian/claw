/** 训练页面的统一切换入口。Created on 2026-09-27 @author: https://github.com/Linmoqian */
import { NavLink } from "react-router";
import "./TrainingNavigation.css";

const TRAINING_PAGES = [
  { to: "/training-center", label: "训练总览" },
  { to: "/model-training", label: "智能训练" },
  { to: "/training", label: "对抗训练" },
] as const;

export default function TrainingNavigation() {
  return (
    <nav className="training-navigation" aria-label="训练类型">
      {TRAINING_PAGES.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `training-navigation__link${isActive ? " is-active" : ""}`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
