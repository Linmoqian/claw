/** 单次实验结果、曲线、执行记录与三维回放。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Download, LoaderCircle, Play, Save, Square } from "lucide-react";
import LoadingState from "../components/workbench/LoadingState";
import { useExperimentStore } from "../experiments/experimentStore";
import { experimentRepository } from "../experiments/repository";
import type { ExperimentBundle } from "../experiments/types";
import { stopProgram } from "../workbench/programRunner";
import { stopRuntime } from "../workbench/runtime";
import "./Experiments.css";
import "./ExperimentDetail.css";

const COLORS = [
  "#d46535",
  "#37738f",
  "#65966e",
  "#9a6eaf",
  "#b49a4a",
  "#8b6156",
];

function MotionChart({
  title,
  unit,
  times,
  series,
}: {
  title: string;
  unit: string;
  times: number[];
  series: { name: string; values: number[] }[];
}) {
  const geometry = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const line of series)
      for (const value of line.values) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (max - min < 0.001) {
      min -= 0.05;
      max += 0.05;
    }
    const duration = times[times.length - 1] || 1;
    const step = Math.max(1, Math.floor(times.length / 500));
    const paths = series.map((line) =>
      line.values
        .map((value, index) =>
          index % step === 0 || index === times.length - 1
            ? `${44 + (times[index] / duration) * 650},${174 - ((value - min) / (max - min)) * 140}`
            : null,
        )
        .filter(Boolean)
        .join(" "),
    );
    return { min, max, duration, paths };
  }, [times, series]);
  return (
    <section className="experiments__panel experiment-detail__chart">
      <h2>
        {title} <small>{unit}</small>
      </h2>
      {times.length ? (
        <>
          <svg
            viewBox="0 0 720 205"
            role="img"
            aria-label={`${title}，共 ${times.length} 帧，单位 ${unit}`}
          >
            <line x1="44" y1="34" x2="44" y2="174" stroke="#d9ddd9" />
            <line x1="44" y1="174" x2="694" y2="174" stroke="#d9ddd9" />
            <line x1="44" y1="104" x2="694" y2="104" stroke="#eff0ee" />
            <text x="3" y="39">
              {geometry.max.toFixed(2)}
            </text>
            <text x="3" y="177">
              {geometry.min.toFixed(2)}
            </text>
            <text x="44" y="195">
              0 s
            </text>
            <text x="648" y="195">
              {geometry.duration.toFixed(1)} s
            </text>
            {geometry.paths.map((points, index) => (
              <polyline
                key={index}
                points={points}
                fill="none"
                stroke={COLORS[index % COLORS.length]}
                strokeWidth="1.8"
              />
            ))}
          </svg>
          <div className="experiment-detail__legend">
            {series.map((line, index) => (
              <span key={line.name}>
                <i style={{ background: COLORS[index % COLORS.length] }} />
                {line.name}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p>此记录没有已保存的运动帧。</p>
      )}
    </section>
  );
}

export default function ExperimentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<ExperimentBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const error = useExperimentStore((state) => state.error);
  const active = useExperimentStore((state) => state.active);
  const records = useExperimentStore((state) => state.records);
  const persistedRecord = records.find((item) => item.id === id);
  const persistedRevision = `${persistedRecord?.status ?? ""}:${persistedRecord?.sampleCount ?? 0}`;

  useEffect(() => {
    let alive = true;
    void useExperimentStore
      .getState()
      .initialize()
      .then(async () => {
        try {
          const result = id ? await experimentRepository.get(id) : null;
          if (!alive) return;
          setBundle(result);
          setName(result?.record.name ?? "");
          if (!result) setLoadError("此记录不存在或未完成首次保存。");
        } catch (reason) {
          if (alive)
            setLoadError(
              reason instanceof Error ? reason.message : String(reason),
            );
        } finally {
          if (alive) setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, persistedRevision]);

  const times = useMemo(
    () => bundle?.samples.map((sample) => sample.t) ?? [],
    [bundle],
  );
  const jointSeries = useMemo(
    () =>
      bundle?.snapshot.jointMapping.map((joint) => ({
        name: `${joint.code} · ${joint.name}`,
        values: bundle.samples.map((sample) => sample.joints[joint.name] ?? 0),
      })) ?? [],
    [bundle],
  );
  const tcpSeries = useMemo(
    () =>
      ["X", "Y", "Z"].map((name, index) => ({
        name,
        values:
          bundle?.samples.map((sample) => sample.tcpPositionM[index]) ?? [],
      })),
    [bundle],
  );

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    setRenaming(true);
    await useExperimentStore.getState().rename(id, name);
    setRenaming(false);
  };
  const replay = async () => {
    if (!id) return;
    setReplaying(true);
    if (await useExperimentStore.getState().beginReplay(id))
      navigate("/studio");
    setReplaying(false);
  };
  const record = records.find((item) => item.id === id) ?? bundle?.record;
  if (loading)
    return (
      <div className="stage experiments">
        <LoadingState
          label="正在加载实验"
          detail="读取运动采样与程序日志…"
        />
      </div>
    );
  if (loadError || !bundle || !record)
    return (
      <div className="stage experiments">
        <Link to="/experiments">返回实验记录</Link>
        <div role="alert" className="experiments__notice is-error">
          {loadError ?? "实验记录不可用"}
        </div>
      </div>
    );

  return (
    <div className="stage experiments experiment-detail">
      <Link className="experiment-detail__back" to="/experiments">
        <ArrowLeft size={14} />
        全部实验
      </Link>
      <header className="experiments__header">
        <div>
          <span className="experiments__eyebrow">
            {record.robotLabel} /{" "}
            {record.source === "studio" ? "仿真实验" : "积木实验"}
          </span>
          <h1>{record.name}</h1>
          <p>
            {new Date(record.createdAt).toLocaleString("zh-CN")} ·{" "}
            {active?.id === record.id && active.status === "interrupted"
              ? "采集已中断，内存数据待保存；图表显示已落盘的片段"
              : record.status === "saved"
                ? "已保存"
                : record.status === "recording"
                  ? "采集中，图表为最近已保存片段"
                  : "中断记录，仅包含已保存的片段"}
          </p>
        </div>
      </header>
      {error && (
        <div className="experiments__notice is-error" role="alert">
          {error}
        </div>
      )}
      <div className="experiment-detail__metrics">
        <div>
          <span>时长</span>
          <strong>
            {record.durationS.toFixed(2)} <small>s</small>
          </strong>
        </div>
        <div>
          <span>运动采样</span>
          <strong>
            {record.sampleCount.toLocaleString("zh-CN")} <small>帧</small>
          </strong>
        </div>
        <div>
          <span>采样频率</span>
          <strong>
            20 <small>Hz</small>
          </strong>
        </div>
        <div>
          <span>程序运行</span>
          <strong>
            {bundle.snapshot.programRuns.length} <small>次</small>
          </strong>
        </div>
      </div>
      <div className="experiment-detail__toolbar">
        <button
          className="experiments__button is-primary"
          type="button"
          disabled={!bundle.samples.length || Boolean(active) || replaying}
          onClick={() => void replay()}
        >
          {replaying ? (
            <LoaderCircle size={14} className="wb-spin" aria-hidden="true" />
          ) : (
            <Play size={14} />
          )}
          {replaying ? "正在准备回放…" : "三维回放"}
        </button>
        <button
          className="experiments__button"
          type="button"
          onClick={() => {
            stopProgram();
            stopRuntime();
          }}
        >
          <Square size={14} />
          停止当前仿真与程序
        </button>
        <button
          className="experiments__button"
          type="button"
          onClick={() =>
            void useExperimentStore.getState().exportRecord(record.id)
          }
        >
          <Download size={14} />
          导出实验 JSON
        </button>
        {active && <p>请先结束并保存当前实验，再回放记录。</p>}
        {!bundle.samples.length && <p>没有运动帧，无法回放。</p>}
      </div>
      <form
        className="experiment-detail__rename"
        onSubmit={(event) => void rename(event)}
      >
        <label htmlFor="experiment-rename">实验名称</label>
        <input
          id="experiment-rename"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          disabled={active?.id === id}
        />
        <button
          type="submit"
          className="experiments__button"
          disabled={
            renaming ||
            active?.id === id ||
            !name.trim() ||
            name.trim() === record.name
          }
        >
          <Save size={14} />
          {renaming ? "保存中…" : "保存名称"}
        </button>
      </form>
      <MotionChart
        title="关节运动"
        unit="rad"
        times={times}
        series={jointSeries}
      />
      <MotionChart
        title="TCP 位置（机械臂基座坐标）"
        unit="m"
        times={times}
        series={tcpSeries}
      />
      <section className="experiments__panel">
        <div className="experiments__section-title">
          <h2>程序日志</h2>
          <span>{bundle.snapshot.logs.length} 条</span>
        </div>
        {bundle.snapshot.logs.length ? (
          <ol className="experiment-detail__logs">
            {bundle.snapshot.logs.map((log, index) => (
              <li
                key={index}
                className={log.type === "error" ? "is-error" : ""}
              >
                <time>{log.t.toFixed(2)} s</time>
                <span>{log.message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>此次实验未执行积木程序。</p>
        )}
      </section>
      <section className="experiments__panel">
        <h2>场景与采集来源</h2>
        <p>
          当前仿真实际状态 · {bundle.snapshot.jointMapping.length} 个关节 ·{" "}
          {bundle.snapshot.scene.workspace
            ? `${bundle.snapshot.scene.workspace.segments.length} 条 DXF 几何线段`
            : "默认仿真场景"}
          。三维回放会恢复记录机型、底盘轨迹与场景参照；动态道具运动未采集。
        </p>
        <p>记录包含每次执行的程序快照，可在导出的 JSON 中查看。</p>
      </section>
    </div>
  );
}
