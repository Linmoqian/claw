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
  /** 已累计的目标角，避免逐帧增量反复叠加到同一个起始值。 */
  currentValueDeg: number;
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

/** BASE 拖拽状态：地面平面（three y≈0）射线交点 → 底盘目标 XY */
interface BaseActiveDrag {
  /** 底盘当前中心（three 世界，拖拽命中半径判定用） */
  center: Vector3;
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
  private baseDrag: BaseActiveDrag | null = null;

  /** 输入意图出口（wire 到 targetStore，见 interactionStore） */
  onIntent: ((intent: InputIntent) => void) | null = null;
  /** 拖拽会话生命周期出口（M4：begin=申请控制权 / commit=提交预览 / cancel=丢弃） */
  onSession: ((phase: "begin" | "commit" | "cancel") => void) | null = null;
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

  /** 拖拽中切换模式视为取消（不再发新意图） */
  setMode(mode: ToolMode): void {
    if (this.mode === mode) return;
    if (this.drag) this.cancelDrag();
    if (this.tcpDrag) this.cancelTcpDrag();
    if (this.baseDrag) this.cancelBaseDrag();
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

  /* ================= 关节部件直接拖拽 ================= */

  /** 开始拖拽：SELECT 直操或兼容 JOINT 模式，初始射线须命中旋转平面。 */
  beginJointDrag(
    args: JointDragFrame & { jointIndex: number; jointName: string },
    ray: Ray,
  ): boolean {
    if ((this.mode !== "select" && this.mode !== "joint") || this.drag) {
      return false;
    }
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
      currentValueDeg: args.startValueDeg,
      prevHit: hit,
    };
    this.onSession?.("begin");
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
    drag.currentValueDeg += radiansToDegrees(deltaRad);
    this.onIntent?.({
      kind: "joint-target",
      source: "mouse",
      jointIndex: drag.jointIndex,
      jointName: drag.jointName,
      valueDeg: drag.currentValueDeg,
    });
  }

  /** 释放：目标已随拖动逐帧预览，此处提交（现实从松开点开始追赶） */
  endDrag(): void {
    this.drag = null;
    this.onSession?.("commit");
  }

  /** 取消：丢弃预览（M4 起 ESC / 模式切换时目标回退） */
  cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.onSession?.("cancel");
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
    if (!this.tcpDrag) return;
    this.tcpDrag = null;
    this.onTcpDrag?.(null);
    this.onSession?.("commit");
  }

  cancelTcpDrag(): void {
    if (!this.tcpDrag) return;
    this.tcpDrag = null;
    this.onTcpDrag?.(null);
    this.onSession?.("cancel");
  }

  /** 取消一切活动拖拽（ESC / 模型卸载；触发对应会话收场） */
  cancelActiveDrag(): void {
    this.cancelDrag();
    this.cancelTcpDrag();
  }

  /* ================= BASE 底盘拖拽（M5） ================= */

  /** 开始底盘拖拽：射线与地面平面交点落在底盘命中半径内（three y=0） */
  beginBaseDrag(ray: Ray, baseCenter: Vector3): boolean {
    if (this.mode !== "base" || this.baseDrag) return false;
    const hit = rayPlaneHit(ray, baseCenter, UP_Y);
    if (!hit) return false;
    if (hit.distanceTo(baseCenter) > BASE_GRAB_RADIUS) return false;
    this.baseDrag = { center: baseCenter.clone() };
    this.onSession?.("begin");
    return true;
  }

  /** 拖动更新：射线与地面交点 → BasePoseIntent（world 平面：y = -z_three） */
  updateBaseDrag(ray: Ray): void {
    if (!this.baseDrag) return;
    const hit = rayPlaneHit(ray, this.baseDrag.center, UP_Y);
    if (!hit) return;
    this.onIntent?.({
      kind: "base-pose",
      source: "mouse",
      x: hit.x,
      y: -hit.z,
      yaw: 0,
    });
  }

  endBaseDrag(): void {
    if (!this.baseDrag) return;
    this.baseDrag = null;
    this.onSession?.("commit");
  }

  cancelBaseDrag(): void {
    if (!this.baseDrag) return;
    this.baseDrag = null;
    this.onSession?.("cancel");
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
/** 地面法向（three Y-up） */
const UP_Y = new Vector3(0, 1, 0);

/** 底盘拖拽命中半径（m，含底盘外扩手柄余量） */
const BASE_GRAB_RADIUS = 0.22;
