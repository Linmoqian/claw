/**
 * DXF 解析器 —— ASCII DXF 常见 2D 实体 → 台面线段集（M5）。
 * 支持：LINE / LWPOLYLINE / CIRCLE / ARC（老式 POLYLINE+VERTEX 一并兼容）。
 * 约定：DXF 单位按毫米（机械制图惯例），输出转米；
 *       y 轴 = URDF/world 平面 Y（渲染层再转 three 的 -Z）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */

/** 工作区线段（world 平面坐标，米） */
export interface DxfSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 实体类型（调试/着色分组） */
  kind: DxfEntityKind;
  /** 图层名（默认 "0"） */
  layer: string;
}

export type DxfEntityKind = "line" | "polyline" | "circle" | "arc";

/** 解析结果：线段集 + 图幅（world 米） */
export interface DxfWorkspace {
  segments: DxfSegment[];
  /** 图幅包围盒（min/max，米；空文件为 null） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** 出现过的图层 */
  layers: string[];
}

/** DXF 毫米 → 米 */
const MM_TO_M = 0.001;

/** 圆/弧离散段数（视觉平滑与解析开销的折中） */
const ARC_SEGMENTS = 48;

/** 解析 ASCII DXF 文本 → 工作区（无法解析的实体跳过，不整体失败） */
export function parseDxf(text: string): DxfWorkspace {
  // 组码对序列化：lines[2i] = 组码，lines[2i+1] = 值
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] ?? "" });
  }

  const segments: DxfSegment[] = [];
  const layers = new Set<string>();
  let i = 0;

  // 顺序扫描：只在 ENTITIES 段内取实体（HEADER/TABLES 忽略）
  let inEntities = false;
  while (i < pairs.length) {
    const { code, value } = pairs[i];
    if (code === 0 && value.trim() === "SECTION") {
      // 下一个 2 组是段名
      const name = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.trim() : "";
      inEntities = name === "ENTITIES";
      i += 2;
      continue;
    }
    if (code === 0 && value.trim() === "ENDSEC") {
      inEntities = false;
      i++;
      continue;
    }
    if (!inEntities || code !== 0) {
      i++;
      continue;
    }

    const kind = value.trim();
    // 收集本实体到下一个 0 组的属性对
    let j = i + 1;
    const props: Array<{ code: number; value: string }> = [];
    while (j < pairs.length && pairs[j].code !== 0) {
      props.push(pairs[j]);
      j++;
    }
    emitEntity(kind, props, segments, layers);
    i = j;
  }

  return { segments, bounds: boundsOf(segments), layers: [...layers].sort() };
}

/** 单实体 → 线段（未知类型静默跳过） */
function emitEntity(
  kind: string,
  props: Array<{ code: number; value: string }>,
  segments: DxfSegment[],
  layers: Set<string>,
): void {
  const get = (code: number): number => {
    const p = props.find((x) => x.code === code);
    return p ? Number(p.value) || 0 : 0;
  };
  const layer =
    props.find((x) => x.code === 8)?.value.trim() || "0";

  switch (kind) {
    case "LINE": {
      layers.add(layer);
      segments.push({
        x1: get(10) * MM_TO_M,
        y1: get(20) * MM_TO_M,
        x2: get(11) * MM_TO_M,
        y2: get(21) * MM_TO_M,
        kind: "line",
        layer,
      });
      break;
    }
    case "LWPOLYLINE": {
      layers.add(layer);
      // 顶点交错：10=x、20=y 交替出现；70 flag bit0 = 闭合
      const xs: number[] = [];
      const ys: number[] = [];
      let pendingX: number | null = null;
      for (const p of props) {
        if (p.code === 10) {
          if (pendingX !== null) {
            // 连续两个 10（缺 20）：忽略前一个
          } else {
            pendingX = Number(p.value) || 0;
          }
        } else if (p.code === 20 && pendingX !== null) {
          xs.push(pendingX);
          ys.push(Number(p.value) || 0);
          pendingX = null;
        }
      }
      const closed = (get(70) & 1) === 1;
      pushPolyline(xs, ys, closed, layer, segments);
      break;
    }
    case "POLYLINE": {
      // 老式：POLYLINE 头（本实体忽略）→ 多个 VERTEX 实体 → SEQEND
      // 顶点在后续实体流中，这里不处理（主流 CAD 导出均带 LWPOLYLINE）
      break;
    }
    case "CIRCLE": {
      layers.add(layer);
      const cx = get(10) * MM_TO_M;
      const cy = get(20) * MM_TO_M;
      const r = get(40) * MM_TO_M;
      pushArc(cx, cy, r, 0, Math.PI * 2, true, layer, segments);
      break;
    }
    case "ARC": {
      layers.add(layer);
      const cx = get(10) * MM_TO_M;
      const cy = get(20) * MM_TO_M;
      const r = get(40) * MM_TO_M;
      // DXF 角度：度、CCW、X 轴起算
      pushArc(cx, cy, r, degToRad(get(50)), degToRad(get(51)), false, layer, segments);
      break;
    }
    default:
      break;
  }
}

/** 折线 → 相邻顶点线段（闭合则首尾相连） */
function pushPolyline(
  xs: number[],
  ys: number[],
  closed: boolean,
  layer: string,
  segments: DxfSegment[],
): void {
  if (xs.length < 2) return;
  for (let k = 0; k + 1 < xs.length; k++) {
    segments.push({
      x1: xs[k] * MM_TO_M,
      y1: ys[k] * MM_TO_M,
      x2: xs[k + 1] * MM_TO_M,
      y2: ys[k + 1] * MM_TO_M,
      kind: "polyline",
      layer,
    });
  }
  if (closed && xs.length > 2) {
    segments.push({
      x1: xs[xs.length - 1] * MM_TO_M,
      y1: ys[ys.length - 1] * MM_TO_M,
      x2: xs[0] * MM_TO_M,
      y2: ys[0] * MM_TO_M,
      kind: "polyline",
      layer,
    });
  }
}

/** 圆/弧 → 离散线段（closed=true 为整圆） */
function pushArc(
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
  closed: boolean,
  layer: string,
  segments: DxfSegment[],
): void {
  if (r <= 0) return;
  const sweep = closed ? Math.PI * 2 : normalizeSweep(startRad, endRad);
  const n = Math.max(8, Math.round((ARC_SEGMENTS * sweep) / (Math.PI * 2)));
  let prevA = startRad;
  for (let k = 1; k <= n; k++) {
    const a = startRad + (sweep * k) / n;
    segments.push({
      x1: cx + r * Math.cos(prevA),
      y1: cy + r * Math.sin(prevA),
      x2: cx + r * Math.cos(a),
      y2: cy + r * Math.sin(a),
      kind: closed ? "circle" : "arc",
      layer,
    });
    prevA = a;
  }
}

/** 弧扫过角（CCW，end ≤ start 视为跨 0°） */
function normalizeSweep(start: number, end: number): number {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  return sweep;
}

/** 包围盒 */
function boundsOf(segments: DxfSegment[]): DxfWorkspace["bounds"] {
  if (segments.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { minX, minY, maxX, maxY };
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
