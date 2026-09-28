import type { Motor } from "../types";
import "./MotorList.css";

type Props = {
  motors: Motor[];
  selectedId: string;
  onSelect: (id: string) => void;
};

/** 紧凑电机导航列表：master-detail 的导航侧 */
export default function MotorList({ motors, selectedId, onSelect }: Props) {
  return (
    <ul className="motor-list">
      {motors.map((m) => {
        const selected = m.id === selectedId;
        return (
          <li key={m.id}>
            <button
              type="button"
              className={`motor-item ${selected ? "is-selected" : ""} ${
                m.enabled ? "" : "is-disabled"
              }`}
              onClick={() => onSelect(m.id)}
              aria-pressed={selected}
            >
              <span className="motor-item__row">
                <span className="motor-item__code tnum">{m.code}</span>
                <span className="motor-item__name">{m.name}</span>
                <i className={`motor-item__led ${m.enabled ? "on" : "off"}`} />
              </span>
              <span className="motor-item__angle tnum">{m.angle.toFixed(1)}°</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
