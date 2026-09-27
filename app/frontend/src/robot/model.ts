/** Robot Model：由 RobotDef 构建运行时运动树（link 层级 + 可动关节表）。 */
import type {
  ActiveJoint,
  JointDef,
  RobotDef,
  RobotModel,
} from "./types";

/** 关节默认中文名（SO-100 对照表；陌生 URDF 关节回退用原名，面板照常生成） */
const JOINT_NAME_CN: Record<string, string> = {
  shoulder_pan: "基座旋转",
  shoulder_lift: "大臂升降",
  elbow_flex: "肘部弯曲",
  wrist_flex: "手腕俯仰",
  wrist_roll: "手腕旋转",
  gripper: "夹爪",
};

/** 找运动树根 link：优先无入向关节的 link，排除 world/floor 之类框架名 */
function findRoot(links: { name: string }[], joints: JointDef[]): string {
  const hasParent = new Set(joints.map((j) => j.child));
  const rootCandidates = links
    .filter((l) => !hasParent.has(l.name))
    .map((l) => l.name);
  if (rootCandidates.length === 0) return links[0]?.name ?? "";
  const preferred = rootCandidates.find(
    (n) => !/^world|^floor|^map/i.test(n),
  );
  return preferred ?? rootCandidates[0];
}

/** 由 URDF 描述构建运行时模型：运动树、可动关节表（J1..JN 面板编号依据） */
export function buildRobotModel(def: RobotDef): RobotModel {
  // link 入向关节（root 为 null）
  const jointOfLink = new Map<string, JointDef | null>(
    def.links.map((l) => [l.name, null]),
  );
  def.joints.forEach((j) => {
    jointOfLink.set(j.child, j);
  });

  // 可动关节（第一版：revolute/continuous 上滑杆；prismatic/fixed 固定为 0）
  const activeIndexByJoint = new Map<number, number>();
  const active: ActiveJoint[] = [];
  def.joints.forEach((j, index) => {
    if (j.kind !== "revolute" && j.kind !== "continuous") return;
    const code = `J${active.length + 1}`;
    activeIndexByJoint.set(index, active.length);
    active.push({
      index,
      def: j,
      code,
      name: JOINT_NAME_CN[j.name] ?? j.name,
      minDeg: radiansToDegrees(j.lower),
      maxDeg: radiansToDegrees(j.upper),
    });
  });

  // 末端 link：运动链最深处的非 root link
  const root = findRoot(def.links, def.joints);
  let eeLink = root;
  let depth = 0;
  const queue: Array<{ name: string; d: number }> = [{ name: root, d: 0 }];
  const seen = new Set<string>([root]);
  while (queue.length > 0) {
    const { name, d } = queue.shift()!;
    if (d > depth || (d === depth && name !== root)) {
      depth = d;
      eeLink = name;
    }
    def.joints
      .filter((j) => j.parent === name && !seen.has(j.child))
      .forEach((j) => {
        seen.add(j.child);
        queue.push({ name: j.child, d: d + 1 });
      });
  }
  // 叶 link 的入向关节上的父 link 更适合作 TCP 基座（如夹爪固定颚）
  const eeParent = jointOfLink.get(eeLink)?.parent ?? null;
  if (eeParent && eeParent !== root) eeLink = eeParent;

  return { def, active, jointOfLink, activeIndexByJoint, eeLink };
}

/** 度 → 弧度 */
export function degreesToRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

/** 弧度 → 度 */
export function radiansToDegrees(rad: number): number {
  return rad * (180 / Math.PI);
}