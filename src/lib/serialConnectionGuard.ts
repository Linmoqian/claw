// 串口连接门禁：界面禁用与连接动作共用原因。Created on 2026-09-26
// @author: https://github.com/Linmoqian
export interface SerialConnectionActivity {
  recordingLocked: boolean;
  replayPreparing: boolean;
  programRunning: boolean;
  serialTransition: boolean;
  channelTransition: boolean;
}

export function serialConnectionBlockedReason(
  activity: SerialConnectionActivity,
  replaying: boolean,
): string | null {
  if (activity.recordingLocked) {
    return "实验采集中，请结束实验并完成保存后再连接串口，以保持数据通道一致。";
  }
  if (activity.replayPreparing) {
    return "回放正在准备，请等待回放加载完成并退出后再连接串口。";
  }
  if (replaying) {
    return "回放中无法连接串口，请先退出回放。";
  }
  if (activity.programRunning) {
    return "程序正在运行，请先停止程序再连接串口。";
  }
  if (activity.channelTransition || activity.serialTransition) {
    return "数据通道正在切换，请等待当前连接操作完成后再连接串口。";
  }
  return null;
}
