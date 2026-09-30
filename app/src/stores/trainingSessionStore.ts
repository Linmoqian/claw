// Created on 2026-09-26; Updated on 2026-09-30
// @author: https://github.com/Linmoqian
// 训练参数与结果跨页面保留，并持久化到业务草稿；running/progress/notice 为瞬时态。
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
import { readDraft, writeDraft } from "../services/draftStorage";

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

// ---- 会话持久化：参数与结果写入业务草稿，瞬时态不保存 ----

interface ModelTrainingPersisted {
  perceptionControls?: PerceptionControls;
  decisionControls?: DecisionControls;
  perceptionResult?: PerceptionTrainingResult | null;
  decisionResult?: DecisionTrainingResult | null;
  perceptionProvenance?: TrainingProvenance | null;
  decisionProvenance?: TrainingProvenance | null;
}

interface AdversarialPersisted {
  controls?: AdversarialControls;
  result?: AdversarialTrainingResult | null;
  resultProvenance?: TrainingProvenance | null;
}

export function projectModelTrainingDraft(
  state: ModelTrainingState,
): ModelTrainingPersisted {
  return {
    perceptionControls: state.perceptionControls,
    decisionControls: state.decisionControls,
    perceptionResult: state.perceptionResult,
    decisionResult: state.decisionResult,
    perceptionProvenance: state.perceptionProvenance,
    decisionProvenance: state.decisionProvenance,
  };
}

export function projectAdversarialDraft(
  state: AdversarialTrainingState,
): AdversarialPersisted {
  return {
    controls: state.controls,
    result: state.result,
    resultProvenance: state.resultProvenance,
  };
}

let trainingHydrated = false;
let modelPersistTimer: number | null = null;
let adversarialPersistTimer: number | null = null;

/** 启动时恢复持久化的训练参数与结果；草稿损坏时忽略并保持默认。 */
export async function hydrateTrainingSessions(): Promise<void> {
  try {
    const raw = await readDraft("model-training", "xiakao:model-training:v1");
    if (raw) {
      const data = JSON.parse(raw) as ModelTrainingPersisted;
      useModelTrainingStore.setState({
        perceptionControls: {
          ...DEFAULT_PERCEPTION,
          ...(data.perceptionControls ?? {}),
        },
        decisionControls: {
          ...DEFAULT_DECISION,
          ...(data.decisionControls ?? {}),
        },
        perceptionResult: data.perceptionResult ?? null,
        decisionResult: data.decisionResult ?? null,
        perceptionProvenance: data.perceptionProvenance ?? null,
        decisionProvenance: data.decisionProvenance ?? null,
      });
    }
  } catch {
    // 忽略损坏草稿
  }
  try {
    const raw = await readDraft(
      "adversarial-training",
      "xiakao:adversarial-training:v1",
    );
    if (raw) {
      const data = JSON.parse(raw) as AdversarialPersisted;
      useAdversarialTrainingStore.setState({
        controls: { ...DEFAULT_ADVERSARIAL, ...(data.controls ?? {}) },
        result: data.result ?? null,
        resultProvenance: data.resultProvenance ?? null,
      });
    }
  } catch {
    // 忽略损坏草稿
  }
  trainingHydrated = true;
}

if (typeof window !== "undefined") {
  // 水合完成前不写回，避免默认值覆盖已保存内容
  useModelTrainingStore.subscribe((state) => {
    if (!trainingHydrated || state.running) return;
    if (modelPersistTimer !== null) window.clearTimeout(modelPersistTimer);
    modelPersistTimer = window.setTimeout(() => {
      modelPersistTimer = null;
      void writeDraft(
        "model-training",
        "xiakao:model-training:v1",
        JSON.stringify(projectModelTrainingDraft(useModelTrainingStore.getState())),
      ).catch(() => undefined);
    }, 400);
  });
  useAdversarialTrainingStore.subscribe((state) => {
    if (!trainingHydrated || state.running) return;
    if (adversarialPersistTimer !== null) window.clearTimeout(adversarialPersistTimer);
    adversarialPersistTimer = window.setTimeout(() => {
      adversarialPersistTimer = null;
      void writeDraft(
        "adversarial-training",
        "xiakao:adversarial-training:v1",
        JSON.stringify(projectAdversarialDraft(useAdversarialTrainingStore.getState())),
      ).catch(() => undefined);
    }, 400);
  });
  void hydrateTrainingSessions();
}
