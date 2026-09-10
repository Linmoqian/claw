/**
 * CommandArbiter —— 命令仲裁器：控制权唯一性与会话规则（M4）。
 * 纯 TS、无 React 依赖：由 sessionStore 单例持有。
 * 规则：
 *  - 同一时刻至多一个 ControlSource 拥有控制权（owner），其余源的请求被拒；
 *  - 系统命令（回零/轨迹/停止）不受 owner 限制，且会中止活动会话；
 *  - 轨迹播放期间拒绝一切用户会话（先 STOP 再手动）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import type { ControlSource } from "../interaction/types";

/** 会话状态：预览中 → 提交成功 / 被拒 / 被系统中止 */
export type SessionPhase =
  | "preview"
  | "done"
  | "rejected"
  | "aborted"
  | "blocked";

export interface ArbitrateDecision {
  allowed: boolean;
  /** 拒绝原因（allowed=false 时必填） */
  reason?: string;
}

export class CommandArbiter {
  private owner: ControlSource | null = null;
  /** 轨迹播放锁（simulationStore mode==="play" 时置位） */
  private trajectoryLock = false;

  /** 用户源申请开始会话（已拥有者重复申请 = 幂等成功） */
  acquire(source: ControlSource): ArbitrateDecision {
    if (this.trajectoryLock) {
      return { allowed: false, reason: "轨迹播放中，先停止轨迹再手动控制" };
    }
    if (this.owner !== null && this.owner !== source) {
      return {
        allowed: false,
        reason: `${labelOf(this.owner)} 正在控制，稍候再试`,
      };
    }
    this.owner = source;
    return { allowed: true };
  }

  /** 同源续约检查（拖拽/预览帧调用；异常态直接拒绝） */
  check(source: ControlSource): ArbitrateDecision {
    if (this.owner !== source) {
      return { allowed: false, reason: "控制权已失效" };
    }
    return { allowed: true };
  }

  /** 释放控制权（会话结束：提交/取消/中止） */
  release(source: ControlSource): void {
    if (this.owner === source) this.owner = null;
  }

  /** 系统命令通道：不申请、直接清场（返回被中止的 owner，供会话卡展示） */
  systemCommand(): ControlSource | null {
    const evicted = this.owner;
    this.owner = null;
    return evicted;
  }

  /** 轨迹播放锁（play 置位 / stop 清除） */
  setTrajectoryLock(locked: boolean): void {
    this.trajectoryLock = locked;
  }

  /** 当前拥有者（诊断/展示用） */
  get currentOwner(): ControlSource | null {
    return this.owner;
  }
}

/** 控制源中文标签 */
export function labelOf(source: ControlSource): string {
  switch (source) {
    case "mouse":
      return "鼠标拖拽";
    case "slider":
      return "滑块";
    case "trajectory":
      return "轨迹";
    case "agent":
      return "智能体";
    case "ros":
      return "ROS";
    default:
      return source;
  }
}
