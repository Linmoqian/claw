// 对抗训练最小最大离线基线。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::{clamp, progress, round4, Rng, TrainingProgress};
use crate::backend::simulation::{collision, model::RobotModel, physics::PhysicsScene};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

const CUP_TARGET: [f64; 3] = [-0.3, -0.23, 0.14];
const MACHINE_CENTER: [f64; 3] = [0.3, -0.22, 0.16];
const MAX_POLICY_OFFSET_DEG: f64 = 24.0;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AdversarialConfig {
    epochs: usize,
    horizon_steps: usize,
    adversary_population: usize,
    perturbation_deg: f64,
    learning_rate: f64,
    finite_difference_deg: f64,
    seed: i64,
    #[serde(skip_serializing)]
    trajectory: Option<Vec<TrajectoryPoint>>,
}

impl Default for AdversarialConfig {
    fn default() -> Self {
        Self {
            epochs: 24,
            horizon_steps: 18,
            adversary_population: 8,
            perturbation_deg: 8.0,
            learning_rate: 0.42,
            finite_difference_deg: 1.5,
            seed: 20260915,
            trajectory: None,
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryPoint {
    time: f64,
    q_deg: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Episode {
    reward: f64,
    goal_reward: f64,
    safety_penalty: f64,
    tracking_penalty: f64,
    smoothness_penalty: f64,
    collision_count: usize,
    machine_near_misses: usize,
    min_obstacle_distance: f64,
    min_safety_distance: Option<f64>,
    perturbation_deg: Vec<f64>,
    final_goal_distance: f64,
}

fn built_in_trajectory() -> Vec<TrajectoryPoint> {
    vec![
        TrajectoryPoint {
            time: 0.0,
            q_deg: vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        },
        TrajectoryPoint {
            time: 2.5,
            q_deg: vec![60.0, 80.0, -90.0, -30.0, 60.0, 25.0],
        },
        TrajectoryPoint {
            time: 5.0,
            q_deg: vec![-60.0, 60.0, -60.0, 40.0, -60.0, 50.0],
        },
        TrajectoryPoint {
            time: 7.5,
            q_deg: vec![0.0, 110.0, -120.0, -50.0, 0.0, 35.0],
        },
        TrajectoryPoint {
            time: 10.0,
            q_deg: vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        },
    ]
}

fn sample_trajectory(points: &[TrajectoryPoint], time: f64) -> Vec<f64> {
    let total = points.last().map(|point| point.time).unwrap_or(0.0);
    if total <= 0.0 {
        return points[0].q_deg.clone();
    }
    let time = time.rem_euclid(total);
    let index = points
        .windows(2)
        .position(|pair| time >= pair[0].time && time <= pair[1].time)
        .unwrap_or(points.len() - 2);
    let from = &points[index];
    let to = &points[index + 1];
    let duration = to.time - from.time;
    let ratio = if duration > 0.0 {
        (time - from.time) / duration
    } else {
        1.0
    };
    from.q_deg
        .iter()
        .zip(&to.q_deg)
        .map(|(a, b)| a + (b - a) * ratio)
        .collect()
}

fn vector_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}
fn vector_distance(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(left, right)| (left - right).powi(2))
        .sum::<f64>()
        .sqrt()
}
fn distance(point: [f64; 3], target: [f64; 3]) -> f64 {
    point
        .iter()
        .zip(target)
        .map(|(a, b)| (a - b).powi(2))
        .sum::<f64>()
        .sqrt()
}

fn evaluate_episode(
    model: &RobotModel,
    props: &[crate::backend::simulation::physics::PropPose],
    trajectory: &[TrajectoryPoint],
    bias_deg: &[f64],
    perturbation_deg: &[f64],
    steps: usize,
) -> Episode {
    let total_time = trajectory
        .last()
        .map(|point| point.time)
        .unwrap_or(1.0)
        .max(0.001);
    let goal_start = (steps as f64 * 0.72).floor().max(1.0) as usize;
    let mut goal_error = 0.0;
    let mut goal_samples = 0;
    let mut machine_penalty = 0.0;
    let mut machine_near_misses = 0;
    let mut collision_count = 0;
    let mut smoothness_penalty = 0.0;
    let mut min_obstacle_distance = f64::INFINITY;
    let mut min_safety_distance = f64::INFINITY;
    let mut previous: Option<Vec<f64>> = None;
    let mut final_goal_distance = f64::INFINITY;
    for step in 0..steps {
        let time = step as f64 / (steps - 1).max(1) as f64 * total_time;
        let nominal = sample_trajectory(trajectory, time);
        let action: Vec<f64> = nominal
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let phase = 0.82 + 0.18 * ((step + 1) as f64 * 0.77 + index as f64 * 0.53).sin();
                let target = value + bias_deg[index] + perturbation_deg[index] * phase;
                let joint = &model.joints[model.active[index]];
                clamp(
                    target,
                    joint.lower.to_degrees() as f64,
                    joint.upper.to_degrees() as f64,
                )
            })
            .collect();
        let radians: Vec<f32> = action
            .iter()
            .map(|value| value.to_radians() as f32)
            .collect();
        let status = collision::evaluate(model, &radians, props);
        let tcp = model.tcp_pose(&radians).position;
        let tcp = [tcp.x as f64, tcp.y as f64, tcp.z as f64];
        let cup_distance = distance(tcp, CUP_TARGET);
        let machine_distance = distance(tcp, MACHINE_CENTER);
        let cup_clearance = (cup_distance - 0.045).max(0.0);
        let machine_clearance = (machine_distance - 0.14).max(0.0);
        min_obstacle_distance = min_obstacle_distance
            .min(cup_clearance)
            .min(machine_clearance);
        if machine_clearance < 0.075 {
            machine_near_misses += 1;
            machine_penalty += (0.075 - machine_clearance) / 0.075;
        }
        if step >= goal_start {
            goal_error += cup_distance;
            goal_samples += 1;
            final_goal_distance = cup_distance;
        }
        if status.rejected() {
            collision_count += 1;
        }
        if let Some(clearance) = status.safety_distance {
            min_safety_distance = min_safety_distance.min(clearance as f64);
        }
        if let Some(ref prior) = previous {
            smoothness_penalty += vector_distance(prior, &action) / action.len().max(1) as f64;
        }
        previous = Some(action);
    }
    let goal_error = if goal_samples > 0 {
        goal_error / goal_samples as f64
    } else {
        1.0
    };
    let goal_reward = clamp(1.0 - goal_error / 0.38, 0.0, 1.0);
    let safety_penalty = collision_count as f64 * 1.6 + machine_penalty;
    let tracking_penalty = vector_norm(bias_deg) / bias_deg.len().max(1) as f64 / 32.0;
    let reward = goal_reward * 4.2
        - safety_penalty * 2.4
        - tracking_penalty * 0.9
        - smoothness_penalty * 0.015;
    Episode {
        reward,
        goal_reward,
        safety_penalty,
        tracking_penalty,
        smoothness_penalty,
        collision_count,
        machine_near_misses,
        min_obstacle_distance: if min_obstacle_distance.is_finite() {
            min_obstacle_distance
        } else {
            0.0
        },
        min_safety_distance: min_safety_distance
            .is_finite()
            .then_some(min_safety_distance),
        perturbation_deg: perturbation_deg.to_vec(),
        final_goal_distance: if final_goal_distance.is_finite() {
            final_goal_distance
        } else {
            1.0
        },
    }
}

