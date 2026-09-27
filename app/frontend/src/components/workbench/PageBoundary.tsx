/** 页面失败后的可恢复出口。Created on 2026-09-26 @author: https://github.com/Linmoqian */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: string | null;
}
export default class PageBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : "页面加载失败" };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("工作台页面错误", error, info.componentStack);
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wb-page-error" role="alert">
        <h1>页面暂时不可用</h1>
        <p>{this.state.error}</p>
        <p>实验状态仍由工作台管理，可以切换其他页面。</p>
        <button
          type="button"
          className="wb-button"
          onClick={() => this.setState({ error: null })}
        >
          重新打开页面
        </button>
        <a className="wb-button wb-button--quiet" href="#/workbench">
          返回工作台
        </a>
      </div>
    );
  }
}
