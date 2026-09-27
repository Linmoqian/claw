/** 全局实验上下文和开始/结束操作。Created on 2026-09-26; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import {
  ArrowUpRight,
  Circle,
  Download,
  FlaskConical,
  LoaderCircle,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import { useExperimentStore } from "../../experiments/experimentStore";
import { useRobotStore, findRobotEntry } from "../../stores/robotStore";
import { useBridgeStore } from "../../stores/bridgeStore";
import { useDevice } from "../../store/DeviceContext";
import { useActivityStore } from "../../workbench/activity";
import { useRuntimeStore } from "../../workbench/runtime";
import "./WorkbenchChrome.css";

const PAGE_NAMES: Record<string, string> = {
  "/workbench": "工作台总览",
  "/studio": "仿真与调参",
  "/blocks": "积木编程",
  "/experiments": "实验记录",
  "/data": "视频与数据",
  "/documents": "文档收集",
  "/assets": "项目资产",
  "/training-center": "训练中心",
  "/model-training": "智能训练",
  "/training": "对抗训练",
  "/vision": "视觉助手",
  "/about": "关于工作台",
};

function elapsedLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function ExperimentBar() {
  const { pathname } = useLocation();
  const active = useExperimentStore((state) => state.active);
  const elapsedS = useExperimentStore((state) => state.elapsedS);
  const sampleCount = useExperimentStore((state) => state.sampleCount);
  const saving = useExperimentStore((state) => state.saving);
  const error = useExperimentStore((state) => state.error);
  const initialize = useExperimentStore((state) => state.initialize);
  const start = useExperimentStore((state) => state.start);
  const finish = useExperimentStore((state) => state.finish);
  const retrySave = useExperimentStore((state) => state.retrySave);
  const exportActive = useExperimentStore((state) => state.exportActive);
  const lastSavedRecord = useExperimentStore((state) => state.lastSavedRecord);
  const dismissSaveNotice = useExperimentStore(
    (state) => state.dismissSaveNotice,
  );
  const currentId = useRobotStore((state) => state.currentId);
  const robotStatus = useRobotStore((state) => state.status);
  const bridgeKind = useBridgeStore((state) => state.bridge.kind);
  const isLive = useBridgeStore((state) => state.isLive);
  const runtimeReady = useRuntimeStore((state) => state.ready);
  const replayPreparing = useActivityStore((state) => state.replayPreparing);
  const programRunning = useActivityStore((state) => state.programRunning);
  const { connected, connectingPort, disconnecting, connectionError, disconnect } = useDevice();
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const source = pathname === "/blocks" ? "blocks" : "studio";
  const inExperiment = pathname === "/studio" || pathname === "/blocks";
  const modelLabel = currentId
    ? (findRobotEntry(currentId)?.label ?? currentId)
    : "准备模型";
  const modeLabel =
    bridgeKind === "replay"
      ? "回放 · 只读"
      : bridgeKind === "simulation"
        ? "SIM · 仿真"
        : isLive
          ? "LIVE · 真机控制"
          : "TWIN · 只读观测";
  const disabledReason =
    robotStatus !== "ready" || !runtimeReady
      ? "等待机器人模型准备完成"
      : replayPreparing
        ? "等待回放准备完成并退出回放"
        : bridgeKind !== "simulation"
          ? "请先结束回放或断开数据桥并返回仿真"
          : connectingPort || disconnecting
            ? "等待串口连接操作完成"
            : connected
              ? "请先断开串口，再开始仿真实验"
              : programRunning
                ? "请先停止程序，再开始实验"
                : null;

  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!active && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [active, saving]);

  const openDialog = (): void => {
    setActionError(null);
    setName(
      `${modelLabel} ${source === "blocks" ? "积木" : "仿真"}实验 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`,
    );
    dialogRef.current?.showModal();
    nameRef.current?.focus();
    nameRef.current?.select();
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || starting) return;
    setStarting(true);
    setActionError(null);
    try {
      await start(name.trim(), source);
      if (useExperimentStore.getState().active) dialogRef.current?.close();
      else
        setActionError(
          useExperimentStore.getState().error ?? "未能开始实验，请重试。",
        );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "开始实验失败");
    } finally {
      setStarting(false);
    }
  };
  const finishExperiment = async (): Promise<void> => {
    setActionError(null);
    try {
      await finish();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "保存失败，请重试或导出",
      );
    }
  };

  return (
    <>
      <div className="workbench-context">
        <div className="workbench-context__location">
          <span>实验室</span>
          <span aria-hidden="true">/</span>
          <strong>{PAGE_NAMES[pathname] ?? "实验详情"}</strong>
        </div>
        <div className="workbench-context__states" aria-label="工作台状态">
          <span className="wb-chip">{modelLabel}</span>
          <span className="wb-chip wb-chip--mode">{modeLabel}</span>
          {connected && (
            <button
              type="button"
              className="wb-button"
              disabled={disconnecting || Boolean(connectingPort)}
              onClick={() => void disconnect()}
            >
              {disconnecting ? "正在断开串口…" : "断开旧串口"}
            </button>
          )}
        </div>
        {!active && inExperiment && (
          <button
            ref={triggerRef}
            type="button"
            className="wb-button wb-button--primary"
            disabled={!!disabledReason || saving}
            title={disabledReason ?? "采集当前运动，不自动启动机器人"}
            onClick={openDialog}
          >
            <FlaskConical size={14} />
            开始实验
          </button>
        )}
      </div>
      {!active && inExperiment && disabledReason && (
        <div className="wb-global-hint" role="status">
          {disabledReason}
        </div>
      )}
      {!active && lastSavedRecord && (
        <div className="wb-save-notice" role="status">
          <span>
            {lastSavedRecord.status === "interrupted"
              ? "中断实验数据已保存"
              : "实验已保存"}{" "}
            · <strong>{lastSavedRecord.name}</strong> ·{" "}
            {lastSavedRecord.sampleCount.toLocaleString()} 帧
          </span>
          <Link to={`/experiments/${lastSavedRecord.id}`}>
            查看结果
            <ArrowUpRight size={14} />
          </Link>
          <button
            type="button"
            className="wb-icon-button"
            aria-label="关闭保存提示"
            onClick={dismissSaveNotice}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {active && (
        <section
          className={`experiment-live ${error ? "has-error" : ""}`}
          aria-label="当前实验"
        >
          <span className="experiment-live__marker">
            <Circle size={8} fill="currentColor" />
          </span>
          <div className="experiment-live__name">
            <strong>{active.name}</strong>
            <span>
              {saving
                ? "正在保存到本机"
                : active.status === "recording"
                  ? "正在采集实际运动"
                  : "实验已中断 · 存在未保存数据"}
            </span>
          </div>
          <span className="experiment-live__time tnum">
            {elapsedLabel(elapsedS)}
          </span>
          <span className="experiment-live__samples tnum">
            {sampleCount.toLocaleString()} 帧
          </span>
          <div className="experiment-live__actions">
            <Link
              className="wb-button wb-button--quiet"
              to={`/${active.source}`}
            >
              返回实验
              <ArrowUpRight size={14} />
            </Link>
            {active.status === "recording" ? (
              <button
                type="button"
                className="wb-button"
                disabled={saving}
                onClick={() => void finishExperiment()}
              >
                {saving ? (
                  <LoaderCircle size={14} className="wb-spin" />
                ) : (
                  <Square size={13} />
                )}
                结束实验
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="wb-button"
                  disabled={saving}
                  onClick={() => void retrySave()}
                >
                  <RotateCw size={14} />
                  重试保存
                </button>
                <button
                  type="button"
                  className="wb-button"
                  onClick={exportActive}
                >
                  <Download size={14} />
                  导出数据
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {(error || actionError || (connected && connectionError)) && (
        <div className="wb-global-error" role="alert">
          {actionError ?? error ?? connectionError}
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="wb-dialog"
        aria-labelledby="experiment-dialog-title"
        onClose={() => triggerRef.current?.focus()}
        onCancel={(event) => {
          if (starting) event.preventDefault();
        }}
      >
        <form onSubmit={(event) => void submit(event)}>
          <div className="wb-dialog__head">
            <h2 id="experiment-dialog-title">开始一次实验</h2>
            <button
              type="button"
              className="wb-icon-button"
              aria-label="关闭实验设置"
              disabled={starting}
              onClick={() => dialogRef.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            记录 {modelLabel}{" "}
            的实际运动与程序快照。开始后，可继续调试并切换其他工具。
          </p>
          <label htmlFor="experiment-name">实验名称</label>
          <input
            ref={nameRef}
            id="experiment-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
          />
          <div className="wb-dialog__facts">
            <span>
              采样频率 <strong>20 Hz</strong>
            </span>
            <span>
              存储位置 <strong>本机</strong>
            </span>
            <span>
              数据源 <strong>仿真</strong>
            </span>
          </div>
          {actionError && (
            <p role="alert" className="wb-text-error">
              {actionError}
            </p>
          )}
          <div className="wb-dialog__actions">
            <button
              className="wb-button"
              type="button"
              disabled={starting}
              onClick={() => dialogRef.current?.close()}
            >
              取消
            </button>
            <button
              className="wb-button wb-button--primary"
              type="submit"
              disabled={!name.trim() || starting}
            >
              {starting && <LoaderCircle size={14} className="wb-spin" aria-hidden="true" />}
              {starting ? "正在准备…" : "开始采集"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
