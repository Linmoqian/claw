import { CircleAlert, ShieldCheck } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import "./EstopButton.css";

/** 全局急停按钮：常驻可见，触发即释放全部扭矩并停止运行 */
export default function EstopButton() {
  const { estop, triggerEstop, clearEstop } = useDevice();
  return (
    <button
      type="button"
      className={`estop ${estop ? "is-active" : ""}`}
      onClick={estop ? clearEstop : triggerEstop}
      aria-label={estop ? "解除急停" : "紧急停止"}
      title={
        estop ? "点击解除急停锁存，不会自动恢复扭矩" : "紧急停止：释放全部扭矩"
      }
    >
      {estop ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
      <span className="estop__label">{estop ? "解除" : "急停"}</span>
    </button>
  );
}
