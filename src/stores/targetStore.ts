/**
 * targetStore —— 用户目标世界（TargetState）：独立于 worldStore（现实估计）。
 * 职责：统一 Intent 入闸（限位校验/钳制 → ValidationResult）→ 转交执行器。
 * M1 执行器 = SimulationLoop（SIM）；M4 起由 CommandArbiter 接管。
 */
import { create } from "zustand";
import type { RobotModel } from "../robot/types";
import type { InputIntent } from "../interaction/types";
import { VALIDATION_OK } from "../interaction/types";
import type { ValidationResult } from "../interaction/types";

let model: RobotModel | null = null;
const executors = new Set<(intent: InputIntent) => void>();

interface TargetStoreState {
  /** 最近一次入闸的意图 */
  lastIntent: InputIntent | null;
  /** 最近一次校验结果（UI 状态徽标用） */
  validation: ValidationResult;
  /** 关节目标值（active 面板下标 → °；Ghost/对照显示用） */
  jointTargets: Record<number, number>;
  /** InputIntent 入闸：校验 → 钳制 → 发布 → 执行器 */
  publish: (intent: InputIntent) => void;
  /** 绑定额定限位来源（模型就绪后注入） */
  bindModel: (m: RobotModel | null) => void;
  /** 注册目标执行器（返回退订函数） */
  registerExecutor: (fn: (intent: InputIntent) => void) => () => void;
  reset: () => void;
}

export const useTargetStore = create<TargetStoreState>()((set) => ({
  lastIntent: null,
  validation: VALIDATION_OK,
  jointTargets: {},

  publish: (intent) => {
    let applied = intent;
    let validation: ValidationResult = VALIDATION_OK;
    // 关节级意图：限位钳制（钳制而非拒绝，保证拖动边界手感自然）
    if (intent.kind === "joint-target" && model) {
      const joint = model.active[intent.jointIndex];
      const lo = Number.isFinite(joint.minDeg) ? joint.minDeg : -Infinity;
      const hi = Number.isFinite(joint.maxDeg) ? joint.maxDeg : Infinity;
      const clamped = Math.min(hi, Math.max(lo, intent.valueDeg));
      const limited = clamped !== intent.valueDeg;
      applied = { ...intent, valueDeg: clamped };
      validation = {
        valid: true,
        jointLimit: limited,
        collision: false,
        singularity: false,
        reachable: true,
        safetyDistance: null,
        reason: limited ? `已钳制到限位 ±${clamped.toFixed(1)}°` : undefined,
        clampedValueDeg: limited ? clamped : undefined,
      };
    }
    set((s) => ({
      lastIntent: applied,
      validation,
      jointTargets:
        applied.kind === "joint-target"
          ? { ...s.jointTargets, [applied.jointIndex]: applied.valueDeg }
          : s.jointTargets,
    }));
    for (const fn of executors) fn(applied);
  },

  bindModel: (m) => {
    model = m;
  },

  registerExecutor: (fn) => {
    executors.add(fn);
    return () => executors.delete(fn);
  },

  reset: () =>
    set({
      lastIntent: null,
      validation: VALIDATION_OK,
      jointTargets: {},
    }),
}));