import type { LucideIcon } from "lucide-react";
import "./PageStub.css";

type Props = {
  title: string;
  desc?: string;
  Icon: LucideIcon;
};

/** 占位页：后续阶段实现的页面统一用它兜底 */
export default function PageStub({ title, desc, Icon }: Props) {
  return (
    <div className="page-stub">
      <div className="page-stub__icon-wrap">
        <Icon className="page-stub__icon" />
      </div>
      <h2 className="page-stub__title">{title}</h2>
      <p className="page-stub__desc">
        {desc ?? "该页面将在后续阶段实现"}
      </p>
    </div>
  );
}
