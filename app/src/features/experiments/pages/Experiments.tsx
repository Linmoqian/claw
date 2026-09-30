/** 实验列表与显式采集入口。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, FlaskConical, LoaderCircle, Plus, Save, Upload } from "lucide-react";
import LoadingState from "../../../components/workbench/LoadingState";
import { useExperimentStore } from "../domain/experimentStore";
import { useRobotStore } from "../../../stores/robotStore";
import "./Experiments.css";

export default function Experiments() {
  const records = useExperimentStore((state) => state.records);
  const active = useExperimentStore((state) => state.active);
  const saving = useExperimentStore((state) => state.saving);
  const error = useExperimentStore((state) => state.error);
  const initialized = useExperimentStore((state) => state.initialized);
  const robotStatus = useRobotStore((state) => state.status);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"studio" | "blocks">("studio");
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void useExperimentStore.getState().initialize();
  }, []);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    const id = await useExperimentStore.getState().importBundle(file);
    setImporting(false);
    if (id) navigate(`/experiments/${id}`);
  };

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await useExperimentStore.getState().start(name, source);
    if (useExperimentStore.getState().active?.status === "recording")
      navigate(source === "blocks" ? "/blocks" : "/studio");
  };

  return (
    <div className="stage experiments">
      <header className="experiments__header">
        <div>
          <span className="experiments__eyebrow">实验操作 / 本地记录</span>
          <h1>实验记录</h1>
          <p>从当前仿真开始采集，保存运动、程序和场景，随时查看与复盘。</p>
        </div>
        <FlaskConical size={32} aria-hidden="true" />
      </header>
      {error && (
        <div className="experiments__notice is-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void useExperimentStore.getState().retrySave()}
          >
            {active ? "重试保存" : "重试读取"}
          </button>
          {active && (
            <button
              type="button"
              onClick={() => useExperimentStore.getState().exportActive()}
            >
              导出当前数据
            </button>
          )}
        </div>
      )}
      <section className="experiments__panel">
        {active ? (
          <div className="experiments__active">
            <div>
              <h2>{active.name}</h2>
              <p>
                {saving
                  ? "正在保存，请稍候"
                  : active.status === "recording"
                    ? "实验采集中，切换页面会继续记录。"
                    : "采集已停止，内存中仍有待保存数据。"}
              </p>
            </div>
            <Link
              className="experiments__button"
              to={active.source === "blocks" ? "/blocks" : "/studio"}
            >
              返回实验 <ArrowRight size={15} />
            </Link>
            <button
              className="experiments__button is-primary"
              type="button"
              disabled={saving}
              onClick={() => void useExperimentStore.getState().finish()}
            >
              {saving ? (
                <LoaderCircle size={15} className="wb-spin" aria-hidden="true" />
              ) : (
                <Save size={15} />
              )}
              {saving ? "正在保存…" : "结束并保存"}
            </button>
          </div>
        ) : (
          <form
            className="experiments__start"
            onSubmit={(event) => void start(event)}
          >
            <div>
              <h2>开始新实验</h2>
              <p>
                20 Hz 记录当前关节、底盘与
                TCP。开始采集后，再通过工作区控制运动。
              </p>
            </div>
            <label>
              实验名称
              <input
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：抓取轨迹验证"
              />
            </label>
            <label>
              实验入口
              <select
                value={source}
                onChange={(event) =>
                  setSource(event.target.value as "studio" | "blocks")
                }
              >
                <option value="studio">仿真与调参</option>
                <option value="blocks">积木编程</option>
              </select>
            </label>
            <button
              className="experiments__button is-primary"
              disabled={saving || robotStatus !== "ready"}
              type="submit"
            >
              <Plus size={15} />
              开始实验
            </button>
            {robotStatus !== "ready" && (
              <p className="experiments__hint">
                机器人尚未就绪，<Link to="/studio">进入仿真完成加载</Link>
                后再开始。
              </p>
            )}
          </form>
        )}
      </section>
      <div className="experiments__section-title">
        <h2>全部实验</h2>
        <div className="experiments__section-actions">
          <span>{records.length} 条记录 · 保存在当前设备</span>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => void importFile(event)}
          />
          <button
            type="button"
            className="experiments__button"
            disabled={importing || !!active}
            title={active ? "请先结束当前实验再导入" : "导入本工作台导出的实验 JSON"}
            onClick={() => importInputRef.current?.click()}
          >
            {importing ? (
              <LoaderCircle size={15} className="wb-spin" aria-hidden="true" />
            ) : (
              <Upload size={15} />
            )}
            {importing ? "正在导入…" : "导入实验 JSON"}
          </button>
        </div>
      </div>
      {!initialized && !error ? (
        <LoadingState
          variant="panel"
          label="正在读取实验记录"
          detail="从本机工作空间读取记录…"
        />
      ) : records.length === 0 ? (
        <section className="experiments__empty">
          <FlaskConical size={32} />
          <h2>准备好记录第一次实验</h2>
          <p>
            先开始采集，在仿真或积木工作区运行，再结束保存。记录会出现在这里。
          </p>
          <div>
            <Link className="experiments__button" to="/studio">
              进入仿真
            </Link>
            <Link className="experiments__button" to="/blocks">
              打开积木编程
            </Link>
          </div>
        </section>
      ) : (
        <div className="experiments__list">
          {records.map((record) => (
            <Link
              className="experiments__record"
              key={record.id}
              to={`/experiments/${record.id}`}
            >
              <div>
                <span className={`experiments__status is-${record.status}`}>
                  {active?.id === record.id && active.status === "interrupted"
                    ? "采集已中断 · 待保存"
                    : record.status === "saved"
                      ? "已保存"
                      : record.status === "recording"
                        ? "采集中"
                        : "中断记录"}
                </span>
                <h3>{record.name}</h3>
                <p>
                  {record.robotLabel} ·{" "}
                  {record.source === "studio" ? "仿真" : "积木"} ·{" "}
                  {new Date(record.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="experiments__record-metrics">
                <strong>
                  {record.durationS.toFixed(1)} <small>s</small>
                </strong>
                <span>{record.sampleCount.toLocaleString("zh-CN")} 帧</span>
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
