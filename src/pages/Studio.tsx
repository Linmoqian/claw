// Created on 2026-09-27
// @author: https://github.com/Linmoqian
/** 仿真与调参工作区：关节控制、数字孪生和 PID 响应模型处于同一上下文。 */
import { useEffect, useState, type CSSProperties } from "react";
import { Camera, Pause, Play, RotateCcw, Ruler, Save, SlidersHorizontal, X } from "lucide-react";
import { Quaternion, Vector3 } from "three";
import JointCard from "../components/JointCard";
import PidSlider from "../components/PidSlider";
import SessionCard from "../components/SessionCard";
import WaveCanvas from "../components/WaveCanvas";

import { formatPose } from "../robot/kinematics";
import { describeCollision } from "../robot/collision";



import { useBridgeStore } from "../stores/bridgeStore";
import { parseRecording } from "../services/protocol/recording";
import { useDevice } from "../store/DeviceContext";

import { useWorkspaceStore } from "../cad/workspaceStore";
import { useInteractionStore, interactionController } from "../stores/interactionStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTargetStore } from "../stores/targetStore";
import {
  DEFAULT_ROBOT_ID,
  ROBOT_CATALOG,
  useReadyModel,
  useRobotStore,
} from "../stores/robotStore";
import { useSceneStore } from "../stores/sceneStore";
import { useSimulationStore } from "../stores/simulationStore";
import { cancelRuntimePreview, getRuntime, useRuntimeStore, awaitRuntimeReady } from "../workbench/runtime";
import { useActivityStore } from "../workbench/activity";
import { stopProgram } from "../workbench/programRunner";
import EyeHandPanel from "../components/EyeHandPanel";
import "./Studio.css";

/** 仿真速度档位 */
const SPEED_OPTIONS = [0.25, 0.5, 1, 2];

