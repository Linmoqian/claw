/** 视频资源、实验采集与旧数据集的兼容查看。
 * Created on 2026-09-27
 * @author:  https://github.com/Linmoqian
 */
import { useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Clapperboard, Database, FileUp, ArrowRight, Square } from "lucide-react";
import VideoLibrary from "../../../components/videos/VideoLibrary";
import { useExperimentStore } from "../domain/experimentStore";
import { useRobotStore } from "../../../stores/robotStore";
import "./DataCollection.css";
import "./Experiments.css";

type DatasetSource = "simulation" | "telemetry" | "replay" | "import";
interface Dataset {
  id: string;
  name: string;
  description: string;
  source: DatasetSource;
  sampleRate: number | null;
  records: number;
  fields: string[];
  createdAt: string;
}
interface DatasetRead {
  datasets: Dataset[];
  error: string | null;
  writable: boolean;
}
const STORAGE_KEY = "xiakao:data-collection:datasets:v3";
const SOURCE_LABELS: Record<DatasetSource, string> = {
  simulation: "旧版演示样本",
  telemetry: "旧版遥测数据集",
  replay: "旧版回放数据集",
  import: "导入摘要",
};

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dataset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    (candidate.source === "simulation" ||
      candidate.source === "telemetry" ||
      candidate.source === "replay" ||
      candidate.source === "import") &&
    typeof candidate.records === "number" &&
    Array.isArray(candidate.fields) &&
    candidate.fields.every((field) => typeof field === "string") &&
    typeof candidate.createdAt === "string"
  );
}

function readDatasets(): DatasetRead {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { datasets: [], error: null, writable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isDataset))
      return {
        datasets: Array.isArray(parsed) ? parsed.filter(isDataset) : [],
        error:
          "部分旧数据无法读取，原存储内容已保留。修复前暂不可添加摘要，新实验采集仍可使用。",
        writable: false,
      };
    return { datasets: parsed, error: null, writable: true };
  } catch {
    return {
      datasets: [],
      error: "旧数据读取失败，原存储内容已保留。新实验记录使用独立数据库。",
      writable: false,
    };
  }
}

function parseSummary(
  text: string,
  csv: boolean,
): { records: number; fields: string[] } {
  if (csv) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error("文件为空");
    return {
      records: Math.max(0, lines.length - 1),
      fields: lines[0]
        .split(",")
        .map((field) => field.trim().replace(/^"|"$/g, "")),
    };
  }
  const value: unknown = JSON.parse(text);
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        "data" in value &&
        Array.isArray(value.data)
      ? value.data
      : [value];
  const first = rows.find(
    (row: unknown) => row && typeof row === "object" && !Array.isArray(row),
  );
  return {
    records: rows.length,
    fields: first && typeof first === "object" ? Object.keys(first) : [],
  };
}

