import { useState } from "react";
import { ShieldAlert, Save, Download, Copy, Check } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import PidSlider from "../components/PidSlider";
import "./Safety.css";

function SwitchRow({
  label,
  desc,
  on,
  onToggle,
}: {
  label: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="safety__switch">
      <div className="safety__switch-text">
        <span className="safety__switch-label">{label}</span>
        <span className="safety__switch-desc">{desc}</span>
      </div>
      <button
        type="button"
        className={`safety__switch-btn ${on ? "on" : ""}`}
        onClick={onToggle}
        aria-pressed={on}
      >
        <i className="safety__switch-knob" />
      </button>
    </div>
  );
}

/** 故障与安全：阈值 / 急停策略 / Flash 保存 / 配置导出 */
export default function Safety() {
  const {
    motors,
    safety,
    setSafety,
    faults,
    dirtyByMotor,
    saveToFlash,
    exportConfig,
  } = useDevice();

  const [exported, setExported] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const anyDirty = motors.some((m) => dirtyByMotor[m.id]);
  const saveAll = () => motors.forEach((m) => saveToFlash(m.id));

  const doExport = () => {
    setExported(exportConfig());
    setCopied(false);
  };

  const copyExport = async () => {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const faultMotors = motors.filter((m) => {
    const f = faults[m.id];
    return f && (f.overTravel || f.overCurrent || f.overTemp || f.commLost);
  });

  return (
    <div className="stage safety">
      <div className="section-label">
        <span className="section-label__title">故障与安全</span>
      </div>

      {/* 故障总览 */}
      <div
        className={`safety__banner ${faultMotors.length ? "is-alert" : "is-ok"}`}
      >
        <ShieldAlert size={18} />
        <span>
          {faultMotors.length
            ? `${faultMotors.length} 个关节存在故障：${faultMotors
                .map((m) => m.code)
                .join("、")}`
            : "全部关节状态正常"}
        </span>
      </div>

      {/* 安全阈值 */}
      <div className="safety__panel">
        <div className="safety__panel-title">安全阈值（全局）</div>
        <div className="safety__sliders">
          <PidSlider
            label="过温阈值"
            symbol="T"
            value={safety.tempMax}
            min={30}
            max={90}
            step={1}
            decimals={0}
            unit="°C"
            onChange={(v) => setSafety({ tempMax: v })}
          />
          <PidSlider
            label="过流阈值"
            symbol="I"
            value={safety.currentMax}
            min={0.5}
            max={10}
            step={0.1}
            decimals={1}
            unit="A"
            onChange={(v) => setSafety({ currentMax: v })}
          />
          <PidSlider
            label="超速阈值"
            symbol="V"
            value={safety.velocityMax}
            min={30}
            max={360}
            step={5}
            decimals={0}
            unit="°/s"
            onChange={(v) => setSafety({ velocityMax: v })}
          />
        </div>
        <div className="safety__switches">
          <SwitchRow
            label="软限位"
            desc="限制目标值在关节角度区间内"
            on={safety.softLimit}
            onToggle={() => setSafety({ softLimit: !safety.softLimit })}
          />
          <SwitchRow
            label="超限自动断使能"
            desc="触发阈值时自动失能该关节"
            on={safety.autoDisable}
            onToggle={() => setSafety({ autoDisable: !safety.autoDisable })}
          />
        </div>
      </div>

      {/* Flash 保存与导出 */}
      <div className="safety__panel">
        <div className="safety__panel-title">Flash 保存与配置导出</div>
        <div className="safety__row">
          <div className={`safety__row-info ${anyDirty ? "dirty" : ""}`}>
            {anyDirty ? "存在未保存的参数修改" : "所有参数已与 Flash 一致"}
          </div>
          <button
            type="button"
            className={`ctrl-btn ${anyDirty ? "is-on" : ""}`}
            onClick={saveAll}
          >
            <Save size={14} /> 保存全部到 Flash
          </button>
        </div>
        <div className="safety__row">
          <div className="safety__row-info">导出当前全部配置为 JSON</div>
          <div className="safety__row-btns">
            <button type="button" className="ctrl-btn" onClick={doExport}>
              <Download size={14} /> 生成配置
            </button>
            {exported && (
              <button type="button" className="ctrl-btn" onClick={copyExport}>
                {copied ? (
                  <>
                    <Check size={14} /> 已复制
                  </>
                ) : (
                  <>
                    <Copy size={14} /> 复制
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        {exported && <pre className="safety__export tnum">{exported}</pre>}
      </div>
    </div>
  );
}
