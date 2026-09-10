/**
 * InteractionController —— 交互系统统一入口（模式机 + 拾取 + 关节拖拽）。
 * 纯 TS、不依赖 React：由 interactionStore 单例持有；
 * 出口只有两个回调（onIntent → targetStore、onSelection → interactionStore）。
 * 原则：鼠标只产出输入意图（InputIntent），绝不直接写 three 或电机目标。
 */
import { Quaternion, Ray, Vector3 } from "three";
import { radiansToDegrees } from "../robot/model";
import type { RobotModel } from "../robot/types";
import { rayPlaneHit, signedDeltaRad } from "./jointMath";
import type {
  InputIntent,
  JointDragFrame,
  SelectedEntity,
  ToolMode,
} from "./types";

interface ActiveDrag {
  jointIndex: number;
  jointName: string;
  frame: JointDragFrame;
  /** 上次指针在旋转平面上的落点（three 世界） */
  prevHit: Vector3;
}

/** TCP 拖拽状态（平移沿轴滑动 / 旋转环角增量，两者均围绕按下瞬间的末端位姿） */
interface TcpActiveDrag {
  kind: "translate" | "rotate";
  axis: Vector3;
  startPosition: Vector3;
  startQuaternion: Quaternion;
  /** translate：按下时指针沿轴参数 t0（m） */
  t0: number;
  /** rotate：上次指针在旋转平面上的落点 */
  prevHit: Vector3;
}

/** TCP 拖拽活动轴广播（UI 徽标用） */
export interface TcpDragState {
  kind: "translate" | "rotate";
  axisIndex: 0 | 1 | 2;
}

export class InteractionController {
  private mode: ToolMode = "select";
  private model: RobotModel | null = null;
  private selected: SelectedEntity | null = null;
  private drag: ActiveDrag | null = null;
  private tcpDrag: TcpActiveDrag | null = null;

  /** 输入意图出口（wire 到 targetStore，见 interactionStore） */
  onIntent: ((intent: InputIntent) => void) | null = null;
  /** 拾取出口 */
  onSelection: ((sel: SelectedEntity | null) => void) | null = null;
  /** TCP 拖拽活动轴出口（UI 徽标用） */
  onTcpDrag: ((state: TcpDragState | null) => void) | null = null;

  bindModel(model: RobotModel | null): void {
    this.model = model;
    this.clearSelection();
    this.cancelDrag();
  }

