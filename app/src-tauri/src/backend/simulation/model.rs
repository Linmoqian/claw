// URDF 运动链与 SI 正运动学。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use rapier3d::math::{Rotation, Vector};
use roxmltree::{Document, Node};
use std::collections::{HashMap, HashSet, VecDeque};

const SO100_URDF: &str = include_str!("../../../../frontend/public/models/so100/so100.urdf");
const PANTHERA_URDF: &str =
    include_str!("../../../../frontend/public/models/111/urdf/panthera_ht_ros_description.urdf");

#[derive(Clone)]
pub struct Joint {
    pub parent: String,
    pub child: String,
    pub origin: Vector,
    pub origin_rotation: Rotation,
    pub axis: Vector,
    pub lower: f32,
    pub upper: f32,
    pub active_index: Option<usize>,
}

pub struct RobotModel {
    pub id: String,
    pub joints: Vec<Joint>,
    pub active: Vec<usize>,
    pub root: String,
    pub ee_link: String,
}

#[derive(Clone)]
pub struct Pose {
    pub position: Vector,
    pub rotation: Rotation,
}

fn child<'a, 'input>(node: Node<'a, 'input>, tag: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|item| item.has_tag_name(tag))
}

fn vec3(raw: Option<&str>, fallback: Vector) -> Vector {
    let values = raw.and_then(|text| {
        text.split_whitespace()
            .map(str::parse::<f32>)
            .collect::<Result<Vec<_>, _>>()
            .ok()
    });
    match values {
        Some(values) if values.len() == 3 && values.iter().all(|value| value.is_finite()) => {
            Vector::new(values[0], values[1], values[2])
        }
        _ => fallback,
    }
}

impl RobotModel {
    pub fn builtin(id: &str) -> Result<Self, String> {
        let xml = match id {
            "so100" => SO100_URDF,
            "111" => PANTHERA_URDF,
            _ => return Err("未知机型".into()),
        };
        Self::parse(id, xml)
    }

    fn parse(id: &str, xml: &str) -> Result<Self, String> {
        let document = Document::parse(xml).map_err(|error| format!("URDF 解析失败：{error}"))?;
        let robot = document
            .descendants()
            .find(|node| node.has_tag_name("robot"))
            .ok_or("URDF 缺少 robot 根节点")?;
        let links = robot
            .children()
            .filter(|node| node.has_tag_name("link"))
            .filter_map(|node| node.attribute("name").map(str::to_string))
            .collect::<Vec<_>>();
        let mut joints = Vec::new();
        let mut active = Vec::new();
        for node in robot.children().filter(|node| node.has_tag_name("joint")) {
            let kind = node.attribute("type").unwrap_or("fixed");
            let is_active = kind == "revolute" || kind == "continuous";
            let origin = child(node, "origin");
            let position = vec3(origin.and_then(|item| item.attribute("xyz")), Vector::ZERO);
            let rpy = vec3(origin.and_then(|item| item.attribute("rpy")), Vector::ZERO);
            let axis = vec3(
                child(node, "axis").and_then(|item| item.attribute("xyz")),
                Vector::X,
            );
            let limits = child(node, "limit");
            let lower = limits
                .and_then(|item| item.attribute("lower"))
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(f32::NEG_INFINITY);
            let upper = limits
                .and_then(|item| item.attribute("upper"))
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(f32::INFINITY);
            let active_index = if is_active {
                let index = active.len();
                active.push(joints.len());
                Some(index)
            } else {
                None
            };
            joints.push(Joint {
                parent: child(node, "parent")
                    .and_then(|item| item.attribute("link"))
                    .unwrap_or("")
                    .to_string(),
                child: child(node, "child")
                    .and_then(|item| item.attribute("link"))
                    .unwrap_or("")
                    .to_string(),
                origin: position,
                origin_rotation: Rotation::from_rotation_z(rpy.z)
                    * Rotation::from_rotation_y(rpy.y)
                    * Rotation::from_rotation_x(rpy.x),
                axis,
                lower,
                upper,
                active_index,
            });
        }
        if active.is_empty() {
            return Err("URDF 中没有可动关节".into());
        }
        let children = joints
            .iter()
            .map(|joint| joint.child.as_str())
            .collect::<HashSet<_>>();
        let roots = links
            .iter()
            .filter(|name| !children.contains(name.as_str()))
            .collect::<Vec<_>>();
        let root = roots
            .iter()
            .find(|name| {
                !["world", "floor", "map"]
                    .iter()
                    .any(|prefix| name.to_lowercase().starts_with(prefix))
            })
            .copied()
            .or_else(|| roots.first().copied())
            .or_else(|| links.first())
            .ok_or("URDF 中没有 link")?
            .to_string();
        let mut queue = VecDeque::from([(root.clone(), 0_usize)]);
        let mut seen = HashSet::from([root.clone()]);
        let mut deepest = root.clone();
        let mut depth = 0;
        while let Some((parent, current_depth)) = queue.pop_front() {
            if current_depth > depth || (current_depth == depth && parent != root) {
                deepest = parent.clone();
                depth = current_depth;
            }
            for joint in joints.iter().filter(|joint| joint.parent == parent) {
                if seen.insert(joint.child.clone()) {
                    queue.push_back((joint.child.clone(), current_depth + 1));
                }
            }
        }
        let ee_link = joints
            .iter()
            .find(|joint| joint.child == deepest)
            .map(|joint| joint.parent.clone())
            .filter(|parent| parent != &root)
            .unwrap_or(deepest);
        Ok(Self {
            id: id.to_string(),
            joints,
            active,
            root,
            ee_link,
        })
    }

    pub fn joint_limits(&self) -> Vec<(f32, f32)> {
        self.active
            .iter()
            .map(|index| {
                let joint = &self.joints[*index];
                (joint.lower, joint.upper)
            })
            .collect()
    }

    pub fn tcp_pose(&self, joints_rad: &[f32]) -> Pose {
        let mut poses = HashMap::from([(
            self.root.clone(),
            Pose {
                position: Vector::ZERO,
                rotation: Rotation::IDENTITY,
            },
        )]);
        let mut queue = VecDeque::from([self.root.clone()]);
        while let Some(parent) = queue.pop_front() {
            let Some(parent_pose) = poses.get(&parent).cloned() else {
                continue;
            };
            for joint in self.joints.iter().filter(|joint| joint.parent == parent) {
                if poses.contains_key(&joint.child) {
                    continue;
                }
                let angle = joint
                    .active_index
                    .and_then(|index| joints_rad.get(index))
                    .copied()
                    .unwrap_or(0.0);
                let axis = if joint.axis.length_squared() > 1.0e-12 {
                    joint.axis.normalize()
                } else {
                    Vector::X
                };
                let rotation = parent_pose.rotation
                    * joint.origin_rotation
                    * Rotation::from_axis_angle(axis, angle);
                let position = parent_pose.position + parent_pose.rotation * joint.origin;
                poses.insert(joint.child.clone(), Pose { position, rotation });
                queue.push_back(joint.child.clone());
            }
        }
        poses.remove(&self.ee_link).unwrap_or(Pose {
            position: Vector::ZERO,
            rotation: Rotation::IDENTITY,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_models_have_finite_tcp_and_joint_limits() {
        for id in ["so100", "111"] {
            let model = RobotModel::builtin(id).unwrap();
            let pose = model.tcp_pose(&vec![0.0; model.active.len()]);
            assert!(pose.position.is_finite());
            assert!(model.joint_limits().iter().all(|(low, high)| low <= high));
        }
    }
}