export default function Studio() {
  const [tuningOpen, setTuningOpen] = useState(false);
  const [eyeHandOpen, setEyeHandOpen] = useState(false);
  const eyeInHand = useRuntimeStore((state) => state.eyeInHand);
  const setEyeInHand = useRuntimeStore((state) => state.setEyeInHand);
  const ready = useRuntimeStore((state) => state.ready);
  const recordingLocked = useActivityStore((state) => state.recordingLocked);
  const recordingSuspended = useActivityStore((state) => state.recordingSuspended || state.replayPreparing);
  const programRunning = useActivityStore((state) => state.programRunning);
  const [mobilePanel, setMobilePanel] = useState("tools");
  const [consoleWidth, setConsoleWidth] = useState(348);
  const [legacyRobotId, setLegacyRobotId] = useState("");
  const model = useReadyModel();
  const status = useRobotStore((s) => s.status);
  const loadError = useRobotStore((s) => s.error);
  const currentId = useRobotStore((s) => s.currentId);
  const loadRobot = useRobotStore((s) => s.loadRobot);

  const speed = useSimulationStore((s) => s.speed);
  const mode = useSimulationStore((s) => s.mode);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const goHome = useSimulationStore((s) => s.goHome);
  const play = useSimulationStore((s) => s.play);
  const stop = useSimulationStore((s) => s.stop);

  const showTcpAxes = useSceneStore((s) => s.showTcpAxes);
  const showTrail = useSceneStore((s) => s.showTrail);
  const materialStyle = useSceneStore((s) => s.materialStyle);
  const toggleTcpAxes = useSceneStore((s) => s.toggleTcpAxes);
  const toggleTrail = useSceneStore((s) => s.toggleTrail);
  const toggleMaterialStyle = useSceneStore((s) => s.setMaterialStyle);
  const requestResetView = useSceneStore((s) => s.requestResetView);
  const requestFocus = useSceneStore((s) => s.requestFocus);
  const requestResetProps = useSceneStore((s) => s.requestResetProps);

  // 数据桥：SIM ↔ MOCK 真数据（TWIN 观察态），100ms 低频刷新健康快照
  const bridgeInfo = useBridgeStore((s) => s.info);
  const bridgeError = useBridgeStore((s) => s.lastError);
  const isLive = useBridgeStore((s) => s.isLive);
  const replay = useBridgeStore((s) => s.replay);
  const connectMock = useBridgeStore((s) => s.connectMock);
  const connectRemote = useBridgeStore((s) => s.connectRemote);
  const enterReplay = useBridgeStore((s) => s.enterReplay);
  const replayControl = useBridgeStore((s) => s.replayControl);
  const exitReplay = useBridgeStore((s) => s.exitReplay);
  const backToSim = useBridgeStore((s) => s.backToSim);
  const [liveUrl, setLiveUrl] = useState("");
  const [liveChecked, setLiveChecked] = useState(false);
  // M5 工作区与底座
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceSource = useWorkspaceStore((s) => s.source);
  const workspacePath = useWorkspaceStore((s) => s.path);
  const loadDemo = useWorkspaceStore((s) => s.loadDemo);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);
  const loadDxfText = useWorkspaceStore((s) => s.loadDxfText);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [basePlaying, setBasePlaying] = useState(false);

  // 交互系统：模式机 / 拾取 / 统一 Intent 发布（拖拽意图经 interactionStore 路由到会话层）
  const interactionMode = useInteractionStore((s) => s.mode);
  const selected = useInteractionStore((s) => s.selected);
  const setInteractionMode = useInteractionStore((s) => s.setMode);

  const {
    motors,
    selectedId,
    selectMotor,
    running: responseRunning,
    setRunning: setResponseRunning,
    tuneByMotor,
    dirtyByMotor,
    updateTune,
    saveTunePlan,
  } = useDevice();

  // 底座路径播放状态同步（200ms 低频轮询，避免高频 setState）
  useEffect(() => {
    const id = window.setInterval(() => {
      setBasePlaying(getRuntime()?.baseSim?.isPlaying ?? false);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => cancelRuntimePreview(), []);

  // ESC：取消活动拖拽/预览会话（M4；输入框聚焦时跳过）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      interactionController.cancelActiveDrag();
      const st = useSessionStore.getState();
      const s = st.session;
      if (s && s.phase === "preview") st.cancel(s.source);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 快捷键：F 聚焦 / R 重置视角（输入框聚焦时跳过）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") requestFocus();
      else if (e.key === "r" || e.key === "R") requestResetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestFocus, requestResetView]);

  // 系统命令包装：先中止活动会话（仲裁器清场）再执行仿真动作
  const runSystem = (fn: () => void) => () => {
    useSessionStore.getState().systemCommand();
    const activity = useActivityStore.getState();
    if (!useBridgeStore.getState().replay && !activity.programRunning && !activity.recordingSuspended && !activity.replayPreparing) fn();
  };

  // 3D 拾取与调参对象共用关节上下文；未拾取时沿用调参面板选择。
  useEffect(() => {
    const jointIndex = selected?.jointIndex;
    if (jointIndex === null || jointIndex === undefined) return;
    const motor = motors[jointIndex];
    if (motor && motor.id !== selectedId) selectMotor(motor.id);
  }, [motors, selectMotor, selected?.jointIndex, selectedId]);

  const applyEyeHandIk = (position: Vector3, quaternion: Quaternion) => {
    if (!ready || replay || recordingSuspended) return;
    getRuntime()?.sim?.setTcpTargetPose(position, quaternion);
  };
  const tcpText = formatPose(snapshot.tcp);
  const validation = useTargetStore((s) => s.validation);
  const progressPct = Math.min(100, Math.max(0, snapshot.progress * 100));
  const tuningMotor = motors.find((motor) => motor.id === selectedId) ?? motors[0];
  const selectedTune = tuneByMotor[tuningMotor.id];
  const tuningDirty = dirtyByMotor[tuningMotor.id];
  const speedDisabled = replay !== null || bridgeInfo.kind !== "simulation" || recordingSuspended;
  const speedDisabledReason = replay
    ? "回放速度请使用上方回放倍速；退出回放后可调整仿真速度。"
    : recordingSuspended
      ? "请等待实验保存或回放准备完成后调整仿真速度。"
      : "请断开遥测链路并返回仿真后调整仿真速度。";

  return (
    <div className={`studio studio--${mobilePanel}`} style={{ "--studio-console-width": `${consoleWidth}px` } as CSSProperties}>
      <div className="workbench-panel-tabs studio__panel-tabs">
        <div className="studio__tab-buttons" role="tablist" aria-label="仿真面板">
          <button type="button" role="tab" aria-selected={mobilePanel === "tools"} onClick={() => setMobilePanel("tools")}>工具</button>
          <button type="button" role="tab" aria-selected={mobilePanel === "scene"} onClick={() => setMobilePanel("scene")}>场景</button>
        </div>
        <button type="button" className="studio__quick-stop" onClick={() => { stopProgram(); stop(); }} title="停止当前程序与仿真运动；硬件急停使用右下角按钮">停止仿真</button>
      </div>
      {/* 左：控制台 */}
      <aside className="studio__console">
        <div className="studio__console-scroll" role="region" aria-label="仿真参数与关节" tabIndex={0}>
        <header className="studio__head">
          <div className="studio__title-row">
            <h1 className="studio__title">仿真工作台</h1>
            <span className="studio__subtitle serif">
              {model?.def.name ?? "so_arm100"}
            </span>
          </div>
          <div className="studio__status">
            <span className="studio__status-chip">
              <i className={`studio__status-dot is-${bridgeInfo.status}`} />
              {replay
                ? "记录回放"
                : bridgeInfo.kind === "simulation"
                ? "仿真联动"
                : bridgeInfo.status === "connected"
                  ? "遥测联动"
                  : bridgeInfo.status === "connecting" ? "正在连接" : "链路中断"}
            </span>
            <span className="studio__status-note">
              {replay
                ? "历史运动 · 只读"
                : bridgeInfo.kind === "simulation"
                ? "SIM · 无硬件链路"
                : bridgeInfo.status === "connected"
                  ? isLive ? "WebSocket · LIVE 可下发" : "WebSocket · TWIN 只读"
                  : "WebSocket · 保持最后位姿"}
            </span>
          </div>
        </header>

        <label className="studio__width-control">工具区宽度<input type="range" min="300" max="470" value={consoleWidth} onChange={(event) => setConsoleWidth(Number(event.target.value))} /></label>
        {/* 数据链路卡：SIM / TWIN / LIVE / 回放 四态 + 录制组 */}
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
            /* —— SIM 态：连接组 + 录制组 —— */
            <>
              <div className="studio__replay-row">
                <button type="button" className="studio__link-btn" disabled={recordingLocked || programRunning} onClick={() => void connectMock()}>
                  接入 MOCK
                </button>
                <input
                  className="studio__link-url"
                  type="text"
                  placeholder="ws://真机地址:端口"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                />
                <label className="studio__link-check">
                  <input
                    type="checkbox"
                    checked={liveChecked}
                    onChange={(e) => setLiveChecked(e.target.checked)}
                  />
                  LIVE
                </label>
                <button
                  type="button"
                  className={`studio__link-btn ${liveChecked ? "is-live" : ""}`}
                  disabled={!liveUrl.trim().startsWith("ws") || recordingLocked || programRunning}
                  onClick={() => void connectRemote(liveUrl.trim(), liveChecked)}
                >
                  连接
                </button>
              </div>
              <p className="studio__experiment-note">使用顶部“开始实验”采集运动，结束后在实验记录中查看、导出和回放。</p>
              <div className="studio__replay-row">
                <select aria-label="旧录像对应机型" value={legacyRobotId} onChange={(event) => setLegacyRobotId(event.target.value)} disabled={recordingLocked || programRunning}>
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
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
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
                    }}
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

        <div className="studio__speed">
          <span className="studio__speed-label">仿真速度</span>
          <div className="studio__speed-options" role="group" aria-label="仿真速度">
            {SPEED_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                className={`studio__speed-opt ${speed === v ? "is-on" : ""}`}
                onClick={() => setSpeed(v)}
                disabled={speedDisabled}
                title={speedDisabled ? speedDisabledReason : `仿真速度 ${v} 倍`}
                aria-describedby={speedDisabled ? "studio-simulation-speed-note" : undefined}
                aria-pressed={speed === v}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>

        {speedDisabled && <p id="studio-simulation-speed-note" className="studio__experiment-note">{speedDisabledReason}</p>}

        {recordingSuspended && <p className="studio__experiment-note" role="status">运动已暂停，请等待实验保存或回放准备完成；保存失败时请先重试。</p>}
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

        </div>
        <footer className="studio__actions">
          <button
            type="button"
            className="studio__btn studio__btn-danger"
            onClick={() => { stopProgram(); stop(); }}
          >
            <i aria-hidden="true">■</i>
            STOP
          </button>
          <button
            type="button"
            className={`studio__btn ${mode === "homing" ? "is-active" : ""}`}
            onClick={runSystem(goHome)}
            disabled={!!replay || programRunning || recordingSuspended}
            title={recordingSuspended ? "请等待实验保存或回放准备完成" : replay ? "请退出回放后操作" : programRunning ? "请先停止积木程序" : "机械臂返回零位"}
          >
            回零位
          </button>
          <button
            type="button"
            className="studio__btn"
            onClick={requestResetView}
          >
            重置视角
          </button>
          <button
            type="button"
            className={`studio__btn ${mode === "play" ? "is-play" : ""}`}
            onClick={runSystem(mode === "play" ? stop : play)}
            disabled={!!replay || programRunning || recordingSuspended}
            aria-pressed={mode === "play"}
          >
            {mode === "play" ? "停止轨迹" : "播放轨迹"}
          </button>
        </footer>
        <p className="studio__stop-note">
          ※ STOP 为仿真停止（冻结轨迹），非硬件急停
        </p>
      </aside>

      {/* 右：3D 世界 */}
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
              <strong>
                正在装配{" "}
                {
                  ROBOT_CATALOG.find(
                    (r) => r.id === (currentId ?? DEFAULT_ROBOT_ID),
                  )?.label
                }{" "}
                数字孪生体…
              </strong>
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
            onApplyIk={applyEyeHandIk}
          />
        )}

        {/* 顶部悬浮层：链路 / 安全 / 交互模式 / 视图工具（窄舞台自动换行，互不遮挡） */}
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

        {/* M5 工作区卡：DXF 加载 / 示例 / 路径播放（悬浮左下） */}
        <div className="studio__workspace">
          <div className="studio__workspace-row">
            <span className="studio__workspace-label">工作区</span>
            <span className="studio__workspace-src">
              {workspace ? (workspaceSource ?? "已加载") : "未加载"}
            </span>
            <label className="studio__workspace-btn">
              载入 DXF
              <input
                type="file"
                accept=".dxf"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const text = await file.text();
                  const r = loadDxfText(text, file.name);
                  setWorkspaceError(r.ok ? null : (r.reason ?? "解析失败"));
                }}
              />
            </label>
            {!workspace ? (
              <button type="button" className="studio__workspace-btn" onClick={loadDemo}>
                内置示例
              </button>
            ) : (
              <button type="button" className="studio__workspace-btn" onClick={clearWorkspace}>
                清除
              </button>
            )}
          </div>
          {workspacePath.length > 0 && (
            <div className="studio__workspace-row">
              <span className="studio__workspace-label">底座路径</span>
              <span className="studio__workspace-src tnum">
                {workspacePath.length} 点
              </span>
              <button
                type="button"
                className={`studio__workspace-btn ${basePlaying ? "is-play" : ""}`}
                disabled={!!replay || programRunning || recordingSuspended}
                title={recordingSuspended ? "请等待实验保存或回放准备完成" : replay ? "回放期间禁止运行路径" : "播放底盘路径"}
                onClick={() => {
                  if (replay || programRunning || recordingSuspended) return;
                  const b = getRuntime()?.baseSim;
                  if (!b) return;
                  useSessionStore.getState().systemCommand();
                  if (b.isPlaying) b.stopPath();
                  else b.playPath(workspacePath);
                }}
              >
                {basePlaying ? "停止底座" : "播放路径"}
              </button>
            </div>
          )}
          {workspaceError && (
            <p className="studio__workspace-error">{workspaceError}</p>
          )}
        </div>

        <div className="studio__hint">
          {interactionMode === "select"
            ? "单击部件高亮 · 再拖拽高亮部件调整关节 · 空白处拖拽旋转视角 · 滚轮缩放"
            : interactionMode === "joint"
              ? "拖拽高亮部件调整关节 · 滚轮缩放 · 松开即生效"
              : interactionMode === "tcp"
                ? "拖拽彩轴平移末端 · 拖彩环转向 · IK 实时解算 · Ghost 预览目标 · 松开生效"
                : "拖拽底盘在地面上移动 · 松开后底盘限速跟随 · 路径播放时自动转向切线"}
        </div>
        {validation.reason && (
          <div className="studio__vbadge">{validation.reason}</div>
        )}

        {/* M4 命令会话卡：预览/提交/被拒状态（底部中央，hint 之上） */}
        <div className="studio__session">
          <SessionCard />
        </div>
      </section>

      <aside
        className={`studio__tuning ${tuningOpen ? "is-open" : ""}`}
        aria-label="PID 调参检查器"
      >
        <header className="studio__tuning-head">
          <div>
            <span className="studio__tuning-eyebrow">响应模型</span>
            <h2>PID 调参</h2>
          </div>
          <button
            type="button"
            className="studio__tuning-close"
            onClick={() => setTuningOpen(false)}
            aria-label="关闭调参检查器"
          >
            <X size={15} />
          </button>
        </header>

        <div className="studio__tuning-source">
          <span>当前对象</span>
          <strong>{tuningMotor.code} · {tuningMotor.name}</strong>
          <i>SIM</i>
        </div>

        <div className="studio__tuning-joints" role="tablist" aria-label="调参关节">
          {motors.map((motor) => (
            <button
              key={motor.id}
              type="button"
              role="tab"
              className={motor.id === tuningMotor.id ? "is-on" : ""}
              aria-selected={motor.id === tuningMotor.id}
              onClick={() => selectMotor(motor.id)}
            >
              {motor.code}
            </button>
          ))}
        </div>

        <section className="studio__response" aria-label="PID 响应仿真曲线">
          <div className="studio__response-head">
            <span>阶跃响应</span>
            <span><i className="is-sp" />目标 SP</span>
            <span><i className="is-pv" />仿真 PV</span>
          </div>
          <WaveCanvas
            motor={tuningMotor}
            tune={selectedTune}
            running={responseRunning}
          />
        </section>

        <p className="studio__tuning-note">
          参数仅作用于响应模型；通过仿真验证后，再由机器人适配器决定是否允许下发实机。
        </p>

        <div className="studio__tuning-params">
          <PidSlider
            label="比例"
            symbol="P"
            value={selectedTune.kp}
            min={0}
            max={50}
            step={0.1}
            onChange={(value) => updateTune(tuningMotor.id, { kp: value })}
          />
          <PidSlider
            label="积分"
            symbol="I"
            value={selectedTune.ki}
            min={0}
            max={5}
            step={0.01}
            onChange={(value) => updateTune(tuningMotor.id, { ki: value })}
          />
          <PidSlider
            label="微分"
            symbol="D"
            value={selectedTune.kd}
            min={0}
            max={10}
            step={0.05}
            onChange={(value) => updateTune(tuningMotor.id, { kd: value })}
          />
        </div>

        <footer className="studio__tuning-actions">
          <button
            type="button"
            className={`studio__tuning-run ${responseRunning ? "is-running" : ""}`}
            onClick={() => setResponseRunning(!responseRunning)}
          >
            {responseRunning ? <Pause size={14} /> : <Play size={14} />}
            {responseRunning ? "暂停响应" : "运行响应"}
          </button>
          <button
            type="button"
            className={`studio__tuning-save ${tuningDirty ? "is-dirty" : ""}`}
            onClick={() => saveTunePlan(tuningMotor.id)}
          >
            <Save size={14} />
            {tuningDirty ? "保存草案" : "已保存"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
