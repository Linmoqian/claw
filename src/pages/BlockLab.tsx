import * as Blockly from "blockly/core";
import "blockly/blocks";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
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
import { CollisionSystem } from "../robot/collision";
import { BaseSim } from "../robot/baseSim";
import { SimulationLoop } from "../robot/simulation";
import MobileBase from "../three/MobileBase";
import RobotView from "../three/RobotView";
import { SimulationCamera } from "../three/SimulationCamera";
import LidarSensor from "../three/LidarSensor";
import {
  DEFAULT_ROBOT_ID,
  findRobotEntry,
  useReadyModel,
  useRobotStore,
} from "../stores/robotStore";
import { useSimulationStore } from "../stores/simulationStore";
import { useWorldStore } from "../stores/worldStore";
import { useDevice } from "../store/DeviceContext";
import { isDesktop } from "../lib/serial";
import { registerBlockLabBlocks } from "../blockly/blocks";
import { BLOCK_TOOLBOX } from "../blockly/toolbox";
import {
  executeWorkspace,
  ExecutionAborted,
  workspaceHasProgram,
} from "../blockly/interpreter";
import { SimulationDeviceGateway } from "../blockly/simulationGateway";
import { HardwareDeviceGateway } from "../blockly/hardwareGateway";
import type { BlockDeviceGateway, Detection } from "../blockly/types";
import "./BlockLab.css";

type WorkspaceState = ReturnType<typeof Blockly.serialization.workspaces.save>;
type RunStatus = "idle" | "running" | "complete" | "error" | "stopped";
type StepId =
  "arm" | "camera" | "lidar" | "sense" | "move" | "turn" | "grab" | "stop";

type ConsoleStep = {
  id: StepId;
  label: string;
  detail: string;
  robotId?: string;
};

type ConsoleLog = {
  time: string;
  text: string;
  kind: "system" | "event" | "success" | "warning" | "error";
};

type RobotRuntime = {
  sim: SimulationLoop;
  baseSim: BaseSim;
};

const STORAGE_KEY = "xiakao:block-console:v1";
const LAYOUT_STORAGE_KEY = "xiakao:block-console-layout:v1";
const DEFAULT_RUNTIME_WIDTH = 362;
const MIN_RUNTIME_WIDTH = 320;
const MAX_RUNTIME_WIDTH = 520;
const MIN_PROGRAM_WIDTH = 460;
const SPLITTER_WIDTH = 14;

const TOOLBOX = BLOCK_TOOLBOX;

const DEFAULT_WORKSPACE: WorkspaceState = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "event_start",
        x: 42,
        y: 42,
        next: {
          block: {
            type: "decision_if",
            inputs: {
              CONDITION: {
                block: {
                  type: "sense_color",
                  fields: { COLOR: "RED" },
                },
              },
              DO: {
                block: {
                  type: "move_steps",
                  fields: { STEPS: 2 },
                  next: { block: { type: "grab_object" } },
                },
              },
            },
          },
        },
      },
    ],
  },
};

const INITIAL_LOGS: ConsoleLog[] = [
  { time: "--:--:--", text: "仿真通道已就绪", kind: "system" },
];

const STATUS_LABELS: Record<RunStatus, string> = {
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

function readSavedWorkspace(): WorkspaceState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WorkspaceState) : null;
  } catch {
    return null;
  }
}

function saveWorkspace(state: WorkspaceState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式或存储空间不足时，Blockly 仍然可以正常使用。
  }
}

function loadState(workspace: Blockly.WorkspaceSvg, state: WorkspaceState) {
  workspace.clear();
  try {
    Blockly.serialization.workspaces.load(state, workspace);
  } catch {
    // 本地草稿损坏时回退到空工作区，不让保存状态阻塞控制台。
    workspace.clear();
  }
}

