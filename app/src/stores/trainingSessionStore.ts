// Created on 2026-09-26
// @author: https://github.com/Linmoqian
// 训练参数、离线结果与提示跨页面保留；不持久化到实验或外部服务。
import { create } from "zustand";
import {
  runDecisionNetworkTraining,
  runPerceptionTraining,
  type DecisionTrainingConfig,
  type DecisionTrainingResult,
  type PerceptionTrainingConfig,
  type PerceptionTrainingResult,
} from "../robot/modelTraining";
import {
  runAdversarialTraining,
  type AdversarialTrainingConfig,
  type AdversarialTrainingResult,
} from "../robot/adversarialTraining";
import { findRobotEntry, useRobotStore } from "./robotStore";
import { desktopTrainingEnabled, trainDesktopAdversarial, trainDesktopDecision, trainDesktopPerception, type TrainingProgress } from "../services/desktopTraining";

export type PerceptionControls = Required<
  Pick<PerceptionTrainingConfig, "samplesPerClass" | "epochs" | "learningRate">
>;
export type DecisionControls = Required<
  Pick<
    DecisionTrainingConfig,
    "samples" | "epochs" | "hiddenUnits" | "learningRate"
  >
>;
export type AdversarialControls = Required<
  Pick<
    AdversarialTrainingConfig,
    "epochs" | "adversaryPopulation" | "perturbationDeg" | "learningRate"
  >
>;
export interface TrainingProvenance {
  robotId: string | null;
  robotName: string;
  source: "内置合成数据 / 离线基线";
}

const DEFAULT_PERCEPTION: PerceptionControls = {
  samplesPerClass: 120,
  epochs: 32,
  learningRate: 0.28,
};
const DEFAULT_DECISION: DecisionControls = {
  samples: 320,
  epochs: 64,
  hiddenUnits: 12,
  learningRate: 0.08,
};
const DEFAULT_ADVERSARIAL: AdversarialControls = {
  epochs: 24,
  adversaryPopulation: 8,
  perturbationDeg: 8,
  learningRate: 0.42,
};
const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function provenance(): TrainingProvenance {
  const { currentId, model } = useRobotStore.getState();
  return {
    robotId: currentId,
    robotName:
      (currentId ? findRobotEntry(currentId)?.label : null) ??
      model?.def.name ??
      "尚未选择机型",
    source: "内置合成数据 / 离线基线",
  };
}

interface ModelTrainingState {
  perceptionControls: PerceptionControls;
  decisionControls: DecisionControls;
  perceptionResult: PerceptionTrainingResult | null;
  decisionResult: DecisionTrainingResult | null;
  perceptionProvenance: TrainingProvenance | null;
  decisionProvenance: TrainingProvenance | null;
  running: "perception" | "decision" | null;
  trainingProgress: TrainingProgress | null;
  notice: string | null;
  updatePerception: <K extends keyof PerceptionControls>(
    key: K,
    value: PerceptionControls[K],
  ) => void;
  updateDecision: <K extends keyof DecisionControls>(
    key: K,
    value: DecisionControls[K],
  ) => void;
  trainPerception: () => Promise<void>;
  trainDecision: () => Promise<void>;
  setNotice: (notice: string | null) => void;
  reset: () => void;
}

