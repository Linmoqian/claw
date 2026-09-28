// 工作台活动互斥状态。Created on 2026-09-26
// @author: https://github.com/Linmoqian
import { create } from "zustand";

interface ActivityState {
  recordingLocked: boolean;
  recordingSuspended: boolean;
  replayPreparing: boolean;
  programRunning: boolean;
  hardwareConnected: boolean;
  hardwareEstop: boolean;
  serialConnected: boolean;
  serialTransition: boolean;
  channelTransition: boolean;
  setRecordingLocked: (locked: boolean) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  recordingLocked: false,
  recordingSuspended: false,
  replayPreparing: false,
  programRunning: false,
  hardwareConnected: false,
  hardwareEstop: false,
  serialConnected: false,
  serialTransition: false,
  channelTransition: false,
  setRecordingLocked: (recordingLocked) => set({ recordingLocked }),
}));
