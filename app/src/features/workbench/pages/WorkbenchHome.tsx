/** 实验室总览与继续工作入口。Created on 2026-09-26; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { Link } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Box,
  BrainCircuit,
  Check,
  Cable,
  Circle,
  Clock3,
  Clapperboard,
  FlaskConical,
  FolderOpen,
  ScanEye,
} from "lucide-react";
import { useExperimentStore } from "../../experiments/domain/experimentStore";
import { useRobotStore, findRobotEntry } from "../../../stores/robotStore";
import { useDevice } from "../../../stores/DeviceContext";
import { isDesktop } from "../../../lib/serial";
import { useBridgeStore } from "../../../stores/bridgeStore";
import { useRuntimeStore } from "../runtime/runtime";
import { useActivityStore } from "../../../stores/activity";
import { useMotorDebugStore } from "../../devices/motor-debug/session";
import "./WorkbenchHome.css";

function durationLabel(seconds: number): string {
  return seconds < 60
    ? `${seconds.toFixed(1)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

export default function WorkbenchHome() {
  const records = useExperimentStore((state) => state.records);
  const active = useExperimentStore((state) => state.active);
  const error = useExperimentStore((state) => state.error);
  const status = useRobotStore((state) => state.status);
  const modelId = useRobotStore((state) => state.currentId);
  const loadError = useRobotStore((state) => state.error);
  const runtimeReady = useRuntimeStore((state) => state.ready);
  const bridgeKind = useBridgeStore((state) => state.bridge.kind);
  const replayPreparing = useActivityStore((state) => state.replayPreparing);
  const programRunning = useActivityStore((state) => state.programRunning);
  const { connected, connectingPort, disconnecting } = useDevice();
  const debugPort = useMotorDebugStore((state) => state.port);
  const modelLabel = modelId
    ? (findRobotEntry(modelId)?.label ?? modelId)
    : "SO-100";
  const savedRecords = records.filter(
    (record) => record.status !== "recording",
  );
  const savedCount = savedRecords.length;
  const totalFrames = savedRecords.reduce(
    (count, record) => count + record.sampleCount,
    0,
  );
  const totalDuration = savedRecords.reduce(
    (duration, record) => duration + record.durationS,
    0,
  );
  const experimentReadiness = active
    ? active.status === "recording"
      ? "采集中"
      : "待保存"
    : status !== "ready" || !runtimeReady
      ? "等待模型"
      : replayPreparing || bridgeKind === "replay"
        ? "回放中"
        : connected || debugPort || bridgeKind !== "simulation"
          ? "请断开真机链路"
          : connectingPort || disconnecting
            ? "切换通道中"
            : programRunning
              ? "程序运行中"
              : "可开始";

  return (
    <div className="workbench-home">
      <header className="workbench-home__heading">
        <div>
          <span className="workbench-home__eyebrow">LAB WORKSPACE</span>
          <h1>今天，从一次实验开始</h1>
          <p>准备环境、编排运动、记录结果，在同一个工作台完成。</p>
        </div>
        <span className="workbench-home__local">
          <Circle size={6} fill="currentColor" />
          {isDesktop() ? "桌面工作空间" : "浏览器预览"}
          <span>本地保存</span>
        </span>
      </header>

      {active && (
        <Link to={`/${active.source}`} className="home-continue">
          <FlaskConical size={20} />
          <div>
            <strong>继续当前实验</strong>
            <span>{active.name}</span>
          </div>
          <ArrowRight size={18} />
        </Link>
      )}

      <section className="home-launch" aria-labelledby="home-launch-title">
        <div className="home-launch__intro">
          <span className="home-section-index">01 / 准备与运行</span>
          <h2 id="home-launch-title">选择你的实验方式</h2>
          <p>
            仿真无需连接硬件。进入工作区后点击“开始实验”，即可记录实际运动。
          </p>
        </div>
        <Link to="/studio" className="home-launch__card">
          <span className="home-launch__icon">
            <Box size={26} strokeWidth={1.5} />
          </span>
          <div>
            <h3>仿真与调参</h3>
            <p>调整关节、验证轨迹、观察三维场景</p>
            <span>
              进入仿真
              <ArrowRight size={14} />
            </span>
          </div>
          <span className="home-launch__tag">{modelLabel}</span>
        </Link>
        <Link
          to="/blocks"
          className="home-launch__card home-launch__card--blocks"
        >
          <span className="home-launch__icon">
            <Blocks size={26} strokeWidth={1.5} />
          </span>
          <div>
            <h3>积木编程</h3>
            <p>编排动作、运行程序、查看执行反馈</p>
            <span>
              打开编程
              <ArrowRight size={14} />
            </span>
          </div>
          <span className="home-launch__tag">可视化编排</span>
        </Link>
      </section>

      <div className="home-middle">
        <section className="home-records" aria-labelledby="home-records-title">
          <div className="home-section-head">
            <div>
              <span className="home-section-index">02 / 实验与结果</span>
              <h2 id="home-records-title">最近实验</h2>
            </div>
            <Link to="/experiments">
              全部记录
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {error && savedCount === 0 ? (
            <div className="home-empty">
              <FlaskConical size={26} />
              <strong>实验记录暂时不可用</strong>
              <p>{error}</p>
              <Link to="/experiments" className="wb-button">
                查看并重试
              </Link>
            </div>
          ) : savedCount === 0 ? (
            <div className="home-empty">
              <span className="home-empty__icon">
                <FlaskConical size={24} />
              </span>
              <strong>你的第一份实验记录，会出现在这里</strong>
              <p>开始实验后，运动、程序快照和日志将一同保存。</p>
              <Link to="/studio" className="wb-button">
                准备一次仿真实验
                <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="home-record-list">
              {savedRecords.slice(0, 4).map((record) => (
                <Link
                  key={record.id}
                  to={`/experiments/${record.id}`}
                  className="home-record"
                >
                  <span className="home-record__icon">
                    {record.source === "blocks" ? (
                      <Blocks size={19} />
                    ) : (
                      <Box size={19} />
                    )}
                  </span>
                  <div>
                    <strong>{record.name}</strong>
                    <small>
                      {record.robotLabel} ·{" "}
                      {new Date(record.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </small>
                  </div>
                  <span className="home-record__duration">
                    {durationLabel(record.durationS)}
                  </span>
                  <span
                    className={`home-record__status ${record.status === "interrupted" ? "is-interrupted" : ""}`}
                  >
                    {record.status === "interrupted" ? "已中断" : "已保存"}
                  </span>
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          )}
          <div className="home-records__summary">
            <span>
              <strong>{savedCount}</strong>份本地记录
            </span>
            <span>
              <strong>{totalFrames.toLocaleString()}</strong>帧运动数据
            </span>
            <span>
              <Clock3 size={12} />
              {durationLabel(totalDuration)}
            </span>
          </div>
        </section>
        <section
          className="home-readiness"
          aria-labelledby="home-readiness-title"
        >
          <div className="home-section-head">
            <div>
              <span className="home-section-index">环境状态</span>
              <h2 id="home-readiness-title">实验准备</h2>
            </div>
            <span className="home-readiness__mark">
              {experimentReadiness === "可开始" ? (
                <Check size={16} />
              ) : (
                <Clock3 size={16} />
              )}
            </span>
          </div>
          <div className="home-readiness__item">
            <Box size={17} />
            <div>
              <strong>机器人模型</strong>
              <span>{modelLabel}</span>
            </div>
            <small className={status === "ready" ? "is-ready" : ""}>
              {status === "ready"
                ? "已就绪"
                : status === "error"
                  ? "加载失败"
                  : "准备中"}
            </small>
          </div>
          <div className="home-readiness__item">
            <FlaskConical size={17} />
            <div>
              <strong>仿真实验</strong>
              <span>本地运行 · 无需硬件</span>
            </div>
            <small
              className={experimentReadiness === "可开始" ? "is-ready" : ""}
            >
              {experimentReadiness}
            </small>
          </div>
          {loadError && (
            <p className="home-readiness__error" role="alert">
              {loadError}
            </p>
          )}
          <div className="home-readiness__note">
            <strong>实验流程</strong>
            <ol>
              <li>进入工作区并准备机型</li>
              <li>开始实验，运行或调整运动</li>
              <li>结束保存，查看结果与回放</li>
            </ol>
          </div>
        </section>
      </div>
      <section className="home-tools" aria-label="分析与辅助工具">
        <Link to="/motor-debug">
          <Cable size={19} />
          <div>
            <strong>单电机调试</strong>
            <span>TTL、RS485 与 SLCAN 经典 CAN</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/assets">
          <FolderOpen size={19} />
          <div>
            <strong>项目资产</strong>
            <span>整理数据、权重、模型与算法文件</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/training-center">
          <BrainCircuit size={19} />
          <div>
            <strong>训练中心</strong>
            <span>智能训练与对抗训练</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/vision">
          <ScanEye size={19} />
          <div>
            <strong>视觉助手</strong>
            <span>文本与单图分析 · 桌面端可用</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/data">
          <Clapperboard size={19} />
          <div>
            <strong>视频与数据</strong>
            <span>查看视频、实验数据与历史导入</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/documents">
          <BookOpen size={19} />
          <div>
            <strong>文档收集</strong>
            <span>集中阅读 PDF 与 Markdown 文件</span>
          </div>
          <ArrowUpRight size={14} />
        </Link>
      </section>
      <footer className="home-footnote">
        记录保存在当前设备的工作空间中，重要实验可在详情页导出备份。
      </footer>
    </div>
  );
}
