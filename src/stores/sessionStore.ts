/**
 * sessionStore —— 命令会话状态机（M4）：Preview → Commit → Execute。
 * 用户输入（滑块/鼠标拖拽）先入预览（Ghost 跟手、现实不动），
 * 松开/确认才提交目标；提交被拒（碰撞/限位）时保留预览供调整。
 * 仲裁规则委托 CommandArbiter（控制权唯一 + 系统命令抢占 + 轨迹锁）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { create } from "zustand";
import { Quaternion, Vector3 } from "three";
import { CommandArbiter, labelOf, type SessionPhase } from "../command/arbiter";
import type { ControlSource } from "../interaction/types";
import { describeCollision } from "../robot/collision";
import type { BaseSim } from "../robot/baseSim";
import type { SimulationLoop } from "../robot/simulation";
import { useTargetStore } from "./targetStore";

/** 结束态会话卡的自动消失时长（ms） */
const DISMISS_MS = 2600;

/** 会话摘要：单关节目标 / TCP 位姿 / 底盘目标 */
export interface SessionSummary {
  kind: "joint-target" | "tcp-pose" | "base-pose";
  /** 关节级：J 代号与目标角 */
  jointCode?: string;
  valueDeg?: number;
  /** TCP 级：目标位置（m） */
  position?: { x: number; y: number; z: number };
  /** 底盘级：目标平面坐标（m） */
  base?: { x: number; y: number };
}

export interface CommandSession {
  source: ControlSource;
  phase: SessionPhase;
  summary: SessionSummary | null;
  /** 预览/拒绝原因（徽标与会话卡显示） */
  reason?: string;
  /** 预览期最后一次校验被拒（松开提交时应显示"已拒绝"而非空提交成功） */
  previewRejected?: boolean;
  startedAt: number;
}

interface SessionStoreState {
  session: CommandSession | null;
  /** 结束态卡的自动消失计时句柄 */
  /** 绑定仿真回路（关节/TCP 预览）与底盘仿真（base 预览） */
  bindSim: (loop: SimulationLoop | null, base?: BaseSim | null) => void;
  /** 开始用户会话：仲裁 → 开启预览；被拒时入 blocked 卡（短暂） */
  begin: (source: ControlSource) => boolean;
  /** 预览帧（滑块 input / 拖拽 move）：写 sim 预览通道；拒绝状态回填 reason */
  previewJoint: (source: ControlSource, jointIndex: number, jointCode: string, deg: number) => void;
  previewTcp: (source: ControlSource, pose: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }) => void;
  /** 底盘拖拽预览（world 平面 xy；底盘无碰撞门禁，预览总有效） */
  previewBase: (source: ControlSource, x: number, y: number) => void;
  /** 提交（松开/change/确认）：sim.commitPreview；拒绝则保留预览并置 rejected */
  commit: (source: ControlSource) => void;
  /** 取消（ESC/切模式）：清预览，静默收场 */
  cancel: (source: ControlSource) => void;
  /** 系统命令（回零/播放/停止）清场：中止活动会话并展示中止卡 */
  systemCommand: () => void;
  /** 手动关卡（被拒卡的"放弃"按钮） */
  dismiss: () => void;
}

/** 仲裁器单例（会话规则与 UI 状态分离，纯逻辑可单测） */
export const arbiter = new CommandArbiter();

let sim: SimulationLoop | null = null;
let baseSim: BaseSim | null = null;
let dismissTimer: number | null = null;

/** 目标提交钩子（LIVE 模式下同步下发真机；Studio 接线时注入） */
let onTargetCommitted: ((qDeg: number[]) => void) | null = null;

export function setTargetCommittedHook(fn: ((qDeg: number[]) => void) | null): void {
  onTargetCommitted = fn;
}

