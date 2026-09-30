/** 共享空态占位：沿用各页面既有的空态样式类，统一标记结构。Created on 2026-09-30
 * @author:  https://github.com/Linmoqian
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  /** 页面既有的空态样式类，视觉仍由各页面 CSS 决定。 */
  className: string;
  icon: LucideIcon;
  iconSize?: number;
  title: string;
  hint?: ReactNode;
  /** 动作区（按钮/链接），渲染在提示文字之后。 */
  children?: ReactNode;
}

export default function EmptyState({
  className,
  icon: Icon,
  iconSize = 26,
  title,
  hint,
  children,
}: EmptyStateProps) {
  return (
    <div className={className}>
      <Icon size={iconSize} aria-hidden="true" />
      <strong>{title}</strong>
      {hint != null && <p>{hint}</p>}
      {children}
    </div>
  );
}
