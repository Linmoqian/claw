// 一次 M3 碰撞系统的数学层验证（node 直跑，不经浏览器）
// Created on 2026-09-10 12:30
// @author:  https://github.com/Linmoqian
import { buildRobotModel } from "../src/robot/model";
import { computeLinkPoses, computeTcpPose } from "../src/robot/kinematics";
import { CollisionSystem } from "../src/robot/collision";

// node 无 DOMParser：手工构造 SO-100 近似链（尺寸与真实 URDF 接近，验证碰撞逻辑）
interface ChainSeg {
  name: string;
  xyz: [number, number, number];
  axis: [number, number, number];
  limit: [number, number];
}

// base(固定) → shoulder(0.072) → upper(0.038) → fore(0.10) → wrist(0.098) → gripper(0.055)
const CHAIN: ChainSeg[] = [
  { name: "base_link", xyz: [0, 0, 0.0], axis: [0, 0, 1], limit: [-3.05, 3.05] },
  { name: "shoulder_link", xyz: [0, 0, 0.072], axis: [0, 1, 0], limit: [-1.57, 1.57] },
  { name: "upper_arm_link", xyz: [0, 0, 0.038], axis: [0, 1, 0], limit: [-1.8, 1.5] },
  { name: "forearm_link", xyz: [0, 0, 0.10], axis: [0, 1, 0], limit: [-1.9, 1.6] },
  { name: "wrist_link", xyz: [0, 0, 0.098], axis: [0, 1, 0], limit: [-1.9, 1.6] },
  { name: "gripper_link", xyz: [0, 0, 0.055], axis: [0, 0, 1], limit: [-0.7, 0.7] },
];

function buildModel() {
  const def = {
    name: "so100-test",
    links: CHAIN.map((s) => ({ name: s.name, visuals: [] })),
    joints: CHAIN.slice(1).map((s, i) => ({
      name: `j${i + 1}`,
      kind: "revolute" as const,
      parent: CHAIN[i].name,
      child: s.name,
      originXyz: s.xyz,
      originRpy: [0, 0, 0] as [number, number, number],
      axis: s.axis,
      lower: s.limit[0],
      upper: s.limit[1],
    })),
    materials: {},
  };
  return buildRobotModel(def);
}

function main() {
  const model = buildModel();
  const sys = CollisionSystem.create(model);
  console.log("碰撞系统启用:", sys.enabled);

  const n = model.active.length;
  const zeros = new Array(n).fill(0);
  const idx = (code: string) => model.active.findIndex((a) => a.name === code);
  const iShoulder = idx("j2");
  const iElbow = idx("j3");
  const iWrist = idx("j4");
  const fmt = (s: ReturnType<CollisionSystem["evaluate"]>) =>
    JSON.stringify(s);

  // 1) 零位（直立）：臂链离台面远，应 clear
  console.log("零位构型:", fmt(sys.evaluate(zeros)));

  // 2) 中度前倾（肩 60°/肘 45°）：TCP 大幅下降但仍 >100mm，应 clear 或 warn
  const mid = [...zeros];
  if (iShoulder >= 0) mid[iShoulder] = 60;
  if (iElbow >= 0) mid[iElbow] = 45;
  const tcpMid = computeTcpPose(model, computeLinkPoses(model, mid));
  const midStatus = sys.evaluate(mid);
  if (midStatus.environmentObjectId !== "coffee-machine") {
    throw new Error(
      `物体碰撞体未命中：期望 coffee-machine，实际 ${midStatus.environmentObjectId ?? "none"}`,
    );
  }
  console.log(
    `前倾构型: TCP z=${tcpMid.position.z.toFixed(3)}m →`,
    fmt(midStatus),
  );

  // 3) 大幅下垂（肩 85°/肘 75°/腕 60°）：TCP 贴台面，应命中 slow/stop
  const droop = [...zeros];
  if (iShoulder >= 0) droop[iShoulder] = 85;
  if (iElbow >= 0) droop[iElbow] = 75;
  if (iWrist >= 0) droop[iWrist] = 60;
  const tcpDroop = computeTcpPose(model, computeLinkPoses(model, droop));
  console.log(
    `下垂构型: TCP z=${tcpDroop.position.z.toFixed(3)}m →`,
    fmt(sys.evaluate(droop)),
  );

  // 4) 自碰撞：限位内随机采样扫描（证明对表/几何管线可用，统计命中率）
  let hits = 0;
  let sample: ReturnType<CollisionSystem["evaluate"]> | null = null;
  let sampleQ: number[] | null = null;
  let rng = 12345;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  for (let trial = 0; trial < 4000; trial++) {
    const q = model.active.map((a) => a.minDeg + rand() * (a.maxDeg - a.minDeg));
    const st = sys.evaluate(q);
    if (st.selfCollision) {
      hits++;
      if (!sample) {
        sample = st;
        sampleQ = q.map((v) => Math.round(v));
      }
    }
  }
  console.log(
    `自碰撞采样: 4000 构型命中 ${hits} 个` +
      (sample ? `，样例 q=${sampleQ?.join(",")}` : "（未命中，需检查对表！）"),
  );

  // 5) 扫掠：零位 → 下垂 路径评估
  console.log("扫掠(0→下垂):", fmt(sys.evaluateSwept(zeros, droop)));

  // 6) 性能：1 万次 evaluate 用时（拖拽/限速路径预算 <50μs/次）
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    sys.evaluate(droop);
  }
  const per = ((performance.now() - t0) / 10000) * 1000;
  console.log(`单次 evaluate: ${per.toFixed(1)}μs`);

  sys.dispose();
  console.log("验证完成");
}

main();
