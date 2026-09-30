/** 三维场景失败时保留工作台和实验结果。Created on 2026-09-26 @author: https://github.com/Linmoqian */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 场景崩溃时的联动停止动作，由入口层注入（如停止积木程序）。 */
  onError?: () => void;
}
interface State {
  error: string | null;
}
export default class RuntimeBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return {
      error: error instanceof Error ? error.message : "三维场景初始化失败",
    };
  }
  componentDidCatch(): void {
    this.props.onError?.();
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <aside className="wb-runtime-error" role="alert">
        <strong>三维场景暂时不可用</strong>
        <p>{this.state.error}</p>
        <span>实验记录和其他工具仍可使用。</span>
        <button
          type="button"
          className="wb-button"
          onClick={() => this.setState({ error: null })}
        >
          重新加载场景
        </button>
      </aside>
    );
  }
}
