// 底部动作条：STOP / 回零位 / 重置视角 / 轨迹播放与停止提示。
// Created on 2026-09-30
// @author:  https://github.com/Linmoqian
import { stopProgram } from "../../workbench/runtime/programRunner";
import type { SimMode } from "../../../robot/simulation";

/** 回放态快照（与 bridgeStore.replay 同构，store 未导出该类型） */
type ReplaySnapshot = {
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
};

type StudioActionBarProps = {
  mode: SimMode;
  replay: ReplaySnapshot | null;
  programRunning: boolean;
  recordingSuspended: boolean;
  goHome: () => void;
  play: () => void;
  stop: () => void;
  requestResetView: () => void;
  runSystem: (fn: () => void) => () => void;
};

export default function StudioActionBar({
  mode,
  replay,
  programRunning,
  recordingSuspended,
  goHome,
  play,
  stop,
  requestResetView,
  runSystem,
}: StudioActionBarProps) {
  return (
    <>
      <footer className="studio__actions">
        <button
          type="button"
          className="studio__btn studio__btn-danger"
          onClick={() => { stopProgram(); stop(); }}
        >
          <i aria-hidden="true">■</i>
          STOP
        </button>
        <button
          type="button"
          className={`studio__btn ${mode === "homing" ? "is-active" : ""}`}
          onClick={runSystem(goHome)}
          disabled={!!replay || programRunning || recordingSuspended}
          title={recordingSuspended ? "请等待实验保存或回放准备完成" : replay ? "请退出回放后操作" : programRunning ? "请先停止积木程序" : "机械臂返回零位"}
        >
          回零位
        </button>
        <button
          type="button"
          className="studio__btn"
          onClick={requestResetView}
        >
          重置视角
        </button>
        <button
          type="button"
          className={`studio__btn ${mode === "play" ? "is-play" : ""}`}
          onClick={runSystem(mode === "play" ? stop : play)}
          disabled={!!replay || programRunning || recordingSuspended}
          aria-pressed={mode === "play"}
        >
          {mode === "play" ? "停止轨迹" : "播放轨迹"}
        </button>
      </footer>
      <p className="studio__stop-note">
        ※ STOP 为仿真停止（冻结轨迹），非硬件急停
      </p>
    </>
  );
}
