/**
 * InteractionController —— 交互系统统一入口（模式机 + 拾取 + 关节拖拽）。
 * 纯 TS、不依赖 React：由 interactionStore 单例持有；
 * 出口只有两个回调（onIntent → targetStore、onSelection → interactionStore）。
 * 原则：鼠标只产出输入意图（InputIntent），绝不直接写 three 或电机目标。
 */
import { Ray, Vector3 } from "three";
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

export class InteractionController {
  private mode: ToolMode = "select";
  private model: RobotModel | null = null;
  private selected: SelectedEntity | null = null;
  private drag: ActiveDrag | null = null;

  /** 输入意图出口（wire 到 targetStore，见 interactionStore） */
  onIntent: ((intent: InputIntent) => void) | null = null;
  /** 拾取出口 */
  onSelection: ((sel: SelectedEntity | null) => void) | null = null;

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

  /** 切换模式；拖拽中切换视为取消（不再发新意图） */
  setMode(mode: ToolMode): void {
    if (this.mode === mode) return;
    if (this.drag) this.cancelDrag();
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
}