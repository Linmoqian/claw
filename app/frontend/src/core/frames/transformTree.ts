/**
 * TransformTree —— 帧树查询与维护（最小 TF 树）。
 *
 * 约定：每条边的 transform 描述 parent → child，
 * 即 child 帧中的点 v 在 parent 帧中为 T · v。
 * lookup(from, to) 返回把 from 帧点变换到 to 帧的变换，
 * 与 ROS TF2 lookupTransform 语义一致。
 * 写入（upsert/remove）会使内部版本号失效，查询带缓存。
 */
import { Quaternion, Vector3 } from "three";
import type { Frame, Transform } from "./types";

/** 单位变换（每次返回新对象，避免共享引用被外部原地修改） */
export function identityTransform(): Transform {
  return {
    translation: new Vector3(),
    rotation: new Quaternion(),
  };
}

/** 先应用 a、再应用 b：v' = b(a(v)) */
export function composeTransforms(a: Transform, b: Transform): Transform {
  const rotation = new Quaternion();
  rotation.multiplyQuaternions(b.rotation, a.rotation);
  const translation = b.translation
    .clone()
    .add(a.translation.clone().applyQuaternion(b.rotation));
  return { translation, rotation };
}

interface Edge {
  parent: string | null;
  transform: Transform;
}

export class TransformTree {
  /** frame → (parent, transform)，根节点 parent 为 null */
  private readonly edges = new Map<string, Edge>();
  /** 结构版本号：upsert/remove 自增，缓存据此失效 */
  private version = 0;
  /** lookup 结果缓存（快照 clone，外部修改不影响内部） */
  private readonly cache = new Map<string, { v: number; t: Transform }>();

  constructor() {
    // 根帧 world：parent 为空、单位变换
    this.edges.set("world", { parent: null, transform: identityTransform() });
  }

  /** 注册/更新一条边（parent → child 变换）；检测成环 */
  upsert(name: string, parent: string | null, transform: Transform): void {
    // 环检测：从 parent 沿树上行，若遇到 name 则成环
    let cursor: string | null = parent;
    let guard = 0;
    while (cursor !== null) {
      if (cursor === name) throw new Error(`TransformTree: cycle via ${name}`);
      const edge = this.edges.get(cursor);
      cursor = edge ? edge.parent : null;
      if (++guard > 1000) throw new Error("TransformTree: chain too deep");
    }
    this.edges.set(name, {
      parent,
      transform: {
        translation: transform.translation.clone(),
        rotation: transform.rotation.clone(),
      },
    });
    this.version++;
    this.cache.clear();
  }

  /** 移除一棵子树（含后代）；根帧不可移除 */
  remove(name: string): void {
    if (name === "world") return;
    this.edges.delete(name);
    for (const [frame, edge] of this.edges) {
      if (edge.parent === name) this.remove(frame);
    }
    this.version++;
    this.cache.clear();
  }

  has(name: string): boolean {
    return this.edges.has(name);
  }

  frame(name: string): Frame | null {
    const edge = this.edges.get(name);
    return edge ? { name, parent: edge.parent } : null;
  }

  frames(): Frame[] {
    return [...this.edges.entries()].map(([name, edge]) => ({
      name,
      parent: edge.parent,
    }));
  }

  /** from 帧 → to 帧的变换（结果为 clone，可安全持有/修改） */
  lookup(from: string, to: string): Transform {
    const key = `${from}>${to}`;
    const hit = this.cache.get(key);
    if (hit && hit.v === this.version) {
      return {
        translation: hit.t.translation.clone(),
        rotation: hit.t.rotation.clone(),
      };
    }
    const fromToWorld = this.chainToWorld(from);
    const toToWorld = this.chainToWorld(to);
    // v_to = inv(toToWorld) ∘ fromToWorld (v_from)：
    // 先 fromToWorld（from → world），再 inv(toToWorld)（world → to）
    const invTo = this.invert(toToWorld);
    const result = composeTransforms(fromToWorld, invTo);
    this.cache.set(key, {
      v: this.version,
      t: {
        translation: result.translation.clone(),
        rotation: result.rotation.clone(),
      },
    });
    return result;
  }

  /** 单点变换：from 帧下的点 → to 帧下的点 */
  transformPoint(from: string, to: string, point: Vector3): Vector3 {
    const t = this.lookup(from, to);
    return point.clone().applyQuaternion(t.rotation).add(t.translation);
  }

  /** 该帧 → world 的变换：从自身边起逐级向上累积（内层边先应用） */
  private chainToWorld(name: string): Transform {
    const out = identityTransform();
    let cursor: string | null = name;
    let guard = 0;
    while (cursor !== null) {
      const edge = this.edges.get(cursor);
      if (!edge) throw new Error(`TransformTree: unknown frame '${name}'`);
      if (edge.parent === null) break;
      // out 是 name → 当前层的累积；新边是更外层（父 → 祖父），后应用
      const acc = composeTransforms(out, edge.transform);
      out.translation.copy(acc.translation);
      out.rotation.copy(acc.rotation);
      cursor = edge.parent;
      if (++guard > 1000) throw new Error("TransformTree: chain too deep");
    }
    return out;
  }

  private invert(t: Transform): Transform {
    const rotation = t.rotation.clone().invert();
    const translation = t.translation
      .clone()
      .applyQuaternion(rotation)
      .negate();
    return { translation, rotation };
  }
}

/** 预置根帧树：world → map → robot_base；station/cad 直属 world（初始单位，等待标定） */
export function buildDefaultFrameTree(): TransformTree {
  const tree = new TransformTree();
  tree.upsert("map", "world", identityTransform());
  tree.upsert("robot_base", "map", identityTransform());
  tree.upsert("station", "world", identityTransform());
  tree.upsert("cad", "world", identityTransform());
  return tree;
}