/** 3D 仿真工作室：左控制台（状态 + 关节 + 动作）+ 右 3D 世界（数字孪生台）。 */
import { useEffect, useRef } from "react";
import JointCard from "../components/JointCard";
import { formatPose } from "../robot/kinematics";
import { SimulationLoop } from "../robot/simulation";
import { useBridgeStore } from "../stores/bridgeStore";
import { useReadyModel, useRobotStore } from "../stores/robotStore";
import { useSceneStore } from "../stores/sceneStore";
import { useSimulationStore } from "../stores/simulationStore";
import RobotStage from "../three/RobotStage";
import "./Studio.css";

/** 仿真速度档位 */
const SPEED_OPTIONS = [0.25, 0.5, 1, 2];

export default function Studio() {
  const model = useReadyModel();
  const status = useRobotStore((s) => s.status);
  const loadError = useRobotStore((s) => s.error);
  const assetBase = useRobotStore((s) => s.assetBase);
  const loadSo100 = useRobotStore((s) => s.loadSo100);

  const simRef = useRef<SimulationLoop | null>(null);
  const bind = useSimulationStore((s) => s.bind);
  const syncTick = useSimulationStore((s) => s.syncTick);
  const speed = useSimulationStore((s) => s.speed);
  const mode = useSimulationStore((s) => s.mode);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const setJointTarget = useSimulationStore((s) => s.setJointTarget);
  const goHome = useSimulationStore((s) => s.goHome);
  const play = useSimulationStore((s) => s.play);
  const stop = useSimulationStore((s) => s.stop);

  const showJointAxes = useSceneStore((s) => s.showJointAxes);
  const showTcpAxes = useSceneStore((s) => s.showTcpAxes);
  const showTrail = useSceneStore((s) => s.showTrail);
  const materialStyle = useSceneStore((s) => s.materialStyle);
  const toggleJointAxes = useSceneStore((s) => s.toggleJointAxes);
  const toggleTcpAxes = useSceneStore((s) => s.toggleTcpAxes);
  const toggleTrail = useSceneStore((s) => s.toggleTrail);
  const toggleMaterialStyle = useSceneStore((s) => s.setMaterialStyle);
  const requestResetView = useSceneStore((s) => s.requestResetView);
  const requestFocus = useSceneStore((s) => s.requestFocus);

  // 数据桥：SIM ↔ MOCK 真数据（TWIN 观察态），100ms 低频刷新健康快照
  const bridgeInfo = useBridgeStore((s) => s.info);
  const bridgeError = useBridgeStore((s) => s.lastError);
  const refreshBridge = useBridgeStore((s) => s.refresh);
  const connectMock = useBridgeStore((s) => s.connectMock);
  const backToSim = useBridgeStore((s) => s.backToSim);

  // 首次进入自动加载内置 SO-100 模型
  useEffect(() => {
    if (status === "idle") void loadSo100();
  }, [status, loadSo100]);

  // 模型就绪 → 创建仿真回路（SimulationLoop 非响应式，只挂在 ref 上）
  useEffect(() => {
    if (!model) {
      bind(null);
      simRef.current = null;
      return;
    }
    const sim = new SimulationLoop(model);
    simRef.current = sim;
    bind(sim);
    return () => {
      bind(null);
      simRef.current = null;
    };
  }, [model, bind]);

  // 速度倍率 → 仿真回路（独立 effect，不重建回路）
  useEffect(() => {
    if (simRef.current) simRef.current.speed = speed;
  }, [speed, model]);

  // 30Hz 低频同步：仿真快照 → store → 控制台读数（高频渲染走 useFrame 直读，不经过这里）
  useEffect(() => {
    const id = window.setInterval(syncTick, 33);
    return () => window.clearInterval(id);
  }, [syncTick]);

  // 100ms 桥健康快照：状态/速率/延迟 UI 数字（遵守 10~20Hz 纪律）
  useEffect(() => {
    const id = window.setInterval(refreshBridge, 100);
    return () => window.clearInterval(id);
  }, [refreshBridge]);

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

  const ready = model !== null && simRef.current !== null;
  const tcpText = formatPose(snapshot.tcp);
  const progressPct = Math.min(100, Math.max(0, snapshot.progress * 100));

  return (
    <div className="studio">
      {/* 左：控制台 */}
      <aside className="studio__console">
        <header className="studio__head">
          <div className="studio__title-row">
            <h1 className="studio__title">SO-100</h1>
            <span className="studio__subtitle serif">
              {model?.def.name ?? "so_arm100"}
            </span>
          </div>
          <div className="studio__status">
            <span className="studio__status-chip">
              <i className={`studio__status-dot is-${bridgeInfo.status}`} />
              {bridgeInfo.kind === "simulation"
                ? "仿真联动"
                : bridgeInfo.status === "connected"
                  ? "真数据联动"
                  : "链路中断"}
            </span>
            <span className="studio__status-note">
              {bridgeInfo.kind === "simulation"
                ? "SIM · 无硬件链路"
                : "MOCK WS · 模型保持最后位姿"}
            </span>
          </div>
        </header>

        {/* 数据链路卡：SIM ↔ MOCK 真数据（TWIN 观察态） */}
        <div className="studio__link">
          <div className="studio__link-row">
            <span className="studio__link-label">数据链路</span>
            <span className={`studio__link-chip is-${bridgeInfo.status}`}>
              {bridgeInfo.kind === "simulation"
                ? "SIM"
                : bridgeInfo.status === "connected"
                  ? "LINK ✓"
                  : bridgeInfo.status === "connecting"
                    ? "重连中…"
                    : "已断开"}
            </span>
          </div>
          {bridgeInfo.kind === "simulation" ? (
            <button
              type="button"
              className="studio__link-btn"
              onClick={() => void connectMock()}
            >
              接入 MOCK 数据源
            </button>
          ) : (
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
              </div>
              <button
                type="button"
                className="studio__link-btn"
                onClick={() => void backToSim()}
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
                aria-pressed={speed === v}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>

        <div className="studio__joints" aria-label="关节控制">
          {model?.active.map((joint, i) => (
            <JointCard
              key={joint.def.name}
              joint={joint}
              panelIndex={i}
              valueDeg={snapshot.currentDeg[i] ?? 0}
              onChange={setJointTarget}
            />
          ))}
        </div>

        {mode === "play" && (
          <div className="studio__progress" aria-label="轨迹进度">
            <i style={{ width: `${progressPct}%` }} />
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
          <div className="studio__tcp-row">
            <span className="studio__tcp-label">RPY</span>
            <span className="studio__tcp-value tnum">
              {tcpText.rpy}
              <i>°</i>
            </span>
          </div>
        </div>

        <footer className="studio__actions">
          <button
            type="button"
            className="studio__btn studio__btn-danger"
            onClick={stop}
          >
            <i aria-hidden="true">■</i>
            STOP
          </button>
          <button
            type="button"
            className={`studio__btn ${mode === "homing" ? "is-active" : ""}`}
            onClick={goHome}
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
            onClick={() => (mode === "play" ? stop() : play())}
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
      <section className="studio__stage">
        {ready ? (
          <RobotStage model={model} sim={simRef.current!} assetBase={assetBase} />
        ) : (          <div className="studio__fallback">
            {status === "error" ? (
              <>
                <strong>模型加载失败</strong>
                <span>{loadError}</span>
                <button
                  type="button"
                  className="studio__btn"
                  onClick={() => void loadSo100()}
                >
                  重试
                </button>
              </>
            ) : (
              <strong>正在装配 SO-100 数字孪生体…</strong>
            )}
          </div>
        )}

        {/* 链接状态 HUD（悬浮于 3D 左上） */}
        <div className={`studio__hud is-${bridgeInfo.status}`}>
          <span className="studio__hud-kind">
            {bridgeInfo.kind === "simulation" ? "SIM" : "MOCK LINK"}
          </span>
          {bridgeInfo.kind !== "simulation" && (
            <span className="studio__hud-meta tnum">
              {bridgeInfo.status === "connected"
                ? `${(bridgeInfo.messageRateHz ?? 0).toFixed(1)} Hz · ${bridgeInfo.latencyMs ?? "—"} ms`
                : bridgeInfo.status === "connecting"
                  ? "自动重连中…"
                  : "disconnected · 原位保持"}
            </span>
          )}
        </div>

        {/* 视图工具条（悬浮） */}
        <div className="studio__scene-tools">
          <button
            type="button"
            className={showJointAxes ? "is-on" : ""}
            onClick={toggleJointAxes}
            aria-pressed={showJointAxes}
          >
            关节轴
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
        </div>

        <div className="studio__hint">
          左键旋转 · 滚轮缩放 · 右键平移 · F 聚焦 · R 复位视角
        </div>
      </section>
    </div>
  );
}