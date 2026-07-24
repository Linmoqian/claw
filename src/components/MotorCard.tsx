import { motion } from "motion/react";
import type { Motor } from "../types";
import "./MotorCard.css";

type Props = {
  motor: Motor;
  index: number;
  total: number;
  selected: boolean;
  onSelect: (id: string) => void;
};

/** 7 张卡片以弧面排列：中间最前、两侧向后旋转，形成 2.5D 纵深 */
function arcTransform(index: number, total: number, selected: boolean) {
  const center = (total - 1) / 2;
  const d = index - center; // 相对中心的偏移
  const rotateY = d * -7; // 两侧向内收
  const translateZ = -Math.abs(d) * 34; // 两侧后退
  const lift = selected ? -10 : 0;
  return {
    rotateY,
    translateZ,
    y: lift,
  };
}

/** 温度对应的色调 */
function tempColor(temp: number) {
  if (temp >= 45) return "var(--danger)";
  if (temp >= 40) return "var(--warning)";
  return "var(--success)";
}

export default function MotorCard({ motor, index, total, selected, onSelect }: Props) {
  const range = motor.max - motor.min;
  const pos = ((motor.angle - motor.min) / range) * 100;
  const targetPos = ((motor.target - motor.min) / range) * 100;
  const error = Math.abs(motor.angle - motor.target);

  return (
    <motion.button
      type="button"
      className={`motor-card ${selected ? "is-selected" : ""} ${
        motor.enabled ? "" : "is-disabled"
      }`}
      onClick={() => onSelect(motor.id)}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, ...arcTransform(index, total, selected) }}
      transition={{ duration: 0.6, delay: 0.25 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: selected ? -14 : -8, translateZ: 30, transition: { duration: 0.3 } }}
      style={{ transformOrigin: "center center" }}
    >
      <div className="motor-card__sheen" aria-hidden />

      <header className="motor-card__head">
        <span className="motor-card__code tnum">{motor.code}</span>
        <span className={`motor-card__status ${motor.enabled ? "on" : "off"}`}>
          <i className="motor-card__led" />
        </span>
      </header>

      <div className="motor-card__name">{motor.name}</div>

      <div className="motor-card__angle">
        <span className="motor-card__value tnum">{motor.angle.toFixed(1)}</span>
        <span className="motor-card__unit">°</span>
      </div>

      {/* 角度轨道：当前位置 + 目标标记 */}
      <div className="motor-track">
        <div className="motor-track__rail" />
        <div
          className="motor-track__target"
          style={{ left: `${targetPos}%` }}
          title={`目标 ${motor.target.toFixed(1)}°`}
        />
        <div
          className="motor-track__thumb"
          style={{ left: `${pos}%` }}
        />
      </div>

      <div className="motor-card__metrics">
        <div className="motor-metric">
          <span className="motor-metric__k">目标</span>
          <span className="motor-metric__v tnum">{motor.target.toFixed(1)}°</span>
        </div>
        <div className="motor-metric">
          <span className="motor-metric__k">电流</span>
          <span className="motor-metric__v tnum">{motor.current.toFixed(2)}A</span>
        </div>
        <div className="motor-metric">
          <span className="motor-metric__k">温度</span>
          <span className="motor-metric__v tnum" style={{ color: tempColor(motor.temp) }}>
            {motor.temp.toFixed(1)}°
          </span>
        </div>
      </div>

      <div className="motor-card__error">
        <span className="motor-card__error-k">误差</span>
        <span className="motor-card__error-v tnum">{error.toFixed(2)}°</span>
      </div>
    </motion.button>
  );
}
