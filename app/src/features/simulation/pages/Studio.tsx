// Created on 2026-09-27
// @author: https://github.com/Linmoqian
/** 仿真与调参工作区：关节控制、数字孪生和 PID 响应模型处于同一上下文。 */
import { useEffect, useState, type CSSProperties } from "react";
import { Quaternion, Vector3 } from "three";
import SessionCard from "../components/SessionCard";
import StudioActionBar from "../components/StudioActionBar";
import StudioJointPanel from "../components/StudioJointPanel";
import StudioLinkCard from "../components/StudioLinkCard";
import StudioStage from "../components/StudioStage";
import StudioTopOverlay from "../components/StudioTopOverlay";
import StudioTuningDrawer from "../components/StudioTuningDrawer";
import StudioWorkspaceCard from "../components/StudioWorkspaceCard";

import { useBridgeStore } from "../../../stores/bridgeStore";
import { useDevice } from "../../../stores/DeviceContext";

import { useWorkspaceStore } from "../../../cad/workspaceStore";
import { interactionController, useInteractionStore } from "../../../stores/interactionStore";
import { useSessionStore } from "../../../stores/sessionStore";
import { useTargetStore } from "../../../stores/targetStore";
import { useReadyModel, useRobotStore } from "../../../stores/robotStore";
import { useSceneStore } from "../../../stores/sceneStore";
import { useSimulationStore } from "../../../stores/simulationStore";
import { cancelRuntimePreview, getRuntime, useRuntimeStore } from "../../workbench/runtime/runtime";
import { useActivityStore } from "../../../stores/activity";
import { stopProgram } from "../../workbench/runtime/programRunner";
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
  const enterReplay = useBridgeStore((s) => s.enterReplay);
  const replayControl = useBridgeStore((s) => s.replayControl);
  const exitReplay = useBridgeStore((s) => s.exitReplay);
  const backToSim = useBridgeStore((s) => s.backToSim);
  // M5 工作区与底座
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceSource = useWorkspaceStore((s) => s.source);
  const workspacePath = useWorkspaceStore((s) => s.path);
  const loadDemo = useWorkspaceStore((s) => s.loadDemo);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);
  const loadDxfText = useWorkspaceStore((s) => s.loadDxfText);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // 交互系统：模式机 / 拾取 / 统一 Intent 发布（拖拽意图经 interactionStore 路由到会话层）
  const interactionMode = useInteractionStore((s) => s.mode);
  const selected = useInteractionStore((s) => s.selected);
  const setInteractionMode = useInteractionStore((s) => s.setMode);

  // 设备状态：页面只保留拾取 → 调参联所需的子集（调参抽屉内部另行取全量）
  const { motors, selectedId, selectMotor } = useDevice();

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
  const validation = useTargetStore((s) => s.validation);
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
        <button type="button" className="studio__quick-stop" onClick={() => { stopProgram(); stop(); }} title="停止当前程序与仿真运动">停止仿真</button>
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
        <StudioLinkCard
          bridgeInfo={bridgeInfo}
          bridgeError={bridgeError}
          isLive={isLive}
          replay={replay}
          replayControl={replayControl}
          exitReplay={exitReplay}
          backToSim={backToSim}
          enterReplay={enterReplay}
          recordingLocked={recordingLocked}
          programRunning={programRunning}
          legacyRobotId={legacyRobotId}
          onLegacyRobotIdChange={setLegacyRobotId}
          loadRobot={loadRobot}
        />

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
        <StudioJointPanel
          model={model}
          snapshot={snapshot}
          selected={selected}
          replay={replay}
          programRunning={programRunning}
          recordingSuspended={recordingSuspended}
          mode={mode}
          interactionMode={interactionMode}
        />

        </div>
        <StudioActionBar
          mode={mode}
          replay={replay}
          programRunning={programRunning}
          recordingSuspended={recordingSuspended}
          goHome={goHome}
          play={play}
          stop={stop}
          requestResetView={requestResetView}
          runSystem={runSystem}
        />
      </aside>

      {/* 右：3D 世界 */}
      <StudioStage
        ready={ready}
        status={status}
        loadError={loadError}
        currentId={currentId}
        loadRobot={loadRobot}
        model={model}
        snapshot={snapshot}
        recordingSuspended={recordingSuspended}
        replay={replay}
        eyeHandOpen={eyeHandOpen}
        eyeInHand={eyeInHand}
        setEyeInHand={setEyeInHand}
        onApplyIk={applyEyeHandIk}
      >
        {/* 顶部悬浮层：链路 / 安全 / 交互模式 / 视图工具（窄舞台自动换行，互不遮挡） */}
        <StudioTopOverlay
          bridgeInfo={bridgeInfo}
          replay={replay}
          isLive={isLive}
          snapshot={snapshot}
          interactionMode={interactionMode}
          setInteractionMode={setInteractionMode}
          currentId={currentId}
          loadRobot={loadRobot}
          status={status}
          recordingLocked={recordingLocked}
          programRunning={programRunning}
          eyeInHand={eyeInHand}
          setEyeInHand={setEyeInHand}
          eyeHandOpen={eyeHandOpen}
          setEyeHandOpen={setEyeHandOpen}
          showTcpAxes={showTcpAxes}
          toggleTcpAxes={toggleTcpAxes}
          showTrail={showTrail}
          toggleTrail={toggleTrail}
          materialStyle={materialStyle}
          toggleMaterialStyle={toggleMaterialStyle}
          requestResetProps={requestResetProps}
          setTuningOpen={setTuningOpen}
        />

        {/* M5 工作区卡：DXF 加载 / 示例 / 路径播放（悬浮左下） */}
        <StudioWorkspaceCard
          workspace={workspace}
          workspaceSource={workspaceSource}
          workspacePath={workspacePath}
          loadDemo={loadDemo}
          clearWorkspace={clearWorkspace}
          loadDxfText={loadDxfText}
          workspaceError={workspaceError}
          setWorkspaceError={setWorkspaceError}
          replay={replay}
          programRunning={programRunning}
          recordingSuspended={recordingSuspended}
        />

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
      </StudioStage>

      <StudioTuningDrawer tuningOpen={tuningOpen} setTuningOpen={setTuningOpen} />
    </div>
  );
}
