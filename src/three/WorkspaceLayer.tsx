/**
 * WorkspaceLayer —— DXF 工作区线段渲染（M5）：world 平面 → three 台面。
 * 图层配色：boundary 深蓝 / obstacle 红棕 / path 青色 / 其他灰。
 * world(x, y) → three(x, 0.002, -y)（与 MobileBase 的映射一致）。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { DxfWorkspace } from "../cad/dxf";

/** 图层 → 颜色（关键字匹配，大小写不敏感） */
function layerColor(layer: string): THREE.Color {
  const l = layer.toLowerCase();
  if (l.includes("path")) return new THREE.Color("#0d9488");
  if (l.includes("obstacle")) return new THREE.Color("#b45309");
  if (l.includes("boundary") || l.includes("border") || l.includes("frame") || l === "0") {
    return new THREE.Color("#475569");
  }
  return new THREE.Color("#94a3b8");
}

/** 线宽增强：多层微偏移绘制（WebGL lineWidth 多数平台锁 1px） */
const WIDTH_LAYERS = 2;

export default function WorkspaceLayer({ workspace }: { workspace: DxfWorkspace }) {
  // 段数较少（千级），每次工作区变化重建；按图层分组着色
  const groups = useMemo(() => {
    const byLayer = new Map<string, number[]>();
    for (const s of workspace.segments) {
      let arr = byLayer.get(s.layer);
      if (!arr) {
        arr = [];
        byLayer.set(s.layer, arr);
      }
      // world → three
      arr.push(s.x1, 0.002, -s.y1, s.x2, 0.002, -s.y2);
    }
    return [...byLayer.entries()].map(([layer, positions]) => ({
      layer,
      geometry: new THREE.BufferGeometry(),
      color: layerColor(layer),
      positions,
    }));
  }, [workspace]);

  useEffect(() => {
    return () => {
      // 卸载/重建时释放旧几何
      for (const g of groups) g.geometry.dispose();
    };
  }, [groups]);

  return (
    <group name="workspace-layer">
      {groups.map(({ layer, positions, color }) => (
        <WorkspaceLines key={layer} layer={layer} positions={positions} color={color} />
      ))}
    </group>
  );
}

/** 单图层线组（含路径层的 waypoint 圆点标记） */
function WorkspaceLines({
  layer,
  positions,
  color,
}: {
  layer: string;
  positions: number[];
  color: THREE.Color;
}) {
  const isPath = layer.toLowerCase().includes("path");
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      {Array.from({ length: WIDTH_LAYERS }, (_, i) => (
        <primitive
          key={i}
          object={
            new THREE.LineSegments(
              geometry,
              new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9 - i * 0.25,
                depthWrite: false,
              }),
            )
          }
          position={[0, i * 0.0006, 0]}
        />
      ))}
      {isPath && (
        <primitive
          object={new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.008 }))}
        />
      )}
    </group>
  );
}
