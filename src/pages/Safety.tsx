import { ShieldAlert } from "lucide-react";
import PageStub from "../components/PageStub";

export default function Safety() {
  return (
    <PageStub
      title="故障与安全"
      desc="限位 / 过流 / 过温阈值、急停策略、Flash 保存与配置导出（建设中）"
      Icon={ShieldAlert}
    />
  );
}
