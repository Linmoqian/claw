// 3D 舞台插槽：RuntimeHost 挂载点（data-runtime-slot）、加载回退与眼在手面板。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import type { ReactNode } from "react";
import type { Quaternion, Vector3 } from "three";
import EyeHandPanel from "./EyeHandPanel";
import LoadingState from "../../../components/workbench/LoadingState";
import { DEFAULT_ROBOT_ID, ROBOT_CATALOG } from "../../../stores/robotStore";
import type { RobotModel } from "../../../robot/types";
import type { SimSnapshot } from "../../../robot/simulation";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

/** 机型加载状态（robotStore 内部同构联合） */
type RobotLoadStatus = "idle" | "loading" | "ready" | "error";

type StudioStageProps = {
  ready: boolean;
  status: RobotLoadStatus;
  loadError: string | null;
  currentId: string | null;
  loadRobot: (id: string, options?: { replayPreparation?: boolean }) => Promise<void>;
  model: RobotModel | null;
  snapshot: SimSnapshot;
  recordingSuspended: boolean;
  replay: ReplaySnapshot | null;
  eyeHandOpen: boolean;
  eyeInHand: boolean;
  setEyeInHand: (enabled: boolean) => void;
  onApplyIk: (position: Vector3, quaternion: Quaternion) => void;
  children: ReactNode;
};

export default function StudioStage({
  ready,
  status,
  loadError,
  currentId,
  loadRobot,
  model,
  snapshot,
  recordingSuspended,
  replay,
  eyeHandOpen,
  eyeInHand,
  setEyeInHand,
  onApplyIk,
  children,
}: StudioStageProps) {
  return (
    <section
      data-runtime-slot
      className="studio__stage"
      onContextMenu={(event) => event.preventDefault()}
    >
      {!ready && (
        <div className="studio__fallback">
          {status === "error" ? (
            <>
              <strong>模型加载失败</strong>
              <span>{loadError}</span>
              <button
                type="button"
                className="studio__btn"
                onClick={() =>
                  void loadRobot(currentId ?? DEFAULT_ROBOT_ID)
                }
              >
                重试
              </button>
            </>
          ) : (
            <LoadingState
              variant="scene"
              label={`正在装配 ${ROBOT_CATALOG.find((r) => r.id === (currentId ?? DEFAULT_ROBOT_ID))?.label ?? "机械臂"}`}
              detail="准备数字孪生场景…"
            />
          )}
        </div>
      )}

      {model && (
        <EyeHandPanel
          key={currentId ?? DEFAULT_ROBOT_ID}
          model={model}
          snapshot={snapshot}
          ready={ready && !recordingSuspended}
          replay={replay !== null}
          open={eyeHandOpen}
          eyeInHand={eyeInHand}
          onEyeInHandChange={setEyeInHand}
          onApplyIk={onApplyIk}
        />
      )}

      {children}
    </section>
  );
}