  getMode(): ToolMode {
    return this.mode;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  /** 拖拽中切换模式视为取消（不再发新意图） */
  setMode(mode: ToolMode): void {
    if (this.mode === mode) return;
    if (this.drag) this.cancelDrag();
    if (this.tcpDrag) this.cancelTcpDrag();
    this.mode = mode;
  }

  /* ================= SELECT 拾取 ================= */

  /** mesh.userData.linkName → link → 归属关节（root 或未知返回 link 级空关节） */
  pick(linkName: string | null | undefined): SelectedEntity | null {
    if (!linkName || !this.model) return null;
    const joint = this.model.jointOfLink.get(linkName) ?? null;
    const jointIndex = joint
      ? (this.model.activeIndexByJoint.get(
          this.model.def.joints.indexOf(joint),
        ) ?? null)
      : null;
    const sel: SelectedEntity = {
      linkName,
      jointName: joint?.name ?? null,
      jointIndex,
    };
    this.selected = sel;
    this.onSelection?.(sel);
    return sel;
  }

  clearSelection(): void {
    if (this.selected === null) return;
    this.selected = null;
    this.onSelection?.(null);
  }

  /* ================= JOINT 旋转环拖拽 ================= */

  /** 开始拖拽（JOINT 模式）：初始射线须先命中旋转平面，否则拒绝 */
  beginJointDrag(
    args: JointDragFrame & { jointIndex: number; jointName: string },
    ray: Ray,
  ): boolean {
    if (this.mode !== "joint" || this.drag) return false;
    const hit = rayPlaneHit(ray, args.center, args.axis);
    if (!hit) return false;
    this.drag = {
      jointIndex: args.jointIndex,
      jointName: args.jointName,
      frame: {
        center: args.center.clone(),
        axis: args.axis.clone(),
        startValueDeg: args.startValueDeg,
      },
      prevHit: hit,
    };
    return true;
  }

  /** 拖动更新：平面角增量 → 目标角（°，基于按下瞬间的起始值） */
  updateDrag(ray: Ray): void {
    const drag = this.drag;
    if (!drag) return;
    const hit = rayPlaneHit(ray, drag.frame.center, drag.frame.axis);
    if (!hit) return;
    const deltaRad = signedDeltaRad(
      drag.frame.center,
      drag.frame.axis,
      drag.prevHit,
      hit,
    );
    drag.prevHit.copy(hit);
    const valueDeg = drag.frame.startValueDeg + radiansToDegrees(deltaRad);
    this.onIntent?.({
      kind: "joint-target",
      source: "mouse",
      jointIndex: drag.jointIndex,
      jointName: drag.jointName,
      valueDeg,
    });
  }

  /** 释放：目标已随拖动逐帧生效，此处仅清态 */
  endDrag(): void {
    this.drag = null;
  }

  /** 取消：不清除已发布意图（M4 预览-提交后才引入撤销语义） */
  cancelDrag(): void {
    this.drag = null;
  }

  /* ================= TCP 6DoF 拖拽 ================= */

  /** 开始 TCP 拖拽：平移轴须射线在轴附近（手柄半径内），旋转须命中绕轴平面 */
  beginTcpDrag(
    args: {
      kind: "translate" | "rotate";
      axis: Vector3;
      axisIndex: 0 | 1 | 2;
      startPosition: Vector3;
      startQuaternion: Quaternion;
    },
    ray: Ray,
  ): boolean {
    if (this.mode !== "tcp" || this.tcpDrag) return false;
    if (args.kind === "translate") {
      const c = closestPair(ray, args.startPosition, args.axis);
      if (!c || c.dist > 0.024) return false;
      this.tcpDrag = {
        kind: "translate",
        axis: args.axis.clone(),
        startPosition: args.startPosition.clone(),
        startQuaternion: args.startQuaternion.clone(),
        t0: c.tLine,
        prevHit: new Vector3(),
      };
    } else {
      const hit = rayPlaneHit(ray, args.startPosition, args.axis);
      if (!hit) return false;
      this.tcpDrag = {
        kind: "rotate",
        axis: args.axis.clone(),
        startPosition: args.startPosition.clone(),
        startQuaternion: args.startQuaternion.clone(),
        t0: 0,
        prevHit: hit,
      };
    }
    this.onTcpDrag?.({ kind: args.kind, axisIndex: args.axisIndex });
    return true;
  }

  /** 拖动更新：沿轴增量 / 绕轴角增量 → 发布 TCP 位姿意图（URDF 坐标） */
  updateTcpDrag(ray: Ray): void {
    const drag = this.tcpDrag;
    if (!drag) return;
    if (drag.kind === "translate") {
      const c = closestPair(ray, drag.startPosition, drag.axis);
      if (!c) return;
      const delta = c.tLine - drag.t0;
      const pos = drag.startPosition
        .clone()
        .add(new Vector3().copy(drag.axis).multiplyScalar(delta));
      this.emitTcpPose(pos, drag.startQuaternion);
    } else {
      const hit = rayPlaneHit(ray, drag.startPosition, drag.axis);
      if (!hit) return;
      const deltaRad = signedDeltaRad(
        drag.startPosition,
        drag.axis,
        drag.prevHit,
        hit,
      );
      drag.prevHit.copy(hit);
      const inc = new Quaternion().setFromAxisAngle(drag.axis, deltaRad);
      const q = inc.clone().multiply(drag.startQuaternion);
      this.emitTcpPose(drag.startPosition, q);
    }
  }

  endTcpDrag(): void {
    this.tcpDrag = null;
    this.onTcpDrag?.(null);
  }

  cancelTcpDrag(): void {
    this.tcpDrag = null;
    this.onTcpDrag?.(null);
  }

  /** 位姿意图出口（统一形态，future LIVE 将路由到 Preview/Consensus） */
  private emitTcpPose(position: Vector3, quaternion: Quaternion): void {
    this.onIntent?.({
      kind: "tcp-pose",
      source: "mouse",
      position: { x: position.x, y: position.y, z: position.z },
      quaternion: {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      },
    });
  }
}

/** 射线与空间直线的最近点对（直线参数 tLine 沿 axis 从 lineOrigin 计量）
 * w0 = lineOrigin − rayOrigin 约定下：tRay = (d−b·e)/denom、tLine = (b·d−e)/denom */
function closestPair(
  ray: Ray,
  lineOrigin: Vector3,
  axis: Vector3,
): { tLine: number; dist: number } | null {
  const u = axis;
  const v = ray.direction;
  const w0 = new Vector3().copy(lineOrigin).sub(ray.origin);
  const b = v.dot(u);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-9) return null; // 射线与轴平行：无唯一切点
  const d = v.dot(w0);
  const e = u.dot(w0);
  const tRay = (d - b * e) / denom;
  const tLine = (b * d - e) / denom;
  const pLine = new Vector3().copy(lineOrigin).addScaledVector(u, tLine);
  const pRay = ray.origin.clone().addScaledVector(v, tRay);
  return { tLine, dist: pLine.distanceTo(pRay) };
}