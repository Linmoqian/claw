/**
 * Created on 2026-09-15; updated on 2026-09-27
 * @author: https://github.com/Linmoqian
 *
 * 智能模型训练工作区：在仿真数据上训练感知分类器与决策网络。
 */
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  Download,
  Eye,
  Network,
  Play,
  RotateCcw,
  ShieldCheck,
  Table2,
} from "lucide-react";
import {
  DECISION_FEATURE_NAMES,
  DECISION_OUTPUT_NAMES,
  PERCEPTION_CLASS_LABELS,
  PERCEPTION_FEATURE_NAMES,
  serializeDecisionData,
  serializeDecisionModel,
  serializePerceptionData,
  serializePerceptionModel,
  type DecisionTrainingResult,
  type PerceptionTrainingResult,
} from "../../../robot/modelTraining";
import { useModelTrainingStore } from "../../../stores/trainingSessionStore";
import TrainingNavigation from "../components/TrainingNavigation";
import "./ModelTraining.css";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return value.toFixed(4);
}

function downloadText(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportFileStamp(): string {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  display,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="model-training__field">
      <span>{label}</span>
      <output className="tnum">{display}</output>
      <input
        type="range"
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function TrainingButton({
  running,
  disabled = running,
  label,
  onClick,
}: {
  running: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="model-training__run"
      disabled={disabled}
      onClick={onClick}
    >
      <Play size={14} />
      {running ? "训练计算中…" : label}
    </button>
  );
}

function ExportActions({
  onExportModel,
  onExportData,
}: {
  onExportModel: () => void;
  onExportData: () => void;
}) {
  return (
    <div className="model-training__export-actions">
      <button
        type="button"
        className="model-training__export"
        onClick={onExportModel}
      >
        <Download size={13} />
        模型 JSON
      </button>
      <button
        type="button"
        className="model-training__export"
        onClick={onExportData}
      >
        <Table2 size={13} />
        数据 CSV
      </button>
    </div>
  );
}

function PerceptionResult({
  result,
  onExportModel,
  onExportData,
}: {
  result: PerceptionTrainingResult;
  onExportModel: () => void;
  onExportData: () => void;
}) {
  const latest = result.history[result.history.length - 1];
  return (
    <div className="model-training__result">
      <div className="model-training__metric-grid">
        <div>
          <span>验证准确率</span>
          <strong className="tnum">
            {formatPercent(result.validationAccuracy)}
          </strong>
          <small>留出集 · {result.validationSamples} 条</small>
        </div>
        <div>
          <span>交叉熵损失</span>
          <strong className="tnum">{formatNumber(result.finalLoss)}</strong>
          <small>第 {latest?.epoch ?? 0} 轮</small>
        </div>
        <div>
          <span>训练样本</span>
          <strong className="tnum">{result.trainSamples}</strong>
          <small>3 类仿真目标</small>
        </div>
      </div>
      <div className="model-training__matrix-wrap">
        <div className="model-training__subhead">
          <span>验证集混淆矩阵</span>
          <small>行 = 实际 · 列 = 预测</small>
        </div>
        <table className="model-training__matrix">
          <thead>
            <tr>
              <th aria-label="实际预测" />
              {PERCEPTION_CLASS_LABELS.map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.confusion.map((row, rowIndex) => (
              <tr key={PERCEPTION_CLASS_LABELS[rowIndex]}>
                <th>{PERCEPTION_CLASS_LABELS[rowIndex]}</th>
                {row.map((count, columnIndex) => (
                  <td
                    key={`${rowIndex}-${columnIndex}`}
                    className={rowIndex === columnIndex ? "is-hit" : undefined}
                  >
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ExportActions
        onExportModel={onExportModel}
        onExportData={onExportData}
      />
    </div>
  );
}

function DecisionResult({
  result,
  onExportModel,
  onExportData,
}: {
  result: DecisionTrainingResult;
  onExportModel: () => void;
  onExportData: () => void;
}) {
  const latest = result.history[result.history.length - 1];
  return (
    <div className="model-training__result">
      <div className="model-training__metric-grid">
        <div>
          <span>验证成功率</span>
          <strong className="tnum">
            {formatPercent(result.validationSuccessRate)}
          </strong>
          <small>动作误差阈值 ≤ 0.30</small>
        </div>
        <div>
          <span>安全动作率</span>
          <strong className="tnum">
            {formatPercent(result.validationSafetyRate)}
          </strong>
          <small>近障碍时优先抬升</small>
        </div>
        <div>
          <span>验证 MSE</span>
          <strong className="tnum">{formatNumber(result.validationMse)}</strong>
          <small>第 {latest?.epoch ?? 0} 轮</small>
        </div>
      </div>
      <div className="model-training__network-summary">
        <div>
          <span>网络结构</span>
          <strong className="tnum">
            {DECISION_FEATURE_NAMES.length} → {result.hiddenUnits} →{" "}
            {DECISION_OUTPUT_NAMES.length}
          </strong>
        </div>
        <div>
          <span>输入</span>
          <small>{DECISION_FEATURE_NAMES.join(" · ")}</small>
        </div>
        <div>
          <span>输出</span>
          <small>{DECISION_OUTPUT_NAMES.join(" · ")}</small>
        </div>
      </div>
      <ExportActions
        onExportModel={onExportModel}
        onExportData={onExportData}
      />
    </div>
  );
}

export default function ModelTraining() {
  const {
    perceptionControls,
    decisionControls,
    perceptionResult,
    decisionResult,
    perceptionProvenance,
    decisionProvenance,
    running,
    trainingProgress,
    notice,
    updatePerception,
    updateDecision,
    trainPerception,
    trainDecision,
    setNotice,
    reset,
  } = useModelTrainingStore();
  const exportPerceptionModel = () => {
    if (!perceptionResult) return;
    downloadText(
      `perception-model-${exportFileStamp()}.json`,
      serializePerceptionModel(perceptionResult),
      "application/json;charset=utf-8",
    );
    setNotice("感知模型 JSON 已导出");
  };

  const exportPerceptionData = () => {
    if (!perceptionResult) return;
    downloadText(
      `perception-data-${exportFileStamp()}.csv`,
      serializePerceptionData(perceptionResult),
      "text/csv;charset=utf-8",
    );
    setNotice("感知训练数据 CSV 已导出");
  };

  const exportDecisionModel = () => {
    if (!decisionResult) return;
    downloadText(
      `decision-model-${exportFileStamp()}.json`,
      serializeDecisionModel(decisionResult),
      "application/json;charset=utf-8",
    );
    setNotice("决策网络 JSON 已导出");
  };

  const exportDecisionData = () => {
    if (!decisionResult) return;
    downloadText(
      `decision-data-${exportFileStamp()}.csv`,
      serializeDecisionData(decisionResult),
      "text/csv;charset=utf-8",
    );
    setNotice("决策训练数据 CSV 已导出");
  };

  return (
    <div className="stage model-training">
      <TrainingNavigation />
      <header className="model-training__header">
        <div>
          <div className="section-label">
            <span className="section-label__title">智能训练</span>
            <span className="model-training__eyebrow">MODEL TRAINING</span>
          </div>
          <h1>模型训练</h1>
          <p>
            基于内置合成样本训练感知与决策基线，查看指标并导出结果。参数与结果在应用内切页时保留。
          </p>
        </div>
        <BrainCircuit
          className="model-training__header-icon"
          aria-hidden="true"
        />
      </header>

      <div className="model-training__status" role="status">
        <span className="model-training__status-dot is-ready" />
        <span>内置合成数据 · 离线基线</span>
        <span className="model-training__status-note">
          不读取摄像头 · 不下发实机 · 固定种子可复现
        </span>
      </div>
      {running && trainingProgress && (
        <p className="model-training__notice" role="status">
          {running === "perception" ? "感知模型" : "决策网络"}训练进度：
          {trainingProgress.epoch}/{trainingProgress.epochs} 轮 · 损失 {trainingProgress.loss.toFixed(4)}
        </p>
      )}

      <div className="model-training__toolbar">
        <div className="model-training__toolbar-copy">
          <Database size={16} aria-hidden="true" />
          <span>
            本页使用可解释的合成特征和状态-动作样本，适合验证训练链路与指标展示。
          </span>
        </div>
        <button
          type="button"
          className="model-training__reset"
          onClick={reset}
          disabled={Boolean(running)}
        >
          <RotateCcw size={13} />
          恢复默认
        </button>
      </div>

      <div className="model-training__grid">
        <section className="model-training__card">
          <div className="model-training__card-head">
            <div>
              <span className="model-training__kicker">PERCEPTION MODEL</span>
              <h2>感知模型训练</h2>
            </div>
            <Eye size={19} aria-hidden="true" />
          </div>
          <p className="model-training__description">
            Softmax 多分类器从归一化仿真视觉特征中学习三类场景目标。
          </p>
          <div className="model-training__algorithm">
            <BarChart3 size={14} />
            <span>算法：全批量梯度下降 + 交叉熵</span>
          </div>
          <RangeField
            disabled={Boolean(running)}
            label="每类样本"
            value={perceptionControls.samplesPerClass}
            min={30}
            max={300}
            step={10}
            display={`${perceptionControls.samplesPerClass} 条`}
            onChange={(value) => updatePerception("samplesPerClass", value)}
          />
          <RangeField
            disabled={Boolean(running)}
            label="训练轮数"
            value={perceptionControls.epochs}
            min={4}
            max={100}
            step={1}
            display={`${perceptionControls.epochs} 轮`}
            onChange={(value) => updatePerception("epochs", value)}
          />
          <RangeField
            disabled={Boolean(running)}
            label="学习率"
            value={perceptionControls.learningRate}
            min={0.01}
            max={0.8}
            step={0.01}
            display={perceptionControls.learningRate.toFixed(2)}
            onChange={(value) => updatePerception("learningRate", value)}
          />
          <div className="model-training__feature-list">
            {PERCEPTION_FEATURE_NAMES.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
          <TrainingButton
            running={running === "perception"}
            disabled={Boolean(running)}
            label="训练感知模型"
            onClick={trainPerception}
          />
          {perceptionProvenance && (
            <p className="model-training__provenance">
              {perceptionProvenance.source} · 运行时机型：
              {perceptionProvenance.robotName}（算法不依赖机型）
            </p>
          )}
          {perceptionResult && (
            <PerceptionResult
              result={perceptionResult}
              onExportModel={exportPerceptionModel}
              onExportData={exportPerceptionData}
            />
          )}
        </section>

        <section className="model-training__card">
          <div className="model-training__card-head">
            <div>
              <span className="model-training__kicker">DECISION NETWORK</span>
              <h2>决策网络训练</h2>
            </div>
            <Network size={19} aria-hidden="true" />
          </div>
          <p className="model-training__description">
            单隐藏层 MLP 学习“目标状态 →
            末端动作”的行为克隆策略，并检查近障碍安全动作。
          </p>
          <div className="model-training__algorithm">
            <ShieldCheck size={14} />
            <span>算法：ReLU 隐藏层 + tanh 输出 + 反向传播</span>
          </div>
          <RangeField
            disabled={Boolean(running)}
            label="状态样本"
            value={decisionControls.samples}
            min={80}
            max={800}
            step={20}
            display={`${decisionControls.samples} 条`}
            onChange={(value) => updateDecision("samples", value)}
          />
          <RangeField
            disabled={Boolean(running)}
            label="训练轮数"
            value={decisionControls.epochs}
            min={8}
            max={160}
            step={1}
            display={`${decisionControls.epochs} 轮`}
            onChange={(value) => updateDecision("epochs", value)}
          />
          <RangeField
            disabled={Boolean(running)}
            label="隐藏单元"
            value={decisionControls.hiddenUnits}
            min={4}
            max={32}
            step={1}
            display={`${decisionControls.hiddenUnits} 个`}
            onChange={(value) => updateDecision("hiddenUnits", value)}
          />
          <RangeField
            disabled={Boolean(running)}
            label="学习率"
            value={decisionControls.learningRate}
            min={0.01}
            max={0.25}
            step={0.01}
            display={decisionControls.learningRate.toFixed(2)}
            onChange={(value) => updateDecision("learningRate", value)}
          />
          <div className="model-training__feature-list">
            {DECISION_FEATURE_NAMES.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
          <TrainingButton
            running={running === "decision"}
            disabled={Boolean(running)}
            label="训练决策网络"
            onClick={trainDecision}
          />
          {decisionProvenance && (
            <p className="model-training__provenance">
              {decisionProvenance.source} · 运行时机型：
              {decisionProvenance.robotName}（算法不依赖机型）
            </p>
          )}
          {decisionResult && (
            <DecisionResult
              result={decisionResult}
              onExportModel={exportDecisionModel}
              onExportData={exportDecisionData}
            />
          )}
        </section>
      </div>

      <div className="model-training__footer">
        <CheckCircle2 size={16} aria-hidden="true" />
        <div>
          <strong>当前训练边界</strong>
          <span>
            感知侧是特征分类基线，决策侧是行为克隆基线；训练完成后可导出模型
            JSON 与样本 CSV，尚未接入摄像头或真实机器人下发。
          </span>
        </div>
      </div>
      {notice && (
        <p className="model-training__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
