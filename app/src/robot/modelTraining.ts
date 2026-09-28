/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 浏览器侧的轻量级模型训练基线：
 * - 感知模型：用仿真视觉特征训练 Softmax 多分类器。
 * - 决策网络：用合成状态-动作样本训练单隐藏层 MLP。
 * 训练不依赖外部服务，固定随机种子即可复现；模型权重只保留在本次运行结果中。
 */

export const PERCEPTION_CLASS_LABELS = ["水杯", "咖啡机", "工作台"] as const;
export const PERCEPTION_FEATURE_NAMES = [
  "水平位置",
  "垂直位置",
  "目标尺度",
  "长宽比",
  "边缘密度",
] as const;

export const DECISION_FEATURE_NAMES = [
  "目标 Δx",
  "目标 Δy",
  "目标 Δz",
  "障碍距离",
  "抓取阶段",
] as const;
export const DECISION_OUTPUT_NAMES = ["末端 Δx", "末端 Δy", "末端 Δz"] as const;

export interface PerceptionTrainingConfig {
  samplesPerClass?: number;
  epochs?: number;
  learningRate?: number;
  seed?: number;
}

export interface PerceptionTrainingEpoch {
  epoch: number;
  loss: number;
  accuracy: number;
  validationAccuracy: number;
}

export interface PerceptionTrainingSample {
  split: "train" | "validation";
  label: number;
  features: number[];
}

export interface PerceptionTrainingResult {
  algorithm: "softmax-regression";
  classLabels: string[];
  featureNames: string[];
  trainSamples: number;
  validationSamples: number;
  history: PerceptionTrainingEpoch[];
  finalLoss: number;
  validationAccuracy: number;
  confusion: number[][];
  samples: PerceptionTrainingSample[];
  weights: number[][];
  bias: number[];
  config: Required<PerceptionTrainingConfig>;
}

export interface DecisionTrainingConfig {
  samples?: number;
  epochs?: number;
  hiddenUnits?: number;
  learningRate?: number;
  seed?: number;
}

export interface DecisionTrainingEpoch {
  epoch: number;
  loss: number;
  validationMse: number;
  successRate: number;
  safetyRate: number;
}

export interface DecisionTrainingSample {
  split: "train" | "validation";
  input: number[];
  target: number[];
}

export interface DecisionTrainingResult {
  algorithm: "mlp-behavior-cloning";
  featureNames: string[];
  outputNames: string[];
  trainSamples: number;
  validationSamples: number;
  hiddenUnits: number;
  history: DecisionTrainingEpoch[];
  finalLoss: number;
  validationMse: number;
  validationSuccessRate: number;
  validationSafetyRate: number;
  samples: DecisionTrainingSample[];
  weightsInputHidden: number[][];
  biasHidden: number[];
  weightsHiddenOutput: number[][];
  biasOutput: number[];
  config: Required<DecisionTrainingConfig>;
}

interface PerceptionSample {
  features: number[];
  label: number;
}

interface DecisionSample {
  input: number[];
  target: number[];
}

interface Split<T> {
  train: T[];
  validation: T[];
}

interface MlpNetwork {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  inputHidden: number[][];
  hiddenBias: number[];
  hiddenOutput: number[][];
  outputBias: number[];
}

interface MlpForward {
  hiddenPreActivation: number[];
  hidden: number[];
  output: number[];
}

const DEFAULT_PERCEPTION_CONFIG: Required<PerceptionTrainingConfig> = {
  samplesPerClass: 120,
  epochs: 32,
  learningRate: 0.28,
  seed: 20260915,
};

const DEFAULT_DECISION_CONFIG: Required<DecisionTrainingConfig> = {
  samples: 320,
  epochs: 64,
  hiddenUnits: 12,
  learningRate: 0.08,
  seed: 20260916,
};

