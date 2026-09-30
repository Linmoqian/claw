// Created on 2026-09-27
// @author: https://github.com/Linmoqian
import * as Blockly from "blockly/core";
import "blockly/blocks";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  Bot,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import {
  DEFAULT_ROBOT_ID,
  findRobotEntry,
  useReadyModel,
  useRobotStore,
} from "../../../stores/robotStore";
import { registerBlockLabBlocks } from "../blockly/blocks";
import { DEFAULT_WORKSPACE } from "../blockly/defaultWorkspace";
import { BLOCK_TOOLBOX } from "../blockly/toolbox";

import { useActivityStore } from "../../../stores/activity";
import { getRuntime } from "../../workbench/runtime/runtime";
import { parseProgramSnapshot } from "../../workbench/runtime/programSnapshot";
import { resetProgramStatus, runProgram, stopProgram, useProgramStore, type ProgramStatus } from "../../workbench/runtime/programRunner";
import { useBridgeStore } from "../../../stores/bridgeStore";
import LoadingState from "../../../components/workbench/LoadingState";
import { readDraft, writeDraft } from "../../../services/draftStorage";
import "./BlockLab.css";

type WorkspaceState = ReturnType<typeof Blockly.serialization.workspaces.save>;
let workspaceStorageBlocked = false;

const STORAGE_KEY = "xiakao:block-console:v1";
const LAYOUT_STORAGE_KEY = "xiakao:block-console-layout:v1";
const DEFAULT_RUNTIME_WIDTH = 362;
const MIN_RUNTIME_WIDTH = 320;
const MAX_RUNTIME_WIDTH = 520;
const MIN_PROGRAM_WIDTH = 460;
const SPLITTER_WIDTH = 14;

const TOOLBOX = BLOCK_TOOLBOX;

const STATUS_LABELS: Record<ProgramStatus, string> = {
  idle: "待机",
  running: "运行中",
  complete: "完成",
  error: "错误",
  stopped: "已停止",
};

function clampRuntimeWidth(width: number, max = MAX_RUNTIME_WIDTH) {
  return Math.round(Math.min(Math.max(width, MIN_RUNTIME_WIDTH), max));
}

function readSavedRuntimeWidth() {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_WIDTH;

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_RUNTIME_WIDTH;

    const stored = Number(raw);
    return Number.isFinite(stored)
      ? clampRuntimeWidth(stored)
      : DEFAULT_RUNTIME_WIDTH;
  } catch {
    return DEFAULT_RUNTIME_WIDTH;
  }
}

function saveRuntimeWidth(width: number) {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, String(width));
  } catch {
    // 隐私模式或存储空间不足时，布局仍然可以正常使用。
  }
}

function registerConsoleBlocks() {
  registerBlockLabBlocks();
}

async function readSavedWorkspace(): Promise<WorkspaceState | null> {
  try {
    const raw = await readDraft("block-console", STORAGE_KEY);
    if (raw === null) return null;
    return parseProgramSnapshot(raw);
  } catch {
    workspaceStorageBlocked = true;
    return null;
  }
}