fn disturbances(count: usize, population: usize, amplitude: f64, rng: &mut Rng) -> Vec<Vec<f64>> {
    let mut candidates = vec![vec![0.0; count]];
    for _ in 1..population {
        candidates.push(
            (0..count)
                .map(|_| {
                    let sign = if rng.next() > 0.5 { 1.0 } else { -1.0 };
                    sign * amplitude * (0.35 + rng.next() * 0.65)
                })
                .collect(),
        );
    }
    candidates
}

fn worst_episode(
    model: &RobotModel,
    props: &[crate::backend::simulation::physics::PropPose],
    trajectory: &[TrajectoryPoint],
    bias: &[f64],
    candidates: &[Vec<f64>],
    steps: usize,
) -> Episode {
    candidates
        .iter()
        .map(|candidate| evaluate_episode(model, props, trajectory, bias, candidate, steps))
        .min_by(|a, b| a.reward.total_cmp(&b.reward))
        .expect("扰动候选不为空")
}

fn run(
    mut config: AdversarialConfig,
    robot_id: &str,
    channel: Option<&Channel<TrainingProgress>>,
) -> Result<Value, String> {
    config.epochs = config.epochs.clamp(1, 200);
    config.horizon_steps = config.horizon_steps.clamp(6, 64);
    config.adversary_population = config.adversary_population.clamp(2, 32);
    config.perturbation_deg = clamp(config.perturbation_deg, 0.0, 30.0);
    config.learning_rate = clamp(config.learning_rate, 0.01, 2.0);
    config.finite_difference_deg = clamp(config.finite_difference_deg, 0.1, 8.0);
    let model = RobotModel::builtin(robot_id)?;
    let trajectory = config.trajectory.take().unwrap_or_else(|| {
        let mut points = built_in_trajectory();
        for point in &mut points {
            point.q_deg.resize(model.active.len(), 0.0);
            point.q_deg.truncate(model.active.len());
        }
        points
    });
    if trajectory.len() < 2
        || trajectory[0].time != 0.0
        || trajectory.iter().any(|point| {
            point.q_deg.len() != model.active.len()
                || !point.time.is_finite()
                || point.q_deg.iter().any(|value| !value.is_finite())
        })
        || trajectory
            .windows(2)
            .any(|pair| pair[1].time <= pair[0].time)
    {
        return Err("训练轨迹缺少有效的递增时间或关节角度".into());
    }
    let props = PhysicsScene::new().props();
    let count = model.active.len();
    let zero = vec![0.0; count];
    let mut bias = zero.clone();
    let mut rng = Rng(config.seed as u32);
    let mut history = Vec::with_capacity(config.epochs);
    let mut best_worst = f64::NEG_INFINITY;
    let mut final_episode = evaluate_episode(
        &model,
        &props,
        &trajectory,
        &bias,
        &zero,
        config.horizon_steps,
    );
    for epoch in 1..=config.epochs {
        let candidates = disturbances(
            count,
            config.adversary_population,
            config.perturbation_deg,
            &mut rng,
        );
        let worst = worst_episode(
            &model,
            &props,
            &trajectory,
            &bias,
            &candidates,
            config.horizon_steps,
        );
        let gradient: Vec<f64> = (0..count)
            .map(|index| {
                let mut plus = bias.clone();
                let mut minus = bias.clone();
                plus[index] += config.finite_difference_deg;
                minus[index] -= config.finite_difference_deg;
                let positive = evaluate_episode(
                    &model,
                    &props,
                    &trajectory,
                    &plus,
                    &worst.perturbation_deg,
                    config.horizon_steps,
                )
                .reward;
                let negative = evaluate_episode(
                    &model,
                    &props,
                    &trajectory,
                    &minus,
                    &worst.perturbation_deg,
                    config.horizon_steps,
                )
                .reward;
                clamp(
                    (positive - negative) / (2.0 * config.finite_difference_deg),
                    -4.0,
                    4.0,
                )
            })
            .collect();
        for index in 0..count {
            bias[index] = clamp(
                bias[index] + config.learning_rate * gradient[index],
                -MAX_POLICY_OFFSET_DEG,
                MAX_POLICY_OFFSET_DEG,
            );
        }
        final_episode = worst_episode(
            &model,
            &props,
            &trajectory,
            &bias,
            &candidates,
            config.horizon_steps,
        );
        best_worst = best_worst.max(final_episode.reward);
        let nominal = evaluate_episode(
            &model,
            &props,
            &trajectory,
            &bias,
            &zero,
            config.horizon_steps,
        );
        history.push(json!({
            "epoch": epoch, "nominalReward": round4(nominal.reward), "worstReward": round4(final_episode.reward),
            "goalReward": round4(final_episode.goal_reward), "collisionCount": final_episode.collision_count,
            "machineNearMisses": final_episode.machine_near_misses,
            "adversaryNormDeg": round4(vector_norm(&final_episode.perturbation_deg)),
            "policyOffsetNormDeg": round4(vector_norm(&bias))
        }));
        progress(channel, epoch, config.epochs, final_episode.reward);
    }
    Ok(json!({ "policy": { "biasDeg": bias }, "history": history,
        "bestWorstReward": round4(best_worst), "finalEpisode": final_episode, "config": config }))
}

#[tauri::command]
pub async fn train_adversarial(
    robot_id: String,
    config: AdversarialConfig,
    progress: Channel<TrainingProgress>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run(config, &robot_id, Some(&progress)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adversarial_result_is_reproducible_and_finite() {
        let config = AdversarialConfig {
            epochs: 2,
            horizon_steps: 6,
            adversary_population: 2,
            ..Default::default()
        };
        let first = run(config.clone(), "so100", None).unwrap();
        assert_eq!(first, run(config, "so100", None).unwrap());
        assert_eq!(first["history"].as_array().unwrap().len(), 2);
        assert_eq!(first["policy"]["biasDeg"].as_array().unwrap().len(), 6);
        assert!(first["bestWorstReward"].as_f64().unwrap().is_finite());
        let other = run(
            AdversarialConfig {
                epochs: 1,
                horizon_steps: 6,
                adversary_population: 2,
                ..Default::default()
            },
            "111",
            None,
        )
        .unwrap();
        assert!(!other["policy"]["biasDeg"].as_array().unwrap().is_empty());
    }
}
