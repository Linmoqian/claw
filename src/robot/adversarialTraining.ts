/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 轻量级对抗训练：在 SO-100 仿真轨迹上交替寻找最坏扰动并更新关节偏置。
 * 这是可解释的离线基线，后续可以把策略参数替换为神经网络权重。
 */
import { CollisionSystem, type CollisionStatus } from "./collision";
import { computeLinkPoses, computeTcpPose } from "./kinematics";
import { SCENE_PROP_LAYOUT } from "./sceneGeometry";
import { sampleTrajectory, so100DemoLoop, type TrajPoint } from "./trajectory";
import type { RobotModel } from "./types";

/** 与 SceneProps.tsx 对齐的 URDF/ROS 坐标（米）：three 的 z 轴映射为 -y。 */
const CUP_TARGET: readonly [number, number, number] = [
  SCENE_PROP_LAYOUT.cup.positionThree[0],
  -SCENE_PROP_LAYOUT.cup.positionThree[2],
  0.14,
];
const MACHINE_CENTER: readonly [number, number, number] = [
  SCENE_PROP_LAYOUT.coffeeMachine.positionThree[0],
  -SCENE_PROP_LAYOUT.coffeeMachine.positionThree[2],
  0.16,
];

const DEFAULT_HORIZON_STEPS = 18;
const DEFAULT_ADVERSARY_POPULATION = 8;
const DEFAULT_PERTURBATION_DEG = 8;
const DEFAULT_LEARNING_RATE = 0.42;
const DEFAULT_FINITE_DIFFERENCE_DEG = 1.5;
const MAX_POLICY_OFFSET_DEG = 24;

export interface AdversarialTrainingConfig {
  /** 训练轮数；每轮都重新选择一次最坏扰动。 */
  epochs?: number;
  /** 每个 episode 的均匀采样点数。 */
  horizonSteps?: number;
  /** 每轮攻击者候选扰动数。 */
  adversaryPopulation?: number;
  /** 每个关节允许的最大攻击幅度（°）。 */
  perturbationDeg?: number;
  /** 策略有限差分梯度的更新步长。 */
  learningRate?: number;
  /** 有限差分的中心间隔（°）。 */
  finiteDifferenceDeg?: number;
  /** 固定随机种子，保证同一配置可复现。 */
  seed?: number;
  /** 默认使用内置安全轨迹，也可传入数据采集后的轨迹。 */
  trajectory?: TrajPoint[];
}

export interface AdversarialPolicy {
  /** 相对名义轨迹的关节偏置（°），按 RobotModel.active 顺序。 */
  biasDeg: number[];
}

export interface AdversarialEpisode {
  reward: number;
  goalReward: number;
  safetyPenalty: number;
  trackingPenalty: number;
  smoothnessPenalty: number;
  collisionCount: number;
  machineNearMisses: number;
  minObstacleDistance: number;
  minSafetyDistance: number | null;
  perturbationDeg: number[];
  finalGoalDistance: number;
}

export interface AdversarialTrainingEpoch {
  epoch: number;
  nominalReward: number;
  worstReward: number;
  goalReward: number;
  collisionCount: number;
  machineNearMisses: number;
  adversaryNormDeg: number;
  policyOffsetNormDeg: number;
}

export interface AdversarialTrainingResult {
  policy: AdversarialPolicy;
  history: AdversarialTrainingEpoch[];
  bestWorstReward: number;
  finalEpisode: AdversarialEpisode;
  config: Required<
    Pick<
      AdversarialTrainingConfig,
      | "epochs"
      | "horizonSteps"
      | "adversaryPopulation"
      | "perturbationDeg"
      | "learningRate"
      | "finiteDifferenceDeg"
      | "seed"
    >
  >;
}

const DEFAULT_CONFIG: Required<
  Pick<
    AdversarialTrainingConfig,
    | "epochs"
    | "horizonSteps"
    | "adversaryPopulation"
    | "perturbationDeg"
    | "learningRate"
    | "finiteDifferenceDeg"
    | "seed"
  >
> = {
  epochs: 24,
  horizonSteps: DEFAULT_HORIZON_STEPS,
  adversaryPopulation: DEFAULT_ADVERSARY_POPULATION,
  perturbationDeg: DEFAULT_PERTURBATION_DEG,
  learningRate: DEFAULT_LEARNING_RATE,
  finiteDifferenceDeg: DEFAULT_FINITE_DIFFERENCE_DEG,
  seed: 20260915,
};

function resolveConfig(
  input: AdversarialTrainingConfig,
): AdversarialTrainingResult["config"] {
  return {
    epochs: clampInt(input.epochs ?? DEFAULT_CONFIG.epochs, 1, 200),
    horizonSteps: clampInt(
      input.horizonSteps ?? DEFAULT_CONFIG.horizonSteps,
      6,
      64,
    ),
    adversaryPopulation: clampInt(
      input.adversaryPopulation ?? DEFAULT_CONFIG.adversaryPopulation,
      2,
      32,
    ),
    perturbationDeg: clampNumber(
      input.perturbationDeg ?? DEFAULT_CONFIG.perturbationDeg,
      0,
      30,
    ),
    learningRate: clampNumber(
      input.learningRate ?? DEFAULT_CONFIG.learningRate,
      0.01,
      2,
    ),
    finiteDifferenceDeg: clampNumber(
      input.finiteDifferenceDeg ?? DEFAULT_CONFIG.finiteDifferenceDeg,
      0.1,
      8,
    ),
    seed: Math.trunc(input.seed ?? DEFAULT_CONFIG.seed),
  };
}

