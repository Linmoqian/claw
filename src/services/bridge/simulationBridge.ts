/**
 * simulationBridge —— SIM 模式的 RobotBridge 实现。
 * 纯仿真形态：3D 关节由 SimulationLoop 直供；无网络链路、无遥测；
 * wrist/滑块直接写仿真目标，不经 Command 通道（M1 统一 Intent 后走仲裁）。
 */
import type { BridgeStatus, RobotBridge } from "./robotBridge";

export class SimulationBridge implements RobotBridge {
  readonly kind = "simulation";

  async connect(): Promise<void> {
    // SIM 无需建链
  }

  async disconnect(): Promise<void> {
    // SIM 无需断链
  }

  getStatus(): BridgeStatus {
    return {
      kind: this.kind,
      connected: true,
      status: "connected",
      latencyMs: null,
      messageRateHz: null,
      lastMessageAt: null,
    };
  }

  /** SIM 模式下 3D 直读 SimulationLoop，不经此通道（保留接口一致性） */
  subscribeRobotState(): () => void {
    return () => {};
  }

  async sendCommand(): Promise<void> {
    throw new Error("SIM 模式不下发控制指令（滑块直写仿真目标）");
  }
}

/** 全程单例：SIM 桥无状态可共享 */
export const simulationBridge = new SimulationBridge();