/** 工作台统一加载反馈。Created on 2026-09-27 @author: https://github.com/Linmoqian */
import "./LoadingState.css";

interface LoadingStateProps {
  label: string;
  detail?: string;
  variant?: "page" | "panel" | "scene";
}

export default function LoadingState({
  label,
  detail,
  variant = "page",
}: LoadingStateProps) {
  return (
    <div
      className={`wb-loading wb-loading--${variant}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="wb-loading__track" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="wb-loading__copy">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
    </div>
  );
}
