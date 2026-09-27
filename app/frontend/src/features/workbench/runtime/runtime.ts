// 常驻仿真实例与领域接线。Created on 2026-09-26
// @author: https://github.com/Linmoqian
import { create } from "zustand";
import { Quaternion, Vector3 } from "three";
import { BaseSim } from "../../../robot/baseSim";
import { CollisionSystem, describeCollision, isRejected } from "../../../robot/collision";
import { degreesToRadians, radiansToDegrees } from "../../../robot/model";
import { SimulationLoop } from "../../../robot/simulation";
import type { RobotModel } from "../../../robot/types";
import { useBridgeStore, refreshReplayState } from "../../../stores/bridgeStore";
import { interactionController } from "../../../stores/interactionStore";
import { arbiter, setTargetCommittedHook, useSessionStore } from "../../../stores/sessionStore";
import { useSimulationStore } from "../../../stores/simulationStore";
import { useTargetStore } from "../../../stores/targetStore";
import { useWorldStore } from "../../../stores/worldStore";
import { useSceneStore } from "../../../stores/sceneStore";
import { useActivityStore } from "./activity";

export interface RobotRuntime {
  model: RobotModel;
  sim: SimulationLoop;
  baseSim: BaseSim;
}

interface RuntimeState {
  ready: boolean;
  status: "idle" | "ready";
  generation: number;
  eyeInHand: boolean;
  setEyeInHand: (value: boolean) => void;
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  ready: false,
  status: "idle",
  generation: 0,
  eyeInHand: true,
  setEyeInHand: (eyeInHand) => set({ eyeInHand }),
}));

let runtime: RobotRuntime | null = null;

export function getRuntime(): RobotRuntime | null {
  return runtime;
}

export function cancelRuntimePreview(): void {
  window.dispatchEvent(new Event("workbench:cancel-preview"));
  interactionController.cancelActiveDrag();
  const state = useSessionStore.getState();
  if (state.session?.phase === "preview") state.cancel(state.session.source);
}

export function stopRuntime(): void {
  cancelRuntimePreview();
  runtime?.sim.stop();
  if (runtime) runtime.baseSim.teleport(runtime.baseSim.getSnapshot().current);
  useSimulationStore.getState().syncTick();
}

