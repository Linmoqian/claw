/**
 * Created on 2026-09-19
 * @author: https://github.com/Linmoqian
 *
 * 眼在手标定仿真面板：相机内参/手眼外参、关节零偏、FK 读数与 DLS IK 验证。
 */
import { useMemo, useState, type ChangeEvent } from "react";
import { Quaternion, Vector3 } from "three";
import { solveIk, type IkResult } from "../../../robot/ik";
import {
  applyJointCalibration,
  computeEyeHandPose,
  createSyntheticSamples,
  DEFAULT_INTRINSICS,
  simulateCameraCalibration,
  type CalibrationReport,
} from "../../../robot/handEye";
import { formatPose } from "../../../robot/kinematics";
import type { RobotModel } from "../../../robot/types";
import type { SimSnapshot } from "../../../robot/simulation";

interface EyeHandPanelProps {
  model: RobotModel;
  snapshot: SimSnapshot;
  ready: boolean;
  replay: boolean;
  open: boolean;
  eyeInHand: boolean;
  onEyeInHandChange: (enabled: boolean) => void;
  onApplyIk: (position: Vector3, quaternion: Quaternion) => void;
}

const numberText = (value: number, digits = 3) => value.toFixed(digits);

export default function EyeHandPanel({
  model,
  snapshot,
  ready,
  replay,
  open,
  eyeInHand,
  onEyeInHandChange,
  onApplyIk,
}: EyeHandPanelProps) {
  const [jointOffsets, setJointOffsets] = useState(() => model.active.map(() => 0));
  const [calibration, setCalibration] = useState<CalibrationReport | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [ikResult, setIkResult] = useState<IkResult | null>(null);
  const [target, setTarget] = useState<Vector3>(new Vector3(0.18, 0, 0.18));

  const measuredQ = snapshot.currentDeg;
  const calibratedQ = useMemo(
    () => applyJointCalibration(measuredQ, jointOffsets),
    [measuredQ, jointOffsets],
  );
  const eyeHandPose = useMemo(
    () => computeEyeHandPose(model, measuredQ, { offsetsDeg: jointOffsets }),
    [model, measuredQ, jointOffsets],
  );
  const tcpText = formatPose(eyeHandPose.tcp);
  const cameraText = formatPose(eyeHandPose.camera);

  const updateOffset = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setJointOffsets((current) => current.map((item, i) => (i === index ? value : item)));
  };

  const updateTarget = (axis: "x" | "y" | "z", event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setTarget((current) => new Vector3(
      axis === "x" ? value : current.x,
      axis === "y" ? value : current.y,
      axis === "z" ? value : current.z,
    ));
  };

  const runCalibration = () => {
    setCalibrating(true);
    // 小延迟让按钮反馈可见；标定本体仍是同步确定性计算。
    window.setTimeout(() => {
      const report = simulateCameraCalibration(model, createSyntheticSamples(model));
      setJointOffsets(report.jointOffsetsDeg.slice(0, model.active.length));
      setCalibration(report);
      setCalibrating(false);
    }, 360);
  };

  const solveTarget = () => {
    const result = solveIk(model, {
      target: {
        position: target.clone(),
        quaternion: snapshot.tcp.quaternion.clone(),
      },
      q0Deg: calibratedQ,
    });
    setIkResult(result);
  };

  const applyTarget = () => {
    onApplyIk(target.clone(), snapshot.tcp.quaternion.clone());
    solveTarget();
  };

  return (
    <section
      className={"eyehand" + (open ? " is-open" : "")}
      aria-label="眼在手标定模拟"
      aria-hidden={!open}
    >
      <header className="eyehand__head">
        <div>
          <span>EYE-IN-HAND</span>
          <h2>标定模拟</h2>
        </div>
        <label className="eyehand__switch">
          <input
            type="checkbox"
            checked={eyeInHand}
            onChange={(event) => onEyeInHandChange(event.target.checked)}
          />
          <i>{eyeInHand ? "随动" : "固定"}</i>
        </label>
      </header>

      <p className="eyehand__note">
        合成棋盘格观测；不改真机参数，不访问相机与舵机。
      </p>

      <section className="eyehand__card">
        <h3>相机标定</h3>
        <div className="eyehand__matrix">
          <span>K =</span>
          <code>
            {numberText(calibration?.intrinsics.fx ?? DEFAULT_INTRINSICS.fx, 2)}
            , {numberText(calibration?.intrinsics.cx ?? DEFAULT_INTRINSICS.cx, 2)}
            , {numberText(calibration?.intrinsics.cy ?? DEFAULT_INTRINSICS.cy, 2)}
          </code>
          <code>
            0, {numberText(calibration?.intrinsics.fy ?? DEFAULT_INTRINSICS.fy, 2)}
            , {numberText(calibration?.intrinsics.cy ?? DEFAULT_INTRINSICS.cy, 2)}
          </code>
          <code>
            0, 0, 1
          </code>
        </div>
        <dl className="eyehand__metrics">
          <div><dt>畸变 k1/k2</dt><dd className="tnum">{numberText(calibration?.intrinsics.k1 ?? DEFAULT_INTRINSICS.k1, 4)} / {numberText(calibration?.intrinsics.k2 ?? DEFAULT_INTRINSICS.k2, 4)}</dd></div>
          <div><dt>重投影 RMS</dt><dd className="tnum">{calibration ? `${numberText(calibration.reprojectionRmsPx)} px` : "—"}</dd></div>
          <div><dt>最大误差</dt><dd className="tnum">{calibration ? `${numberText(calibration.maxReprojectionPx)} px` : "—"}</dd></div>
          <div><dt>样本 / 迭代</dt><dd className="tnum">{calibration ? `${calibration.sampleCount} / ${calibration.iterations}` : "—"}</dd></div>
        </dl>
        <button type="button" onClick={runCalibration} disabled={calibrating || !ready}>
          {calibrating ? "标定中…" : calibration ? "重新标定" : "执行标定"}
        </button>
      </section>

      <section className="eyehand__card">
        <h3>关节校准</h3>
        <div className="eyehand__joints">
          {model.active.map((joint, index) => (
            <label key={joint.code}>
              <span>{joint.code}</span>
              <input
                type="range"
                min={-2}
                max={2}
                step={0.05}
                value={jointOffsets[index] ?? 0}
                onChange={(event) => updateOffset(index, event)}
                aria-label={`${joint.code} 零偏`}
              />
              <strong className="tnum">{numberText(jointOffsets[index] ?? 0, 2)}°</strong>
            </label>
          ))}
        </div>
      </section>

      <section className="eyehand__card">
        <h3>正运动学</h3>
        <dl className="eyehand__kv">
          <div><dt>校准 q</dt><dd className="tnum">{calibratedQ.map((value) => `${value.toFixed(1)}°`).join(", ")}</dd></div>
          <div><dt>TCP XYZ</dt><dd className="tnum">{tcpText.xyz} m</dd></div>
          <div><dt>RPY</dt><dd className="tnum">{tcpText.rpy}°</dd></div>
          <div><dt>眼位 XYZ</dt><dd className="tnum">{cameraText.xyz} m</dd></div>
        </dl>
      </section>

      <section className="eyehand__card">
        <h3>逆运动学</h3>
        <div className="eyehand__target">
          {(["x", "y", "z"] as const).map((axis) => (
            <label key={axis}>
              <span>{axis.toUpperCase()}</span>
              <input
                type="range"
                min={axis === "z" ? 0 : -0.25}
                max={axis === "z" ? 0.45 : 0.35}
                step={0.005}
                value={target[axis]}
                onChange={(event) => updateTarget(axis, event)}
                aria-label={`IK 目标 ${axis}`}
              />
              <strong className="tnum">{target[axis].toFixed(3)}</strong>
            </label>
          ))}
        </div>
        <div className="eyehand__actions">
          <button type="button" onClick={solveTarget} disabled={!ready}>解算</button>
          <button type="button" onClick={applyTarget} disabled={!ready || replay}>应用</button>
        </div>
        {ikResult && (
          <dl className="eyehand__metrics">
            <div><dt>收敛</dt><dd>{ikResult.ok ? "成功" : "未收敛"}</dd></div>
            <div><dt>位置残差</dt><dd className="tnum">{numberText(ikResult.residualPos, 4)} m</dd></div>
            <div><dt>姿态残差</dt><dd className="tnum">{numberText(ikResult.residualRot, 4)} rad</dd></div>
            <div><dt>迭代 / 奇异</dt><dd className="tnum">{ikResult.iterations} / {ikResult.singular ? "是" : "否"}</dd></div>
          </dl>
        )}
      </section>
    </section>
  );
}
