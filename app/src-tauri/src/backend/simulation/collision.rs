// 关节构型的解析碰撞门禁与环境限速。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::model::RobotModel;
use super::physics::PropPose;
use rapier3d::math::{Rotation, Vector};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollisionStatus {
    pub self_collision: bool,
    pub tier: &'static str,
    pub safety_distance: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_object_id: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_object_label: Option<&'static str>,
}

impl CollisionStatus {
    pub fn rejected(&self) -> bool {
        self.self_collision || self.tier == "stop"
    }

    pub fn speed_scale(&self) -> f32 {
        match self.tier {
            "warn" => 0.5,
            "slow" => 0.2,
            "stop" => 0.0,
            _ => 1.0,
        }
    }
}

struct Segment {
    name: String,
    p0: Vector,
    p1: Vector,
    self_radius: f32,
    env_radius: f32,
    depth: usize,
}

fn distance_sq(a0: Vector, a1: Vector, b0: Vector, b1: Vector) -> f32 {
    let d1 = a1 - a0;
    let d2 = b1 - b0;
    let r = a0 - b0;
    let a = d1.length_squared();
    let e = d2.length_squared();
    let f = d2.dot(r);
    let (mut s, mut t) = (0.0, 0.0);
    if a <= 1.0e-12 && e <= 1.0e-12 {
        return r.length_squared();
    }
    if a <= 1.0e-12 {
        t = (f / e).clamp(0.0, 1.0);
    } else {
        let c = d1.dot(r);
        if e <= 1.0e-12 {
            s = (-c / a).clamp(0.0, 1.0);
        } else {
            let b = d1.dot(d2);
            let denominator = a * e - b * b;
            s = if denominator > 1.0e-12 {
                ((b * f - c * e) / denominator).clamp(0.0, 1.0)
            } else {
                0.0
            };
            t = (b * s + f) / e;
            if t < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            }
        }
    }
    (r + d1 * s - d2 * t).length_squared()
}

fn chain_distance(a: &str, b: &str, parent: &HashMap<String, String>) -> Option<usize> {
    let mut left = HashMap::from([(a.to_string(), 0_usize)]);
    let mut current = a;
    for depth in 1..=3 {
        let Some(next) = parent.get(current) else {
            break;
        };
        left.insert(next.clone(), depth);
        current = next;
    }
    let mut current = b;
    if let Some(depth) = left.get(current) {
        return Some(*depth);
    }
    for depth in 1..=3 {
        let Some(next) = parent.get(current) else {
            break;
        };
        if let Some(left_depth) = left.get(next) {
            return Some(left_depth + depth);
        }
        current = next;
    }
    None
}

fn robot_segments(model: &RobotModel, angles: &[f32]) -> (Vec<Segment>, HashMap<String, String>) {
    let poses = model.link_poses(angles);
    let mut queue = VecDeque::from([(model.root.clone(), 0_usize, 0_usize)]);
    let mut seen = HashSet::from([model.root.clone()]);
    let mut arm_depth = HashMap::new();
    let mut parent = HashMap::new();
    while let Some((link, depth, active_count)) = queue.pop_front() {
        if active_count > 0 {
            arm_depth.insert(link.clone(), depth);
        }
        for joint in model.joints.iter().filter(|joint| joint.parent == link) {
            if seen.insert(joint.child.clone()) {
                parent.insert(joint.child.clone(), link.clone());
                queue.push_back((
                    joint.child.clone(),
                    depth + 1,
                    active_count + usize::from(joint.active_index.is_some()),
                ));
            }
        }
    }
    let mut segments = Vec::new();
    for (name, depth) in arm_depth {
        let Some(pose) = poses.get(&name) else {
            continue;
        };
        let end = model.joints.iter().find(|joint| joint.parent == name);
        let local = end.map_or(Vector::ZERO, |joint| joint.origin);
        let leaf = end.is_none();
        segments.push(Segment {
            name,
            p0: pose.position,
            p1: pose.position + pose.rotation * local,
            self_radius: if leaf { 0.024 } else { 0.022 },
            env_radius: if leaf { 0.03 } else { 0.028 },
            depth,
        });
    }
    (segments, parent)
}

fn prop_capsule(prop: &PropPose) -> Option<(Vector, Vector, f32, &'static str)> {
    let (local0, local1, radius, label) = match prop.id {
        "cup" => (
            Vector::new(0.0, 0.01, 0.0),
            Vector::new(0.0, 0.11, 0.0),
            0.06,
            "水杯",
        ),
        "coffee-machine" => (
            Vector::new(0.0, 0.01, 0.025),
            Vector::new(0.0, 0.335, 0.025),
            0.145,
            "咖啡机",
        ),
        _ => return None,
    };
    let [x, y, z, w] = prop.rotation_xyzw;
    let rotation = Rotation::from_xyzw(x, y, z, w);
    let position = Vector::from_array(prop.position_m);
    let to_urdf = |point: Vector| Vector::new(point.x, -point.z, point.y);
    Some((
        to_urdf(position + rotation * local0),
        to_urdf(position + rotation * local1),
        radius,
        label,
    ))
}

