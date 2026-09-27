// Rapier 场景物理；渲染层只消费位姿。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use rapier3d::prelude::*;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct PropPose {
    pub id: &'static str,
    pub position_m: [f32; 3],
    pub rotation_xyzw: [f32; 4],
}

pub struct PhysicsScene {
    pipeline: PhysicsPipeline,
    gravity: Vector,
    integration: IntegrationParameters,
    islands: IslandManager,
    broad_phase: DefaultBroadPhase,
    narrow_phase: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    impulse_joints: ImpulseJointSet,
    multibody_joints: MultibodyJointSet,
    soft_bodies: SoftBodySet,
    ccd: CCDSolver,
    cup: RigidBodyHandle,
    machine: RigidBodyHandle,
    tcp: RigidBodyHandle,
}

impl PhysicsScene {
    pub fn new() -> Self {
        let mut bodies = RigidBodySet::new();
        let mut colliders = ColliderSet::new();
        let ground =
            bodies.insert(RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.01, 0.0)));
        colliders.insert_with_parent(
            ColliderBuilder::cuboid(6.0, 0.01, 6.0).friction(1.0),
            ground,
            &mut bodies,
        );

        let machine = bodies.insert(
            RigidBodyBuilder::dynamic()
                .translation(Vector::new(0.3, 0.0, 0.22))
                .linear_damping(1.4)
                .angular_damping(1.8),
        );
        colliders.insert_with_parent(
            ColliderBuilder::cuboid(0.09, 0.125, 0.08)
                .translation(Vector::new(0.0, 0.125, 0.0))
                .friction(0.92),
            machine,
            &mut bodies,
        );

        let cup = bodies.insert(
            RigidBodyBuilder::dynamic()
                .translation(Vector::new(-0.3, 0.0, 0.23))
                .can_sleep(false),
        );
        colliders.insert_with_parent(
            ColliderBuilder::cylinder(0.055, 0.06)
                .translation(Vector::new(0.0, 0.063, 0.0))
                .friction(0.82)
                .restitution(0.12),
            cup,
            &mut bodies,
        );

        let tcp = bodies.insert(
            RigidBodyBuilder::kinematic_position_based().translation(Vector::new(0.0, 0.15, 0.0)),
        );
        colliders.insert_with_parent(
            ColliderBuilder::ball(0.045)
                .friction(0.82)
                .restitution(0.12),
            tcp,
            &mut bodies,
        );

        Self {
            pipeline: PhysicsPipeline::new(),
            gravity: Vector::new(0.0, -9.81, 0.0),
            integration: IntegrationParameters::default(),
            islands: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            bodies,
            colliders,
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            soft_bodies: SoftBodySet::new(),
            ccd: CCDSolver::new(),
            cup,
            machine,
            tcp,
        }
    }

    pub fn step(&mut self, dt_s: f32, tcp_position_m: [f32; 3]) {
        self.integration.dt = dt_s.clamp(0.001, 0.05);
        if tcp_position_m.iter().all(|value| value.is_finite()) {
            // 前端坐标是 URDF Z-up；Rapier 与 Three 使用 Y-up。
            let position = Vector::new(
                tcp_position_m[0],
                tcp_position_m[2] + 0.062,
                -tcp_position_m[1],
            );
            self.bodies[self.tcp].set_next_kinematic_translation(position);
        }
        self.pipeline.step(
            self.gravity,
            &self.integration,
            &mut self.islands,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.impulse_joints,
            &mut self.multibody_joints,
            &mut self.soft_bodies,
            &mut self.ccd,
            &(),
            &(),
        );
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    pub fn props(&self) -> Vec<PropPose> {
        let cup = &self.bodies[self.cup];
        let position = cup.translation();
        let rotation = cup.rotation();
        let machine = &self.bodies[self.machine];
        let machine_position = machine.translation();
        let machine_rotation = machine.rotation();
        vec![
            PropPose {
                id: "cup",
                position_m: [position.x, position.y, position.z],
                rotation_xyzw: [rotation.x, rotation.y, rotation.z, rotation.w],
            },
            PropPose {
                id: "coffee-machine",
                position_m: [machine_position.x, machine_position.y, machine_position.z],
                rotation_xyzw: [
                    machine_rotation.x,
                    machine_rotation.y,
                    machine_rotation.z,
                    machine_rotation.w,
                ],
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cup_rests_above_ground_after_falling() {
        let mut scene = PhysicsScene::new();
        for _ in 0..100 {
            scene.step(0.02, [0.0, -1.0, 1.0]);
        }
        let cup = &scene.props()[0];
        assert!(cup.position_m[1] > -0.01 && cup.position_m[1] < 0.1);
    }
}
