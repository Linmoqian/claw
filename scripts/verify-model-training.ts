/**
 * 模型训练数学层验证：仿真感知分类器 + 决策网络反向传播。
 *
 * Created on 2026-09-15
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
import {
  runDecisionNetworkTraining,
  runPerceptionTraining,
  serializeDecisionData,
  serializeDecisionModel,
  serializePerceptionData,
  serializePerceptionModel,
} from "../src/robot/modelTraining";

function main() {
  const perceptionConfig = {
    samplesPerClass: 90,
    epochs: 24,
    learningRate: 0.28,
    seed: 20260915,
  };
  const perception = runPerceptionTraining(perceptionConfig);
  const perceptionRepeat = runPerceptionTraining(perceptionConfig);
  assert.equal(perception.history.length, perceptionConfig.epochs);
  assert.ok(
    perception.validationAccuracy >= 0.9,
    `感知验证准确率过低: ${perception.validationAccuracy}`,
  );
  assert.deepEqual(perception.history, perceptionRepeat.history);
  assert.equal(perception.confusion.length, 3);
  const perceptionModel = JSON.parse(
    serializePerceptionModel(perception, "2026-09-15T00:00:00.000Z"),
  ) as { modelType: string; parameters: { weights: number[][] } };
  assert.equal(perceptionModel.modelType, "perception");
  assert.equal(perceptionModel.parameters.weights.length, 3);
  const perceptionDataRows = serializePerceptionData(perception)
    .trimEnd()
    .split(/\r?\n/);
  assert.equal(perceptionDataRows.length, perception.samples.length + 1);

  const decisionConfig = {
    samples: 240,
    epochs: 48,
    hiddenUnits: 10,
    learningRate: 0.08,
    seed: 20260916,
  };
  const decision = runDecisionNetworkTraining(decisionConfig);
  const decisionRepeat = runDecisionNetworkTraining(decisionConfig);
  assert.equal(decision.history.length, decisionConfig.epochs);
  assert.ok(
    decision.validationSuccessRate >= 0.85,
    `决策验证成功率过低: ${decision.validationSuccessRate}`,
  );
  assert.ok(
    decision.validationSafetyRate >= 0.8,
    `决策验证安全率过低: ${decision.validationSafetyRate}`,
  );
  assert.deepEqual(decision.history, decisionRepeat.history);
  const decisionModel = JSON.parse(
    serializeDecisionModel(decision, "2026-09-15T00:00:00.000Z"),
  ) as { modelType: string; architecture: { hiddenUnits: number } };
  assert.equal(decisionModel.modelType, "decision");
  assert.equal(decisionModel.architecture.hiddenUnits, decision.hiddenUnits);
  const decisionDataRows = serializeDecisionData(decision)
    .trimEnd()
    .split(/\r?\n/);
  assert.equal(decisionDataRows.length, decision.samples.length + 1);

  console.log(
    JSON.stringify(
      {
        perception: {
          validationAccuracy: perception.validationAccuracy,
          finalLoss: perception.finalLoss,
          validationSamples: perception.validationSamples,
        },
        decision: {
          validationSuccessRate: decision.validationSuccessRate,
          validationSafetyRate: decision.validationSafetyRate,
          validationMse: decision.validationMse,
          validationSamples: decision.validationSamples,
        },
        deterministic: true,
      },
      null,
      2,
    ),
  );
  console.log("模型训练验证完成");
}

main();
