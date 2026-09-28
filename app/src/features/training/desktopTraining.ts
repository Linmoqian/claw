// 桌面训练命令与进度适配。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DecisionTrainingConfig,
  DecisionTrainingResult,
  PerceptionTrainingConfig,
  PerceptionTrainingResult,
} from "../../robot/modelTraining";
import type { AdversarialTrainingConfig, AdversarialTrainingResult } from "../../robot/adversarialTraining";

export interface TrainingProgress {
  version: number;
  sequence: number;
  epoch: number;
  epochs: number;
  loss: number;
}

export function desktopTrainingEnabled(): boolean {
  return isTauri();
}

async function invokeTraining<T>(
  command: string,
  config: PerceptionTrainingConfig | DecisionTrainingConfig | AdversarialTrainingConfig,
  onProgress: (progress: TrainingProgress) => void,
): Promise<T> {
  const progress = new Channel<TrainingProgress>();
  let lastSequence = 0;
  progress.onmessage = (message) => {
    if (message.version !== 1 || message.sequence <= lastSequence) return;
    lastSequence = message.sequence;
    onProgress(message);
  };
  return invoke<T>(command, { config, progress });
}

export function trainDesktopPerception(
  config: PerceptionTrainingConfig,
  onProgress: (progress: TrainingProgress) => void,
): Promise<PerceptionTrainingResult> {
  return invokeTraining("train_perception", config, onProgress);
}

export function trainDesktopDecision(
  config: DecisionTrainingConfig,
  onProgress: (progress: TrainingProgress) => void,
): Promise<DecisionTrainingResult> {
  return invokeTraining("train_decision", config, onProgress);
}

export function trainDesktopAdversarial(
  robotId: string,
  config: AdversarialTrainingConfig,
  onProgress: (progress: TrainingProgress) => void,
): Promise<AdversarialTrainingResult> {
  const progress = new Channel<TrainingProgress>();
  let lastSequence = 0;
  progress.onmessage = (message) => {
    if (message.version !== 1 || message.sequence <= lastSequence) return;
    lastSequence = message.sequence;
    onProgress(message);
  };
  return invoke<AdversarialTrainingResult>("train_adversarial", { robotId, config, progress });
}
