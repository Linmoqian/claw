// 关节面板：关节控制组、轨迹进度条、拾取联动提示与 TCP 位姿读数。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import JointCard from "./JointCard";
import { formatPose } from "../../../robot/kinematics";
import { useSessionStore } from "../../../stores/sessionStore";
import type { RobotModel } from "../../../robot/types";
import type { SimMode, SimSnapshot } from "../../../robot/simulation";
import type { SelectedEntity, ToolMode } from "../../../interaction/types";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

type StudioJointPanelProps = {
  model: RobotModel | null;
  snapshot: SimSnapshot;
  selected: SelectedEntity | null;
  replay: ReplaySnapshot | null;
  programRunning: boolean;
  recordingSuspended: boolean;
  mode: SimMode;
  interactionMode: ToolMode;
};

export default function StudioJointPanel({
  model,
  snapshot,
  selected,
  replay,
  programRunning,
  recordingSuspended,
  mode,
  interactionMode,
}: StudioJointPanelProps) {
  const tcpText = formatPose(snapshot.tcp);
  const progressPct = Math.min(100, Math.max(0, snapshot.progress * 100));

  return (
    <>
      <fieldset className="studio__joints" aria-label="关节控制" disabled={!!replay || programRunning || recordingSuspended}>
        {model?.active.map((joint, i) => (
          <JointCard
            key={joint.def.name}
            joint={joint}
            panelIndex={i}
            valueDeg={snapshot.currentDeg[i] ?? 0}
            targetDeg={snapshot.targetDeg[i] ?? 0}
            previewDeg={snapshot.previewDeg?.[i] ?? null}
            selected={selected?.jointIndex === i}
            onPreview={(idx, deg) => {
              if (replay || programRunning || recordingSuspended) return;
              const st = useSessionStore.getState();
              const active =
                st.session?.source === "slider" && st.session.phase === "preview";
              if (!active && !st.begin("slider")) return;
              st.previewJoint(
                "slider",
                idx,
                model?.active[idx]?.code ?? `J${idx + 1}`,
                deg,
              );
            }}
            onCommit={() => useSessionStore.getState().commit("slider")}
          />
        ))}
      </fieldset>

      {mode === "play" && (
        <div className="studio__progress" aria-label="轨迹进度">
          <i style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* 拾取联动提示：点选 3D 部件 → 左侧定位对应关节 */}
      {selected && (
        <div className="studio__pick">
          <span className="studio__pick-link">Link {selected.linkName}</span>
          {selected.jointName && (
            <span className="studio__pick-joint tnum">
              · 关节 {selected.jointName}
              {selected.jointIndex !== null && ` (J${selected.jointIndex + 1})`}
            </span>
          )}
        </div>
      )}

      {/* 末端位置读数（URDF/ROS 坐标） */}
      <div className="studio__tcp">
        <div className="studio__tcp-row">
          <span className="studio__tcp-label">TCP 位置</span>
          <span className="studio__tcp-value tnum">
            {tcpText.xyz}
            <i>m</i>
          </span>
        </div>
        {snapshot.tcpTarget && interactionMode === "tcp" && (
          <div className="studio__tcp-row is-target">
            <span className="studio__tcp-label">TCP 目标</span>
            <span className="studio__tcp-value tnum">
              {formatPose(snapshot.tcpTarget).xyz}
              <i>m</i>
            </span>
          </div>
        )}
        <div className="studio__tcp-row">
          <span className="studio__tcp-label">RPY</span>
          <span className="studio__tcp-value tnum">
            {tcpText.rpy}
            <i>°</i>
          </span>
        </div>
      </div>
    </>
  );
}
