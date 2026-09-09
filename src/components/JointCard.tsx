/** 关节控制卡片：代号/名称/当前角 + 限位滑块 + 目标角对照 + 拾取高亮。 */
import type { CSSProperties } from "react";
import type { ActiveJoint } from "../robot/types";
import "./JointCard.css";

type Props = {
  joint: ActiveJoint;
  panelIndex: number;
  valueDeg: number;
  /** 目标角（Intent 入闸后的下发值；拖动/回零时与当前值分岔） */
  targetDeg: number;
  /** 3D 拾取联动高亮 */
  selected: boolean;
  onChange: (panelIndex: number, deg: number) => void;
};

/** 无 <limit> 的关节（continuous）滑块回退范围 */
const LIMITLESS_FALLBACK = 180;

export default function JointCard({
  joint,
  panelIndex,
  valueDeg,
  targetDeg,
  selected,
  onChange,
}: Props) {
  const hasLimits =
    Number.isFinite(joint.minDeg) && Number.isFinite(joint.maxDeg);
  const min = hasLimits ? joint.minDeg : -LIMITLESS_FALLBACK;
  const max = hasLimits ? joint.maxDeg : LIMITLESS_FALLBACK;
  // 滑块位置跟随目标角（拖动滑块时即所得）
  const slid = Math.min(100, Math.max(0, ((targetDeg - min) / (max - min)) * 100));
  const hasGap = Math.abs(targetDeg - valueDeg) > 0.15;

  return (
    <div className={`joint-card${selected ? " is-selected" : ""}`}>
      <div className="joint-card__head">
        <span className="joint-card__code tnum">{joint.code}</span>
        <span className="joint-card__name">{joint.name}</span>
        <span className="joint-card__value tnum">
          {valueDeg.toFixed(1)}
          <i>°</i>
        </span>
      </div>
      <input
        type="range"
        className="joint-card__slider"
        style={{ "--pct": `${slid}%` } as CSSProperties}
        min={min}
        max={max}
        step={0.1}
        value={targetDeg}
        onChange={(e) => onChange(panelIndex, Number(e.target.value))}
        aria-label={`${joint.code} ${joint.name} 角度`}
      />
      {hasGap && (
        <div className="joint-card__target tnum">
          → {targetDeg.toFixed(1)}°
        </div>
      )}
      <div className="joint-card__limits tnum">
        <span>{min.toFixed(0)}°</span>
        <span>{max.toFixed(0)}°</span>
      </div>
    </div>
  );
}