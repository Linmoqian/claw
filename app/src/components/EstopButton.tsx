// Created on 2026-09-26
// @author: https://github.com/Linmoqian
import { CircleAlert, ShieldCheck } from "lucide-react";
import { useDevice } from "../stores/DeviceContext";
import "./EstopButton.css";

/** 急停：串口保持扭矩，LIVE 通道发送停止并断链；解锁后不自动恢复运行。 */
export default function EstopButton() {
  const { connected, estop, triggerEstop, clearEstop } = useDevice();
  if (!connected && !estop) return null;
  return (
    <button
      type="button"
      className={`estop ${estop ? "is-active" : ""}`}
      onClick={estop ? clearEstop : triggerEstop}
      aria-label={
        estop ? "解除急停锁存" : "急停：串口保持扭矩，LIVE 停止并断链"
      }
      title={
        estop
          ? "解除急停锁存，不自动恢复运行；真机链路需手动重连"
          : "串口保持当前位置和扭矩；LIVE 通道发送停止并断链"
      }
    >
      {estop ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
      <span className="estop__label">
        {estop ? "解除急停" : "急停"}
      </span>
      <small className="estop__scope">保持扭矩 · 含 LIVE</small>
    </button>
  );
}
