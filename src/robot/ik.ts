/**
 * DLS 逆运动学（阻尼最小二乘）——TCP 拖拽的数学核心。
 * 数值雅可比（几何法）+ 限位投影 + 可操作度奇异度量。
 * 纯函数、无 React/渲染依赖，q 语义为 active 数组顺序（°）。
 */
import { Quaternion, Vector3 } from "three";
import {
  computeLinkPoses,
  computeTcpPose,
  rpyToQuaternion,
  type Pose,
} from "./kinematics";
import { degreesToRadians, radiansToDegrees } from "./model";
import type { RobotModel } from "./types";

export interface IkOptions {
  /** 目标末端位姿（URDF/ROS 坐标） */
  target: Pose;
  /** 初始猜测（active 序 °；默认全 0） */
  q0Deg?: number[];
  /** 迭代上限 */
  maxIter?: number;
  /** 位置收敛容差（m） */
  tolPos?: number;
  /** 姿态收敛容差（rad，旋转矢量范数） */
  tolRot?: number;
  /** 阻尼基数（λ = damping·(1+25·res)，随误差收缩） */
  damping?: number;
}

export interface IkResult {
  ok: boolean;
  /** 最终配置（active 序 °，已投影到限位内） */
  qDeg: number[];
  iterations: number;
  /** 残差：位置（m）/ 姿态（rad） */
  residualPos: number;
  residualRot: number;
  /** 收尾时卡在限位上的 active 下标 */
  atLimit: number[];
  /** 可操作度 μ=sqrt(det(J·Jᵀ))，0 即奇异 */
  manipulability: number;
  /** 奇异/近奇异（μ 过小，维度混合的雅可比） */
  singular: boolean;
}

/** 关节夹取到限位范围（含非对称单边） */
function clampToJoint(q: number, j: { minDeg: number; maxDeg: number }): number {
  const lo = Number.isFinite(j.minDeg) ? j.minDeg : -Infinity;
  const hi = Number.isFinite(j.maxDeg) ? j.maxDeg : Infinity;
  return Math.min(hi, Math.max(lo, q));
}

