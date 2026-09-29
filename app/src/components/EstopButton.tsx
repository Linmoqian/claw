// Created on 2026-09-26
// @author: https://github.com/Linmoqian
import { CircleAlert, ShieldCheck } from "lucide-react";
import { useDevice } from "../stores/DeviceContext";
import "./EstopButton.css";

/** 串口停止：尝试读当前位置并写回目标以保持扭矩；不覆盖 Studio LIVE。 */
export default function EstopButton() {
  const { connected, estop, triggerEstop, clearEstop } = useDevice();
  if (!connected && !estop) return null;
  return (
    <button
      type="button"
      className={`estop ${estop ? "is-active" : ""}`}
      onClick={estop ? clearEstop : triggerEstop}
      aria-label={
        estop ? "解除串口停止锁存" : "串口急停，保持扭矩，不涵盖 Studio LIVE"
      }
      title={
        estop
          ? "解除串口停止锁存，不自动恢复运行；不涵盖 Studio LIVE"
          : "仅串口通道：尝试保持当前位置和扭矩；不涵盖 Studio LIVE"
      }
    >
      {estop ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
      <span className="estop__label">
        {estop ? "解除串口停止" : "串口急停"}
      </span>
      <small className="estop__scope">保持扭矩 · 不含 LIVE</small>
    </button>
  );
}
