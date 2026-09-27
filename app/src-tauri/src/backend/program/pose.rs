// 积木位姿运算使用米与弧度，角度仅在积木字段边界转换。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use serde_json::{json, Value};

#[derive(Clone)]
struct Pose {
    p: [f64; 3],
    q: [f64; 4],
    frame: String,
}

fn field(value: &Value, parent: &str, child: &str) -> Result<f64, String> {
    value[parent][child]
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("位姿字段无效：{parent}.{child}"))
}
fn parse(value: &Value) -> Result<Pose, String> {
    let q = [
        field(value, "quaternion", "x")?,
        field(value, "quaternion", "y")?,
        field(value, "quaternion", "z")?,
        field(value, "quaternion", "w")?,
    ];
    let length = q.iter().map(|value| value * value).sum::<f64>().sqrt();
    if length < 1e-9 {
        return Err("位姿四元数无效".into());
    }
    Ok(Pose {
        p: [
            field(value, "position", "x")?,
            field(value, "position", "y")?,
            field(value, "position", "z")?,
        ],
        q: q.map(|value| value / length),
        frame: value["frame"].as_str().unwrap_or("base").into(),
    })
}
fn encode(pose: Pose) -> Value {
    json!({ "position": { "x": pose.p[0], "y": pose.p[1], "z": pose.p[2] },
        "quaternion": { "x": pose.q[0], "y": pose.q[1], "z": pose.q[2], "w": pose.q[3] },
        "frame": pose.frame })
}
fn multiply(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let [x, y, z, w] = a;
    let [u, v, t, s] = b;
    [
        w * u + x * s + y * t - z * v,
        w * v - x * t + y * s + z * u,
        w * t + x * v - y * u + z * s,
        w * s - x * u - y * v - z * t,
    ]
}
fn inverse(q: [f64; 4]) -> [f64; 4] {
    [-q[0], -q[1], -q[2], q[3]]
}
fn rotate(q: [f64; 4], p: [f64; 3]) -> [f64; 3] {
    let result = multiply(multiply(q, [p[0], p[1], p[2], 0.0]), inverse(q));
    [result[0], result[1], result[2]]
}

pub fn make(x: f64, y: f64, z: f64, roll: f64, pitch: f64, yaw: f64) -> Value {
    let (sr, cr) = (roll.to_radians() / 2.0).sin_cos();
    let (sp, cp) = (pitch.to_radians() / 2.0).sin_cos();
    let (sy, cy) = (yaw.to_radians() / 2.0).sin_cos();
    encode(Pose {
        p: [x, y, z],
        q: [
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
            cr * cp * cy + sr * sp * sy,
        ],
        frame: "base".into(),
    })
}

pub fn property(value: &Value, name: &str) -> Result<Value, String> {
    let pose = parse(value)?;
    let [x, y, z, w] = pose.q;
    let result = match name {
        "X" => pose.p[0],
        "Y" => pose.p[1],
        "Z" => pose.p[2],
        "ROLL" => (2.0 * (w * x + y * z))
            .atan2(1.0 - 2.0 * (x * x + y * y))
            .to_degrees(),
        "PITCH" => (2.0 * (w * y - z * x)).clamp(-1.0, 1.0).asin().to_degrees(),
        "YAW" => (2.0 * (w * z + x * y))
            .atan2(1.0 - 2.0 * (y * y + z * z))
            .to_degrees(),
        _ => return Err("未知位姿属性".into()),
    };
    Ok(json!(result))
}

pub fn compose(parent: &Value, child: &Value) -> Result<Value, String> {
    let parent = parse(parent)?;
    let child = parse(child)?;
    let offset = rotate(parent.q, child.p);
    Ok(encode(Pose {
        p: [
            parent.p[0] + offset[0],
            parent.p[1] + offset[1],
            parent.p[2] + offset[2],
        ],
        q: multiply(parent.q, child.q),
        frame: parent.frame,
    }))
}

pub fn invert(value: &Value) -> Result<Value, String> {
    let pose = parse(value)?;
    let q = inverse(pose.q);
    let p = rotate(q, [-pose.p[0], -pose.p[1], -pose.p[2]]);
    Ok(encode(Pose {
        p,
        q,
        frame: pose.frame,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pose_round_trip_and_degree_boundary() {
        let value = make(1.0, 2.0, 3.0, 0.0, 0.0, 90.0);
        assert!((property(&value, "YAW").unwrap().as_f64().unwrap() - 90.0).abs() < 1e-9);
        let identity = compose(&value, &invert(&value).unwrap()).unwrap();
        for axis in ["x", "y", "z"] {
            assert!(identity["position"][axis].as_f64().unwrap().abs() < 1e-9);
        }
    }
}