async function saveWorkspace(state: WorkspaceState): Promise<boolean> {
  if (workspaceStorageBlocked) return false;
  try {
    await writeDraft("block-console", STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function loadState(workspace: Blockly.WorkspaceSvg, state: WorkspaceState) {
  workspace.clear();
  try {
    Blockly.serialization.workspaces.load(state, workspace);
  } catch {
    workspaceStorageBlocked = true;
    // 保留原始损坏草稿，只有显式重置才允许覆盖。
    workspace.clear();
  }
}

function BlockLab() {
  const model = useReadyModel();
  const robotStatus = useRobotStore((state) => state.status);
  const currentRobotId = useRobotStore((state) => state.currentId);
  const loadRobot = useRobotStore((state) => state.loadRobot);
  const currentRobot = findRobotEntry(currentRobotId ?? DEFAULT_ROBOT_ID);
  const currentArmLabel = currentRobot?.label ?? "SO-100";
  const [blockCount, setBlockCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState("自动保存");
  const runStatus = useProgramStore((state) => state.status);
  const lastDetection = useProgramStore((state) => state.lastDetection);
  const logs = useProgramStore((state) => state.logs);
  const recordingLocked = useActivityStore((state) => state.recordingLocked);
  const recordingSuspended = useActivityStore((state) => state.recordingSuspended || state.replayPreparing);
  const serialTransition = useActivityStore((state) => state.serialTransition);
  const replay = useBridgeStore((state) => state.replay !== null);
  const [mobilePanel, setMobilePanel] = useState("tools");
  const [runtimeWidth, setRuntimeWidth] = useState(readSavedRuntimeWidth);
  const [isResizing, setIsResizing] = useState(false);
  const blocklyDivRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const previewRuntimeWidthRef = useRef(runtimeWidth);

  const getRuntimeWidthMax = useCallback(() => {
    const layoutWidth =
      layoutRef.current?.getBoundingClientRect().width ?? Infinity;
    return Math.min(
      MAX_RUNTIME_WIDTH,
      Math.max(
        MIN_RUNTIME_WIDTH,
        layoutWidth - MIN_PROGRAM_WIDTH - SPLITTER_WIDTH,
      ),
    );
  }, []);

  const applyRuntimeWidth = useCallback(
    (width: number) => {
      const nextWidth = clampRuntimeWidth(width, getRuntimeWidthMax());
      previewRuntimeWidthRef.current = nextWidth;
      layoutRef.current?.style.setProperty(
        "--block-console-runtime-width",
        `${nextWidth}px`,
      );
      splitterRef.current?.setAttribute("aria-valuenow", String(nextWidth));
      return nextWidth;
    },
    [getRuntimeWidthMax],
  );

  const commitRuntimeWidth = useCallback(
    (width: number) => {
      const nextWidth = applyRuntimeWidth(width);
      setRuntimeWidth(nextWidth);
      saveRuntimeWidth(nextWidth);
    },
    [applyRuntimeWidth],
  );

  const handleSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      const startWidth = applyRuntimeWidth(previewRuntimeWidthRef.current);
      resizeStateRef.current = { startX: event.clientX, startWidth };
      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [applyRuntimeWidth],
  );

  const handleSplitterPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      applyRuntimeWidth(
        resizeState.startWidth + resizeState.startX - event.clientX,
      );
    },
    [applyRuntimeWidth],
  );

  const finishSplitterResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!resizeStateRef.current) return;

      commitRuntimeWidth(previewRuntimeWidthRef.current);
      resizeStateRef.current = null;
      setIsResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [commitRuntimeWidth],
  );

  const handleSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 48 : 16;
      let nextWidth: number | null = null;

      if (event.key === "ArrowLeft") nextWidth = runtimeWidth + step;
      if (event.key === "ArrowRight") nextWidth = runtimeWidth - step;
      if (event.key === "Home") nextWidth = MIN_RUNTIME_WIDTH;
      if (event.key === "End") nextWidth = MAX_RUNTIME_WIDTH;
      if (nextWidth === null) return;

      event.preventDefault();
      commitRuntimeWidth(nextWidth);
    },
    [commitRuntimeWidth, runtimeWidth],
  );

  const syncWorkspaceState = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const state = Blockly.serialization.workspaces.save(workspace);
    setBlockCount(workspace.getAllBlocks(false).length);
    void saveWorkspace(state).then((saved) => {
      setLastSavedAt(saved ? "刚刚保存" : workspaceStorageBlocked
        ? "原草稿损坏，已保留；重置后恢复保存" : "保存失败，请检查草稿存储");
    });
  }, []);

  useEffect(() => {
    registerConsoleBlocks();
    const container = blocklyDivRef.current;
    if (!container) return;

    const workspace = Blockly.inject(container, {
      toolbox: TOOLBOX,
      renderer: "zelos",
      trashcan: true,
      sounds: false,
      grid: { spacing: 24, length: 2, colour: "#D9E4E1", snap: true },
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.86,
        maxScale: 1.2,
        minScale: 0.55,
        scaleSpeed: 1.1,
      },
    });
    workspaceRef.current = workspace;

    let disposed = false;
    const handleChange = () => syncWorkspaceState();
    void readSavedWorkspace().then((saved) => {
      if (disposed) return;
      loadState(workspace, saved ?? DEFAULT_WORKSPACE);
      workspace.addChangeListener(handleChange);
      syncWorkspaceState();
    });

    const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      workspace.removeChangeListener(handleChange);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [syncWorkspaceState]);

  useEffect(() => {
    if (robotStatus === "idle") void loadRobot(DEFAULT_ROBOT_ID);
  }, [loadRobot, robotStatus]);

  const handleRun = () => {
    if (workspaceRef.current) void runProgram(workspaceRef.current);
  };
  const handleStop = () => stopProgram();
  const handleReset = () => {
    if (runStatus === "running" || recordingLocked || replay) return;
    getRuntime()?.sim.goHome();
    resetProgramStatus();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspaceStorageBlocked = false;
    loadState(workspace, DEFAULT_WORKSPACE);
    syncWorkspaceState();
  };
  const statusLabel = STATUS_LABELS[runStatus];
  const armStageMode = runStatus;
  const layoutStyle = {
    "--block-console-runtime-width": `${runtimeWidth}px`,
  } as CSSProperties;

  return (
    <main className={`block-console block-console--${mobilePanel}`}>
      <div className="workbench-panel-tabs" role="tablist" aria-label="积木面板">
        <button type="button" role="tab" aria-selected={mobilePanel === "tools"} onClick={() => setMobilePanel("tools")}>程序</button>
        <button type="button" role="tab" aria-selected={mobilePanel === "scene"} onClick={() => setMobilePanel("scene")}>场景与日志</button>
      </div>
      <div
        ref={layoutRef}
        className={`block-console__layout${isResizing ? " block-console__layout--resizing" : ""}`}
        style={layoutStyle}
      >
        <section
          id="block-console-program-panel"
          className="block-console__program-panel"
          aria-label="Blockly 程序编排区"
        >
          <header className="block-console__panel-head block-console__panel-head--program">
            <div>
              <div className="block-console__title-row">
                <h1 className="block-console__title">积木控制台</h1>
                <span className="block-console__subtitle">Blockly</span>
              </div>
              <div className="block-console__program-status">
                <span className="block-console__status-dot" />
                <span>仿真模式</span>
                <span className="block-console__status-note">
                  本地仿真 · 新示例使用关节目标
                </span>
              </div>
            </div>
            <div className="block-console__program-meta">
              <span>{blockCount} 块积木</span>
              <span className="block-console__save-indicator">
                <span />
                自动保存
              </span>
            </div>
          </header>

          <div className="block-console__toolbar">
            <div className="block-console__channel">
              <span className="block-console__channel-dot" />
              程序控制
              <span className="block-console__toolbar-divider" />
              <span className="block-console__autosave">{lastSavedAt}</span>
            </div>
            <div className="block-console__actions">
              <button
                type="button"
                className="console-button console-button--primary"
                onClick={handleRun}
                disabled={runStatus === "running" || replay || !model || recordingSuspended || serialTransition}
                title={recordingSuspended ? "请等待实验保存或回放准备完成后运行" : serialTransition ? "串口正在切换，请稍候" : replay ? "请退出回放后运行" : !model ? "请等待模型就绪" : "使用程序快照运行，切页后继续执行"}
              >
                <Play size={15} fill="currentColor" />
                运行
              </button>
              <button
                type="button"
                className="console-button"
                onClick={handleStop}
                disabled={runStatus !== "running"}
              >
                <Square size={13} fill="currentColor" />
                停止
              </button>
              <button
                type="button"
                className="console-button"
                onClick={handleReset}
                disabled={runStatus === "running" || recordingLocked || replay}
              >
                <RotateCcw size={14} />
                重置
              </button>
            </div>
          </div>

          <div className="block-console__workspace-shell">
            <div
              ref={blocklyDivRef}
              className="block-console__blockly"
              aria-label="拖拽积木编程工作区"
            />
          </div>

          <footer className="block-console__workspace-footer">
            <span>
              <Zap size={13} />
              从左侧工具箱拖入积木
            </span>
            <span>
              新示例：J1 15° 与夹爪 · 先在仿真试运行
            </span>
          </footer>
        </section>

        <button
          ref={splitterRef}
          type="button"
          className="block-console__splitter"
          role="separator"
          aria-label="调整程序区与仿真区宽度"
          aria-controls="block-console-program-panel block-console-runtime-panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_RUNTIME_WIDTH}
          aria-valuemax={MAX_RUNTIME_WIDTH}
          aria-valuenow={runtimeWidth}
          title="拖动调整程序区宽度"
          onKeyDown={handleSplitterKeyDown}
          onPointerDown={handleSplitterPointerDown}
          onPointerMove={handleSplitterPointerMove}
          onPointerUp={finishSplitterResize}
          onPointerCancel={finishSplitterResize}
        >
          <span className="block-console__splitter-grip" aria-hidden="true" />
        </button>

        <aside
          id="block-console-runtime-panel"
          className="block-console__runtime-panel"
          aria-label="机械臂仿真运行面板"
        >
          <header className="block-console__panel-head block-console__panel-head--runtime">
            <div>
              <span className="block-console__panel-label">RUNTIME</span>
              <h2>
                <Bot size={19} />
                {currentArmLabel} 机械臂
              </h2>
            </div>
            <span
              className={`block-console__status block-console__status--${runStatus}`}
            >
              {statusLabel}
            </span>
          </header>

          <div
            className={`block-console__arm-stage block-console__arm-stage--${armStageMode}`}
          >
            <div className="block-console__arena-topline">
              <span>
                {currentArmLabel} / SIMULATION
              </span>
              <span className="block-console__scene-signal">
                <span />
                LOCAL
              </span>
            </div>
            <div
              data-runtime-slot
              className="block-console__arm-canvas"
              aria-label={currentArmLabel + " 机械臂仿真视图"}
            >
              {!model && robotStatus === "error" && (
                <div className="block-console__arm-loading">
                  <strong>机械臂模型加载失败</strong>
                  <small>
                    请检查 {currentRobot?.urdfPath ?? "模型资源"}
                  </small>
                </div>
              )}
              {!model && robotStatus !== "error" && (
                <LoadingState
                  variant="scene"
                  label={`正在加载 ${currentArmLabel}`}
                  detail="准备仿真视图…"
                />
              )}
            </div>
            <div className="block-console__arena-readout">
              <span>机械臂状态</span>
              <strong>
                {runStatus === "complete"
                  ? "动作完成"
                  : runStatus === "running"
                    ? "执行中"
                    : "等待程序"}
              </strong>
            </div>
          </div>

          <section
            className="block-console__log-panel"
            aria-label="视觉识别结果"
          >
            <header className="block-console__log-head">
              <span>视觉识别 · 合成图像</span>
              <span>{lastDetection ? lastDetection.label : "NO TARGET"}</span>
            </header>
            <div className="block-console__vision-grid">
              <span>中心</span>
              <strong>
                {lastDetection
                  ? `${lastDetection.centerX.toFixed(0)}, ${lastDetection.centerY.toFixed(0)}`
                  : "—"}
              </strong>
              <span>外接框</span>
              <strong>
                {lastDetection
                  ? `${lastDetection.width} × ${lastDetection.height}`
                  : "—"}
              </strong>
              <span>面积</span>
              <strong>
                {lastDetection ? lastDetection.area.toFixed(0) : "—"}
              </strong>
            </div>
          </section>

          <section className="block-console__log-panel" aria-live="polite">
            <header className="block-console__log-head">
              <span>
                <Terminal size={14} />
                执行日志
              </span>
              <span>
                {logs.length > 0 ? `${logs.length} 条` : "待运行"}
              </span>
            </header>
            <div className="block-console__log-list">
              {logs.map((log, index) => (
                <div
                  className={`block-console__log-item block-console__log-item--${log.kind}`}
                  key={`${log.time}-${log.text}-${index}`}
                >
                  <span className="block-console__log-dot" />
                  <time>{log.time}</time>
                  <p>{log.text}</p>
                </div>
              ))}
            </div>
          </section>

          <Link className="block-console__studio-link" to="/studio">
            <span>在仿真工作台查看机械臂</span>
            <ArrowLeft size={14} />
          </Link>
        </aside>
      </div>
    </main>
  );
}

export default BlockLab;
