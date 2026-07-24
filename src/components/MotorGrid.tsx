import MotorCard from "./MotorCard";
import type { Motor } from "../types";
import "./MotorGrid.css";

type Props = {
  motors: Motor[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export default function MotorGrid({ motors, selectedId, onSelect }: Props) {
  return (
    <div className="motor-grid">
      <div className="motor-grid__arc">
        {motors.map((m, i) => (
          <MotorCard
            key={m.id}
            motor={m}
            index={i}
            total={motors.length}
            selected={m.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
