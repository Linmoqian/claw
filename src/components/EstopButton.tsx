import { CircleAlert, ShieldCheck } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import "./EstopButton.css";

/** 全局急停按钮：常驻可见，触发即断开所有使能并停止运行 */
export default function EstopButton() {
  const { estop, triggerEstop, clearEstop } = useDevice();
  return (
    <button
      type="button"
      className={`estop ${estop ? "is-active" : ""}`}
      onClick={estop ? clearEstop : triggerEstop}
      aria-label={estop ? "解除急停" : "紧急停止"}
      title={estop ? "点击解除急停" : "紧急停止：断开所有电机使能"}
    >
      {estop ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
      <span className="estop__label">{estop ? "解除" : "急停"}</span>
    </button>
  );
}
