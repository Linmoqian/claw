import { Cpu } from "lucide-react";
import PageStub from "../components/PageStub";

export default function Monitor() {
  return (
    <PageStub
      title="状态监控"
      desc="7 个电机的实时位置 / 速度 / 电流 / 温度概览（建设中）"
      Icon={Cpu}
    />
  );
}