/** 运行可复现的最小-最大训练基线。 */
export function runAdversarialTraining(
  model: RobotModel,
  inputConfig: AdversarialTrainingConfig = {},
): AdversarialTrainingResult {
  const config = resolveConfig(inputConfig);
  const trajectory = inputConfig.trajectory ?? so100DemoLoop();
  const collision = new CollisionSystem(model);
  const policy: AdversarialPolicy = {
    biasDeg: model.active.map(() => 0),
  };
  const zeroDisturbance = model.active.map(() => 0);
  const rng = createRng(config.seed);
  const history: AdversarialTrainingEpoch[] = [];
  let bestWorstReward = -Infinity;
  let finalEpisode = evaluateEpisode(
    model,
    collision,
    trajectory,
    policy,
    zeroDisturbance,
    config.horizonSteps,
  );

  for (let epoch = 1; epoch <= config.epochs; epoch++) {
    const candidates = generateDisturbances(
      model.active.length,
      config.adversaryPopulation,
      config.perturbationDeg,
      rng,
    );
    const scored = candidates.map((disturbance) => ({
      disturbance,
      episode: evaluateEpisode(
        model,
        collision,
        trajectory,
        policy,
        disturbance,
        config.horizonSteps,
      ),
    }));
    const worst = scored.reduce((current, candidate) =>
      candidate.episode.reward < current.episode.reward ? candidate : current,
    );

    // 策略玩家：对攻击者当前的最佳响应做中心有限差分并上升更新。
    const gradient = policy.biasDeg.map((_, index) => {
      const plus = { biasDeg: [...policy.biasDeg] };
      const minus = { biasDeg: [...policy.biasDeg] };
      plus.biasDeg[index] += config.finiteDifferenceDeg;
      minus.biasDeg[index] -= config.finiteDifferenceDeg;
      const plusReward = evaluateEpisode(
        model,
        collision,
        trajectory,
        plus,
        worst.disturbance,
        config.horizonSteps,
      ).reward;
      const minusReward = evaluateEpisode(
        model,
        collision,
        trajectory,
        minus,
        worst.disturbance,
        config.horizonSteps,
      ).reward;
      return clampNumber(
        (plusReward - minusReward) / (2 * config.finiteDifferenceDeg),
        -4,
        4,
      );
    });
    policy.biasDeg = policy.biasDeg.map((value, index) =>
      clampNumber(
        value + config.learningRate * gradient[index],
        -MAX_POLICY_OFFSET_DEG,
        MAX_POLICY_OFFSET_DEG,
      ),
    );

    // 攻击者玩家：固定最坏扰动，重新评估更新后的策略，记录真实 worst-case 指标。
    const postScored = candidates.map((disturbance) => ({
      disturbance,
      episode: evaluateEpisode(
        model,
        collision,
        trajectory,
        policy,
        disturbance,
        config.horizonSteps,
      ),
    }));
    const postWorst = postScored.reduce((current, candidate) =>
      candidate.episode.reward < current.episode.reward ? candidate : current,
    );
    finalEpisode = postWorst.episode;
    bestWorstReward = Math.max(bestWorstReward, postWorst.episode.reward);
    const nominal = evaluateEpisode(
      model,
      collision,
      trajectory,
      policy,
      zeroDisturbance,
      config.horizonSteps,
    );
    history.push({
      epoch,
      nominalReward: round(nominal.reward),
      worstReward: round(postWorst.episode.reward),
      goalReward: round(postWorst.episode.goalReward),
      collisionCount: postWorst.episode.collisionCount,
      machineNearMisses: postWorst.episode.machineNearMisses,
      adversaryNormDeg: round(vectorNorm(postWorst.disturbance)),
      policyOffsetNormDeg: round(vectorNorm(policy.biasDeg)),
    });
  }

  collision.dispose();
  return {
    policy: { biasDeg: [...policy.biasDeg] },
    history,
    bestWorstReward: round(bestWorstReward),
    finalEpisode,
    config,
  };
}

/** 对单个扰动做一次 episode 评估，供训练和后续单元测试共用。 */
export function evaluateAdversarialEpisode(
  model: RobotModel,
  policy: AdversarialPolicy,
  perturbationDeg: number[],
  options: { trajectory?: TrajPoint[]; horizonSteps?: number } = {},
): AdversarialEpisode {
  const collision = new CollisionSystem(model);
  try {
    return evaluateEpisode(
      model,
      collision,
      options.trajectory ?? so100DemoLoop(),
      policy,
      perturbationDeg,
      clampInt(options.horizonSteps ?? DEFAULT_HORIZON_STEPS, 6, 64),
    );
  } finally {
    collision.dispose();
  }
}

