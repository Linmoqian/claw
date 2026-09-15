import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Check,
  Database,
  FileUp,
  Play,
  Plus,
  Save,
  Square,
  X,
} from "lucide-react";
import { computeLinkPoses, computeTcpPose } from "../robot/kinematics";
import { degreesToRadians, radiansToDegrees } from "../robot/model";
import { sampleTrajectory, so100DemoLoop } from "../robot/trajectory";
import { DEFAULT_ROBOT_ID, useRobotStore } from "../stores/robotStore";
import "./DataCollection.css";

type DatasetSource = "simulation" | "telemetry" | "replay" | "import";

type Dataset = {
  id: string;
  name: string;
  description: string;
  source: DatasetSource;
  sampleRate: number | null;
  records: number;
  fields: string[];
  createdAt: string;
  samples?: SimulationSample[];
  lastSample?: SimulationSample;
};

type SimulationSample = {
  timestampS: number;
  jointPositionRad: number[];
  tcpPositionM: [number, number, number];
  mode: "simulation";
};

type Notice = {
  tone: "success" | "error";
  text: string;
};

const STORAGE_KEY = "xiakao:data-collection:datasets:v3";

const SOURCE_LABELS: Record<DatasetSource, string> = {
  simulation: "仿真数据",
  telemetry: "真机遥测",
  replay: "回放记录",
  import: "文件导入",
};

const DEFAULT_FIELDS: Record<Exclude<DatasetSource, "import">, string[]> = {
  simulation: ["timestamp_s", "joint_position_rad", "tcp_position_m", "mode"],
  telemetry: ["timestamp", "joint_state", "temperature", "current"],
  replay: ["timestamp", "joint_state", "base_pose"],
};

const SIMULATION_TRAJECTORY = so100DemoLoop();
const MAX_STORED_SAMPLES = 2400;

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dataset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.records === "number" &&
    Array.isArray(candidate.fields) &&
    typeof candidate.createdAt === "string"
  );
}

function readDatasets(): Dataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDataset) : [];
  } catch {
    return [];
  }
}

