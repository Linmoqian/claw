type Props = {
  label: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** 数值小数位，默认 2 */
  decimals?: number;
  /** 数值后单位 */
  unit?: string;
};

import "./PidSlider.css";

/** 参数滑块（PID 与高级调试参数复用） */
export default function PidSlider({
  label,
  symbol,
  value,
  min,
  max,
  step,
  onChange,
  decimals = 2,
  unit,
}: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="pid-slider">
      <div className="pid-slider__head">
        <span className="pid-slider__label">
          <i className="pid-slider__symbol">{symbol}</i>
          {label}
        </span>
        <span className="pid-slider__value tnum">
          {value.toFixed(decimals)}
          {unit && <i className="pid-slider__unit">{unit}</i>}
        </span>
      </div>
      <input
        className="pid-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}
