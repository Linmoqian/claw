/** URDF 解析：XML → RobotDef。第一版覆盖 link/visual/mesh/材质/关节/类型/轴/限位。 */
import type { JointDef, LinkDef, RobotDef, Vec3, VisualDef } from "./types";

/** "1 2 3" 字符串 → 三元组 */
function parseVec3(text: string | null, fallback: Vec3): Vec3 {
  if (!text) return [...fallback] as Vec3;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return [...fallback] as Vec3;
  return [parts[0], parts[1], parts[2]];
}

/** URDF rgba "0.1 0.2 0.3 1.0" → css hex */
function parseRgba(text: string | null): string | null {
  if (!text) return null;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length < 3) return null;
  const to8 = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to8(parts[0])}${to8(parts[1])}${to8(parts[2])}`;
}

/** 取 <el> 下 <origin> 的 xyz 三元组（缺省用 fallback） */
function parseOriginXyz(el: Element, fallback: Vec3): Vec3 {
  return parseVec3(el.querySelector("origin")?.getAttribute("xyz") ?? null, fallback);
}

/** 取 <el> 下 <origin> 的 rpy 三元组（缺省用 fallback） */
function parseOriginRpy(el: Element, fallback: Vec3): Vec3 {
  return parseVec3(el.querySelector("origin")?.getAttribute("rpy") ?? null, fallback);
}

/** 解析 URDF 文本，返回与渲染/仿真解耦的机器人描述 */
export function parseUrdf(xml: string): RobotDef {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("URDF 解析失败：XML 格式错误");
  }
  const robotEl = doc.querySelector("robot");
  if (!robotEl) throw new Error("URDF 解析失败：缺少 <robot> 根节点");

  const name = robotEl.getAttribute("name") ?? "robot";

  // 材质表（第一版只取颜色）
  const materials: Record<string, string> = {};
  robotEl.querySelectorAll("material").forEach((el) => {
    const matName = el.getAttribute("name");
    const hex = parseRgba(el.querySelector("color")?.getAttribute("rgba") ?? null);
    if (matName && hex) materials[matName] = hex;
  });

  // link：仅保留 <visual>（inertial/collision 第一版不做动力学，忽略）
  const links: LinkDef[] = [];
  robotEl.querySelectorAll("link").forEach((el) => {
    const linkName = el.getAttribute("name");
    if (!linkName) return;
    const visuals: VisualDef[] = [];
    el.querySelectorAll("visual").forEach((visualEl) => {
      const geometryOrigin = visualEl.querySelector("geometry");
      const mesh = geometryOrigin?.querySelector("mesh") ?? null;
      visuals.push({
        meshFile: mesh?.getAttribute("filename") ?? null,
        materialName:
          visualEl.querySelector("material")?.getAttribute("name") ?? null,
        originXyz: parseOriginXyz(visualEl, [0, 0, 0]),
        originRpy: parseOriginRpy(visualEl, [0, 0, 0]),
      });
    });
    links.push({ name: linkName, visuals });
  });

  // 关节：parent/child/origin/axis/limit（transmission 信息第一版不解析）
  const joints: JointDef[] = [];
  robotEl.querySelectorAll("joint").forEach((el) => {
    const kind = (el.getAttribute("type") ?? "fixed") as JointDef["kind"];
    const limitEl = el.querySelector("limit");
    joints.push({
      name: el.getAttribute("name") ?? "unnamed_joint",
      kind,
      parent: el.querySelector("parent")?.getAttribute("link") ?? "",
      child: el.querySelector("child")?.getAttribute("link") ?? "",
      originXyz: parseOriginXyz(el, [0, 0, 0]),
      originRpy: parseOriginRpy(el, [0, 0, 0]),
      axis: parseVec3(
        el.querySelector("axis")?.getAttribute("xyz") ?? null,
        [1, 0, 0],
      ),
      lower:
        limitEl?.getAttribute("lower") !== null
          ? Number(limitEl?.getAttribute("lower"))
          : -Infinity,
      upper:
        limitEl?.getAttribute("upper") !== null
          ? Number(limitEl?.getAttribute("upper"))
          : Infinity,
    });
  });

  return { name, links, joints, materials };
}