function formatTime() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function RobotSimulationView({
  model,
  assetBase,
  runtimeRef,
  cameraFeedRef,
}: {
  model: NonNullable<ReturnType<typeof useReadyModel>>;
  assetBase: string;
  runtimeRef: { current: RobotRuntime | null };
  cameraFeedRef: RefObject<HTMLDivElement | null>;
}) {
  const bindSimulation = useSimulationStore((state) => state.bind);
  const runtime = useMemo<RobotRuntime>(() => {
    const collision = CollisionSystem.create(model);
    const sim = new SimulationLoop(model, collision);
    const baseSim = new BaseSim();

    baseSim.onPose = (pose) => {
      useWorldStore.getState().updateRobotPose({
        position: { x: pose.x, y: pose.y, z: 0 },
        orientation: {
          x: 0,
          y: 0,
          z: Math.sin(pose.yaw / 2),
          w: Math.cos(pose.yaw / 2),
        },
      });
    };
    baseSim.teleport({ x: 0, y: 0, yaw: 0 });

    return { sim, baseSim };
  }, [model]);

  useEffect(() => {
    runtimeRef.current = runtime;
    bindSimulation(runtime.sim);

    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      bindSimulation(null);
      runtime.sim.dispose();
    };
  }, [bindSimulation, runtime, runtimeRef]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.88, 0.72, 0.95], fov: 42, near: 0.01, far: 60 }}
      gl={{ antialias: true }}
    >
      <Suspense fallback={null}>
        <BlockArmScene
          model={model}
          sim={runtime.sim}
          baseSim={runtime.baseSim}
          assetBase={assetBase}
        />
      </Suspense>
      <SimulationCamera feedRef={cameraFeedRef} />
    </Canvas>
  );
}

function BlockArmScene({
  model,
  sim,
  baseSim,
  assetBase,
}: {
  model: NonNullable<ReturnType<typeof useReadyModel>>;
  sim: SimulationLoop;
  baseSim: BaseSim;
  assetBase: string;
}) {
  useFrame((_, delta) => {
    sim.step(delta);
    baseSim.step(delta);
  });

  return (
    <>
      <color attach="background" args={["#eef0f3"]} />
      <ambientLight intensity={1.05} />
      <directionalLight
        position={[2.4, 3.6, 1.6]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-0.9}
        shadow-camera-right={0.9}
        shadow-camera-top={0.9}
        shadow-camera-bottom={-0.9}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-2.2, 1.6, -2.4]} intensity={0.35} />
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        infiniteGrid
        cellSize={0.1}
        sectionSize={0.5}
        sectionThickness={1}
        cellThickness={0.55}
        cellColor="#d8dce2"
        sectionColor="#c3cad4"
        fadeDistance={7}
        fadeStrength={1.1}
        followCamera={false}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.004} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial transparent opacity={0.09} />
      </mesh>
      <MobileBase accessories={<LidarSensor position={[0.14, 0, 0.072]} />}>
        <RobotView model={model} sim={sim} assetBase={assetBase} />
      </MobileBase>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        target={[0, 0.22, 0]}
        minDistance={0.22}
        maxDistance={2.8}
        minPolarAngle={0.06}
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
    </>
  );
}