export default function DataCollection() {
  const [legacy, setLegacy] = useState<DatasetRead>(readDatasets);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = useExperimentStore((state) => state.active);
  const count = useExperimentStore((state) => state.sampleCount);
  const elapsed = useExperimentStore((state) => state.elapsedS);
  const saving = useExperimentStore((state) => state.saving);
  const error = useExperimentStore((state) => state.error);
  const robotReady = useRobotStore((state) => state.status === "ready");
  const navigate = useNavigate();

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !legacy.writable) return;
    setImporting(true);
    try {
      const summary = parseSummary(
        await file.text(),
        file.name.toLowerCase().endsWith(".csv"),
      );
      const dataset: Dataset = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        description: "仅保存行数和字段摘要，不包含可回放的运动帧。",
        source: "import",
        sampleRate: null,
        records: summary.records,
        fields: summary.fields,
        createdAt: new Date().toISOString(),
      };
      // 只在明确导入时写入；先验证最新值，避免覆盖损坏内容或其他页面的新增数据。
      const latest = readDatasets();
      if (!latest.writable) {
        setLegacy(latest);
        throw new Error("旧数据发生变化，已保留原内容，请先修复后再导入");
      }
      const datasets = [dataset, ...latest.datasets];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
      setLegacy({ datasets, writable: true, error: null });
      setNotice(`已保存「${dataset.name}」的字段与行数摘要。`);
    } catch (reason) {
      setNotice(
        `导入未保存：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setImporting(false);
    }
  };

  const start = async () => {
    await useExperimentStore.getState().start("", "studio");
    if (useExperimentStore.getState().active?.status === "recording")
      navigate("/studio");
  };

  return (
    <div className="stage data-collection experiments">
      <header className="data-collection__header">
        <div>
          <div className="section-label">
            <span className="section-label__title">数据与智能</span>
            <span className="data-collection__eyebrow">DATA COLLECTION</span>
          </div>
          <h1>视频与实验数据</h1>
          <p>
            集中查看实验录像与演示视频。运动采集保存在实验记录中，关联实际关节、底盘、TCP、程序与场景。
          </p>
        </div>
        <Clapperboard className="data-collection__header-icon" aria-hidden="true" />
      </header>
      <VideoLibrary />
      {(error || legacy.error) && (
        <div className="experiments__notice is-error" role="alert">
          {error ?? legacy.error}
          {active && (
            <>
              <button
                type="button"
                onClick={() => void useExperimentStore.getState().retrySave()}
              >
                重试保存
              </button>
              <button
                type="button"
                onClick={() => useExperimentStore.getState().exportActive()}
              >
                导出当前数据
              </button>
            </>
          )}
        </div>
      )}
      <section className="experiments__panel">
        <div className="experiments__active">
          <div>
            <h2>{active ? active.name : "当前仿真采集"}</h2>
            <p>
              {active
                ? `${active.status === "recording" ? "正在采集" : "待保存"} · ${elapsed.toFixed(1)} s · ${count} 帧 · 20 Hz`
                : "开始实验后按 20 Hz 采样，切换页面会继续记录。"}
            </p>
          </div>
          {active ? (
            <button
              type="button"
              className="experiments__button is-primary"
              disabled={saving}
              onClick={() => void useExperimentStore.getState().finish()}
            >
              <Square size={14} />
              {saving ? "保存中…" : "结束并保存"}
            </button>
          ) : (
            <button
              type="button"
              className="experiments__button is-primary"
              disabled={saving || !robotReady}
              onClick={() => void start()}
            >
              开始实验采集
            </button>
          )}
          <Link to="/experiments" className="experiments__button">
            查看实验记录 <ArrowRight size={14} />
          </Link>
        </div>
        {!robotReady && (
          <p>
            机器人尚未就绪，先<Link to="/studio">进入仿真</Link>完成加载。
          </p>
        )}
      </section>
      <section className="data-collection__toolbar" aria-label="兼容数据集操作">
        <div className="data-collection__stats">
          <div>
            <strong>{legacy.datasets.length}</strong>
            <span>个旧数据集 / 摘要</span>
          </div>
        </div>
        <div className="data-collection__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            hidden
            onChange={(event) => void handleImport(event)}
          />
          <button
            type="button"
            className="experiments__button"
            disabled={!legacy.writable || importing}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={15} />
            {importing ? "正在读取…" : "添加文件摘要"}
          </button>
        </div>
      </section>
      {notice && (
        <div className="experiments__notice" role="status">
          {notice}
        </div>
      )}
      <section
        className="data-collection__list"
        aria-label="旧数据集与文件摘要"
      >
        <div className="data-collection__list-head">
          <div>
            <span className="data-collection__card-kicker">历史兼容</span>
            <h2>旧数据集与文件摘要</h2>
          </div>
          <span>保留原始内容</span>
        </div>
        <p className="data-collection__legacy-note">
          旧版仿真样本来自固定演示轨迹；导入文件仅保留摘要。此处内容不作为新实验运动记录或回放来源。
        </p>
        {legacy.datasets.length === 0 ? (
          <div className="data-collection__empty">
            <Database size={26} />
            <strong>暂无旧数据集或文件摘要</strong>
            <p>新采集请使用上方“开始实验采集”。</p>
          </div>
        ) : (
          <div className="data-collection__grid">
            {legacy.datasets.map((dataset) => (
              <article className="dataset-card" key={dataset.id}>
                <div className="dataset-card__head">
                  <span className={`dataset-card__icon is-${dataset.source}`}>
                    <Database size={16} />
                  </span>
                  <span className={`dataset-card__source is-${dataset.source}`}>
                    {SOURCE_LABELS[dataset.source]}
                  </span>
                </div>
                <h3>{dataset.name}</h3>
                <p>{dataset.description}</p>
                <div className="dataset-card__meta">
                  <span>{dataset.records.toLocaleString("zh-CN")} 条记录</span>
                  <span>
                    {dataset.sampleRate
                      ? `${dataset.sampleRate} Hz`
                      : "文件摘要"}
                  </span>
                </div>
                <div className="dataset-card__fields">
                  {dataset.fields.slice(0, 4).map((field, index) => (
                    <code key={`${field}-${index}`}>{field}</code>
                  ))}
                </div>
                <footer className="dataset-card__foot">
                  <span>
                    {Number.isFinite(Date.parse(dataset.createdAt))
                      ? new Date(dataset.createdAt).toLocaleDateString("zh-CN")
                      : "日期未知"}
                  </span>
                  <span>兼容查看 · 不支持回放</span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
