// 碰撞检测系统：纯 TS 解析几何（capsule×capsule / capsule×台面 / 静态物体体积）。
// 四层语义中的 self / environment / swept；输出真实最近距离（非布尔膨胀层）。
// Created on 2026-09-10 12:50
// @author:  https://github.com/Linmoqian
import { Vector3 } from "three";
import { computeLinkPoses } from "./kinematics";
import {
  SCENE_PROP_COLLIDERS,
  type ScenePropCollider,
  type ScenePropId,
} from "./sceneGeometry";
import type { RobotModel } from "./types";

/** 三档安全距离语义（最近环境距离）：clear → warn → slow → stop 逐级收紧 */
export type SafetyTier = "clear" | "warn" | "slow" | "stop";

/** 各档阈值（米）：距环境 < 阈值即落入该档 */
export const TIER_METERS = {
  warn: 0.1,
  slow: 0.05,
  stop: 0.02,
} as const;

/** 档位 → 追赶速度缩放系数（SimulationLoop 限速用；stop 档目标侧为拒绝、现实侧为冻结） */
export const TIER_SPEED_SCALE: Record<SafetyTier, number> = {
  clear: 1,
  warn: 0.5,
  slow: 0.2,
  stop: 0,
};

/** 档位严重度排序值（越大越危险） */
function tierRank(tier: SafetyTier): number {
  switch (tier) {
    case "clear":
      return 0;
    case "warn":
      return 1;
    case "slow":
      return 2;
    case "stop":
      return 3;
  }
}

/** 一次碰撞评估结果（目标入闸校验 / 现实限速共用） */
export interface CollisionStatus {
  /** 自碰撞（相邻对已排除） */
  selfCollision: boolean;
  /** 环境最近距离档（clear = 全部安全余量之外） */
  tier: SafetyTier;
  /** 最近环境距离（米，负值 = 已穿透；解析法直接量出，非布尔判定） */
  safetyDistance: number | null;
  /** 最近静态物体（命中物体碰撞体时提供，台面/全清时为空） */
  environmentObjectId?: ScenePropId;
  /** 最近静态物体的显示名称，供安全 HUD/拒绝原因使用 */
  environmentObjectLabel?: string;
}

/** 全清状态常量 */
export const COLLISION_CLEAR: CollisionStatus = {
  selfCollision: false,
  tier: "clear",
  safetyDistance: null,
};

/** 拒绝语义：自碰撞或 stop 档 */
export function isRejected(st: CollisionStatus): boolean {
  return st.selfCollision || st.tier === "stop";
}

/** 状态文本（UI 徽标/日志用） */
export function describeCollision(st: CollisionStatus): string {
  if (st.selfCollision) return "自碰撞";
  const d = st.safetyDistance;
  const objectPrefix = st.environmentObjectLabel
    ? `${st.environmentObjectLabel}距离 `
    : "环境距离 ";
  switch (st.tier) {
    case "stop":
      return `${objectPrefix}${fmtM(d)}（<20mm）`;
    case "slow":
      return `${objectPrefix}${fmtM(d)}（<50mm）`;
    case "warn":
      return `${objectPrefix}${fmtM(d)}（<100mm）`;
    case "clear":
      return "安全";
  }
}

function fmtM(d: number | null): string {
  return d === null ? "—" : `${(d * 1000).toFixed(0)}mm`;
}

/** 自碰撞 capsule 半径：电机盒实际包络（SO-100 电机座宽约 45mm，中心线在轴线上） */
const SELF_RADIUS = 0.022;

/** 环境距离 capsule 半径：含安全余量的包络（比真实半径肥 6mm） */
const ENV_RADIUS = 0.028;

/** 叶子 link（无子关节，如夹爪指尖）以球近似 */
const LEAF_SELF_RADIUS = 0.024;
const LEAF_ENV_RADIUS = 0.03;

/** 自碰撞排除链距：≤3 的对（隔两个关节）几何上常邻接（SO-100 收纳形态本来贴近） */
const SELF_EXCLUDE_CHAIN_DIST = 3;

/** 工作台面高度（URDF/ROS Z-up，z=0 为安装基准面） */
const GROUND_Z = 0;