/** 训练仿真视觉特征上的 Softmax 多分类器。 */
export function runPerceptionTraining(
  inputConfig: PerceptionTrainingConfig = {},
): PerceptionTrainingResult {
  const config = resolvePerceptionConfig(inputConfig);
  const rng = createRng(config.seed);
  const split = splitSamples(
    makePerceptionSamples(config.samplesPerClass, rng),
    rng,
  );
  const classCount = PERCEPTION_CLASS_LABELS.length;
  const featureCount = PERCEPTION_FEATURE_NAMES.length;
  const weights = Array.from({ length: classCount }, () =>
    Array.from({ length: featureCount }, () => (rng() - 0.5) * 0.04),
  );
  const bias = Array.from({ length: classCount }, () => 0);
  const history: PerceptionTrainingEpoch[] = [];

  for (let epoch = 1; epoch <= config.epochs; epoch++) {
    shuffleInPlace(split.train, rng);
    const gradients = weights.map((row) => row.map(() => 0));
    const biasGradient = bias.map(() => 0);
    let loss = 0;
    let correct = 0;

    for (const sample of split.train) {
      const probabilities = softmax(logits(sample.features, weights, bias));
      const probability = Math.max(1e-8, probabilities[sample.label] ?? 0);
      loss -= Math.log(probability);
      if (argMax(probabilities) === sample.label) correct += 1;
      for (let classIndex = 0; classIndex < classCount; classIndex++) {
        const error =
          (probabilities[classIndex] ?? 0) -
          (classIndex === sample.label ? 1 : 0);
        for (
          let featureIndex = 0;
          featureIndex < featureCount;
          featureIndex++
        ) {
          gradients[classIndex][featureIndex] +=
            error * (sample.features[featureIndex] ?? 0);
        }
        biasGradient[classIndex] += error;
      }
    }

    const scale = 1 / Math.max(1, split.train.length);
    for (let classIndex = 0; classIndex < classCount; classIndex++) {
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
        weights[classIndex][featureIndex] -=
          config.learningRate * gradients[classIndex][featureIndex] * scale;
      }
      bias[classIndex] -=
        config.learningRate * biasGradient[classIndex] * scale;
    }

    history.push({
      epoch,
      loss: round(loss * scale),
      accuracy: round(correct / Math.max(1, split.train.length)),
      validationAccuracy: round(
        classificationAccuracy(split.validation, weights, bias),
      ),
    });
  }

  const finalEpoch = history[history.length - 1];
  const validationAccuracy = classificationAccuracy(
    split.validation,
    weights,
    bias,
  );
  return {
    algorithm: "softmax-regression",
    classLabels: [...PERCEPTION_CLASS_LABELS],
    featureNames: [...PERCEPTION_FEATURE_NAMES],
    trainSamples: split.train.length,
    validationSamples: split.validation.length,
    history,
    finalLoss: finalEpoch?.loss ?? 0,
    validationAccuracy: round(validationAccuracy),
    confusion: confusionMatrix(split.validation, weights, bias),
    samples: [
      ...split.train.map((sample) => ({
        split: "train" as const,
        label: sample.label,
        features: [...sample.features],
      })),
      ...split.validation.map((sample) => ({
        split: "validation" as const,
        label: sample.label,
        features: [...sample.features],
      })),
    ],
    weights: weights.map((row) => row.map(round)),
    bias: bias.map(round),
    config,
  };
}

