// TCP 阻尼逆运动学，所有输入输出使用 SI。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::model::{Pose, RobotModel};
use rapier3d::math::{Rotation, Vector};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IkSolution {
    pub joints_rad: Vec<f32>,
    pub iterations: usize,
    pub residual_position_m: f32,
    pub residual_rotation_rad: f32,
}

fn rotation_error(target: Rotation, current: Rotation) -> Vector {
    let error = target * current.inverse();
    let scale = if error.w < 0.0 { -2.0 } else { 2.0 };
    Vector::new(error.x * scale, error.y * scale, error.z * scale)
}

fn linear(mut a: Vec<Vec<f32>>, mut b: Vec<f32>) -> Option<Vec<f32>> {
    let count = b.len();
    for col in 0..count {
        let pivot = (col..count).max_by(|x, y| a[*x][col].abs().total_cmp(&a[*y][col].abs()))?;
        if a[pivot][col].abs() < 1e-10 {
            return None;
        }
        a.swap(col, pivot);
        b.swap(col, pivot);
        let diagonal = a[col][col];
        for row in 0..count {
            if row == col {
                continue;
            }
            let factor = a[row][col] / diagonal;
            for item in col..count {
                a[row][item] -= factor * a[col][item];
            }
            b[row] -= factor * b[col];
        }
    }
    Some((0..count).map(|index| b[index] / a[index][index]).collect())
}

fn chain(model: &RobotModel) -> HashSet<usize> {
    let mut child = model.ee_link.as_str();
    let mut active = HashSet::new();
    for _ in 0..model.joints.len() {
        let Some(joint) = model.joints.iter().find(|joint| joint.child == child) else {
            break;
        };
        if let Some(index) = joint.active_index {
            active.insert(index);
        }
        child = &joint.parent;
        if child == model.root {
            break;
        }
    }
    active
}

pub fn solve(model: &RobotModel, start: &[f32], target: &Pose) -> Result<IkSolution, String> {
    let count = model.active.len();
    if start.len() != count || !target.position.is_finite() || !target.rotation.is_finite() {
        return Err("TCP 位姿或当前关节状态无效".into());
    }
    let limits = model.joint_limits();
    let chain = chain(model);
    let mut joints = start.to_vec();
    for (index, angle) in joints.iter_mut().enumerate() {
        *angle = angle.clamp(limits[index].0, limits[index].1);
    }
    let (mut residual_position, mut residual_rotation) = (f32::INFINITY, f32::INFINITY);
    let mut iterations = 0;
    for iteration in 0..480 {
        iterations = iteration + 1;
        let actual = model.tcp_pose(&joints);
        let mut position_error = target.position - actual.position;
        let mut orientation_error = rotation_error(target.rotation, actual.rotation);
        residual_position = position_error.length();
        residual_rotation = orientation_error.length();
        if residual_position < 0.0005 && residual_rotation < 0.002 {
            return Ok(IkSolution {
                joints_rad: joints,
                iterations,
                residual_position_m: residual_position,
                residual_rotation_rad: residual_rotation,
            });
        }
        if residual_position > 0.05 {
            position_error *= 0.05 / residual_position;
        }
        if residual_rotation > 0.3 {
            orientation_error *= 0.3 / residual_rotation;
        }
        let error = [
            position_error.x,
            position_error.y,
            position_error.z,
            orientation_error.x,
            orientation_error.y,
            orientation_error.z,
        ];
        let mut jacobian = vec![[0.0_f32; 6]; count];
        for index in 0..count {
            if !chain.contains(&index) {
                continue;
            }
            let mut perturbed = joints.clone();
            perturbed[index] += 0.001;
            let next = model.tcp_pose(&perturbed);
            let linear = (next.position - actual.position) / 0.001;
            let angular = rotation_error(next.rotation, actual.rotation) / 0.001;
            jacobian[index] = [
                linear.x, linear.y, linear.z, angular.x, angular.y, angular.z,
            ];
        }
        let damping =
            0.04 * (12.0 * (residual_position + 0.15 * residual_rotation)).clamp(0.15, 4.0);
        let mut a = vec![vec![0.0; count]; count];
        let mut b = vec![0.0; count];
        for row in 0..count {
            for col in 0..count {
                a[row][col] = jacobian[row]
                    .iter()
                    .zip(&jacobian[col])
                    .map(|(x, y)| x * y)
                    .sum();
            }
            a[row][row] += damping * damping;
            b[row] = jacobian[row].iter().zip(error).map(|(x, y)| x * y).sum();
        }
        let delta = linear(a, b).ok_or("TCP 逆运动学矩阵不可解")?;
        let mut moved = 0.0;
        for index in 0..count {
            let next = (joints[index] + delta[index]).clamp(limits[index].0, limits[index].1);
            moved += (next - joints[index]).abs();
            joints[index] = next;
        }
        if moved < 1e-8 {
            break;
        }
    }
    Err(format!("TCP 逆运动学未收敛：位置 {residual_position:.4} m，姿态 {residual_rotation:.4} rad，迭代 {iterations} 次"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reaches_nearby_pose_without_moving_gripper() {
        let model = RobotModel::builtin("so100").unwrap();
        let mut known = vec![0.0; model.active.len()];
        known[0] = 5.0_f32.to_radians();
        known[1] = 5.0_f32.to_radians();
        let target = model.tcp_pose(&known);
        let result = solve(&model, &vec![0.0; known.len()], &target).unwrap();
        assert!((model.tcp_pose(&result.joints_rad).position - target.position).length() < 0.0005);
        assert!(result.joints_rad.last().unwrap().abs() < 1e-6);
    }
}
