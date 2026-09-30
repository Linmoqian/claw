// 飞特舵机单 ID 面板：ID 与限速输入，位置读写、扭矩使能、点动与停止保持。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { useState } from "react";
import { Square } from "lucide-react";
import { useMotorDebugStore } from "../motor-debug/session";

interface DebugFeetechPanelProps {
  motorId: number;
  onMotorIdChange: (value: number) => void;
}

export default function DebugFeetechPanel({
  motorId,
  onMotorIdChange,
}: DebugFeetechPanelProps) {
  const [speed, setSpeed] = useState(150);
  const sessionPort = useMotorDebugStore((state) => state.port);
  const busy = useMotorDebugStore((state) => state.busy || state.transitioning);
  const targetId = useMotorDebugStore((state) => state.targetId);
  const position = useMotorDebugStore((state) => state.position);
  const locked = useMotorDebugStore((state) => state.locked);
  const torqueEnabled = useMotorDebugStore((state) => state.torqueEnabled);
  const ping = useMotorDebugStore((state) => state.ping);
  const readPosition = useMotorDebugStore((state) => state.readPosition);
  const setSpeedAction = useMotorDebugStore((state) => state.setSpeed);
  const setTorque = useMotorDebugStore((state) => state.setTorque);
  const jog = useMotorDebugStore((state) => state.jog);
  const hold = useMotorDebugStore((state) => state.hold);
  const unlock = useMotorDebugStore((state) => state.unlock);
  const connected = Boolean(sessionPort);
  const activeMotorId = targetId ?? motorId;

  return (
    <section
      className="motor-debug__panel"
      aria-labelledby="motor-debug-device-title"
    >
      <div className="motor-debug__panel-head">
        <span className="motor-debug__number">02</span>
        <div>
          <h2 id="motor-debug-device-title">单 ID 舵机</h2>
          <p>每次只对所选 ID 发送指令，不扫描整条总线。</p>
        </div>
      </div>
      <div className="motor-debug__fields is-two">
        <label>
          舵机 ID
          <input
            type="number"
            min={1}
            max={253}
            step={1}
            value={activeMotorId}
            disabled={connected || busy}
            onChange={(event) => onMotorIdChange(Number(event.target.value))}
          />
        </label>
        <label>
          限速 raw / s
          <input
            type="number"
            min={1}
            max={2400}
            step={1}
            value={speed}
            disabled={busy}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="motor-debug__readout">
        <span>当前位置</span>
        <strong>
          {position === null ? "—" : position}
        </strong>
        <small>raw / 0–4095</small>
      </div>
      <div className="motor-debug__action-grid">
        <button
          type="button"
          disabled={
            !connected ||
            busy ||
            !Number.isInteger(activeMotorId) ||
            activeMotorId < 1 ||
            activeMotorId > 253
          }
          onClick={() => void ping(activeMotorId)}
        >
          Ping / 型号
        </button>
        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => void readPosition(activeMotorId)}
        >
          读取位置
        </button>
        <button
          type="button"
          disabled={!connected || busy || speed < 1 || speed > 2400}
          onClick={() => void setSpeedAction(activeMotorId, speed)}
        >
          写入限速
        </button>
        <button
          type="button"
          disabled={
            !connected ||
            busy ||
            locked ||
            activeMotorId < 1 ||
            activeMotorId > 253
          }
          onClick={() =>
            void setTorque(
              activeMotorId,
              !torqueEnabled,
            )
          }
        >
          {torqueEnabled ? "释放扭矩" : "使能扭矩"}
        </button>
      </div>
      <div className="motor-debug__jog">
        <span>小步点动</span>
        {[-50, -10, 10, 50].map((delta) => (
          <button
            type="button"
            key={delta}
            disabled={
              !connected ||
              busy ||
              !torqueEnabled ||
              locked ||
              speed < 1 ||
              speed > 2400 ||
              activeMotorId < 1 ||
              activeMotorId > 253
            }
            title="每次先写入限速、读取实际位置，再写入相对目标"
            onClick={() =>
              void jog(activeMotorId, delta, speed)
            }
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </button>
        ))}
      </div>
      <div className="motor-debug__actions">
        <button
          type="button"
          className="motor-debug__button is-stop"
          disabled={!connected || busy || locked}
          onClick={() => void hold(activeMotorId)}
        >
          <Square size={15} /> 停止下发并保持当前位置
        </button>
        {locked && (
          <button
            type="button"
            className="motor-debug__button"
            disabled={busy}
            onClick={unlock}
          >
            解除停止锁定
          </button>
        )}
      </div>
      <p className="motor-debug__hint">
        保持动作会读取当前位置并写回目标，维持原有扭矩；断线或读数失败时不能保证电机立即停转。释放扭矩可能使负载下坠。
      </p>
    </section>
  );
}