function BlockLab() {
  const { connected, estop } = useDevice();
  const model = useReadyModel();
  const robotStatus = useRobotStore((state) => state.status);
  const currentRobotId = useRobotStore((state) => state.currentId);
  const modelLoads = useRobotStore((state) => state.loads);
  const assetBase = useRobotStore((state) => state.assetBase);
  const loadRobot = useRobotStore((state) => state.loadRobot);
  const currentRobot = findRobotEntry(currentRobotId ?? DEFAULT_ROBOT_ID);
  const currentArmLabel = currentRobot?.label ?? "SO-100";
  const [blockCount, setBlockCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState("自动保存");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [activeStepId, setActiveStepId] = useState<StepId | null>(null);
  const [runSteps, setRunSteps] = useState<ConsoleStep[]>([]);
  const [logs, setLogs] = useState<ConsoleLog[]>(INITIAL_LOGS);
  const [hardwareMode, setHardwareMode] = useState(false);
  const [lastDetection, setLastDetection] = useState<Detection | null>(null);
  const [runtimeWidth, setRuntimeWidth] = useState(readSavedRuntimeWidth);
  const [isResizing, setIsResizing] = useState(false);
  const blocklyDivRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const runtimeRef = useRef<RobotRuntime | null>(null);
  const cameraFeedRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hardwareModeRef = useRef(hardwareMode);
  const estopRef = useRef(estop);
  hardwareModeRef.current = hardwareMode;
  estopRef.current = estop;
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

  const clearRunTimers = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const appendLog = useCallback(
    (text: string, kind: ConsoleLog["kind"] = "event") => {
      setLogs((current) => [
        ...current.slice(-5),
        { time: formatTime(), text, kind },
      ]);
    },
    [],
  );

  const syncWorkspaceState = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    saveWorkspace(Blockly.serialization.workspaces.save(workspace));
    setBlockCount(workspace.getAllBlocks(false).length);
    setLastSavedAt("刚刚保存");
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

    loadState(workspace, readSavedWorkspace() ?? DEFAULT_WORKSPACE);
    const handleChange = () => syncWorkspaceState();
    workspace.addChangeListener(handleChange);
    syncWorkspaceState();

    const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
    observer.observe(container);

    return () => {
      observer.disconnect();
      workspace.removeChangeListener(handleChange);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [syncWorkspaceState]);

  useEffect(() => {
    if (robotStatus === "idle") void loadRobot(DEFAULT_ROBOT_ID);
  }, [loadRobot, robotStatus]);

  useEffect(() => {
    return () => {
      clearRunTimers();
      abortRef.current?.abort();
    };
  }, [clearRunTimers]);

  useEffect(() => {
    if (!estop) return;
    abortRef.current?.abort();
  }, [estop]);

  const selectSimulationArm = useCallback(
    async (robotId: string) => {
      await loadRobot(robotId);
      if (
        useRobotStore.getState().currentId !== robotId ||
        useRobotStore.getState().status !== "ready"
      ) {
        throw new Error(`机械臂 ${robotId} 加载失败`);
      }
    },
    [loadRobot],
  );

  const createGateway = useCallback(
    (signal: AbortSignal): BlockDeviceGateway => {
      if (hardwareModeRef.current) {
        const model = useRobotStore.getState().model;
        if (!isDesktop() || !connected || estopRef.current) {
          throw new Error("硬件执行需要：桌面端 + 串口已连接 + 非急停");
        }
        if (!model) throw new Error("硬件网关需要机械臂模型就绪");
        return new HardwareDeviceGateway(model, {
          onDetection: setLastDetection,
          signal,
        });
      }
      return new SimulationDeviceGateway({
        getRuntime: () => runtimeRef.current,
        getModel: () => useRobotStore.getState().model,
        selectArm: selectSimulationArm,
        onDetection: setLastDetection,
      });
    },
    [connected, selectSimulationArm],
  );

  const handleRun = async () => {
    const workspace = workspaceRef.current;
    if (!workspace || runStatus === "running") return;
    if (!workspaceHasProgram(workspace)) {
      setRunStatus("error");
      appendLog("开始积木后没有可执行动作", "warning");
      return;
    }
    if (hardwareModeRef.current && (!isDesktop() || !connected || estop)) {
      setRunStatus("error");
      appendLog("硬件执行需要桌面端、串口连接且非急停", "warning");
      return;
    }

    clearRunTimers();
    const controller = new AbortController();
    abortRef.current = controller;
    let gateway: BlockDeviceGateway;
    try {
      gateway = createGateway(controller.signal);
    } catch (error) {
      setRunStatus("error");
      appendLog(
        error instanceof Error ? error.message : "网关创建失败",
        "warning",
      );
      return;
    }

    runtimeRef.current?.sim.stop();
    setRunSteps([]);
    setRunStatus("running");
    appendLog(
      hardwareModeRef.current ? "硬件程序开始运行" : "仿真程序开始运行",
      "event",
    );

    try {
      await executeWorkspace({
        workspace,
        gateway,
        signal: controller.signal,
        log: (message, kind = "event") => {
          appendLog(message, kind);
          if (message.includes("识别颜色") || message.includes("PnP")) {
            // 检测值由网关日志更新；此处仅作为兜底界面提示。
            setLastDetection((current) => current);
          }
        },
      });
      setRunStatus("complete");
      setActiveStepId(null);
    } catch (error) {
      if (error instanceof ExecutionAborted || controller.signal.aborted) {
        setRunStatus("stopped");
        appendLog("程序已停止", "warning");
      } else {
        setRunStatus("error");
        appendLog(
          error instanceof Error ? error.message : "程序执行失败",
          "error",
        );
      }
      gateway.stop().catch(() => undefined);
    } finally {
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    runtimeRef.current?.sim.stop();
    setRunStatus("stopped");
    setActiveStepId(null);
    appendLog("仿真已停止", "warning");
  };

  const handleReset = () => {
    abortRef.current?.abort();
    runtimeRef.current?.sim.goHome();
    setRunStatus("idle");
    setActiveStepId(null);
    setRunSteps([]);
    setLastDetection(null);
    setLogs(INITIAL_LOGS);

    const workspace = workspaceRef.current;
    if (!workspace) return;
    loadState(workspace, DEFAULT_WORKSPACE);
    syncWorkspaceState();
  };

  const toggleHardwareMode = () => {
    if (runStatus === "running") return;
    setHardwareMode((current) => !current);
    appendLog(
      !hardwareMode ? "已切换硬件通道（仍需串口连接）" : "已切回仿真通道",
      hardwareMode ? "event" : "warning",
    );
  };
  const statusLabel = STATUS_LABELS[runStatus];
  const armStageMode =
    activeStepId ?? (runStatus === "complete" ? "complete" : runStatus);
  const layoutStyle = {
    "--block-console-runtime-width": `${runtimeWidth}px`,
  } as CSSProperties;

  return (
    <main className="block-console">
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
                <span>{hardwareMode ? "硬件模式" : "仿真模式"}</span>
                <span className="block-console__status-note">
                  {hardwareMode
                    ? "桌面硬件通道 · 需串口连接"
                    : "本地通道 · 不连接真实设备"}
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
                className={`console-button ${hardwareMode ? "console-button--danger" : ""}`}
                onClick={toggleHardwareMode}
                disabled={!isDesktop() || runStatus === "running"}
                title={
                  !isDesktop()
                    ? "浏览器预览不支持硬件执行"
                    : "切换仿真/硬件执行通道"
                }
              >
                {hardwareMode ? "仿真通道" : "硬件通道"}
              </button>
              <button
                type="button"
                className="console-button"
                onClick={handleReset}
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
              {hardwareMode
                ? "硬件模式：动作将访问真实设备"
                : "本地保存 · 不连接真实设备"}
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
                {currentArmLabel} / {hardwareMode ? "HARDWARE" : "SIMULATION"}
              </span>
              <span className="block-console__scene-signal">
                <span />
                LOCAL
              </span>
            </div>
            <div
              className="block-console__arm-canvas"
              aria-label={currentArmLabel + " 机械臂仿真视图"}
            >
              {model ? (
                <RobotSimulationView
                  key={modelLoads}
                  model={model}
                  assetBase={assetBase}
                  runtimeRef={runtimeRef}
                  cameraFeedRef={cameraFeedRef}
                />
              ) : (
                <div className="block-console__arm-loading">
                  <span className="block-console__arm-loading-dot" />
                  <strong>
                    {robotStatus === "error"
                      ? "机械臂模型加载失败"
                      : "正在加载 " + currentArmLabel}
                  </strong>
                  <small>
                    {robotStatus === "error"
                      ? "请检查 " + (currentRobot?.urdfPath ?? "模型资源")
                      : "准备仿真视图…"}
                  </small>
                </div>
              )}
              <div
                ref={cameraFeedRef}
                className="block-console__camera-feed"
                aria-label="仿真摄像头画面"
              >
                <span className="block-console__camera-feed-label">
                  CAM-01 · SIM
                </span>
                <span className="block-console__camera-feed-status">
                  <i />
                  {model ? "LIVE" : "WAIT"}
                </span>
              </div>
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
              <span>VISION</span>
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
                {runSteps.length > 0 ? `${runSteps.length} 步` : "待运行"}
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
