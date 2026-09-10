/** simulationStore：仿真控制状态（低频 UI：模式/速度/目标值/快照读数）。 */
import { create } from "zustand";
import { Quaternion, Vector3 } from "three";
import { COLLISION_CLEAR } from "../robot/collision";
import {
  SimulationLoop,
  type SimMode,
  type SimSnapshot,
} from "../robot/simulation";

/** 由 UI 侧注入的仿真回路实例（不进入 store 本身，避免高频渲染路径进 React） */
let sim: SimulationLoop | null = null;

const emptySnapshot = (): SimSnapshot => ({
  mode: "manual",
  speed: 1,
  currentDeg: [],
  targetDeg: [],
  previewDeg: null,
  tcp: {
    position: new Vector3(),
    quaternion: new Quaternion(),
  },
  tcpTarget: null,
  ik: null,
  collision: COLLISION_CLEAR,
  collisionEnabled: false,
  progress: 0,
});

interface SimulationStore {
  mode: SimMode;
  speed: number;
  snapshot: SimSnapshot;
  /** 绑定/解绑仿真实例（模型就绪时绑定） */
  bind: (instance: SimulationLoop | null) => void;
  /** 把仿真快照同步进 store（30Hz 低频轮询调用） */
  syncTick: () => void;
  setSpeed: (speed: number) => void;
  goHome: () => void;
  play: () => void;
  stop: () => void;
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  mode: "manual",
  speed: 1,
  snapshot: emptySnapshot(),
  bind: (instance) => {
    sim = instance;
    if (instance) {
      set({ mode: instance.currentMode, snapshot: instance.getSnapshot() });
    }
  },
  syncTick: () => {
    if (!sim) return;
    set({ mode: sim.currentMode, snapshot: sim.getSnapshot() });
  },
  setSpeed: (speed) => {
    if (sim) sim.speed = speed;
    set({ speed });
  },
  goHome: () => {
    sim?.goHome();
    if (sim) set({ mode: sim.currentMode });
  },
  play: () => {
    sim?.play();
    if (sim) set({ mode: sim.currentMode });
  },
  stop: () => {
    sim?.stop();
    if (sim) set({ mode: sim.currentMode, snapshot: sim.getSnapshot() });
  },
}));