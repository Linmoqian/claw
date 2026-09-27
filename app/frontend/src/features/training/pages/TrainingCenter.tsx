/** 智能与对抗训练的统一入口。Created on 2026-09-27 @author: https://github.com/Linmoqian */
import { ArrowUpRight, BrainCircuit, Swords } from "lucide-react";
import { Link } from "react-router";
import TrainingNavigation from "../../../components/TrainingNavigation";
import {
  useAdversarialTrainingStore,
  useModelTrainingStore,
} from "../../../stores/trainingSessionStore";
import "./TrainingCenter.css";

export default function TrainingCenter() {
  const modelRunning = useModelTrainingStore((state) => state.running);
  const perceptionResult = useModelTrainingStore(
    (state) => state.perceptionResult,
  );
  const decisionResult = useModelTrainingStore((state) => state.decisionResult);
  const adversarialRunning = useAdversarialTrainingStore(
    (state) => state.running,
  );
  const adversarialResult = useAdversarialTrainingStore(
    (state) => state.result,
  );

  return (
    <div className="stage training-center">
      <header className="training-center__header">
        <div className="section-label">
          <span className="section-label__title">训练中心</span>
          <span className="training-center__eyebrow">TRAINING WORKSPACE</span>
        </div>
        <h1>选择训练方式</h1>
        <p>
          在一个工作区管理智能训练与对抗训练，切换页面后参数和本次结果仍会保留。
        </p>
      </header>

      <TrainingNavigation />

      <div className="training-center__grid">
        <article className="training-center__card">
          <div className="training-center__card-head">
            <span className="training-center__icon">
              <BrainCircuit size={23} aria-hidden="true" />
            </span>
            <span className="training-center__status" role="status">
              {modelRunning
                ? "训练中"
                : perceptionResult || decisionResult
                  ? "本次会话有结果"
                  : "待训练"}
            </span>
          </div>
          <span className="training-center__index">01 / INTELLIGENT</span>
          <h2>智能训练</h2>
          <p>训练感知分类器与决策网络，查看验证指标，并导出模型与训练数据。</p>
          <div className="training-center__facts">
            <span>
              感知：
              {perceptionResult
                ? `准确率 ${(perceptionResult.validationAccuracy * 100).toFixed(1)}%`
                : "尚无结果"}
            </span>
            <span>
              决策：
              {decisionResult
                ? `安全动作率 ${(decisionResult.validationSafetyRate * 100).toFixed(1)}%`
                : "尚无结果"}
            </span>
          </div>
          <Link className="training-center__action" to="/model-training">
            进入智能训练 <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </article>

        <article className="training-center__card">
          <div className="training-center__card-head">
            <span className="training-center__icon">
              <Swords size={23} aria-hidden="true" />
            </span>
            <span className="training-center__status" role="status">
              {adversarialRunning
                ? "训练中"
                : adversarialResult
                  ? "本次会话有结果"
                  : "待训练"}
            </span>
          </div>
          <span className="training-center__index">02 / ADVERSARIAL</span>
          <h2>对抗训练</h2>
          <p>
            在离线仿真中加入有界扰动，观察最坏回报与训练过程，检验策略稳定性。
          </p>
          <div className="training-center__facts">
            <span>
              最坏回报：
              {adversarialResult
                ? adversarialResult.bestWorstReward.toFixed(2)
                : "尚无结果"}
            </span>
            <span>
              训练轮数：
              {adversarialResult ? adversarialResult.config.epochs : "尚无结果"}
            </span>
          </div>
          <Link className="training-center__action" to="/training">
            进入对抗训练 <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </article>
      </div>

      <p className="training-center__footnote">
        当前两种训练使用内置合成数据与离线基线。结果保留在本次应用会话中；智能训练页支持导出。
      </p>
    </div>
  );
}
