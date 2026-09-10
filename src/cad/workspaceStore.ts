/**
 * workspaceStore —— DXF 工作区状态（M5）：加载/清除/路径提取。
 * 工作区 = 台面线段集（边界/障碍/标注的视觉与拾取基础）；
 * 路径层（图层名含 "path"）同时作为底座 waypoint 序列的来源。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { create } from "zustand";
import { parseDxf, type DxfSegment, type DxfWorkspace } from "./dxf";

/** 图层名中标识"底盘路径"的关键字（大小写不敏感） */
const PATH_LAYER_KEYWORD = "path";

/** 底座 waypoint（world 平面，米；y 为 URDF/world Y） */
export interface BaseWaypoint {
  x: number;
  y: number;
}

interface WorkspaceStoreState {
  /** 当前工作区（null = 未加载） */
  workspace: DxfWorkspace | null;
  /** 加载来源名（文件名/"内置示例"） */
  source: string | null;
  /** 路径 waypoints（路径层折线顺序采样；无路径层为空） */
  path: BaseWaypoint[];
  /** 解析 DXF 文本（错误返回 false 并记录 reason） */
  loadDxfText: (text: string, name: string) => { ok: boolean; reason?: string };
  /** 载入内置示例（边界 + 障碍 + S 形路径） */
  loadDemo: () => void;
  /** 清除工作区 */
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>()((set) => ({
  workspace: null,
  source: null,
  path: [],

  loadDxfText: (text, name) => {
    let ws: DxfWorkspace;
    try {
      ws = parseDxf(text);
    } catch (e) {
      return { ok: false, reason: `解析失败：${String(e)}` };
    }
    if (!ws.bounds) {
      return { ok: false, reason: "未解析到任何 2D 实体（LINE/LWPOLYLINE/CIRCLE/ARC）" };
    }
    set({
      workspace: ws,
      source: name,
      path: extractPath(ws),
    });
    return { ok: true };
  },

  loadDemo: () => {
    set({ workspace: demoWorkspace(), source: "内置示例", path: demoPath() });
  },

  clear: () => set({ workspace: null, source: null, path: [] }),
}));

/** 从工作区路径层折线提取有序 waypoints（折线首尾相连序列去重） */
function extractPath(ws: DxfWorkspace): BaseWaypoint[] {
  const pathLayers = new Set(
    ws.layers.filter((l) => l.toLowerCase().includes(PATH_LAYER_KEYWORD)),
  );
  if (pathLayers.size === 0) return [];
  const segs = ws.segments.filter((s) => pathLayers.has(s.layer));
  // 折线连接贪心串联：任取起点，按端点相近（1mm）依次接龙
  const out: BaseWaypoint[] = [];
  const eps = 0.001;
  const near = (a: BaseWaypoint, s: DxfSegment, end: 1 | 2) =>
    Math.abs((end === 1 ? s.x1 : s.x2) - a.x) < eps &&
    Math.abs((end === 1 ? s.y1 : s.y2) - a.y) < eps;

  const remaining = [...segs];
  let cursor: BaseWaypoint | null = remaining[0]
    ? { x: remaining[0].x1, y: remaining[0].y1 }
    : null;
  while (cursor && remaining.length > 0) {
    out.push(cursor);
    let matched = false;
    for (let k = 0; k < remaining.length; k++) {
      const s = remaining[k];
      if (near(cursor, s, 1)) {
        cursor = { x: s.x2, y: s.y2 };
      } else if (near(cursor, s, 2)) {
        cursor = { x: s.x1, y: s.y1 };
      } else {
        continue;
      }
      remaining.splice(k, 1);
      matched = true;
      break;
    }
    if (!matched) break; // 折线断头：路径到此为止
  }
  return out;
}

/* ================= 内置示例（world 米，1.6m × 1.0m 工位） ================= */

/** 示例边界 + 障碍（不含路径；路径单独生成） */
function demoWorkspace(): DxfWorkspace {
  const segs: DxfSegment[] = [];
  const push = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    layer: string,
    kind: DxfSegment["kind"] = "line",
  ) => segs.push({ x1, y1, x2, y2, layer, kind });

  // 边界（外框 1.6 × 1.0，中心在原点）
  const bx = 0.8;
  const by = 0.5;
  push(-bx, -by, bx, -by, "boundary");
  push(bx, -by, bx, by, "boundary");
  push(bx, by, -bx, by, "boundary");
  push(-bx, by, -bx, -by, "boundary");

  // 障碍 A：中央偏左方块（0.24m）
  const ax = -0.32;
  const ay = -0.12;
  const aw = 0.24;
  push(ax, ay, ax + aw, ay, "obstacle", "polyline");
  push(ax + aw, ay, ax + aw, ay + aw, "obstacle", "polyline");
  push(ax + aw, ay + aw, ax, ay + aw, "obstacle", "polyline");
  push(ax, ay + aw, ax, ay, "obstacle", "polyline");

  // 障碍 B：右下圆柱（r=0.10）
  const cx = 0.42;
  const cy = -0.18;
  const r = 0.1;
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    push(
      cx + r * Math.cos(a0),
      cy + r * Math.sin(a0),
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1),
      "obstacle",
      "circle",
    );
  }

  const bounds = { minX: -bx, minY: -by, maxX: bx, maxY: by };
  return { segments: segs, bounds, layers: ["boundary", "obstacle", "path"] };
}

/** 示例 S 形路径（绕开两个障碍，world 米） */
function demoPath(): BaseWaypoint[] {
  return [
    { x: -0.62, y: -0.32 },
    { x: -0.55, y: 0.22 },
    { x: -0.05, y: 0.3 },
    { x: 0.18, y: 0.05 },
    { x: 0.14, y: -0.32 },
    { x: 0.62, y: -0.34 },
    { x: 0.6, y: 0.3 },
  ];
}
