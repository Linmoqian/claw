/**
 * Created on 2026-09-15
 * @author: https://github.com/Linmoqian
 *
 * 对抗训练工作区：运行可复现的仿真最小-最大基线并展示最坏回报。
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  RotateCcw,
  ShieldAlert,
  Swords,
  Target,
} from "lucide-react";
import {
  runAdversarialTraining,
  type AdversarialTrainingConfig,
  type AdversarialTrainingResult,
} from "../robot/adversarialTraining";
import { DEFAULT_ROBOT_ID, useRobotStore } from "../stores/robotStore";
import "./AdversarialTraining.css";

type TrainingControls = Required<
  Pick<
    AdversarialTrainingConfig,
    "epochs" | "adversaryPopulation" | "perturbationDeg" | "learningRate"
  >
>;

const DEFAULT_CONTROLS: TrainingControls = {
  epochs: 24,
  adversaryPopulation: 8,
  perturbationDeg: 8,
  learningRate: 0.42,
};

function formatReward(value: number): string {
  return value.toFixed(2);
}

function formatMillimeters(value: number | null): string {
  return value === null ? "—" : `${(value * 1000).toFixed(0)} mm`;
}

export default function AdversarialTraining() {
  const model = useRobotStore((state) => state.model);
  const status = useRobotStore((state) => state.status);
  const loadRobot = useRobotStore((state) => state.loadRobot);
  const [controls, setControls] = useState<TrainingControls>(DEFAULT_CONTROLS);
  const [result, setResult] = useState<AdversarialTrainingResult | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle") void loadRobot(DEFAULT_ROBOT_ID);
  }, [loadRobot, status]);

  const latest = result?.history[result.history.length - 1] ?? null;
  const first = result?.history[0] ?? null;
  const rewardDelta =
    latest && first ? latest.worstReward - first.worstReward : 0;
  const chartMax = useMemo(() => {
    if (!result || result.history.length === 0) return 1;
    return Math.max(
      1,
      ...result.history.map((item) => Math.abs(item.worstReward)),
    );
  }, [result]);

  const updateControl = <K extends keyof TrainingControls>(
    key: K,
    value: TrainingControls[K],
  ) => {
    setControls((current) => ({ ...current, [key]: value }));
    setResult(null);
    setNotice(null);
  };

  const startTraining = () => {
    if (!model || running) return;
    setRunning(true);
    setNotice(null);
    // 该基线是小规模同步离线计算，保持一次点击即可得到完整可复现结果。
    const output = runAdversarialTraining(model, controls);
    setResult(output);
    setRunning(false);
    setNotice(
      `训练完成 · ${output.config.epochs} 轮 · 最坏回报 ${formatReward(output.bestWorstReward)}`,
    );
  };

  const reset = () => {
    setControls(DEFAULT_CONTROLS);
    setResult(null);
    setNotice(null);
  };

  return (
    <div className="stage adversarial-training">
      <header className="adversarial-training__header">
        <div>
          <div className="section-label">
            <span className="section-label__title">对抗训练</span>
            <span className="adversarial-training__eyebrow">
              ADVERSARIAL TRAINING
            </span>
          </div>
          <h1>先把策略放进最坏情况里。</h1>
          <p>
            策略生成关节轨迹，攻击者施加有界扰动；每轮保留最坏
            episode，再用有限差分更新策略偏置。
          </p>
        </div>
        <Swords
          className="adversarial-training__header-icon"
          aria-hidden="true"
        />
      </header>

      <div className="adversarial-training__status" role="status">
        <span className={`adversarial-training__status-dot is-${status}`} />
        <span>
          {status === "ready"
            ? `${model?.def.name ?? "SO-100"} · ${model?.active.length ?? 0} 个可动关节 · 离线仿真`
            : status === "loading"
              ? "正在加载机器人模型…"
              : "等待机器人模型"}
        </span>
        <span className="adversarial-training__status-note">
          场景目标：水杯 · 障碍：咖啡机
        </span>
      </div>

      <div className="adversarial-training__layout">
        <section className="adversarial-training__card adversarial-training__controls">
          <div className="adversarial-training__card-head">
            <div>
              <span className="adversarial-training__kicker">
                TRAINING LOOP
              </span>
              <h2>训练配置</h2>
            </div>
            <ShieldAlert size={19} aria-hidden="true" />
          </div>

          <label className="adversarial-training__field">
            <span>训练轮数</span>
            <output className="tnum">{controls.epochs}</output>
            <input
              type="range"
              min="4"
              max="80"
              step="1"
              value={controls.epochs}
              onChange={(event) =>
                updateControl("epochs", Number(event.target.value))
              }
            />
          </label>
          <label className="adversarial-training__field">
            <span>攻击样本 / 轮</span>
            <output className="tnum">{controls.adversaryPopulation}</output>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              value={controls.adversaryPopulation}
              onChange={(event) =>
                updateControl("adversaryPopulation", Number(event.target.value))
              }
            />
          </label>
          <label className="adversarial-training__field">
            <span>扰动上限</span>
            <output className="tnum">{controls.perturbationDeg}°</output>
            <input
              type="range"
              min="0"
              max="20"
              step="1"
              value={controls.perturbationDeg}
              onChange={(event) =>
                updateControl("perturbationDeg", Number(event.target.value))
              }
            />
          </label>
          <label className="adversarial-training__field">
            <span>策略学习率</span>
            <output className="tnum">{controls.learningRate.toFixed(2)}</output>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.01"
              value={controls.learningRate}
              onChange={(event) =>
                updateControl("learningRate", Number(event.target.value))
              }
            />
          </label>

          <div className="adversarial-training__actions">
            <button
              type="button"
              className="adversarial-training__run"
              disabled={!model || running}
              onClick={startTraining}
            >
              <Play size={15} />
              {running ? "计算中…" : "开始训练"}
            </button>
            <button
              type="button"
              className="adversarial-training__reset"
              onClick={reset}
              aria-label="重置训练配置"
            >
              <RotateCcw size={14} />
              重置
            </button>
          </div>
          {notice && <p className="adversarial-training__notice">{notice}</p>}
        </section>

        <section className="adversarial-training__card adversarial-training__metrics">
          <div className="adversarial-training__card-head">
            <div>
              <span className="adversarial-training__kicker">
                ROBUSTNESS READOUT
              </span>
              <h2>最坏情况指标</h2>
            </div>
            <Target size={19} aria-hidden="true" />
          </div>
          {latest ? (
            <div className="adversarial-training__metric-grid">
              <div>
                <span>最坏回报</span>
                <strong className="tnum">
                  {formatReward(latest.worstReward)}
                </strong>
                <small className={rewardDelta >= 0 ? "is-up" : "is-down"}>
                  {rewardDelta >= 0 ? "↑" : "↓"}{" "}
                  {Math.abs(rewardDelta).toFixed(2)} vs 首轮
                </small>
              </div>
              <div>
                <span>目标回报</span>
                <strong className="tnum">{latest.goalReward.toFixed(2)}</strong>
                <small>末段靠近水杯</small>
              </div>
              <div>
                <span>碰撞步数</span>
                <strong className="tnum">{latest.collisionCount}</strong>
                <small>{latest.machineNearMisses} 次咖啡机近失</small>
              </div>
              <div>
                <span>策略偏移</span>
                <strong className="tnum">
                  {latest.policyOffsetNormDeg.toFixed(1)}°
                </strong>
                <small>关节向量 L2 范数</small>
              </div>
            </div>
          ) : (
            <div className="adversarial-training__empty">
              <AlertTriangle size={18} />
              <span>
                运行一次训练后，这里会显示最坏 episode 的回报、安全与收敛指标。
              </span>
            </div>
          )}
          {result && (
            <div className="adversarial-training__episode">
              <div>
                <span>最终水杯目标距离</span>
                <strong className="tnum">
                  {(result.finalEpisode.finalGoalDistance * 1000).toFixed(0)} mm
                </strong>
              </div>
              <div>
                <span>最小碰撞安全距</span>
                <strong className="tnum">
                  {formatMillimeters(result.finalEpisode.minSafetyDistance)}
                </strong>
              </div>
              <div>
                <span>最坏扰动范数</span>
                <strong className="tnum">
                  {latest?.adversaryNormDeg.toFixed(1)}°
                </strong>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="adversarial-training__lower">
        <section className="adversarial-training__card adversarial-training__history">
          <div className="adversarial-training__card-head">
            <div>
              <span className="adversarial-training__kicker">
                MINIMAX HISTORY
              </span>
              <h2>训练轨迹</h2>
            </div>
            <CheckCircle2 size={19} aria-hidden="true" />
          </div>
          {result ? (
            <div className="adversarial-training__history-list">
              {result.history.map((item) => (
                <div
                  className="adversarial-training__history-row"
                  key={item.epoch}
                >
                  <span className="tnum">
                    {String(item.epoch).padStart(2, "0")}
                  </span>
                  <div className="adversarial-training__history-bar">
                    <i
                      style={{
                        width: `${Math.min(100, (Math.abs(item.worstReward) / chartMax) * 100)}%`,
                      }}
                    />
                  </div>
                  <strong className="tnum">
                    {formatReward(item.worstReward)}
                  </strong>
                  <small className="tnum">{item.collisionCount} 碰撞</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="adversarial-training__history-placeholder">
              <span className="tnum">01</span>
              <i />
              <span>等待训练轨迹</span>
            </div>
          )}
        </section>

        <section className="adversarial-training__card adversarial-training__method">
          <div className="adversarial-training__card-head">
            <div>
              <span className="adversarial-training__kicker">ALGORITHM</span>
              <h2>基本算法</h2>
            </div>
            <Swords size={19} aria-hidden="true" />
          </div>
          <ol>
            <li>
              <b>01</b>
              <span>
                <strong>策略玩家</strong>
                ：给名义轨迹加关节偏置，目标是靠近水杯并保持平滑。
              </span>
            </li>
            <li>
              <b>02</b>
              <span>
                <strong>攻击玩家</strong>
                ：在每轮生成固定幅度内的扰动，选择回报最低的 episode。
              </span>
            </li>
            <li>
              <b>03</b>
              <span>
                <strong>安全评估</strong>：用
                FK、现有碰撞系统和咖啡机距离共同计算最坏回报。
              </span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
