// 内置合成数据训练与有序进度流。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

const PERCEPTION_LABELS: [&str; 3] = ["水杯", "咖啡机", "工作台"];
const PERCEPTION_FEATURES: [&str; 5] = ["水平位置", "垂直位置", "目标尺度", "长宽比", "边缘密度"];
const DECISION_FEATURES: [&str; 5] = ["目标 Δx", "目标 Δy", "目标 Δz", "障碍距离", "抓取阶段"];
const DECISION_OUTPUTS: [&str; 3] = ["末端 Δx", "末端 Δy", "末端 Δz"];

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PerceptionConfig {
    samples_per_class: usize,
    epochs: usize,
    learning_rate: f64,
    seed: i64,
}

impl Default for PerceptionConfig {
    fn default() -> Self {
        Self {
            samples_per_class: 120,
            epochs: 32,
            learning_rate: 0.28,
            seed: 20260915,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DecisionConfig {
    samples: usize,
    epochs: usize,
    hidden_units: usize,
    learning_rate: f64,
    seed: i64,
}

impl Default for DecisionConfig {
    fn default() -> Self {
        Self {
            samples: 320,
            epochs: 64,
            hidden_units: 12,
            learning_rate: 0.08,
            seed: 20260916,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingProgress {
    version: u8,
    sequence: usize,
    epoch: usize,
    epochs: usize,
    loss: f64,
}

struct Rng(u32);

impl Rng {
    // 与原前端 Mulberry32 一致，确保相同配置使用相同合成样本。
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut value = self.0;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        (value ^ (value >> 14)) as f64 / 4294967296.0
    }

    fn gaussian(&mut self) -> f64 {
        let first = self.next().max(1e-8);
        let second = self.next();
        (-2.0 * first.ln()).sqrt() * (2.0 * std::f64::consts::PI * second).cos()
    }

    fn shuffle<T>(&mut self, values: &mut [T]) {
        for index in (1..values.len()).rev() {
            let swap = (self.next() * (index + 1) as f64).floor() as usize;
            values.swap(index, swap);
        }
    }
}

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}
fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        min
    }
}
fn progress(channel: Option<&Channel<TrainingProgress>>, epoch: usize, epochs: usize, loss: f64) {
    if let Some(channel) = channel {
        let _ = channel.send(TrainingProgress {
            version: 1,
            sequence: epoch,
            epoch,
            epochs,
            loss,
        });
    }
}

#[derive(Clone, Serialize)]
struct PerceptionSample {
    split: &'static str,
    label: usize,
    features: Vec<f64>,
}

fn perception_samples(count: usize, rng: &mut Rng) -> Vec<PerceptionSample> {
    let centers = [
        [0.28, 0.57, 0.22, 0.46, 0.78],
        [0.70, 0.57, 0.68, 0.86, 0.64],
        [0.50, 0.18, 0.92, 0.96, 0.24],
    ];
    let noise = [0.075, 0.075, 0.08, 0.08, 0.09];
    let mut samples = Vec::with_capacity(count * centers.len());
    for (label, center) in centers.iter().enumerate() {
        for _ in 0..count {
            samples.push(PerceptionSample {
                split: "train",
                label,
                features: center
                    .iter()
                    .enumerate()
                    .map(|(index, value)| clamp(value + rng.gaussian() * noise[index], 0.0, 1.0))
                    .collect(),
            });
        }
    }
    samples
}

fn softmax(features: &[f64], weights: &[Vec<f64>], bias: &[f64]) -> Vec<f64> {
    let logits: Vec<f64> = weights
        .iter()
        .enumerate()
        .map(|(index, row)| {
            bias[index]
                + row
                    .iter()
                    .zip(features)
                    .map(|(weight, feature)| weight * feature)
                    .sum::<f64>()
        })
        .collect();
    let max = logits.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let values: Vec<f64> = logits.iter().map(|value| (value - max).exp()).collect();
    let total: f64 = values.iter().sum();
    values.iter().map(|value| value / total.max(1e-8)).collect()
}

fn argmax(values: &[f64]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map(|item| item.0)
        .unwrap_or(0)
}

fn perception_accuracy(samples: &[PerceptionSample], weights: &[Vec<f64>], bias: &[f64]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples
        .iter()
        .filter(|sample| argmax(&softmax(&sample.features, weights, bias)) == sample.label)
        .count() as f64
        / samples.len() as f64
}

fn run_perception(
    mut config: PerceptionConfig,
    channel: Option<&Channel<TrainingProgress>>,
) -> Value {
    config.samples_per_class = config.samples_per_class.clamp(30, 600);
    config.epochs = config.epochs.clamp(4, 160);
    config.learning_rate = clamp(config.learning_rate, 0.01, 1.0);
    let mut rng = Rng(config.seed as u32);
    let mut samples = perception_samples(config.samples_per_class, &mut rng);
    rng.shuffle(&mut samples);
    let validation_count = ((samples.len() as f64 * 0.2).round() as usize).max(1);
    let mut train = samples.split_off(validation_count);
    let mut validation = samples;
    for sample in &mut validation {
        sample.split = "validation";
    }
    let mut weights: Vec<Vec<f64>> = (0..3)
        .map(|_| (0..5).map(|_| (rng.next() - 0.5) * 0.04).collect())
        .collect();
    let mut bias = vec![0.0; 3];
    let mut history = Vec::with_capacity(config.epochs);
    for epoch in 1..=config.epochs {
        rng.shuffle(&mut train);
        let mut gradients = vec![vec![0.0; 5]; 3];
        let mut bias_gradient = [0.0; 3];
        let mut loss = 0.0;
        let mut correct = 0;
        for sample in &train {
            let probabilities = softmax(&sample.features, &weights, &bias);
            loss -= probabilities[sample.label].max(1e-8).ln();
            if argmax(&probabilities) == sample.label {
                correct += 1;
            }
            for class in 0..3 {
                let error = probabilities[class] - if class == sample.label { 1.0 } else { 0.0 };
                for feature in 0..5 {
                    gradients[class][feature] += error * sample.features[feature];
                }
                bias_gradient[class] += error;
            }
        }
        let scale = 1.0 / train.len() as f64;
        for class in 0..3 {
            for feature in 0..5 {
                weights[class][feature] -= config.learning_rate * gradients[class][feature] * scale;
            }
            bias[class] -= config.learning_rate * bias_gradient[class] * scale;
        }
        let loss = round4(loss * scale);
        history.push(json!({
            "epoch": epoch, "loss": loss, "accuracy": round4(correct as f64 * scale),
            "validationAccuracy": round4(perception_accuracy(&validation, &weights, &bias))
        }));
        progress(channel, epoch, config.epochs, loss);
    }
    let mut confusion = vec![vec![0_usize; 3]; 3];
    for sample in &validation {
        confusion[sample.label][argmax(&softmax(&sample.features, &weights, &bias))] += 1;
    }
    let final_loss = history
        .last()
        .and_then(|item| item["loss"].as_f64())
        .unwrap_or(0.0);
    train.extend(validation);
    json!({
        "algorithm": "softmax-regression", "classLabels": PERCEPTION_LABELS,
        "featureNames": PERCEPTION_FEATURES, "trainSamples": train.len() - validation_count,
        "validationSamples": validation_count, "history": history, "finalLoss": final_loss,
        "validationAccuracy": round4(perception_accuracy(&train[train.len()-validation_count..], &weights, &bias)),
        "confusion": confusion, "samples": train,
        "weights": weights.iter().map(|row| row.iter().map(|value| round4(*value)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "bias": bias.iter().map(|value| round4(*value)).collect::<Vec<_>>(), "config": config
    })
}

#[derive(Clone, Serialize)]
struct DecisionSample {
    split: &'static str,
    input: [f64; 5],
    target: [f64; 3],
}

fn decision_samples(count: usize, rng: &mut Rng) -> Vec<DecisionSample> {
    (0..count)
        .map(|_| {
            let dx = rng.next() * 2.0 - 1.0;
            let dy = rng.next() * 2.0 - 1.0;
            let dz = rng.next() * 1.4 - 0.55;
            let obstacle = rng.next();
            let phase = rng.next();
            let lift = if obstacle < 0.3 {
                (0.3 - obstacle) * 1.7
            } else {
                0.0
            };
            DecisionSample {
                split: "train",
                input: [dx, dy, dz, obstacle, phase],
                target: [
                    clamp(dx * 0.78 - dy * 0.08, -1.0, 1.0),
                    clamp(dy * 0.78 + dx * 0.08, -1.0, 1.0),
                    clamp(dz * 0.84 + 0.12 + lift + phase * 0.04, -1.0, 1.0),
                ],
            }
        })
        .collect()
}

struct Network {
    input_hidden: Vec<Vec<f64>>,
    hidden_bias: Vec<f64>,
    hidden_output: Vec<Vec<f64>>,
    output_bias: Vec<f64>,
}

fn forward(network: &Network, input: &[f64; 5]) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let pre: Vec<f64> = network
        .input_hidden
        .iter()
        .enumerate()
        .map(|(index, row)| {
            network.hidden_bias[index]
                + row
                    .iter()
                    .zip(input)
                    .map(|(weight, value)| weight * value)
                    .sum::<f64>()
        })
        .collect();
    let hidden: Vec<f64> = pre.iter().map(|value| value.max(0.0)).collect();
    let output: Vec<f64> = network
        .hidden_output
        .iter()
        .enumerate()
        .map(|(index, row)| {
            (network.output_bias[index]
                + row
                    .iter()
                    .zip(&hidden)
                    .map(|(weight, value)| weight * value)
                    .sum::<f64>())
            .tanh()
        })
        .collect();
    (pre, hidden, output)
}

fn mse(output: &[f64], target: &[f64; 3]) -> f64 {
    output
        .iter()
        .zip(target)
        .map(|(value, goal)| (value - goal).powi(2))
        .sum::<f64>()
        / 3.0
}

fn evaluate_decision(network: &Network, samples: &[DecisionSample]) -> (f64, f64, f64) {
    let mut mse_sum = 0.0;
    let mut success = 0;
    let mut safe = 0;
    for sample in samples {
        let output = forward(network, &sample.input).2;
        let error = (mse(&output, &sample.target) * 3.0).sqrt();
        mse_sum += mse(&output, &sample.target);
        if error <= 0.3 {
            success += 1;
        }
        if sample.input[3] >= 0.3 || output[2] >= 0.12 {
            safe += 1;
        }
    }
    let count = samples.len().max(1) as f64;
    (mse_sum / count, success as f64 / count, safe as f64 / count)
}

fn run_decision(mut config: DecisionConfig, channel: Option<&Channel<TrainingProgress>>) -> Value {
    config.samples = config.samples.clamp(80, 1600);
    config.epochs = config.epochs.clamp(8, 220);
    config.hidden_units = config.hidden_units.clamp(4, 48);
    config.learning_rate = clamp(config.learning_rate, 0.005, 0.4);
    let mut rng = Rng(config.seed as u32);
    let mut samples = decision_samples(config.samples, &mut rng);
    rng.shuffle(&mut samples);
    let validation_count = ((samples.len() as f64 * 0.2).round() as usize).max(1);
    let mut train = samples.split_off(validation_count);
    let mut validation = samples;
    for sample in &mut validation {
        sample.split = "validation";
    }
    let hidden = config.hidden_units;
    let input_scale = (6.0 / (5 + hidden) as f64).sqrt();
    let output_scale = (6.0 / (hidden + 3) as f64).sqrt();
    let mut network = Network {
        input_hidden: (0..hidden)
            .map(|_| {
                (0..5)
                    .map(|_| (rng.next() * 2.0 - 1.0) * input_scale)
                    .collect()
            })
            .collect(),
        hidden_bias: vec![0.0; hidden],
        hidden_output: (0..3)
            .map(|_| {
                (0..hidden)
                    .map(|_| (rng.next() * 2.0 - 1.0) * output_scale)
                    .collect()
            })
            .collect(),
        output_bias: vec![0.0; 3],
    };
    let mut history = Vec::with_capacity(config.epochs);
    for epoch in 1..=config.epochs {
        rng.shuffle(&mut train);
        let mut loss = 0.0;
        for sample in &train {
            let (pre, hidden_values, output) = forward(&network, &sample.input);
            loss += mse(&output, &sample.target);
            let output_delta: Vec<f64> = output
                .iter()
                .enumerate()
                .map(|(index, value)| (value - sample.target[index]) * (1.0 - value * value))
                .collect();
            let hidden_delta: Vec<f64> = pre
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    if *value <= 0.0 {
                        0.0
                    } else {
                        output_delta
                            .iter()
                            .enumerate()
                            .map(|(out, delta)| delta * network.hidden_output[out][index])
                            .sum()
                    }
                })
                .collect();
            for out in 0..3 {
                for index in 0..hidden {
                    network.hidden_output[out][index] -=
                        config.learning_rate * output_delta[out] * hidden_values[index];
                }
                network.output_bias[out] -= config.learning_rate * output_delta[out];
            }
            for index in 0..hidden {
                for feature in 0..5 {
                    network.input_hidden[index][feature] -=
                        config.learning_rate * hidden_delta[index] * sample.input[feature];
                }
                network.hidden_bias[index] -= config.learning_rate * hidden_delta[index];
            }
        }
        let (validation_mse, success, safety) = evaluate_decision(&network, &validation);
        let loss = round4(loss / train.len() as f64);
        history.push(
            json!({ "epoch": epoch, "loss": loss, "validationMse": round4(validation_mse),
            "successRate": round4(success), "safetyRate": round4(safety) }),
        );
        progress(channel, epoch, config.epochs, loss);
    }
    let (validation_mse, success, safety) = evaluate_decision(&network, &validation);
    let final_loss = history
        .last()
        .and_then(|item| item["loss"].as_f64())
        .unwrap_or(0.0);
    train.extend(validation);
    json!({
        "algorithm": "mlp-behavior-cloning", "featureNames": DECISION_FEATURES,
        "outputNames": DECISION_OUTPUTS, "trainSamples": train.len() - validation_count,
        "validationSamples": validation_count, "hiddenUnits": hidden,
        "history": history, "finalLoss": final_loss, "validationMse": round4(validation_mse),
        "validationSuccessRate": round4(success), "validationSafetyRate": round4(safety),
        "samples": train,
        "weightsInputHidden": network.input_hidden.iter().map(|row| row.iter().map(|value| round4(*value)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "biasHidden": network.hidden_bias.iter().map(|value| round4(*value)).collect::<Vec<_>>(),
        "weightsHiddenOutput": network.hidden_output.iter().map(|row| row.iter().map(|value| round4(*value)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "biasOutput": network.output_bias.iter().map(|value| round4(*value)).collect::<Vec<_>>(), "config": config
    })
}

#[tauri::command]
pub async fn train_perception(
    config: PerceptionConfig,
    progress: Channel<TrainingProgress>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_perception(config, Some(&progress)))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn train_decision(
    config: DecisionConfig,
    progress: Channel<TrainingProgress>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_decision(config, Some(&progress)))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perception_keeps_export_shape_and_is_deterministic() {
        let config = PerceptionConfig {
            samples_per_class: 30,
            epochs: 4,
            ..Default::default()
        };
        let first = run_perception(config.clone(), None);
        assert_eq!(first, run_perception(config, None));
        assert_eq!(first["samples"].as_array().unwrap().len(), 90);
        assert_eq!(first["history"].as_array().unwrap().len(), 4);
        assert_eq!(first["confusion"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn decision_keeps_export_shape_and_is_deterministic() {
        let config = DecisionConfig {
            samples: 80,
            epochs: 8,
            hidden_units: 4,
            ..Default::default()
        };
        let first = run_decision(config.clone(), None);
        assert_eq!(first, run_decision(config, None));
        assert_eq!(first["samples"].as_array().unwrap().len(), 80);
        assert_eq!(first["history"].as_array().unwrap().len(), 8);
        assert_eq!(first["weightsInputHidden"].as_array().unwrap().len(), 4);
    }
}
