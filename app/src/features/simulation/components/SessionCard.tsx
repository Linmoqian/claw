/**
 * SessionCard —— 命令会话卡（M4）：预览/提交/被拒状态展示。
 * 预览期：显示控制源与预览摘要（✕ 取消可点击，ESC 等效）；
 * 结束态（done/rejected/aborted/blocked）：短暂展示后自动消失。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { labelOf } from "../../../command/arbiter";
import { useSessionStore } from "../../../stores/sessionStore";
import "./SessionCard.css";

export default function SessionCard() {
  const session = useSessionStore((s) => s.session);
  const cancel = useSessionStore((s) => s.cancel);
  const dismiss = useSessionStore((s) => s.dismiss);
  if (!session) return null;

  const { phase, source, summary, reason } = session;
  // 摘要文本：J3 → -45.0° / TCP (0.12, 0.00, 0.18) / 底盘 (0.35, -0.20)
  const summaryText =
    summary?.kind === "joint-target"
      ? `${summary.jointCode ?? "?"} → ${(summary.valueDeg ?? 0).toFixed(1)}°`
      : summary?.kind === "tcp-pose" && summary.position
        ? `TCP (${summary.position.x.toFixed(2)}, ${summary.position.y.toFixed(2)}, ${summary.position.z.toFixed(2)})`
        : summary?.kind === "base-pose" && summary.base
          ? `底盘 (${summary.base.x.toFixed(2)}, ${summary.base.y.toFixed(2)})`
          : "…";

  const phaseLabel =
    phase === "preview"
      ? "预览中"
      : phase === "done"
        ? "已提交"
        : phase === "rejected"
          ? "已拒绝"
          : phase === "aborted"
            ? "已中止"
            : "被阻塞";

  return (
    <div className={`session-card is-${phase}`} role="status" aria-live="polite">
      <i className="session-card__dot" aria-hidden="true" />
      <div className="session-card__body">
        <span className="session-card__phase">{phaseLabel}</span>
        <span className="session-card__meta tnum">
          {labelOf(source)} · {summaryText}
        </span>
        {reason && <span className="session-card__reason">{reason}</span>}
      </div>
      {phase === "preview" ? (
        <button
          type="button"
          className="session-card__btn"
          onClick={() => cancel(source)}
          aria-label="取消预览"
        >
          ✕
        </button>
      ) : (
        <button
          type="button"
          className="session-card__btn"
          onClick={dismiss}
          aria-label="关闭"
        >
          ✓
        </button>
      )}
    </div>
  );
}
