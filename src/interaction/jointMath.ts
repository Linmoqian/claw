/**
 * interaction 数学工具：射线×旋转平面求交 + 平面拖拽角。
 * 纯函数、无 React 依赖（可在 node 下做断言自检）。
 */
import { Plane, Vector3, type Ray } from "three";

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const TMP_PLANE = new Plane();

/** 平面参考基向量：u 卧于平面（优先世界 X 的投影），v = axis × u */
function planeBasis(axis: Vector3, outU: Vector3, outV: Vector3): void {
  const ref = Math.abs(axis.dot(X_AXIS)) > 0.92 ? Y_AXIS : X_AXIS;
  outU
    .copy(ref)
    .addScaledVector(axis, -ref.dot(axis))
    .normalize();
  outV.crossVectors(axis, outU).normalize();
}

/** 指针射线与旋转平面（过 center、法向 = axis）交点；不相交返回 null */
export function rayPlaneHit(
  ray: Ray,
  center: Vector3,
  axis: Vector3,
  target = new Vector3(),
): Vector3 | null {
  TMP_PLANE.setFromNormalAndCoplanarPoint(axis, center);
  return ray.intersectPlane(TMP_PLANE, target);
}

/** 点相对旋转中心的平面内拖拽角（rad；pm点位于平面内的夹角，用局部 scratch） */
export function planarAngle(
  center: Vector3,
  axis: Vector3,
  point: Vector3,
): number {
  const u = new Vector3();
  const v = new Vector3();
  planeBasis(axis, u, v);
  const d = new Vector3().copy(point).sub(center);
  return Math.atan2(d.dot(v), d.dot(u));
}

/** prev → curr 在旋转平面内的带符号转角（rad）：夹角 × 沿轴手性 */
export function signedDeltaRad(
  center: Vector3,
  axis: Vector3,
  prev: Vector3,
  curr: Vector3,
): number {
  const a = new Vector3().copy(prev).sub(center);
  const b = new Vector3().copy(curr).sub(center);
  const cross = new Vector3().crossVectors(a, b);
  const sign = cross.dot(axis) >= 0 ? 1 : -1;
  const sin = cross.length() * sign;
  const cos = a.dot(b);
  return Math.atan2(sin, cos);
}

/** 两点在旋转平面上的带符号转角（基于参考基的角度差） */
export function dragDeltaRad(
  center: Vector3,
  axis: Vector3,
  prev: Vector3,
  curr: Vector3,
): number {
  return planarAngle(center, axis, curr) - planarAngle(center, axis, prev);
}