import type { FaultFlags, Motor, SafetyLimits } from "../types";
import "./MotorCard.css";

type Props = {
  motor: Motor;
  selected: boolean;
  safety: SafetyLimits;
  fault: FaultFlags;
  onSelect: (id: string) => void;
};

function Metric({
  label,
  value,
  unit,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}) {
  return (
    <div className="motor-card__metric">
      <span className="motor-card__k">{label}</span>
      <span className={`motor-card__v tnum ${warn ? "warn" : ""}`}>
        {value}
        <i>{unit}</i>
      </span>
    </div>
  );
}

/** 单电机状态卡片：实时读数 + 使能态 + 故障标记 */
export default function MotorCard({
  motor,
  selected,
  safety,
  fault,
  onSelect,
}: Props) {
  const hasFault =
    fault.overTravel || fault.overCurrent || fault.overTemp || fault.commLost;
  const overTemp = motor.temp >= safety.tempMax;
  const overCurrent = motor.current >= safety.currentMax;

  return (
    <button
      type="button"
      className={`motor-card ${selected ? "is-selected" : ""} ${
        motor.enabled ? "" : "is-off"
      } ${hasFault ? "is-fault" : ""}`}
      onClick={() => onSelect(motor.id)}
      aria-pressed={selected}
    >
      <div className="motor-card__head">
        <span className="motor-card__code tnum">{motor.code}</span>
        <span className="motor-card__name">{motor.name}</span>
        <i
          className={`motor-card__led ${motor.enabled ? "on" : "off"}`}
          title={motor.enabled ? "使能中" : "未使能"}
        />
      </div>
      <div className="motor-card__grid">
        <Metric label="位置" value={motor.angle.toFixed(1)} unit="°" />
        <Metric label="速度" value={motor.velocity.toFixed(1)} unit="°/s" />
        <Metric
          label="电流"
          value={motor.current.toFixed(2)}
          unit="A"
          warn={overCurrent}
        />
        <Metric
          label="温度"
          value={motor.temp.toFixed(1)}
          unit="°"
          warn={overTemp}
        />
      </div>
      {hasFault && <div className="motor-card__fault">故障</div>}
    </button>
  );
}
