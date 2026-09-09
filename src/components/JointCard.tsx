/** 关节控制卡片：代号/名称/当前角 + 限位滑块（min/max 来自 URDF）。 */
import type { CSSProperties } from "react";
import type { ActiveJoint } from "../robot/types";
import "./JointCard.css";

type Props = {
  joint: ActiveJoint;
  panelIndex: number;
  valueDeg: number;
  onChange: (panelIndex: number, deg: number) => void;
};

/** 无 <limit> 的关节（continuous）滑块回退范围 */
const LIMITLESS_FALLBACK = 180;

export default function JointCard({ joint, panelIndex, valueDeg, onChange }: Props) {
  const hasLimits =
    Number.isFinite(joint.minDeg) && Number.isFinite(joint.maxDeg);
  const min = hasLimits ? joint.minDeg : -LIMITLESS_FALLBACK;
  const max = hasLimits ? joint.maxDeg : LIMITLESS_FALLBACK;
  const pct = Math.min(100, Math.max(0, ((valueDeg - min) / (max - min)) * 100));

  return (
    <div className="joint-card">
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
        style={{ "--pct": `${pct}%` } as CSSProperties}
        min={min}
        max={max}
        step={0.1}
        value={valueDeg}
        onChange={(e) => onChange(panelIndex, Number(e.target.value))}
        aria-label={`${joint.code} ${joint.name} 角度`}
      />
      <div className="joint-card__limits tnum">
        <span>{min.toFixed(0)}°</span>
        <span>{max.toFixed(0)}°</span>
      </div>
    </div>
  );
}