/** 轨迹：waypoint 定义 + 分段线性插值采样。后续可扩展梯形速度/S 曲线。 */

/** 轨迹点：绝对时间 + 各关节目标角（角度，按 active 关节顺序） */
export interface TrajPoint {
  time: number;
  qDeg: number[];
}

/** 按时间在分段线性轨迹上采样关节目标（超出总时长自动回绕） */
export function sampleTrajectory(points: TrajPoint[], t: number): number[] {
  if (points.length === 0) return [];
  const total = points[points.length - 1].time;
  if (total <= 0) return [...points[0].qDeg];

  const loop = ((t % total) + total) % total;
  // 找区间 [i, i+1]
  let i = points.length - 1;
  for (let k = 0; k < points.length - 1; k++) {
    if (loop >= points[k].time && loop <= points[k + 1].time) {
      i = k;
      break;
    }
  }
  const seg = points[Math.min(i, points.length - 2)];
  const next = points[Math.min(i + 1, points.length - 1)];
  const segDur = next.time - seg.time;
  const u = segDur > 0 ? (loop - seg.time) / segDur : 1;
  return seg.qDeg.map((q, idx) => q + (next.qDeg[idx] - q) * u);
}

/**
 * 内置演示轨迹：SO-100 5 轴 + 夹爪，零位 → 三个安全位形 → 零位，循环 10s（1x 时）。
 * 关节顺序与 RobotModel.active 一致。
 */
export function so100DemoLoop(): TrajPoint[] {
  return [
    { time: 0, qDeg: [0, 0, 0, 0, 0, 0] },
    { time: 2.5, qDeg: [60, 80, -90, -30, 60, 25] },
    { time: 5.0, qDeg: [-60, 60, -60, 40, -60, 50] },
    { time: 7.5, qDeg: [0, 110, -120, -50, 0, 35] },
    { time: 10.0, qDeg: [0, 0, 0, 0, 0, 0] },
  ];
}