/** 训练仿真状态到末端动作的单隐藏层 MLP（行为克隆基线）。 */
export function runDecisionNetworkTraining(
  inputConfig: DecisionTrainingConfig = {},
): DecisionTrainingResult {
  const config = resolveDecisionConfig(inputConfig);
  const rng = createRng(config.seed);
  const split = splitSamples(makeDecisionSamples(config.samples, rng), rng);
  const network = createMlp(
    DECISION_FEATURE_NAMES.length,
    config.hiddenUnits,
    DECISION_OUTPUT_NAMES.length,
    rng,
  );
  const history: DecisionTrainingEpoch[] = [];

  for (let epoch = 1; epoch <= config.epochs; epoch++) {
    shuffleInPlace(split.train, rng);
    let loss = 0;
    for (const sample of split.train) {
      const forward = forwardMlp(network, sample.input);
      const outputError = forward.output.map(
        (value, index) => value - (sample.target[index] ?? 0),
      );
      loss += meanSquaredError(forward.output, sample.target);
      const outputDelta = outputError.map(
        (error, index) => error * tanhDerivative(forward.output[index] ?? 0),
      );
      const hiddenDelta = forward.hiddenPreActivation.map(
        (pre, hiddenIndex) => {
          if (pre <= 0) return 0;
          let gradient = 0;
          for (
            let outputIndex = 0;
            outputIndex < network.outputSize;
            outputIndex++
          ) {
            gradient +=
              (outputDelta[outputIndex] ?? 0) *
              (network.hiddenOutput[outputIndex]?.[hiddenIndex] ?? 0);
          }
          return gradient;
        },
      );

      for (
        let outputIndex = 0;
        outputIndex < network.outputSize;
        outputIndex++
      ) {
        for (
          let hiddenIndex = 0;
          hiddenIndex < network.hiddenSize;
          hiddenIndex++
        ) {
          network.hiddenOutput[outputIndex][hiddenIndex] -=
            config.learningRate *
            (outputDelta[outputIndex] ?? 0) *
            (forward.hidden[hiddenIndex] ?? 0);
        }
        network.outputBias[outputIndex] -=
          config.learningRate * (outputDelta[outputIndex] ?? 0);
      }
      for (
        let hiddenIndex = 0;
        hiddenIndex < network.hiddenSize;
        hiddenIndex++
      ) {
        for (
          let featureIndex = 0;
          featureIndex < network.inputSize;
          featureIndex++
        ) {
          network.inputHidden[hiddenIndex][featureIndex] -=
            config.learningRate *
            (hiddenDelta[hiddenIndex] ?? 0) *
            (sample.input[featureIndex] ?? 0);
        }
        network.hiddenBias[hiddenIndex] -=
          config.learningRate * (hiddenDelta[hiddenIndex] ?? 0);
      }
    }

    const validation = evaluateDecisionNetwork(network, split.validation);
    history.push({
      epoch,
      loss: round(loss / Math.max(1, split.train.length)),
      validationMse: round(validation.mse),
      successRate: round(validation.successRate),
      safetyRate: round(validation.safetyRate),
    });
  }

  const finalEpoch = history[history.length - 1];
  const validation = evaluateDecisionNetwork(network, split.validation);
  return {
    algorithm: "mlp-behavior-cloning",
    featureNames: [...DECISION_FEATURE_NAMES],
    outputNames: [...DECISION_OUTPUT_NAMES],
    trainSamples: split.train.length,
    validationSamples: split.validation.length,
    hiddenUnits: config.hiddenUnits,
    history,
    finalLoss: finalEpoch?.loss ?? 0,
    validationMse: round(validation.mse),
    validationSuccessRate: round(validation.successRate),
    validationSafetyRate: round(validation.safetyRate),
    samples: [
      ...split.train.map((sample) => ({
        split: "train" as const,
        input: [...sample.input],
        target: [...sample.target],
      })),
      ...split.validation.map((sample) => ({
        split: "validation" as const,
        input: [...sample.input],
        target: [...sample.target],
      })),
    ],
    weightsInputHidden: network.inputHidden.map((row) => row.map(round)),
    biasHidden: network.hiddenBias.map(round),
    weightsHiddenOutput: network.hiddenOutput.map((row) => row.map(round)),
    biasOutput: network.outputBias.map(round),
    config,
  };
}

/** 将感知模型参数与训练摘要序列化为可复用 JSON。 */
export function serializePerceptionModel(
  result: PerceptionTrainingResult,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: "xiakao.model",
      formatVersion: 1,
      modelType: "perception",
      exportedAt,
      algorithm: result.algorithm,
      classes: result.classLabels.map((label, id) => ({ id, label })),
      featureNames: result.featureNames,
      parameters: {
        weights: result.weights,
        bias: result.bias,
      },
      training: {
        config: result.config,
        trainSamples: result.trainSamples,
        validationSamples: result.validationSamples,
        finalLoss: result.finalLoss,
        validationAccuracy: result.validationAccuracy,
        confusion: result.confusion,
        history: result.history,
      },
    },
    null,
    2,
  );
}

/** 将决策网络结构、权重与训练摘要序列化为可复用 JSON。 */
export function serializeDecisionModel(
  result: DecisionTrainingResult,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: "xiakao.model",
      formatVersion: 1,
      modelType: "decision",
      exportedAt,
      algorithm: result.algorithm,
      architecture: {
        inputSize: result.featureNames.length,
        hiddenUnits: result.hiddenUnits,
        outputSize: result.outputNames.length,
        activationHidden: "relu",
        activationOutput: "tanh",
      },
      featureNames: result.featureNames,
      outputNames: result.outputNames,
      parameters: {
        inputHidden: result.weightsInputHidden,
        hiddenBias: result.biasHidden,
        hiddenOutput: result.weightsHiddenOutput,
        outputBias: result.biasOutput,
      },
      training: {
        config: result.config,
        trainSamples: result.trainSamples,
        validationSamples: result.validationSamples,
        finalLoss: result.finalLoss,
        validationMse: result.validationMse,
        validationSuccessRate: result.validationSuccessRate,
        validationSafetyRate: result.validationSafetyRate,
        history: result.history,
      },
    },
    null,
    2,
  );
}

/** 导出感知训练/验证样本，保留标签和特征名，中文可直接用表格工具打开。 */
export function serializePerceptionData(
  result: PerceptionTrainingResult,
): string {
  const header = ["split", "label_id", "label", ...result.featureNames];
  const rows = result.samples.map((sample) => [
    sample.split,
    sample.label,
    result.classLabels[sample.label] ?? "未知",
    ...sample.features.map(formatCsvNumber),
  ]);
  return toCsv([header, ...rows]);
}

