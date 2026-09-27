/** 按平台查看已接入的设备机型。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Bot, CarFront, CircleAlert, FolderOpen, Plane, type LucideIcon } from "lucide-react";
import { useBridgeStore } from "../stores/bridgeStore";
import {
  DEVICE_CATEGORIES,
  ROBOT_CATALOG,
  findRobotEntry,
  useRobotStore,
  type DeviceCategory,
  type RobotCatalogEntry,
} from "../stores/robotStore";
import { useActivityStore } from "../workbench/activity";
import "./DeviceCatalog.css";

const CATEGORY_ICONS: Record<DeviceCategory, LucideIcon> = {
  vehicle: CarFront,
  drone: Plane,
  arm: Bot,
};

export default function DeviceCatalog() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<DeviceCategory>("arm");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const currentId = useRobotStore((state) => state.currentId);
  const status = useRobotStore((state) => state.status);
  const loadRobot = useRobotStore((state) => state.loadRobot);
  const recordingLocked = useActivityStore((state) => state.recordingLocked);
  const programRunning = useActivityStore((state) => state.programRunning);
  const replayPreparing = useActivityStore((state) => state.replayPreparing);
  const replay = useBridgeStore((state) => state.replay);
  const selectedCategory = DEVICE_CATEGORIES.find((item) => item.id === category)!;
  const SelectedIcon = CATEGORY_ICONS[category];
  const models = ROBOT_CATALOG.filter((entry) => entry.category === category);
  const lockReason =
    selecting || status === "loading"
      ? "请等待机型加载完成"
      : recordingLocked
        ? "实验采集或保存期间不能切换机型，请先结束实验"
        : programRunning
          ? "请先停止积木程序，再切换机型"
          : replayPreparing || replay
            ? "请先退出回放，再切换机型"
            : null;

  const openModel = async (entry: RobotCatalogEntry): Promise<void> => {
    if (currentId === entry.id && status === "ready") {
      navigate("/studio");
      return;
    }
    if (lockReason) return;
    setSelecting(entry.id);
    setActionError(null);
    try {
      await loadRobot(entry.id);
      const loaded = useRobotStore.getState();
      if (loaded.currentId !== entry.id || loaded.status !== "ready") {
        setActionError(loaded.error ?? "机型未能加载，请重试");
        return;
      }
      navigate("/studio");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "机型加载失败");
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="stage device-catalog">
      <header className="device-catalog__header">
        <span className="section-label">设备与诊断</span>
        <h1>设备目录</h1>
        <p>按平台查看实验室设备。当前已接入的机型可直接进入仿真，其他类别会显示实际接入状态。</p>
      </header>

      <section className="device-catalog__categories" aria-label="设备分类">
        {DEVICE_CATEGORIES.map((item) => {
          const Icon = CATEGORY_ICONS[item.id];
          const count = ROBOT_CATALOG.filter((entry) => entry.category === item.id).length;
          return (
            <button
              key={item.id}
              type="button"
              className="device-catalog__category"
              aria-pressed={category === item.id}
              onClick={() => { setCategory(item.id); setActionError(null); }}
            >
              <Icon size={24} aria-hidden="true" />
              <strong>{item.label}</strong>
              <span>{item.description}</span>
              <small>{count ? `${count} 款已接入机型` : "暂无已接入机型"}</small>
            </button>
          );
        })}
      </section>

      <section className="device-catalog__panel" aria-label={`${selectedCategory.label}机型`}>
        <div className="device-catalog__panel-head">
          <div>
            <span className="device-catalog__eyebrow">DEVICE CATALOG</span>
            <h2>{selectedCategory.label}<small>{models.length} 款已接入</small></h2>
          </div>
          <span className="device-catalog__current">当前机型：{currentId ? findRobotEntry(currentId)?.label ?? currentId : "尚未准备"}</span>
        </div>
        {lockReason && models.some((entry) => entry.id !== currentId) && (
          <p className="device-catalog__lock">{lockReason}</p>
        )}
        {actionError && (
          <p className="device-catalog__error" role="alert"><CircleAlert size={16} aria-hidden="true" />{actionError}</p>
        )}
        {models.length ? (
          <div className="device-catalog__models">
            {models.map((entry) => {
              const current = currentId === entry.id && status === "ready";
              const ModelIcon = CATEGORY_ICONS[entry.category];
              return (
                <article className="device-catalog__model" key={entry.id}>
                  <span className="device-catalog__model-icon"><ModelIcon size={24} aria-hidden="true" /></span>
                  <div className="device-catalog__model-copy">
                    <strong>{entry.label}</strong>
                    <span>内置{selectedCategory.label}机型 · 可进入仿真</span>
                  </div>
                  {current && <small className="device-catalog__badge">当前机型</small>}
                  <button
                    type="button"
                    disabled={!current && !!lockReason}
                    title={!current && lockReason ? lockReason : undefined}
                    onClick={() => void openModel(entry)}
                  >
                    {selecting === entry.id ? "正在加载…" : current ? "进入仿真" : "切换并进入仿真"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="device-catalog__empty">
            <SelectedIcon size={30} aria-hidden="true" />
            <strong>尚无可运行的{selectedCategory.label}机型</strong>
            <p>可以先将相关模型文件归档到项目资产；仿真和控制能力需要在设备接入后提供。</p>
            <Link to="/assets"><FolderOpen size={15} aria-hidden="true" />打开项目资产</Link>
          </div>
        )}
      </section>
    </div>
  );
}
