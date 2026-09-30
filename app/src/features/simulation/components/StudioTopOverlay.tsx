// 顶部悬浮层：链路 HUD、碰撞安全提示、交互模式工具条与视图工具（窄舞台自动换行）。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { Camera, Ruler, RotateCcw, SlidersHorizontal } from "lucide-react";
import { describeCollision } from "../../../robot/collision";
import { DEFAULT_ROBOT_ID, ROBOT_CATALOG } from "../../../stores/robotStore";
import type { MaterialStyle } from "../../../stores/sceneStore";
import type { BridgeStatus } from "../../../services/bridge";
import type { SimSnapshot } from "../../../robot/simulation";
import type { ToolMode } from "../../../interaction/types";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

/** 机型加载状态（robotStore 内部同构联合） */
type RobotLoadStatus = "idle" | "loading" | "ready" | "error";

type StudioTopOverlayProps = {
  bridgeInfo: BridgeStatus;
  replay: ReplaySnapshot | null;
  isLive: boolean;
  snapshot: SimSnapshot;
  interactionMode: ToolMode;
  setInteractionMode: (mode: ToolMode) => void;
  currentId: string | null;
  loadRobot: (id: string, options?: { replayPreparation?: boolean }) => Promise<void>;
  status: RobotLoadStatus;
  recordingLocked: boolean;
  programRunning: boolean;
  eyeInHand: boolean;
  setEyeInHand: (enabled: boolean) => void;
  eyeHandOpen: boolean;
  setEyeHandOpen: (open: boolean) => void;
  showTcpAxes: boolean;
  toggleTcpAxes: () => void;
  showTrail: boolean;
  toggleTrail: () => void;
  materialStyle: MaterialStyle;
  toggleMaterialStyle: (style: MaterialStyle) => void;
  requestResetProps: () => void;
  setTuningOpen: (open: boolean) => void;
};

export default function StudioTopOverlay({
  bridgeInfo,
  replay,
  isLive,
  snapshot,
  interactionMode,
  setInteractionMode,
  currentId,
  loadRobot,
  status,
  recordingLocked,
  programRunning,
  eyeInHand,
  setEyeInHand,
  eyeHandOpen,
  setEyeHandOpen,
  showTcpAxes,
  toggleTcpAxes,
  showTrail,
  toggleTrail,
  materialStyle,
  toggleMaterialStyle,
  requestResetProps,
  setTuningOpen,
}: StudioTopOverlayProps) {
  return (
    <div className="studio__top">
      {/* 链接状态 HUD（悬浮于 3D 左上） */}
      <div className={`studio__hud is-${bridgeInfo.status}`}>
        <span className="studio__hud-kind">
          {replay ? "记录回放 · 只读" : bridgeInfo.kind === "simulation" ? "SIM" : isLive ? "LIVE WS" : "TWIN WS"}
        </span>
        {bridgeInfo.kind !== "simulation" && (
          <span className="studio__hud-meta tnum">
            {replay
              ? `${replay.playing ? "播放中" : "已暂停"} · ${replay.rate}×`
              : bridgeInfo.status === "connected"
              ? `${(bridgeInfo.messageRateHz ?? 0).toFixed(1)} Hz · ${bridgeInfo.latencyMs ?? "—"} ms`
              : bridgeInfo.status === "connecting"
                ? "自动重连中…"
                : "disconnected · 原位保持"}
          </span>
        )}
      </div>

      {/* 碰撞安全 HUD（环境档位 + 自碰撞 + 静态物体；档位随现实构型刷新） */}
      {snapshot.collisionEnabled && (
        <div className={`studio__safety is-${snapshot.collision.tier}`}>
          <i className="studio__safety-dot" aria-hidden="true" />
          <span className="studio__safety-label">碰撞</span>
          <span className="studio__safety-value">
            {snapshot.collision.selfCollision
              ? "自碰撞"
              : snapshot.collision.tier === "clear"
                ? "安全"
                : describeCollision(snapshot.collision)}
          </span>
        </div>
      )}

      <div className="studio__modes" role="toolbar" aria-label="交互模式">
        <button
          type="button"
          className={interactionMode === "select" ? "is-on" : ""}
          onClick={() => setInteractionMode("select")}
          aria-pressed={interactionMode === "select"}
        >
          <i aria-hidden="true">↖</i>
          部件直调
        </button>
        <button
          type="button"
          className={interactionMode === "tcp" ? "is-on" : ""}
          onClick={() => setInteractionMode("tcp")}
          aria-pressed={interactionMode === "tcp"}
        >
          <i aria-hidden="true">✥</i>
          TCP
        </button>
        <button
          type="button"
          className={interactionMode === "base" ? "is-on" : ""}
          onClick={() => setInteractionMode("base")}
          aria-pressed={interactionMode === "base"}
        >
          <i aria-hidden="true">⌖</i>
          底座
        </button>

        {/* 机型选择：public/models 内置机械臂目录（切换后碰撞/仿真/视图自动重建） */}
        <label className="studio__model-pick">
          <i aria-hidden="true">⚙</i>
          <select
            value={currentId ?? DEFAULT_ROBOT_ID}
            onChange={(e) => void loadRobot(e.target.value)}
            disabled={status === "loading" || recordingLocked || programRunning || replay !== null}
            aria-label="选择机械臂机型"
          >
            {ROBOT_CATALOG.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 视图工具条（悬浮） */}
      <div className="studio__scene-tools">
        <button
          type="button"
          className={eyeInHand ? "is-on" : ""}
          onClick={() => setEyeInHand(!eyeInHand)}
          aria-pressed={eyeInHand}
          title="切换固定仿真相机与 TCP 眼在手相机"
        >
          <Camera size={13} />
          眼在手
        </button>
        <button
          type="button"
          className={eyeHandOpen ? "is-on" : ""}
          onClick={() => setEyeHandOpen(!eyeHandOpen)}
          aria-pressed={eyeHandOpen}
          title="打开眼在手标定模拟面板"
        >
          <Ruler size={13} />
          标定
        </button>
        <button
          type="button"
          className={showTcpAxes ? "is-on" : ""}
          onClick={toggleTcpAxes}
          aria-pressed={showTcpAxes}
        >
          TCP 轴
        </button>
        <button
          type="button"
          className={showTrail ? "is-on" : ""}
          onClick={toggleTrail}
          aria-pressed={showTrail}
        >
          轨迹线
        </button>
        <button
          type="button"
          className={materialStyle === "urdf" ? "is-on" : ""}
          onClick={() =>
            toggleMaterialStyle(materialStyle === "chalk" ? "urdf" : "chalk")
          }
          aria-pressed={materialStyle === "urdf"}
        >
          {materialStyle === "chalk" ? "浅灰涂装" : "URDF 配色"}
        </button>
        <button
          type="button"
          onClick={requestResetProps}
          title="将水杯和咖啡机恢复到初始位置与姿态"
        >
          <RotateCcw size={13} />
          物体复位
        </button>
        <button
          type="button"
          className="studio__tune-toggle"
          onClick={() => setTuningOpen(true)}
        >
          <SlidersHorizontal size={13} />
          调参
        </button>
      </div>
    </div>
  );
}