function makeId(): string {
  return `dataset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function monotonicNow(): number {
  return performance.now();
}

function makeSimulationSample(timestampS: number): SimulationSample {
  const model = useRobotStore.getState().model;
  const qDegFromTrajectory = sampleTrajectory(
    SIMULATION_TRAJECTORY,
    timestampS,
  );
  const jointCount = model?.active.length ?? qDegFromTrajectory.length;
  const qDeg = Array.from(
    { length: jointCount },
    (_, index) => qDegFromTrajectory[index] ?? 0,
  );
  const tcp = model
    ? computeTcpPose(model, computeLinkPoses(model, qDeg)).position
    : null;
  return {
    timestampS: Number(timestampS.toFixed(3)),
    jointPositionRad: qDeg.map(degreesToRadians),
    tcpPositionM: tcp
      ? [
          Number(tcp.x.toFixed(5)),
          Number(tcp.y.toFixed(5)),
          Number(tcp.z.toFixed(5)),
        ]
      : [0, 0, 0],
    mode: "simulation",
  };
}

function parseJsonSummary(value: unknown): {
  records: number;
  fields: string[];
} {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [value];
  const first = rows.find(
    (row) => row && typeof row === "object" && !Array.isArray(row),
  );
  const fields = first && typeof first === "object" ? Object.keys(first) : [];
  return { records: rows.length, fields };
}

function parseCsvSummary(text: string): { records: number; fields: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("文件为空");
  const fields = lines[0]
    .split(",")
    .map((field) => field.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  if (fields.length === 0) throw new Error("CSV 缺少表头");
  return { records: Math.max(0, lines.length - 1), fields };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export default function DataCollection() {
  const [datasets, setDatasets] = useState<Dataset[]>(readDatasets);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] =
    useState<Exclude<DatasetSource, "import">>("simulation");
  const [sampleRate, setSampleRate] = useState(20);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const robotStatus = useRobotStore((state) => state.status);
  const loadRobot = useRobotStore((state) => state.loadRobot);
  const captureRef = useRef<{
    datasetId: string;
    startedAt: number;
    timer: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
    } catch {
      // 本地存储不可用时仍保留当前会话中的数据集。
    }
  }, [datasets]);

  useEffect(() => {
    if (robotStatus === "idle") void loadRobot(DEFAULT_ROBOT_ID);
  }, [loadRobot, robotStatus]);

  useEffect(
    () => () => {
      if (captureRef.current) window.clearInterval(captureRef.current.timer);
    },
    [],
  );

  const totalRecords = useMemo(
    () => datasets.reduce((total, dataset) => total + dataset.records, 0),
    [datasets],
  );

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const dataset: Dataset = {
      id: makeId(),
      name: trimmedName,
      description: description.trim() || "等待采集数据",
      source,
      sampleRate,
      records: 0,
      fields: DEFAULT_FIELDS[source],
      createdAt: new Date().toISOString(),
    };
    setDatasets((current) => [dataset, ...current]);
    setName("");
    setDescription("");
    setSource("simulation");
    setSampleRate(20);
    setCreateOpen(false);
    setNotice({ tone: "success", text: `已创建数据集「${dataset.name}」` });
  };

  const stopCapture = () => {
    const capture = captureRef.current;
    if (!capture) return;
    window.clearInterval(capture.timer);
    captureRef.current = null;
    setCollectingId(null);
    setNotice({ tone: "success", text: "仿真采集已停止，数据集已保存" });
  };

  const startCapture = (dataset: Dataset) => {
    if (dataset.source !== "simulation") return;
    stopCapture();
    const startedAt = monotonicNow();
    const intervalMs = Math.max(
      50,
      1000 / Math.max(1, dataset.sampleRate ?? 20),
    );
    const timer = window.setInterval(() => {
      const timestampS = (monotonicNow() - startedAt) / 1000;
      const sample = makeSimulationSample(timestampS);
      setDatasets((current) =>
        current.map((item) => {
          if (item.id !== dataset.id) return item;
          const samples = [...(item.samples ?? []), sample].slice(
            -MAX_STORED_SAMPLES,
          );
          return {
            ...item,
            records: item.records + 1,
            fields: DEFAULT_FIELDS.simulation,
            samples,
            lastSample: sample,
          };
        }),
      );
    }, intervalMs);
    captureRef.current = { datasetId: dataset.id, startedAt, timer };
    setCollectingId(dataset.id);
    setNotice({ tone: "success", text: `正在采集「${dataset.name}」仿真数据` });
  };

  const toggleCapture = (dataset: Dataset) => {
    if (collectingId === dataset.id) stopCapture();
    else startCapture(dataset);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const summary = isCsv
        ? parseCsvSummary(text)
        : parseJsonSummary(JSON.parse(text));
      const dataset: Dataset = {
        id: makeId(),
        name: file.name.replace(/\.[^.]+$/, "") || "导入数据集",
        description: `从 ${file.name} 导入`,
        source: "import",
        sampleRate: null,
        records: summary.records,
        fields: summary.fields,
        createdAt: new Date().toISOString(),
      };
      setDatasets((current) => [dataset, ...current]);
      setNotice({
        tone: "success",
        text: `已添加「${dataset.name}」· ${dataset.records} 条记录`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: `导入失败：${error instanceof Error ? error.message : "无法解析文件"}`,
      });
    }
  };

  return (
    <div className="stage data-collection">
      <header className="data-collection__header">
        <div>
          <div className="section-label">
            <span className="section-label__title">数据采集</span>
            <span className="data-collection__eyebrow">DATA COLLECTION</span>
          </div>
          <h1>把每一次运动，留成可追溯的数据。</h1>
          <p>
            管理仿真、遥测与回放样本，为调参、诊断和后续分析保留统一的数据入口。
          </p>
        </div>
        <Database className="data-collection__header-icon" aria-hidden="true" />
      </header>

      <section className="data-collection__toolbar" aria-label="数据集操作">
        <div className="data-collection__stats">
          <div>
            <strong>{datasets.length}</strong>
            <span>个数据集</span>
          </div>
          <div>
            <strong>{totalRecords.toLocaleString("zh-CN")}</strong>
            <span>条记录</span>
          </div>
        </div>
        <div className="data-collection__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            hidden
            onChange={handleImport}
          />
          <button
            type="button"
            className="data-collection__btn data-collection__btn--secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={15} />
            添加数据集
          </button>
          <button
            type="button"
            className="data-collection__btn data-collection__btn--primary"
            onClick={() => {
              setCreateOpen(true);
              setNotice(null);
            }}
          >
            <Plus size={15} />
            创建数据集
          </button>
        </div>
      </section>

      {notice && (
        <div
          className={`data-collection__notice is-${notice.tone}`}
          role="status"
        >
          {notice.tone === "success" ? <Check size={15} /> : <X size={15} />}
          {notice.text}
        </div>
      )}

      {collectingId && (
        <div className="data-collection__capture-status" role="status">
          <span className="data-collection__capture-dot" />
          <strong>仿真采集中</strong>
          <span>内置 SO-100 安全轨迹 · 按数据集采样频率写入</span>
        </div>
      )}

      {createOpen && (
        <form className="data-collection__create" onSubmit={submitCreate}>
          <div className="data-collection__create-head">
            <div>
              <span className="data-collection__card-kicker">NEW DATASET</span>
              <h2>创建数据集</h2>
            </div>
            <button
              type="button"
              className="data-collection__icon-btn"
              onClick={() => setCreateOpen(false)}
              aria-label="取消创建"
            >
              <X size={16} />
            </button>
          </div>
          <div className="data-collection__form-grid">
            <label>
              <span>名称</span>
              <input
                required
                maxLength={48}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：SO-100 轨迹样本"
              />
            </label>
            <label>
              <span>数据来源</span>
              <select
                value={source}
                onChange={(event) =>
                  setSource(event.target.value as typeof source)
                }
              >
                <option value="simulation">仿真数据</option>
                <option value="telemetry">真机遥测</option>
                <option value="replay">回放记录</option>
              </select>
            </label>
            <label className="data-collection__form-wide">
              <span>说明</span>
              <textarea
                rows={2}
                maxLength={160}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="记录这组数据的用途或采集场景"
              />
            </label>
            <label>
              <span>采样频率（Hz）</span>
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={sampleRate}
                onChange={(event) =>
                  setSampleRate(Number(event.target.value) || 1)
                }
              />
            </label>
          </div>
          <footer className="data-collection__create-actions">
            <span>创建后可在此处继续接入采集源。</span>
            <button
              type="submit"
              className="data-collection__btn data-collection__btn--primary"
            >
              <Save size={15} />
              创建并添加
            </button>
          </footer>
        </form>
      )}

      <section className="data-collection__list" aria-label="数据集列表">
        <div className="data-collection__list-head">
          <div>
            <span className="data-collection__card-kicker">DATASETS</span>
            <h2>数据集</h2>
          </div>
          <span>{datasets.length ? "按最近创建排序" : "尚未建立数据集"}</span>
        </div>

        {datasets.length === 0 ? (
          <div className="data-collection__empty">
            <Database size={26} />
            <strong>从一个干净的数据集开始</strong>
            <p>创建采集容器，或导入已有的 JSON / CSV 文件。</p>
            <div>
              <button
                type="button"
                className="data-collection__btn data-collection__btn--primary"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={15} />
                创建数据集
              </button>
              <button
                type="button"
                className="data-collection__btn data-collection__btn--ghost"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp size={15} />
                导入文件
              </button>
            </div>
          </div>
        ) : (
          <div className="data-collection__grid">
            {datasets.map((dataset) => (
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
                      : "外部文件"}
                  </span>
                </div>
                <div className="dataset-card__fields">
                  {dataset.fields.length > 0 ? (
                    dataset.fields
                      .slice(0, 4)
                      .map((field) => <code key={field}>{field}</code>)
                  ) : (
                    <span>等待采集字段</span>
                  )}
                  {dataset.fields.length > 4 && (
                    <span>+{dataset.fields.length - 4}</span>
                  )}
                </div>
                {dataset.lastSample && (
                  <div className="dataset-card__sample">
                    <span>最近样本</span>
                    <code>
                      J1{" "}
                      {radiansToDegrees(
                        dataset.lastSample.jointPositionRad[0] ?? 0,
                      ).toFixed(1)}
                      ° · TCP{" "}
                      {dataset.lastSample.tcpPositionM
                        .map((value) => value.toFixed(3))
                        .join(", ")}{" "}
                      m
                    </code>
                  </div>
                )}
                <footer className="dataset-card__foot">
                  <span>创建于 {formatDate(dataset.createdAt)}</span>
                  <span className="dataset-card__ready">
                    {dataset.source === "simulation" ? (
                      <button
                        type="button"
                        className={`dataset-card__capture ${collectingId === dataset.id ? "is-active" : ""}`}
                        disabled={robotStatus !== "ready"}
                        onClick={() => toggleCapture(dataset)}
                      >
                        {collectingId === dataset.id ? (
                          <>
                            <Square size={11} />
                            停止采集
                          </>
                        ) : (
                          <>
                            <Play size={11} />
                            {dataset.records > 0 ? "继续采集" : "开始采集"}
                          </>
                        )}
                      </button>
                    ) : dataset.records === 0 ? (
                      "待接入"
                    ) : (
                      "已导入"
                    )}
                  </span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