function evaluateEpisode(
  model: RobotModel,
  collision: CollisionSystem,
  trajectory: TrajPoint[],
  policy: AdversarialPolicy,
  perturbationDeg: number[],
  horizonSteps: number,
): AdversarialEpisode {
  const totalTime = Math.max(
    trajectory[trajectory.length - 1]?.time ?? 1,
    0.001,
  );
  const goalStart = Math.max(1, Math.floor(horizonSteps * 0.72));
  let goalErrorSum = 0;
  let goalSamples = 0;
  let machinePenalty = 0;
  let machineNearMisses = 0;
  let collisionCount = 0;
  let smoothnessPenalty = 0;
  let minObstacleDistance = Infinity;
  let minSafetyDistance = Infinity;
  let previousAction: number[] | null = null;
  let finalGoalDistance = Infinity;

  for (let step = 0; step < horizonSteps; step++) {
    const t = (step / Math.max(1, horizonSteps - 1)) * totalTime;
    const nominal = sampleTrajectory(trajectory, t);
    const action = nominal.map((value, index) => {
      // 攻击者可随时间改变方向，但幅度固定在用户配置边界内。
      const phase = 0.82 + 0.18 * Math.sin((step + 1) * 0.77 + index * 0.53);
      const disturbed =
        value +
        (policy.biasDeg[index] ?? 0) +
        (perturbationDeg[index] ?? 0) * phase;
      return clampToJoint(model, index, disturbed);
    });
    const status = collision.evaluate(action);
    const tcp = computeTcpPose(model, computeLinkPoses(model, action)).position;
    const cupDistance = distance3(tcp.x, tcp.y, tcp.z, CUP_TARGET);
    const machineDistance = distance3(tcp.x, tcp.y, tcp.z, MACHINE_CENTER);
    const cupClearance = Math.max(0, cupDistance - 0.045);
    const machineClearance = Math.max(0, machineDistance - 0.14);
    minObstacleDistance = Math.min(
      minObstacleDistance,
      cupClearance,
      machineClearance,
    );
    if (machineClearance < 0.075) {
      machineNearMisses += 1;
      machinePenalty += (0.075 - machineClearance) / 0.075;
    }
    if (step >= goalStart) {
      goalErrorSum += cupDistance;
      goalSamples += 1;
      finalGoalDistance = cupDistance;
    }
    if (status.selfCollision || status.tier === "stop") collisionCount += 1;
    if (status.safetyDistance !== null) {
      minSafetyDistance = Math.min(minSafetyDistance, status.safetyDistance);
    }
    if (previousAction) {
      smoothnessPenalty +=
        vectorDistance(previousAction, action) / Math.max(1, action.length);
    }
    previousAction = action;
  }

  const goalError = goalSamples > 0 ? goalErrorSum / goalSamples : 1;
  const goalReward = clampNumber(1 - goalError / 0.38, 0, 1);
  const safetyPenalty = collisionCount * 1.6 + machinePenalty;
  const trackingPenalty =
    vectorNorm(policy.biasDeg) / Math.max(1, policy.biasDeg.length) / 32;
  const reward =
    goalReward * 4.2 -
    safetyPenalty * 2.4 -
    trackingPenalty * 0.9 -
    smoothnessPenalty * 0.015;

  return {
    reward,
    goalReward,
    safetyPenalty,
    trackingPenalty,
    smoothnessPenalty,
    collisionCount,
    machineNearMisses,
    minObstacleDistance: Number.isFinite(minObstacleDistance)
      ? minObstacleDistance
      : 0,
    minSafetyDistance: Number.isFinite(minSafetyDistance)
      ? minSafetyDistance
      : null,
    perturbationDeg: [...perturbationDeg],
    finalGoalDistance: Number.isFinite(finalGoalDistance)
      ? finalGoalDistance
      : 1,
  };
}

function generateDisturbances(
  jointCount: number,
  population: number,
  amplitudeDeg: number,
  rng: () => number,
): number[][] {
  const candidates: number[][] = [Array.from({ length: jointCount }, () => 0)];
  for (let sample = 1; sample < population; sample++) {
    const disturbance = Array.from({ length: jointCount }, () => {
      const sign = rng() > 0.5 ? 1 : -1;
      return sign * amplitudeDeg * (0.35 + rng() * 0.65);
    });
    candidates.push(disturbance);
  }
  return candidates;
}

function clampToJoint(model: RobotModel, index: number, value: number): number {
  const joint = model.active[index];
  if (!joint) return value;
  const min = Number.isFinite(joint.minDeg) ? joint.minDeg : -Infinity;
  const max = Number.isFinite(joint.maxDeg) ? joint.maxDeg : Infinity;
  return Math.min(max, Math.max(min, value));
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance3(
  x: number,
  y: number,
  z: number,
  target: readonly [number, number, number],
): number {
  return Math.hypot(x - target[0], y - target[1], z - target[2]);
}

function vectorNorm(values: readonly number[]): number {
  return Math.hypot(...values);
}

function vectorDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(Math.max(0, sum));
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

export type { CollisionStatus };
