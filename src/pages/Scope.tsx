import { Activity } from "lucide-react";
import PageStub from "../components/PageStub";

export default function Scope() {
  return (
    <PageStub
      title="实时曲线"
      desc="多通道示波器：位置 / 速度 / 电流 vs 时间（建设中）"
      Icon={Activity}
    />
  );
}