/** 高斯消元求解 Ax=b（n≤6，列主元），同时返回 det 与近似条件警告 */
function solveLinear(
  aIn: number[][],
  bIn: number[],
): { x: number[]; det: number; illConditioned: boolean } | null {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  let det = 1;
  let illConditioned = false;
  const maxDiag = Math.max(1e-12, ...a.map((row, i) => Math.abs(row[i])));
  for (let col = 0; col < n; col++) {
    // 列主元
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    if (Math.abs(a[piv][col]) < 1e-13) {
      // 数值奇异（阻尼下一般不会出现；防御性拒绝）
      return null;
    }
    if (piv !== col) {
      [a[piv], a[col]] = [a[col], a[piv]];
      [b[piv], b[col]] = [b[col], b[piv]];
      det = -det;
    }
    const d = a[col][col];
    det *= d;
    illConditioned = illConditioned || Math.abs(d) < maxDiag * 1e-8;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = a.map((row, i) => b[i] / row[i]);
  return { x, det, illConditioned };
}

/**
 * DLS 迭代求解。
 * e = [p_t - p_e; 2·vec(q_t ⊗ conj(q_e))]；A = JᵀJ + λ²I；dθ = A⁻¹Jᵀe。
 */
export function solveIk(model: RobotModel, opts: IkOptions): IkResult {
  const maxIter = opts.maxIter ?? 480;
  const tolPos = opts.tolPos ?? 5e-4; // 0.5mm
  const tolRot = opts.tolRot ?? 2e-3; // ~0.1°
  const damping = opts.damping ?? 0.04;
  const n = model.active.length;

  // eeLink 运动链上的关节集合：不在链上的 active 关节对 TCP 无贡献（如 gripper）
  const chain = new Set<string>();
  {
    let link: string | undefined = model.eeLink;
    while (link) {
      const joint = model.jointOfLink.get(link);
      if (!joint) break;
      chain.add(joint.name);
      link = joint.parent;
    }
  }

  // 初始猜测（钳到限位内）
  const qRad: number[] = model.active.map((j, i) =>
    degreesToRadians(clampToJoint(opts.q0Deg?.[i] ?? 0, j)),
  );

  let iterations = 0;
  let residualPos = Infinity;
  let residualRot = Infinity;
  let singular = false;
  let manipulability = 0;

  const ePos = new Vector3();
  const eRot = new Vector3();
  const qerr = new Quaternion();
  const tmpQ = new Quaternion();
  const axes = model.active.map(() => new Vector3());
  const origins = model.active.map(() => new Vector3());
  const lin = new Vector3();

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const poses = computeLinkPoses(model, qRad.map(radiansToDegrees));
    const tcp = computeTcpPose(model, poses);

    // 位置/姿态误差（旋转矢量近似）
    ePos.copy(opts.target.position).sub(tcp.position);
    qerr.copy(opts.target.quaternion).multiply(tcp.quaternion.clone().invert());
    if (qerr.w < 0) {
      qerr.x = -qerr.x;
      qerr.y = -qerr.y;
      qerr.z = -qerr.z;
      qerr.w = -qerr.w;
    }
    eRot.set(qerr.x, qerr.y, qerr.z).multiplyScalar(2);

    // 真实残差（限幅前）用于收敛判定与阻尼自适应
    residualPos = ePos.length();
    residualRot = eRot.length();
    if (residualPos < tolPos && residualRot < tolRot) break;

    // 误差限幅：远离时每步最多 0.05m / 0.3rad，配合阻尼保持稳定
    if (residualPos > 0.05) ePos.multiplyScalar(0.05 / residualPos);
    if (residualRot > 0.3) eRot.multiplyScalar(0.3 / residualRot);

    // 几何雅可比：各 active 关节的世界轴 R_parent·R_origin·axis 与世界原点
    // 不在 eeLink 链上的关节（如 gripper）列置零，避免假信息污染解
    model.active.forEach((j, i) => {
      if (!chain.has(j.def.name)) {
        axes[i].set(0, 0, 0);
        origins[i].set(0, 0, 0);
        return;
      }
      const pp = poses.get(j.def.parent);
      const parentQ = pp?.quaternion ?? IDENTITY_Q;
      const parentP = pp?.position ?? ZERO_V;
      tmpQ.copy(parentQ).multiply(rpyToQuaternion(j.def.originRpy));
      axes[i].copy(new Vector3(...j.def.axis)).applyQuaternion(tmpQ).normalize();
      origins[i]
        .copy(new Vector3(...j.def.originXyz))
        .applyQuaternion(parentQ)
        .add(parentP);
    });

    // Jᵀ（6×n 转置存储）与 A=JᵀJ、b=Jᵀe
    const jt = Array.from({ length: n }, () => new Array<number>(6).fill(0));
    model.active.forEach((_, i) => {
      // 标准几何雅可比线性列 = z_i × (p_e − p_i)（叉积顺序不可反）
      if (axes[i].lengthSq() < 0.5) return; // 链外死关节：全零列
      lin.copy(tcp.position).sub(origins[i]);
      lin.crossVectors(axes[i], lin);
      const row = jt[i];
      row[0] = lin.x;
      row[1] = lin.y;
      row[2] = lin.z;
      row[3] = axes[i].x;
      row[4] = axes[i].y;
      row[5] = axes[i].z;
    });
    const a = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => {
        let s = 0;
        for (let k = 0; k < 6; k++) s += jt[r][k] * jt[c][k];
        return s;
      }),
    );
    const jte = Array.from({ length: n }, (_, r) => {
      const row = jt[r];
      return (
        row[0] * ePos.x +
        row[1] * ePos.y +
        row[2] * ePos.z +
        row[3] * eRot.x +
        row[4] * eRot.y +
        row[5] * eRot.z
      );
    });

    // 阻尼自适应：远距离大 λ 保稳；尾段小 λ 全速收敛（目标不可达时 res 居高不下，λ 自然回升）
    const res = residualPos + 0.15 * residualRot;
    const lambda2 = Math.pow(
      damping * Math.min(4, Math.max(0.15, 12 * res)),
      2,
    );
    for (let i = 0; i < n; i++) a[i][i] += lambda2;

    const solved = solveLinear(a, jte);
    if (!solved) {
      singular = true;
      break;
    }
    manipulability = Math.sqrt(Math.max(0, Math.abs(solved.det)));
    singular = singular || solved.illConditioned;

    // 限位投影（clamp 后下一迭代自行修正其余自由度）+ 停滞检测
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const next = clampToJoint(radiansToDegrees(qRad[i]) + solved.x[i], model.active[i]);
      moved += Math.abs(next - radiansToDegrees(qRad[i]));
      qRad[i] = degreesToRadians(next);
    }
    if (moved < 1e-6) break;
  }

  const qDeg = qRad.map(radiansToDegrees);
  // 收尾时贴住限位（0.05° 内）的关节
  const atLimit: number[] = [];
  model.active.forEach((j, i) => {
    if (!Number.isFinite(j.minDeg) && !Number.isFinite(j.maxDeg)) return;
    const lo = Number.isFinite(j.minDeg) ? j.minDeg : -Infinity;
    const hi = Number.isFinite(j.maxDeg) ? j.maxDeg : Infinity;
    if (qDeg[i] - lo < 0.05 || hi - qDeg[i] < 0.05) atLimit.push(i);
  });

  return {
    ok: residualPos < tolPos && residualRot < tolRot && !singular,
    qDeg,
    iterations,
    residualPos,
    residualRot,
    atLimit,
    manipulability,
    singular,
  };
}

const ZERO_V = new Vector3();
const IDENTITY_Q = new Quaternion();