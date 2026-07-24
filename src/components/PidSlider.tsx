type Props = {
  label: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};

/** 苹果风 PID 参数滑块 */
export default function PidSlider({ label, symbol, value, min, max, step, onChange }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="pid-slider">
      <div className="pid-slider__head">
        <span className="pid-slider__label">
          <i className="pid-slider__symbol">{symbol}</i>
          {label}
        </span>
        <span className="pid-slider__value tnum">{value.toFixed(2)}</span>
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