function clearTimer(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

/** 结束态卡定时自动消失 */
function scheduleDismiss(set: (partial: Partial<SessionStoreState>) => void): void {
  clearTimer();
  dismissTimer = window.setTimeout(() => {
    set({ session: null });
    dismissTimer = null;
  }, DISMISS_MS);
}

export const useSessionStore = create<SessionStoreState>()((set, get) => ({
  session: null,

  bindSim: (loop, base) => {
    sim = loop;
    baseSim = base ?? null;
    if (!loop) {
      arbiter.systemCommand();
      clearTimer();
      set({ session: null });
    }
  },

  begin: (source) => {
    const decision = arbiter.acquire(source);
    if (!decision.allowed) {
      // 被阻塞：短暂展示原因（不开启会话）
      set({ session: { source, phase: "blocked", summary: null, reason: decision.reason, startedAt: performance.now() } });
      scheduleDismiss(set);
      return false;
    }
    // 新会话从目标态起算：清掉上个被拒会话残留的预览角
    sim?.clearPreview();
    clearTimer();
    set({
      session: {
        source,
        phase: "preview",
        summary: null,
        startedAt: performance.now(),
      },
    });
    return true;
  },

  previewJoint: (source, jointIndex, jointCode, deg) => {
    if (arbiter.check(source).allowed === false) return;
    const s = get().session;
    if (!sim || !s || s.phase !== "preview") return;
    const rejected = sim.previewJointTarget(jointIndex, deg);
    set({
      session: {
        ...s,
        summary: { kind: "joint-target", jointCode, valueDeg: deg },
        reason: rejected ? `预览被拒：${describeCollision(rejected)}` : undefined,
        previewRejected: rejected !== null,
      },
    });
  },

  previewTcp: (source, pose) => {
    if (arbiter.check(source).allowed === false) return;
    const s = get().session;
    if (!sim || !s || s.phase !== "preview") return;
    // TCP 预览：IK 解算写入预览角（解算质量经 snapshot 的 ik 字段展示）
    const result = sim.previewTcpTarget(
      new Vector3(pose.position.x, pose.position.y, pose.position.z),
      new Quaternion(
        pose.quaternion.x,
        pose.quaternion.y,
        pose.quaternion.z,
        pose.quaternion.w,
      ),
    );
    set({
      session: {
        ...s,
        summary: { kind: "tcp-pose", position: pose.position },
        reason: result.collision
          ? `预览被拒：${describeCollision(result.collision)}`
          : result.singular
            ? "预览收敛于近奇异构型"
            : undefined,
        previewRejected: result.collision !== undefined,
      },
    });
  },

  previewBase: (source, x, y) => {
    if (arbiter.check(source).allowed === false) return;
    const s = get().session;
    if (!baseSim || !s || s.phase !== "preview") return;
    baseSim.setPreviewBase(x, y);
    set({
      session: {
        ...s,
        summary: { kind: "base-pose", base: { x, y } },
      },
    });
  },

  commit: (source) => {
    const s = get().session;
    if (!s || s.source !== source) return;
    if (s.phase !== "preview") return;
    // 底盘会话：无碰撞门禁，预览即提交
    if (s.summary?.kind === "base-pose") {
      baseSim?.commitPreview();
      arbiter.release(source);
      set({ session: { ...s, phase: "done" } });
      scheduleDismiss(set);
      return;
    }
    // 预览从未成功（全程被拒）：目标不生效，直接拒绝收场
    if (s.previewRejected) {
      sim?.clearPreview();
      arbiter.release(source);
      set({
        session: { ...s, phase: "rejected", reason: s.reason?.replace("预览被拒", "目标被拒") },
      });
      scheduleDismiss(set);
      return;
    }
    const rejected = sim?.commitPreview() ?? null;
    arbiter.release(source);
    if (rejected) {
      set({
        session: { ...s, phase: "rejected", reason: `目标被拒：${describeCollision(rejected)}` },
      });
      scheduleDismiss(set);
      // 拒绝原因同步到全局校验徽标
      useTargetStore.getState().setValidation({
        valid: false,
        jointLimit: false,
        collision: true,
        singularity: false,
        reachable: true,
        safetyDistance: null,
        reason: `目标被拒：${describeCollision(rejected)}`,
      });
      return;
    }
    set({ session: { ...s, phase: "done" } });
    scheduleDismiss(set);
    // LIVE 钩子：提交成功的目标同步下发真机（SIM/TWIN 为 no-op）
    if (sim) onTargetCommitted?.(sim.getSnapshot().targetDeg);
  },

  cancel: (source) => {
    const s = get().session;
    if (!s || s.source !== source) return;
    sim?.clearPreview();
    baseSim?.clearPreview();
    arbiter.release(source);
    set({ session: null });
  },

  systemCommand: () => {
    const evicted = arbiter.systemCommand();
    sim?.clearPreview();
    if (!evicted) {
      set({ session: null });
      return;
    }
    const s = get().session;
    if (s && s.phase === "preview" && s.source === evicted) {
      set({
        session: {
          ...s,
          phase: "aborted",
          reason: `${labelOf(evicted)} 会话已被系统命令中止`,
        },
      });
      scheduleDismiss(set);
    }
  },

  dismiss: () => {
    clearTimer();
    const s = get().session;
    if (s && (s.phase === "rejected" || s.phase === "aborted" || s.phase === "blocked")) {
      sim?.clearPreview();
      arbiter.release(s.source);
    }
    set({ session: null });
  },
}));