/** 臂链碰撞段：link 原点 → 子关节挂载点的胶囊（段长固定，评估时算世界两端点） */
interface ArmSegment {
  linkName: string;
  /** 段向量（link 坐标系，build 时一次算定；null = 叶子球） */
  localEnd: Vector3 | null;
  /** 评估用预分配世界端点（零 GC） */
  p0: Vector3;
  p1: Vector3;
  /** 自碰撞判定半径（真实包络，不含余量） */
  selfRadius: number;
  /** 环境距离半径（含安全余量） */
  envRadius: number;
  /** 链深（到 root 的关节数）：半深启发式用 */
  depth: number;
}

/** 自碰撞检测对（链距 >2 的臂链组合） */
interface SelfPair {
  a: ArmSegment;
  b: ArmSegment;
}

interface EnvironmentHit {
  collider: ScenePropCollider;
  distance: number;
}

interface EnvironmentRuntimeCollider {
  collider: ScenePropCollider;
  p0: Vector3;
  p1: Vector3;
}

/** 线段最短距离平方（标准 clamp 算法；tmp 系列复用调用方传入的预分配对象） */
function segmentDistanceSq(
  a0: Vector3,
  a1: Vector3,
  b0: Vector3,
  b1: Vector3,
): number {
  const d1x = a1.x - a0.x, d1y = a1.y - a0.y, d1z = a1.z - a0.z;
  const d2x = b1.x - b0.x, d2y = b1.y - b0.y, d2z = b1.z - b0.z;
  const rx = a0.x - b0.x, ry = a0.y - b0.y, rz = a0.z - b0.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    // 双退化：点-点
    return rx * rx + ry * ry + rz * rz;
  }
  if (a <= 1e-12) {
    // a 退化为点：t = clamp(f/e)
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      // b 退化为点
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = rx + d1x * s - d2x * t;
  const cy = ry + d1y * s - d2y * t;
  const cz = rz + d1z * s - d2z * t;
  return cx * cx + cy * cy + cz * cz;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 距离值 → 档位 */
function distanceTier(d: number): SafetyTier {
  if (d < TIER_METERS.stop) return "stop";
  if (d < TIER_METERS.slow) return "slow";
  if (d < TIER_METERS.warn) return "warn";
  return "clear";
}

/**
 * CollisionSystem —— 目标世界与现实世界的共享碰撞查询器。
 * 纯解析几何：每帧 FK → 更新胶囊端点 → 台面/物体距离计算（无 WASM/物理步进依赖）。
 */
export class CollisionSystem {
  readonly model: RobotModel;
  /** 兼容旧接口（纯 TS 实现恒为 true） */
  readonly enabled = true;

  private readonly segments: ArmSegment[] = [];
  private readonly selfPairs: SelfPair[] = [];
  private readonly environmentColliders: EnvironmentRuntimeCollider[] =
    SCENE_PROP_COLLIDERS.map((collider) => ({
      collider,
      p0: new Vector3(...collider.p0),
      p1: new Vector3(...collider.p1),
    }));
  private readonly parentOfLink = new Map<string, string>();
  /** 臂链最大链深（环境距离的半深启发式用） */
  private maxArmDepth = 0;

  constructor(model: RobotModel) {
    this.model = model;
    this.build();
  }

  /** 即时构建（同步，无需 async 工厂） */
  static create(model: RobotModel): CollisionSystem {
    return new CollisionSystem(model);
  }

  /** 构建静态碰撞几何（构造内部调用，一次性） */
  private build(): void {
    const { def } = this.model;
    def.joints.forEach((j) => this.parentOfLink.set(j.child, j.parent));

    // —— 臂链判定：自 root 起经过 ≥1 个可动关节才能到达的 link ——
    // （底座固定链不建碰撞体，否则底盘永远压着台面膨胀档）
    const root =
      def.links.find((l) => this.model.jointOfLink.get(l.name) === null)?.name ??
      def.links[0]?.name;
    const activeCount = new Map<string, number>();
    if (root) {
      activeCount.set(root, 0);
      const queue = [root];
      while (queue.length > 0) {
        const link = queue.shift()!;
        const cnt = activeCount.get(link) ?? 0;
        for (let ji = 0; ji < def.joints.length; ji++) {
          const j = def.joints[ji];
          if (j.parent !== link || activeCount.has(j.child)) continue;
          const isActive = this.model.activeIndexByJoint.has(ji);
          activeCount.set(j.child, cnt + (isActive ? 1 : 0));
          queue.push(j.child);
        }
      }
    }
    const armLinks = new Set(
      [...activeCount.entries()].filter(([, c]) => c > 0).map(([n]) => n),
    );
    // 链深（到 root 的关节数，root 自身 0）：肩座（深1）属准安装结构，环境距离跳过
    const depthOfLink = new Map<string, number>([[root ?? "", 0]]);
    if (root) {
      const queue = [root];
      while (queue.length > 0) {
        const link = queue.shift()!;
        const d = depthOfLink.get(link) ?? 0;
        for (const j of def.joints) {
          if (j.parent !== link || depthOfLink.has(j.child)) continue;
          depthOfLink.set(j.child, d + 1);
          queue.push(j.child);
        }
      }
    }

    // —— 每段连杆一个胶囊：link 原点 → 第一个子关节挂载点（SO-100 链式结构） ——
    const firstChildJointOf = new Map<string, (typeof def.joints)[number]>();
    def.joints.forEach((j) => {
      if (!firstChildJointOf.has(j.parent)) firstChildJointOf.set(j.parent, j);
    });

    for (const link of def.links) {
      if (!armLinks.has(link.name)) continue;
      const childJoint = firstChildJointOf.get(link.name);
      this.segments.push({
        linkName: link.name,
        localEnd: childJoint ? new Vector3(...childJoint.originXyz) : null,
        p0: new Vector3(),
        p1: new Vector3(),
        selfRadius: childJoint ? SELF_RADIUS : LEAF_SELF_RADIUS,
        envRadius: childJoint ? ENV_RADIUS : LEAF_ENV_RADIUS,
        depth: depthOfLink.get(link.name) ?? 0,
      });
    }

    // —— 自碰撞对表：臂链两两组合，排除链距 ≤3 的邻接对（SO-100 收纳形态本就贴近） ——
    const segs = this.segments;
    this.maxArmDepth = segs.reduce((m, s) => Math.max(m, s.depth), 0);
    for (let i = 0; i < segs.length; i++) {
      for (let k = i + 1; k < segs.length; k++) {
        if (this.chainDistance(segs[i].linkName, segs[k].linkName) <= SELF_EXCLUDE_CHAIN_DIST) continue;
        this.selfPairs.push({ a: segs[i], b: segs[k] });
      }
    }
  }

  /** 两 link 链距（沿运动树上溯的最少步数；无法到达按 Infinity） */
  private chainDistance(a: string, b: string): number {
    // 只需上溯 ≤3 步即可判定排除条件（≤SELF_EXCLUDE_CHAIN_DIST）
    const up = (start: string): Map<string, number> => {
      const dist = new Map<string, number>([[start, 0]]);
      let cur = start;
      for (let step = 1; step <= SELF_EXCLUDE_CHAIN_DIST; step++) {
        const p = this.parentOfLink.get(cur);
        if (p === undefined) break;
        dist.set(p, step);
        cur = p;
      }
      return dist;
    };
    const reachA = up(a);
    const reachB = up(b);
    let best = Infinity;
    for (const [link, da] of reachA) {
      const db = reachB.get(link);
      if (db !== undefined) best = Math.min(best, da + db);
    }
    return best;
  }

  /** 评估指定构型：FK → 更新胶囊端点 → 自碰撞 + 台面/物体最近距离 */
  evaluate(qDeg: number[]): CollisionStatus {
    const poses = computeLinkPoses(this.model, qDeg);

    // 世界端点：p0 = link 原点；p1 = p0 + 段向量（link 系 → 世界旋转）
    for (const seg of this.segments) {
      const pose = poses.get(seg.linkName);
      if (!pose) continue;
      seg.p0.copy(pose.position);
      if (seg.localEnd) {
        seg.p1.copy(seg.localEnd).applyQuaternion(pose.quaternion).add(seg.p0);
      } else {
        seg.p1.copy(seg.p0);
      }
    }

    // 环境最近距离：每段胶囊到台面（z=GROUND_Z 半空间）的距离
    // capsule 到水平面距离 = min(两端点 z) - r - GROUND_Z（含球端帽）
    // 半深启发式：靠基座的一半连杆（肩座/大臂底段）贴台面属常态，
    // 只有末端半链（链深 ≥ ⌈maxDepth/2⌉）下沉才代表"即将砸台面"
    const envMinDepth = Math.ceil(this.maxArmDepth / 2);
    let minDist = Infinity;
    for (const seg of this.segments) {
      if (seg.depth < envMinDepth) continue;
      const zMin = Math.min(seg.p0.z, seg.p1.z) - seg.envRadius - GROUND_Z;
      if (zMin < minDist) minDist = zMin;
    }
    // 环境最近距离 2/2：每段机械臂胶囊到静态场景物体胶囊。
    // 咖啡机主体/水箱/托盘合并为一根保守竖直胶囊，水杯用杯身包络；
    // 距离减去两端半径后为真实安全余量（负值 = 穿透）。
    let nearestObject: EnvironmentHit | null = null;
    for (const runtimeCollider of this.environmentColliders) {
      const objectDistance = this.distanceToCollider(runtimeCollider);
      if (objectDistance < minDist) minDist = objectDistance;
      if (!nearestObject || objectDistance < nearestObject.distance) {
        nearestObject = {
          collider: runtimeCollider.collider,
          distance: objectDistance,
        };
      }
    }
    const tier = distanceTier(minDist);

    // 自碰撞：胶囊对中心线距离 < 真实半径和 → 重叠（真实半径，不含环境余量）
    let selfCollision = false;
    for (const pair of this.selfPairs) {
      const distSq = segmentDistanceSq(
        pair.a.p0,
        pair.a.p1,
        pair.b.p0,
        pair.b.p1,
      );
      const rSum = pair.a.selfRadius + pair.b.selfRadius;
      if (distSq < rSum * rSum) {
        selfCollision = true;
        break;
      }
    }

    const nearestObjectIsSource =
      nearestObject !== null &&
      Number.isFinite(nearestObject.distance) &&
      nearestObject.distance <= minDist;
    return {
      selfCollision,
      tier,
      safetyDistance: minDist === Infinity ? null : minDist,
      ...(nearestObjectIsSource
        ? {
            environmentObjectId: nearestObject?.collider.id,
            environmentObjectLabel: nearestObject?.collider.label,
          }
        : {}),
    };
  }

  /** 当前 FK 端点到一个静态物体胶囊的最小安全距离。 */
  private distanceToCollider(collider: EnvironmentRuntimeCollider): number {
    let minDistance = Infinity;
    for (const segment of this.segments) {
      const centerlineDistance = Math.sqrt(
        segmentDistanceSq(segment.p0, segment.p1, collider.p0, collider.p1),
      );
      const clearance =
        centerlineDistance - segment.envRadius - collider.collider.radius;
      if (clearance < minDistance) minDistance = clearance;
    }
    return minDistance;
  }

  /** 扫掠路径评估：from → to 关节空间线性插值采样（目标入闸用，粗采样） */
  evaluateSwept(from: readonly number[], to: readonly number[], steps = 4): CollisionStatus {
    let worst = COLLISION_CLEAR;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const q = from.map((v, i) => v + ((to[i] - v) * t));
      const st = this.evaluate(q);
      if (worser(st, worst)) worst = st;
      if (worst.selfCollision && worst.tier === "stop") break;
    }
    return worst;
  }

  /** 释放资源（纯 TS 实现为空操作，保持接口兼容） */
  dispose(): void {
    // 纯内存对象，交由 GC
  }
}

/** st 是否比 worst 更严重 */
function worser(st: CollisionStatus, worst: CollisionStatus): boolean {
  if (st.selfCollision && !worst.selfCollision) return true;
  if (!st.selfCollision && worst.selfCollision) return false;
  return tierRank(st.tier) > tierRank(worst.tier);
}