export const useModelTrainingStore = create<ModelTrainingState>((set, get) => ({
  perceptionControls: { ...DEFAULT_PERCEPTION },
  decisionControls: { ...DEFAULT_DECISION },
  perceptionResult: null,
  decisionResult: null,
  perceptionProvenance: null,
  decisionProvenance: null,
  running: null,
  trainingProgress: null,
  notice: null,
  updatePerception: (key, value) => {
    if (get().running) return;
    set({
      perceptionControls: { ...get().perceptionControls, [key]: value },
      perceptionResult: null,
      perceptionProvenance: null,
      notice: null,
    });
  },
  updateDecision: (key, value) => {
    if (get().running) return;
    set({
      decisionControls: { ...get().decisionControls, [key]: value },
      decisionResult: null,
      decisionProvenance: null,
      notice: null,
    });
  },
  trainPerception: async () => {
    if (get().running) return;
    const config = { ...get().perceptionControls };
    const source = provenance();
    set({ running: "perception", trainingProgress: null, notice: null });
    await nextTurn();
    try {
      const result = desktopTrainingEnabled()
        ? await trainDesktopPerception(config, (trainingProgress) => set({ trainingProgress }))
        : runPerceptionTraining(config);
      set({
        perceptionResult: result,
        perceptionProvenance: source,
        notice: `感知训练完成 · 内置合成数据 · 验证准确率 ${(result.validationAccuracy * 100).toFixed(1)}%`,
      });
    } catch (reason) {
      set({ notice: `训练失败：${String(reason)}。已保留上次结果，可重试。` });
    } finally {
      set({ running: null, trainingProgress: null });
    }
  },
  trainDecision: async () => {
    if (get().running) return;
    const config = { ...get().decisionControls };
    const source = provenance();
    set({ running: "decision", trainingProgress: null, notice: null });
    await nextTurn();
    try {
      const result = desktopTrainingEnabled()
        ? await trainDesktopDecision(config, (trainingProgress) => set({ trainingProgress }))
        : runDecisionNetworkTraining(config);
      set({
        decisionResult: result,
        decisionProvenance: source,
        notice: `决策训练完成 · 内置合成数据 · 安全动作率 ${(result.validationSafetyRate * 100).toFixed(1)}%`,
      });
    } catch (reason) {
      set({ notice: `训练失败：${String(reason)}。已保留上次结果，可重试。` });
    } finally {
      set({ running: null, trainingProgress: null });
    }
  },
  setNotice: (notice) => set({ notice }),
  reset: () => {
    if (get().running) return;
    set({
      perceptionControls: { ...DEFAULT_PERCEPTION },
      decisionControls: { ...DEFAULT_DECISION },
      perceptionResult: null,
      decisionResult: null,
      perceptionProvenance: null,
      decisionProvenance: null,
      trainingProgress: null,
      notice: null,
    });
  },
}));

interface AdversarialTrainingState {
  controls: AdversarialControls;
  result: AdversarialTrainingResult | null;
  resultProvenance: TrainingProvenance | null;
  running: boolean;
  trainingProgress: TrainingProgress | null;
  notice: string | null;
  updateControl: <K extends keyof AdversarialControls>(
    key: K,
    value: AdversarialControls[K],
  ) => void;
  startTraining: () => Promise<void>;
  reset: () => void;
}

export const useAdversarialTrainingStore = create<AdversarialTrainingState>(
  (set, get) => ({
    controls: { ...DEFAULT_ADVERSARIAL },
    result: null,
    resultProvenance: null,
    running: false,
    trainingProgress: null,
    notice: null,
    updateControl: (key, value) => {
      if (get().running) return;
      set({
        controls: { ...get().controls, [key]: value },
        result: null,
        resultProvenance: null,
        notice: null,
      });
    },
    startTraining: async () => {
      const { model, status, currentId } = useRobotStore.getState();
      if (!model || status !== "ready" || get().running) return;
      const config = { ...get().controls };
      const source = provenance();
      set({ running: true, trainingProgress: null, notice: null });
      await nextTurn();
      try {
        const result = desktopTrainingEnabled()
          ? await trainDesktopAdversarial(currentId ?? "", config, (trainingProgress) => set({ trainingProgress }))
          : runAdversarialTraining(model, config);
        set({
          result,
          resultProvenance: source,
          notice: `训练完成 · ${result.config.epochs} 轮 · 最坏回报 ${result.bestWorstReward.toFixed(2)} · ${source.robotName}`,
        });
      } catch (reason) {
        set({
          notice: `训练失败：${String(reason)}。已保留上次结果，可重试。`,
        });
      } finally {
        set({ running: false, trainingProgress: null });
      }
    },
    reset: () => {
      if (get().running) return;
      set({
        controls: { ...DEFAULT_ADVERSARIAL },
        result: null,
        resultProvenance: null,
        trainingProgress: null,
        notice: null,
      });
    },
  }),
);
