// Rust 仿真状态流与编辑意图桥接。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { SimulationLoop, SimMode } from "../../../robot/simulation";
import type { BasePose, BaseSim } from "../../../robot/baseSim";
import type { CollisionStatus } from "../../../robot/collision";
import { useBridgeStore } from "../../../stores/bridgeStore";
import { useActivityStore } from "./activity";

interface PropPose {
  id: string;
  position_m: [number, number, number];
  rotation_xyzw: [number, number, number, number];
}

export interface SimulationFrame {
  version: number;
  robotId: string;
  sequence: number;
  timestampMs: number;
  jointsRad: number[];
  targetRad: number[];
  mode: SimMode;
  speed: number;
  progress: number;
  base: BasePose;
  tcpPositionM: [number, number, number];
  props: PropPose[];
  collision: CollisionStatus;
}

let latestFrame: SimulationFrame | null = null;
let lifecycle: Promise<void> = Promise.resolve();
const frameListeners = new Set<(frame: SimulationFrame) => void>();
let pauseControl: ((paused: boolean) => void) | null = null;

export function getDesktopFrame(): SimulationFrame | null {
  return latestFrame;
}

export function subscribeDesktopFrames(listener: (frame: SimulationFrame) => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

export function setDesktopPaused(paused: boolean): void {
  pauseControl?.(paused);
}

export function desktopRuntimeEnabled(): boolean {
  return isTauri();
}

function enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
  lifecycle = lifecycle.catch(() => undefined).then(operation);
  return lifecycle;
}

export function connectDesktopRuntime(
  robotId: string,
  sim: SimulationLoop,
  baseSim: BaseSim,
  onReady: () => void,
  onError: (message: string) => void,
): () => void {
  let disposed = false;
  let commandSequence = 0;
  let lastFrameSequence = -1;
  let lastSpeed = sim.speed;
  let started = false;
  let desiredPaused = false;
  let commandQueue: Promise<unknown> = Promise.resolve();
  const channel = new Channel<SimulationFrame>();
  const enqueue = <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const sequence = ++commandSequence;
    const next = commandQueue.catch(() => undefined).then(() => {
      if (disposed) throw new Error("仿真运行时已关闭");
      return invoke<T>(name, { robotId, sequence, ...args });
    });
    commandQueue = next.catch((error: unknown) => {
      if (!disposed) onError(String(error));
    });
    return next;
  };
  const send = (name: string, args: Record<string, unknown>): void => {
    void enqueue(name, args).catch(() => undefined);
  };
  channel.onmessage = (frame) => {
    if (disposed || frame.version !== 1 || frame.robotId !== robotId
      || frame.sequence <= lastFrameSequence) return;
    lastFrameSequence = frame.sequence;
    latestFrame = frame;
    for (const listener of frameListeners) listener(frame);
    if (useBridgeStore.getState().bridge.kind !== "simulation"
      || useActivityStore.getState().replayPreparing) return;
    sim.applyAuthorityFrame(frame.jointsRad, frame.targetRad, frame.mode, frame.progress, frame.collision);
    baseSim.applyAuthorityPose(frame.base);
  };

  commandQueue = enqueueLifecycle(async () => {
    if (disposed) return;
    try {
      const initial = await invoke<SimulationFrame>("simulation_start", { robotId });
      if (disposed) {
        await invoke("simulation_stop_runtime");
        return;
      }
      latestFrame = initial;
      sim.applyAuthorityFrame(initial.jointsRad, initial.targetRad, initial.mode, initial.progress, initial.collision);
      baseSim.applyAuthorityPose(initial.base);
      await invoke("simulation_subscribe", { channel });
      started = true;
      if (desiredPaused) send("simulation_set_paused", { paused: true });
      if (!disposed) onReady();
    } catch (error: unknown) {
      if (!disposed) onError(`Rust 仿真启动失败：${String(error)}`);
    }
  });

  sim.onControlIntent = (mode, targetsDeg) => {
    if (mode === "stop") {
      send("simulation_stop_motion", {});
    } else if (mode === "homing" || mode === "play") {
      send("simulation_set_mode", { mode, speed: sim.speed });
    } else {
      send("simulation_set_joint_targets", {
        jointsRad: targetsDeg.map((deg) => deg * Math.PI / 180),
      });
    }
  };
  sim.onTcpIntent = async (position, quaternion) => {
    const solution = await enqueue<{ jointsRad: number[] }>("simulation_set_tcp_target", {
      positionM: [position.x, position.y, position.z],
      rotationXyzw: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    });
    return solution.jointsRad.map((rad) => rad * 180 / Math.PI);
  };
  baseSim.onTargetChanged = (pose) => {
    send("simulation_set_base_target", { x: pose.x, y: pose.y, yaw: pose.yaw });
  };
  pauseControl = (paused) => {
    desiredPaused = paused;
    if (started) send("simulation_set_paused", { paused });
  };
  const speedTimer = window.setInterval(() => {
    if (disposed || sim.speed === lastSpeed) return;
    lastSpeed = sim.speed;
    send("simulation_set_speed", { speed: lastSpeed });
  }, 100);

  return () => {
    disposed = true;
    window.clearInterval(speedTimer);
    sim.onControlIntent = null;
    sim.onTcpIntent = null;
    baseSim.onTargetChanged = null;
    pauseControl = null;
    latestFrame = null;
    void enqueueLifecycle(async () => {
      await invoke("simulation_stop_runtime").catch(() => undefined);
    });
  };
}
