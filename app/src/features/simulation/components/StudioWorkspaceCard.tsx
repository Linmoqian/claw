// M5 工作区卡：DXF 加载 / 内置示例 / 底座路径播放（悬浮左下）。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { useEffect, useState } from "react";
import { getRuntime } from "../../workbench/runtime/runtime";
import { useSessionStore } from "../../../stores/sessionStore";
import type { BaseWaypoint } from "../../../cad/workspaceStore";
import type { DxfWorkspace } from "../../../cad/dxf";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

type StudioWorkspaceCardProps = {
  workspace: DxfWorkspace | null;
  workspaceSource: string | null;
  workspacePath: BaseWaypoint[];
  loadDemo: () => void;
  clearWorkspace: () => void;
  loadDxfText: (text: string, name: string) => { ok: boolean; reason?: string };
  workspaceError: string | null;
  setWorkspaceError: (error: string | null) => void;
  replay: ReplaySnapshot | null;
  programRunning: boolean;
  recordingSuspended: boolean;
};

export default function StudioWorkspaceCard({
  workspace,
  workspaceSource,
  workspacePath,
  loadDemo,
  clearWorkspace,
  loadDxfText,
  workspaceError,
  setWorkspaceError,
  replay,
  programRunning,
  recordingSuspended,
}: StudioWorkspaceCardProps) {
  const [basePlaying, setBasePlaying] = useState(false);

  // 底座路径播放状态同步（200ms 低频轮询，避免高频 setState）
  useEffect(() => {
    const id = window.setInterval(() => {
      setBasePlaying(getRuntime()?.baseSim?.isPlaying ?? false);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="studio__workspace">
      <div className="studio__workspace-row">
        <span className="studio__workspace-label">工作区</span>
        <span className="studio__workspace-src">
          {workspace ? (workspaceSource ?? "已加载") : "未加载"}
        </span>
        <label className="studio__workspace-btn">
          载入 DXF
          <input
            type="file"
            accept=".dxf"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const text = await file.text();
              const r = loadDxfText(text, file.name);
              setWorkspaceError(r.ok ? null : (r.reason ?? "解析失败"));
            }}
          />
        </label>
        {!workspace ? (
          <button type="button" className="studio__workspace-btn" onClick={loadDemo}>
            内置示例
          </button>
        ) : (
          <button type="button" className="studio__workspace-btn" onClick={clearWorkspace}>
            清除
          </button>
        )}
      </div>
      {workspacePath.length > 0 && (
        <div className="studio__workspace-row">
          <span className="studio__workspace-label">底座路径</span>
          <span className="studio__workspace-src tnum">
            {workspacePath.length} 点
          </span>
          <button
            type="button"
            className={`studio__workspace-btn ${basePlaying ? "is-play" : ""}`}
            disabled={!!replay || programRunning || recordingSuspended}
            title={recordingSuspended ? "请等待实验保存或回放准备完成" : replay ? "回放期间禁止运行路径" : "播放底盘路径"}
            onClick={() => {
              if (replay || programRunning || recordingSuspended) return;
              const b = getRuntime()?.baseSim;
              if (!b) return;
              useSessionStore.getState().systemCommand();
              if (b.isPlaying) b.stopPath();
              else b.playPath(workspacePath);
            }}
          >
            {basePlaying ? "停止底座" : "播放路径"}
          </button>
        </div>
      )}
      {workspaceError && (
        <p className="studio__workspace-error">{workspaceError}</p>
      )}
    </div>
  );
}