/** 导出决策网络状态-动作样本，保留 train/validation 划分。 */
export function serializeDecisionData(result: DecisionTrainingResult): string {
  const header = [
    "split",
    ...result.featureNames,
    ...result.outputNames.map((name) => `target_${name}`),
  ];
  const rows = result.samples.map((sample) => [
    sample.split,
    ...sample.input.map(formatCsvNumber),
    ...sample.target.map(formatCsvNumber),
  ]);
  return toCsv([header, ...rows]);
}

function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return `\ufeff${rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatCsvNumber(value: number): string {
  return value.toFixed(8);
}

function resolvePerceptionConfig(
  input: PerceptionTrainingConfig,
): Required<PerceptionTrainingConfig> {
  return {
    samplesPerClass: clampInt(
      input.samplesPerClass ?? DEFAULT_PERCEPTION_CONFIG.samplesPerClass,
      30,
      600,
    ),
    epochs: clampInt(input.epochs ?? DEFAULT_PERCEPTION_CONFIG.epochs, 4, 160),
    learningRate: clampNumber(
      input.learningRate ?? DEFAULT_PERCEPTION_CONFIG.learningRate,
      0.01,
      1,
    ),
    seed: Math.trunc(input.seed ?? DEFAULT_PERCEPTION_CONFIG.seed),
  };
}

function resolveDecisionConfig(
  input: DecisionTrainingConfig,
): Required<DecisionTrainingConfig> {
  return {
    samples: clampInt(
      input.samples ?? DEFAULT_DECISION_CONFIG.samples,
      80,
      1600,
    ),
    epochs: clampInt(input.epochs ?? DEFAULT_DECISION_CONFIG.epochs, 8, 220),
    hiddenUnits: clampInt(
      input.hiddenUnits ?? DEFAULT_DECISION_CONFIG.hiddenUnits,
      4,
      48,
    ),
    learningRate: clampNumber(
      input.learningRate ?? DEFAULT_DECISION_CONFIG.learningRate,
      0.005,
      0.4,
    ),
    seed: Math.trunc(input.seed ?? DEFAULT_DECISION_CONFIG.seed),
  };
}

function makePerceptionSamples(
  samplesPerClass: number,
  rng: () => number,
): PerceptionSample[] {
  // 归一化特征模拟检测框与深度相机摘要，不代表真实图像像素。
  const centers = [
    [0.28, 0.57, 0.22, 0.46, 0.78],
    [0.7, 0.57, 0.68, 0.86, 0.64],
    [0.5, 0.18, 0.92, 0.96, 0.24],
  ];
  const noise = [0.075, 0.075, 0.08, 0.08, 0.09];
  const samples: PerceptionSample[] = [];
  for (let label = 0; label < centers.length; label++) {
    const center = centers[label] ?? [];
    for (let index = 0; index < samplesPerClass; index++) {
      samples.push({
        label,
        features: center.map((value, featureIndex) =>
          clamp01(value + gaussian(rng) * (noise[featureIndex] ?? 0.08)),
        ),
      });
    }
  }
  return samples;
}

function makeDecisionSamples(
  count: number,
  rng: () => number,
): DecisionSample[] {
  const samples: DecisionSample[] = [];
  for (let index = 0; index < count; index++) {
    const dx = rng() * 2 - 1;
    const dy = rng() * 2 - 1;
    const dz = rng() * 1.4 - 0.55;
    const obstacleDistance = rng();
    const phase = rng();
    const avoidanceLift =
      obstacleDistance < 0.3 ? (0.3 - obstacleDistance) * 1.7 : 0;
    samples.push({
      input: [dx, dy, dz, obstacleDistance, phase],
      target: [
        clampSigned(dx * 0.78 - dy * 0.08),
        clampSigned(dy * 0.78 + dx * 0.08),
        clampSigned(dz * 0.84 + 0.12 + avoidanceLift + phase * 0.04),
      ],
    });
  }
  return samples;
}

function splitSamples<T>(samples: T[], rng: () => number): Split<T> {
  shuffleInPlace(samples, rng);
  const validationCount = Math.max(1, Math.round(samples.length * 0.2));
  return {
    validation: samples.slice(0, validationCount),
    train: samples.slice(validationCount),
  };
}

function logits(
  features: readonly number[],
  weights: readonly number[][],
  bias: readonly number[],
): number[] {
  return weights.map((row, classIndex) =>
    row.reduce(
      (sum, weight, featureIndex) =>
        sum + weight * (features[featureIndex] ?? 0),
      bias[classIndex] ?? 0,
    ),
  );
}

function softmax(values: readonly number[]): number[] {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / Math.max(1e-8, total));
}

function classificationAccuracy(
  samples: readonly PerceptionSample[],
  weights: readonly number[][],
  bias: readonly number[],
): number {
  if (samples.length === 0) return 0;
  let correct = 0;
  for (const sample of samples) {
    if (
      argMax(softmax(logits(sample.features, weights, bias))) === sample.label
    ) {
      correct += 1;
    }
  }
  return correct / samples.length;
}

function confusionMatrix(
  samples: readonly PerceptionSample[],
  weights: readonly number[][],
  bias: readonly number[],
): number[][] {
  const matrix = PERCEPTION_CLASS_LABELS.map(() =>
    PERCEPTION_CLASS_LABELS.map(() => 0),
  );
  for (const sample of samples) {
    const actual = matrix[sample.label];
    const predicted = argMax(softmax(logits(sample.features, weights, bias)));
    if (actual && predicted >= 0) actual[predicted] += 1;
  }
  return matrix;
}

function createMlp(
  inputSize: number,
  hiddenSize: number,
  outputSize: number,
  rng: () => number,
): MlpNetwork {
  const inputScale = Math.sqrt(6 / (inputSize + hiddenSize));
  const outputScale = Math.sqrt(6 / (hiddenSize + outputSize));
  return {
    inputSize,
    hiddenSize,
    outputSize,
    inputHidden: Array.from({ length: hiddenSize }, () =>
      Array.from({ length: inputSize }, () => (rng() * 2 - 1) * inputScale),
    ),
    hiddenBias: Array.from({ length: hiddenSize }, () => 0),
    hiddenOutput: Array.from({ length: outputSize }, () =>
      Array.from({ length: hiddenSize }, () => (rng() * 2 - 1) * outputScale),
    ),
    outputBias: Array.from({ length: outputSize }, () => 0),
  };
}

function forwardMlp(network: MlpNetwork, input: readonly number[]): MlpForward {
  const hiddenPreActivation = network.inputHidden.map((row, hiddenIndex) =>
    row.reduce(
      (sum, weight, featureIndex) => sum + weight * (input[featureIndex] ?? 0),
      network.hiddenBias[hiddenIndex] ?? 0,
    ),
  );
  const hidden = hiddenPreActivation.map((value) => Math.max(0, value));
  const output = network.hiddenOutput.map((row, outputIndex) =>
    Math.tanh(
      row.reduce(
        (sum, weight, hiddenIndex) => sum + weight * (hidden[hiddenIndex] ?? 0),
        network.outputBias[outputIndex] ?? 0,
      ),
    ),
  );
  return { hiddenPreActivation, hidden, output };
}

function evaluateDecisionNetwork(
  network: MlpNetwork,
  samples: readonly DecisionSample[],
): { mse: number; successRate: number; safetyRate: number } {
  if (samples.length === 0) return { mse: 0, successRate: 0, safetyRate: 0 };
  let mse = 0;
  let success = 0;
  let safe = 0;
  for (const sample of samples) {
    const output = forwardMlp(network, sample.input).output;
    const error = Math.sqrt(
      output.reduce(
        (sum, value, index) => sum + (value - (sample.target[index] ?? 0)) ** 2,
        0,
      ),
    );
    mse += meanSquaredError(output, sample.target);
    if (error <= 0.3) success += 1;
    if (isSafeDecision(sample.input[3] ?? 1, output)) safe += 1;
  }
  return {
    mse: mse / samples.length,
    successRate: success / samples.length,
    safetyRate: safe / samples.length,
  };
}

function isSafeDecision(
  obstacleDistance: number,
  output: readonly number[],
): boolean {
  return obstacleDistance >= 0.3 || (output[2] ?? 0) >= 0.12;
}

function meanSquaredError(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0) return 0;
  return (
    a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0) /
    a.length
  );
}

function tanhDerivative(output: number): number {
  return 1 - output * output;
}

function argMax(values: readonly number[]): number {
  let index = 0;
  for (let candidate = 1; candidate < values.length; candidate++) {
    if ((values[candidate] ?? -Infinity) > (values[index] ?? -Infinity)) {
      index = candidate;
    }
  }
  return index;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const first = Math.max(1e-8, rng());
  const second = rng();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function shuffleInPlace<T>(values: T[], rng: () => number): void {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clampNumber(value, min, max));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
