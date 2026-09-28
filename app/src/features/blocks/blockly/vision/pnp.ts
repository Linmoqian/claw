/**
 * 四共面点 PnP：由目标宽度构建 3D 点，单应分解得到 target-in-camera 位姿。
 * `opencv-ts` 当前类型未暴露 solvePnP，因此此处保留可静态验证的纯 TS 实现。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { toQuaternionValue } from "../poseMath";
import type { Detection, PoseValue } from "../types";

export interface PnpIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

type Matrix3Data = number[][];

function inverse3(m: Matrix3Data): Matrix3Data | null {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
    ],
  ];
}

function asThreeMatrix(value: Matrix3Data): Matrix3 {
  return new Matrix3().set(
    value[0][0],
    value[0][1],
    value[0][2],
    value[1][0],
    value[1][1],
    value[1][2],
    value[2][0],
    value[2][1],
    value[2][2],
  );
}

function matrixToQuaternion(matrix: Matrix3Data): Quaternion {
  const m = new Matrix4().set(
    matrix[0][0],
    matrix[0][1],
    matrix[0][2],
    0,
    matrix[1][0],
    matrix[1][1],
    matrix[1][2],
    0,
    matrix[2][0],
    matrix[2][1],
    matrix[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  return new Quaternion().setFromRotationMatrix(m);
}

/** 像素角点顺序固定为左上、右上、右下、左下。 */
export function solveCoplanarPnp(
  detection: Detection,
  targetWidthM: number,
  intrinsics: PnpIntrinsics,
): PoseValue | null {
  if (!(targetWidthM > 0) || !(detection.width > 0)) return null;
  const corners = [
    { x: detection.x, y: detection.y },
    { x: detection.x + detection.width, y: detection.y },
    { x: detection.x + detection.width, y: detection.y + detection.height },
    { x: detection.x, y: detection.y + detection.height },
  ];
  const world = [
    new Vector3(-targetWidthM / 2, targetWidthM / 2, 0),
    new Vector3(targetWidthM / 2, targetWidthM / 2, 0),
    new Vector3(targetWidthM / 2, -targetWidthM / 2, 0),
    new Vector3(-targetWidthM / 2, -targetWidthM / 2, 0),
  ];
  const kInv = inverse3([
    [intrinsics.fx, 0, intrinsics.cx],
    [0, intrinsics.fy, intrinsics.cy],
    [0, 0, 1],
  ]);
  if (!kInv) return null;
  const kInvMatrix = asThreeMatrix(kInv);

  const a: number[][] = [];
  const b: number[] = [];
  corners.forEach((corner, i) => {
    const normalized = new Vector3(corner.x, corner.y, 1).applyMatrix3(
      kInvMatrix,
    );
    const x = normalized.x / (normalized.z || 1);
    const y = normalized.y / (normalized.z || 1);
    const w = [world[i].x, world[i].y, 1];
    a.push([...w, 0, 0, 0, -x * w[0], -x * w[1]]);
    b.push(x);
    a.push([0, 0, 0, ...w, -y * w[0], -y * w[1]]);
    b.push(y);
  });

  const ata = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
  const atb = Array<number>(8).fill(0);
  a.forEach((row, rowIndex) => {
    for (let i = 0; i < 8; i += 1) {
      atb[i] += row[i] * b[rowIndex];
      for (let j = 0; j < 8; j += 1) ata[i][j] += row[i] * row[j];
    }
  });

  const m = ata.map((row, i) => [...row, atb[i]]);
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k < 9; k += 1) m[row][k] -= factor * m[col][k];
    }
  }

  const h = [...m.map((row, index) => row[8] / row[index]), 1];

  const homography: Matrix3Data = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], h[8]],
  ];
  const column1 = new Vector3(
    homography[0][0],
    homography[1][0],
    homography[2][0],
  );
  const column2 = new Vector3(
    homography[0][1],
    homography[1][1],
    homography[2][1],
  );
  const column3 = new Vector3(
    homography[0][2],
    homography[1][2],
    homography[2][2],
  );
  const scale = (column1.length() + column2.length()) / 2;
  if (!(scale > 1e-9)) return null;
  column1.divideScalar(scale);
  column2.divideScalar(scale);
  column3.divideScalar(scale);
  const column0 = new Vector3().crossVectors(column1, column2).normalize();
  const rotation: Matrix3Data = [
    [column1.x, column2.x, column0.x],
    [column1.y, column2.y, column0.y],
    [column1.z, column2.z, column0.z],
  ];
  return {
    position: { x: column3.x, y: column3.y, z: column3.z },
    quaternion: toQuaternionValue(matrixToQuaternion(rotation)),
    frame: "camera",
  };
}
