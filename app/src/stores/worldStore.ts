/**
 * worldStore —— Unified World State 的低频发布通道（Zustand）。
 * 高频遥测（Transport 50/100Hz）经 buffer 归并后 publish 到这里；
 * Three.js 层订阅高频时走 ref 直读，绝不 100Hz 触发整棵 React 树。
 */
import { create } from "zustand";
import {
  createEmptyWorldState,
  type RobotState,
  type WorldState,
} from "../core/world";
import { TWIST_ZERO } from "../core/world/pose";

interface WorldStoreState {
  world: WorldState;
  /** 部分合并进世界快照（自动递增 version 与 timestamp） */
  publish: (patch: Partial<WorldState>) => void;
  /** 整包替换（Replay/打开项目时用） */
  replace: (next: WorldState) => void;
  /** 机器人本体状态（内部定位 + 关节 + TCP） */
  updateRobotState: (robot: RobotState) => void;
  /** 只更新机器人定位（高频遥测的典型载荷） */
  updateRobotPose: (pose: RobotState["pose"]) => void;
  reset: () => void;
}

export const useWorldStore = create<WorldStoreState>()((set) => ({
  world: createEmptyWorldState(),

  publish: (patch) =>
    set((s) => ({
      world: {
        ...s.world,
        ...patch,
        timestamp: Date.now(),
        version: s.world.version + 1,
      },
    })),

  replace: (next) => set({ world: next }),

  updateRobotState: (robot) =>
    set((s) => ({
      world: {
        ...s.world,
        robot,
        timestamp: Date.now(),
        version: s.world.version + 1,
      },
    })),

  updateRobotPose: (pose) =>
    set((s) => {
      const prev = s.world.robot;
      return {
        world: {
          ...s.world,
          robot: prev
            ? { ...prev, pose }
            : {
                pose,
                velocity: TWIST_ZERO,
                joints: {},
              },
          timestamp: Date.now(),
          version: s.world.version + 1,
        },
      };
    }),

  reset: () => set({ world: createEmptyWorldState() }),
}));