export function awaitRuntimeReady(model: RobotModel | null): Promise<void> {
  if (runtime?.model === model && model) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("仿真运行时未能就绪，请重试"));
    }, 10000);
    const unsubscribe = useRuntimeStore.subscribe(() => {
      if (runtime?.model !== model || !model) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

export function mountRuntime(model: RobotModel): () => void {
  if (runtime) throw new Error("工作台只能挂载一个仿真运行时");
  const collision = CollisionSystem.create(model);
  const sim = new SimulationLoop(model, collision);
  const baseSim = new BaseSim();
  runtime = { model, sim, baseSim };
  baseSim.onPose = (pose) => useWorldStore.getState().updateRobotPose({
    position: { x: pose.x, y: pose.y, z: 0 },
    orientation: { x: 0, y: 0, z: Math.sin(pose.yaw / 2), w: Math.cos(pose.yaw / 2) },
  });
  const priorPose = useWorldStore.getState().world.robot?.pose;
  baseSim.enabled = useBridgeStore.getState().bridge.kind === "simulation";
  baseSim.teleport(priorPose ? {
    x: priorPose.position.x,
    y: priorPose.position.y,
    yaw: 2 * Math.atan2(priorPose.orientation.z, priorPose.orientation.w),
  } : { x: 0, y: 0, yaw: 0 });
  sim.speed = useSimulationStore.getState().speed;
  useSimulationStore.getState().bind(sim);
  useSessionStore.getState().bindSim(sim, baseSim);
  useTargetStore.getState().bindModel(model);
  const unregister = useTargetStore.getState().registerExecutor((intent) => {
    if (useBridgeStore.getState().replay || (useActivityStore.getState().recordingSuspended || useActivityStore.getState().replayPreparing)) return;
    if (intent.kind === "joint-target") {
      const result = sim.setJointTarget(intent.jointIndex, intent.valueDeg);
      if (isRejected(result)) useTargetStore.getState().setValidation({
        valid: false, jointLimit: false, collision: true, singularity: false,
        reachable: true, safetyDistance: null, reason: `目标被拒：${describeCollision(result)}`,
      });
    } else if (intent.kind === "tcp-pose") {
      const result = sim.setTcpTargetPose(
        new Vector3(intent.position.x, intent.position.y, intent.position.z),
        new Quaternion(intent.quaternion.x, intent.quaternion.y, intent.quaternion.z, intent.quaternion.w),
      );
      useTargetStore.getState().setValidation({
        valid: !result.collision, jointLimit: result.atLimit.length > 0,
        collision: result.collision !== undefined, singularity: result.singular,
        reachable: result.ok, safetyDistance: null,
        reason: result.collision ? `目标被拒：${describeCollision(result.collision)}`
          : result.singular ? "IK 收敛于近奇异构型" : undefined,
      });
    }
  });
  const byName = new Map<string, number>();
  model.active.forEach((joint, index) => {
    byName.set(joint.def.name, index);
    byName.set(joint.code, index);
  });
  const unsubscribeTelemetry = useWorldStore.subscribe((state) => {
    if (useBridgeStore.getState().bridge.kind === "simulation") return;
    const joints = state.world.robot?.joints;
    if (!joints) return;
    const values = [...sim.currentDegrees];
    let hit = false;
    for (const [key, value] of Object.entries(joints)) {
      const index = byName.get(key);
      if (index !== undefined && Number.isFinite(value)) {
        values[index] = radiansToDegrees(value);
        hit = true;
      }
    }
    if (hit) sim.applyTelemetry(values);
  });
  const unsubscribeBridge = useBridgeStore.subscribe((state, previous) => {
    if (state.bridge === previous.bridge) return;
    stopRuntime();
    if (state.bridge.kind === "replay") useSceneStore.getState().requestResetProps();
    baseSim.enabled = state.bridge.kind === "simulation";
    const pose = useWorldStore.getState().world.robot?.pose;
    if (pose) baseSim.teleport({ x: pose.position.x, y: pose.position.y,
      yaw: 2 * Math.atan2(pose.orientation.z, pose.orientation.w) });
  });
  const unsubscribeActivity = useActivityStore.subscribe((state, previous) => {
    if ((state.recordingSuspended && !previous.recordingSuspended) || (state.replayPreparing && !previous.replayPreparing)) stopRuntime();
  });
  setTargetCommittedHook((qDeg) => {
    const bridge = useBridgeStore.getState();
    if (!bridge.isLive || bridge.replay || (useActivityStore.getState().recordingSuspended || useActivityStore.getState().replayPreparing)) return;
    void bridge.sendCommand({ kind: "joint_target", position_rad: qDeg.map(degreesToRadians) })
      .catch((error: unknown) => useBridgeStore.setState({ lastError: String(error) }));
  });
  const syncTimer = window.setInterval(() => {
    useSimulationStore.getState().syncTick();
    arbiter.setTrajectoryLock(sim.currentMode === "play" || useActivityStore.getState().programRunning
      || useBridgeStore.getState().replay !== null || (useActivityStore.getState().recordingSuspended || useActivityStore.getState().replayPreparing));
  }, 50);
  const bridgeTimer = window.setInterval(() => {
    useBridgeStore.getState().refresh();
    refreshReplayState();
  }, 100);
  if (import.meta.env.DEV) Object.assign(window, {
    __sim: sim, __baseSim: baseSim, __collision: collision,
    __sessionStore: useSessionStore, __worldStore: useWorldStore, __bridgeStore: useBridgeStore,
  });
  useRuntimeStore.setState((state) => ({ ready: true, status: "ready", generation: state.generation + 1 }));
  return () => {
    window.clearInterval(syncTimer);
    window.clearInterval(bridgeTimer);
    stopRuntime();
    unregister();
    unsubscribeTelemetry();
    unsubscribeBridge();
    unsubscribeActivity();
    setTargetCommittedHook(null);
    useSessionStore.getState().bindSim(null);
    useTargetStore.getState().bindModel(null);
    useSimulationStore.getState().bind(null);
    sim.dispose();
    runtime = null;
    useRuntimeStore.setState({ ready: false, status: "idle" });
  };
}