pub fn evaluate(model: &RobotModel, angles: &[f32], props: &[PropPose]) -> CollisionStatus {
    let (segments, parent) = robot_segments(model, angles);
    let max_depth = segments
        .iter()
        .map(|segment| segment.depth)
        .max()
        .unwrap_or(0);
    let minimum_depth = max_depth.div_ceil(2);
    let mut nearest = f32::INFINITY;
    for segment in &segments {
        if segment.depth < minimum_depth {
            continue;
        }
        nearest = nearest.min(segment.p0.z.min(segment.p1.z) - segment.env_radius);
    }
    let mut object = None;
    for prop in props {
        let Some((p0, p1, radius, label)) = prop_capsule(prop) else {
            continue;
        };
        for segment in &segments {
            let clearance =
                distance_sq(segment.p0, segment.p1, p0, p1).sqrt() - segment.env_radius - radius;
            if clearance <= nearest {
                nearest = clearance;
                object = Some((prop.id, label));
            }
        }
    }
    let mut self_collision = false;
    for left in 0..segments.len() {
        for right in left + 1..segments.len() {
            if chain_distance(&segments[left].name, &segments[right].name, &parent)
                .is_some_and(|distance| distance <= 3)
            {
                continue;
            }
            let radius = segments[left].self_radius + segments[right].self_radius;
            if distance_sq(
                segments[left].p0,
                segments[left].p1,
                segments[right].p0,
                segments[right].p1,
            ) < radius * radius
            {
                self_collision = true;
                break;
            }
        }
        if self_collision {
            break;
        }
    }
    CollisionStatus {
        self_collision,
        tier: if nearest < 0.02 {
            "stop"
        } else if nearest < 0.05 {
            "slow"
        } else if nearest < 0.1 {
            "warn"
        } else {
            "clear"
        },
        safety_distance: nearest.is_finite().then_some(nearest),
        environment_object_id: object.map(|item| item.0),
        environment_object_label: object.map(|item| item.1),
    }
}

pub fn evaluate_swept(
    model: &RobotModel,
    start: &[f32],
    goal: &[f32],
    props: &[PropPose],
) -> CollisionStatus {
    let mut worst = evaluate(model, goal, props);
    for step in 1..4 {
        let factor = step as f32 / 4.0;
        let values = start
            .iter()
            .zip(goal)
            .map(|(from, to)| from + (to - from) * factor)
            .collect::<Vec<_>>();
        let status = evaluate(model, &values, props);
        if status.rejected() {
            return status;
        }
        if status.speed_scale() < worst.speed_scale() {
            worst = status;
        }
    }
    worst
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::simulation::physics::PhysicsScene;

    #[test]
    fn distance_between_crossing_segments_is_zero() {
        let distance = distance_sq(
            Vector::new(-1.0, 0.0, 0.0),
            Vector::new(1.0, 0.0, 0.0),
            Vector::new(0.0, -1.0, 0.0),
            Vector::new(0.0, 1.0, 0.0),
        );
        assert!(distance < 1.0e-8);
    }

    #[test]
    fn builtin_model_reports_clear_zero_and_rejects_swept_obstacle() {
        let model = RobotModel::builtin("so100").unwrap();
        let zero = vec![0.0; model.active.len()];
        let props = PhysicsScene::new().props();
        let initial = evaluate(&model, &zero, &props);
        assert!(!initial.rejected(), "零位不能被误判为碰撞");
        let mut unsafe_pose = false;
        let mut nearest = f32::INFINITY;
        for shoulder in [0.0_f32, 30.0, 60.0, 90.0, 120.0, 150.0, 180.0] {
            for elbow in [-180.0_f32, -150.0, -120.0, -90.0, -60.0, -30.0, 0.0] {
                for wrist in [-120.0_f32, -60.0, 0.0, 60.0] {
                    let angles = [0.0_f32, shoulder, elbow, wrist, 0.0, 0.0].map(f32::to_radians);
                    let status = evaluate_swept(&model, &zero, &angles, &props);
                    nearest = nearest.min(status.safety_distance.unwrap_or(f32::INFINITY));
                    unsafe_pose |= status.rejected();
                }
            }
        }
        assert!(nearest < 0.02);
        assert!(unsafe_pose, "至少一个下垂构型应触发碰撞门禁");
    }
}
