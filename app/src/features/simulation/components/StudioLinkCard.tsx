// 数据链路卡：SIM / TWIN / LIVE / 回放四态展示与回放控制、旧录像导入。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import type { ChangeEvent } from "react";
import { useActivityStore } from "../../../stores/activity";
import { useBridgeStore } from "../../../stores/bridgeStore";
import { ROBOT_CATALOG, useRobotStore } from "../../../stores/robotStore";
import type { BridgeStatus } from "../../../services/bridge";
import { parseRecording, type RecFrame } from "../../../services/protocol/recording";
import { awaitRuntimeReady } from "../../workbench/runtime/runtime";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

type StudioLinkCardProps = {
  bridgeInfo: BridgeStatus;
  bridgeError: string | null;
  isLive: boolean;
  replay: ReplaySnapshot | null;
  replayControl: (cmd: "play" | "pause" | "seek" | "rate", value?: number) => void;
  exitReplay: () => Promise<void>;
  backToSim: () => Promise<void>;
  enterReplay: (frames: RecFrame[], options?: { replayPreparation?: boolean }) => Promise<void>;
  recordingLocked: boolean;
  programRunning: boolean;
  legacyRobotId: string;
  onLegacyRobotIdChange: (robotId: string) => void;
  loadRobot: (id: string, options?: { replayPreparation?: boolean }) => Promise<void>;
};

export default function StudioLinkCard({
  bridgeInfo,
  bridgeError,
  isLive,
  replay,
  replayControl,
  exitReplay,
  backToSim,
  enterReplay,
  recordingLocked,
  programRunning,
  legacyRobotId,
  onLegacyRobotIdChange,
  loadRobot,
}: StudioLinkCardProps) {
  // 旧录像导入：解析录像 → 预备加载对应机型 → 进入回放（失败提示并复位准备态）
  const handleLegacyRecordingImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const activity = useActivityStore.getState();
    if (activity.recordingLocked || activity.programRunning || activity.replayPreparing
      || activity.serialTransition || activity.channelTransition || activity.hardwareConnected) {
      useBridgeStore.setState({ lastError: "请结束实验、停止程序并断开硬件链路后导入回放" });
      return;
    }
    useActivityStore.setState({ replayPreparing: true });
    try {
      const rec = parseRecording(await file.text());
      await loadRobot(legacyRobotId, { replayPreparation: true });
      const loaded = useRobotStore.getState();
      if (loaded.currentId !== legacyRobotId || loaded.status !== "ready")
        throw new Error(loaded.error ?? "录像机型加载失败");
      await awaitRuntimeReady(loaded.model);
      await enterReplay(rec.frames, { replayPreparation: true });
    } catch (err) {
      useBridgeStore.setState({
        lastError: `导入失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      useActivityStore.setState({ replayPreparing: false });
    }
  };

  return (
    <div className="studio__link">
      <div className="studio__link-row">
        <span className="studio__link-label">数据链路</span>
        <span
          className={`studio__link-chip is-${replay ? "connected" : bridgeInfo.status}${isLive ? " is-live" : ""}`}
        >
          {replay
            ? "记录回放 · 只读"
            : bridgeInfo.kind === "simulation"
              ? "SIM"
              : bridgeInfo.status === "connected"
                ? isLive
                  ? "LIVE ✓"
                  : "LINK ✓"
                : bridgeInfo.status === "connecting"
                  ? "重连中…"
                  : "已断开"}
        </span>
      </div>

      {/* —— 回放态：控制条 —— */}
      {replay ? (
        <>
          <div className="studio__replay-track">
            <input
              type="range"
              min={0}
              max={Math.max(replay.duration, 0.01)}
              step={0.05}
              value={replay.position}
              onChange={(e) => replayControl("seek", Number(e.target.value))}
              aria-label="回放进度"
            />
            <span className="studio__replay-time tnum">
              {replay.position.toFixed(1)}/{replay.duration.toFixed(1)}s
            </span>
          </div>
          <div className="studio__replay-row studio__replay-actions">
            <button
              type="button"
              className="studio__link-btn"
              onClick={() => replayControl(replay.playing ? "pause" : "play")}
            >
              {replay.playing ? "⏸ 暂停" : "▶ 播放"}
            </button>
            {[0.5, 1, 2].map((r) => (
              <button
                key={r}
                type="button"
                className={`studio__link-btn ${replay.rate === r ? "is-on" : ""}`}
                onClick={() => replayControl("rate", r)}
                aria-label={`回放速度 ${r} 倍`}
                aria-pressed={replay.rate === r}
              >
                {r}×
              </button>
            ))}
            <button type="button" className="studio__link-btn" onClick={() => void exitReplay()}>
              退出回放
            </button>
          </div>
        </>
      ) : bridgeInfo.kind === "simulation" ? (
        /* —— SIM 态：本地实验与旧录像导入 —— */
        <>
          <p className="studio__experiment-note">使用顶部“开始实验”采集运动，结束后在实验记录中查看、导出和回放。</p>
          <div className="studio__replay-row">
            <select aria-label="旧录像对应机型" value={legacyRobotId} onChange={(event) => onLegacyRobotIdChange(event.target.value)} disabled={recordingLocked || programRunning}>
              <option value="">选择旧录像机型</option>
              {ROBOT_CATALOG.map((robot) => <option key={robot.id} value={robot.id}>{robot.label}</option>)}
            </select>
            <label className="studio__link-btn">
              导入回放
              <input
                type="file"
                accept=".json"
                disabled={!legacyRobotId || recordingLocked || programRunning}
                hidden
                onChange={handleLegacyRecordingImport}
              />
            </label>
          </div>
        </>
      ) : (
        /* —— TWIN/LIVE 态 —— */
        <>
          <div className="studio__link-meta tnum">
            <span>
              {bridgeInfo.messageRateHz !== null
                ? `${bridgeInfo.messageRateHz.toFixed(1)} Hz`
                : "—Hz"}
            </span>
            <span>
              {bridgeInfo.latencyMs !== null
                ? `${bridgeInfo.latencyMs} ms`
                : "—ms"}
            </span>
            {isLive && <span className="studio__live-badge">可下发</span>}
          </div>
          <button
            type="button"
            className="studio__link-btn"
            disabled={recordingLocked || programRunning} onClick={() => void backToSim()}
          >
            断开 · 回仿真
          </button>
        </>
      )}
      {bridgeError && (
        <p className="studio__link-error">{bridgeError}</p>
      )}
    </div>
  );
}
