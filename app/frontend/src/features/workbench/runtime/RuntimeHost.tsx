// 工作台唯一画布宿主，路由只改变其位置。Created on 2026-09-26
// @author: https://github.com/Linmoqian
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useDevice } from "../../../store/DeviceContext";
import { DEFAULT_ROBOT_ID, useReadyModel, useRobotStore } from "../../../stores/robotStore";
import { useBridgeStore } from "../../../stores/bridgeStore";
import RobotStage from "../../../three/RobotStage";
import { useActivityStore } from "./activity";
import { cancelRuntimePreview, getRuntime, mountRuntime, useRuntimeStore } from "./runtime";
import { useProgramStore } from "./programRunner";
import { useMotorDebugStore } from "../../devices/motor-debug/session";
import "./RuntimeHost.css";

export default function RuntimeHost() {
  const { pathname } = useLocation();
  const { connected, estop, connectingPort, disconnecting } = useDevice();
  const model = useReadyModel();
  const status = useRobotStore((state) => state.status);
  const assetBase = useRobotStore((state) => state.assetBase);
  const runtime = useRuntimeStore((state) => state.ready ? getRuntime() : null);
  const eyeInHand = useRuntimeStore((state) => state.eyeInHand);
  const recording = useActivityStore((state) => state.recordingLocked);
  const running = useProgramStore((state) => state.status === "running");
  const replay = useBridgeStore((state) => state.replay !== null);
  const debugConnected = useMotorDebugStore((state) => state.port !== null);
  const debugTransitioning = useMotorDebugStore((state) => state.transitioning);
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraFeedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "idle") void useRobotStore.getState().loadRobot(DEFAULT_ROBOT_ID);
  }, [status]);

  useEffect(() => model ? mountRuntime(model) : undefined, [model]);

  useLayoutEffect(() => {
    useActivityStore.setState({
      hardwareConnected: connected || debugConnected,
      serialConnected: connected || debugConnected,
      hardwareEstop: estop,
      serialTransition: connectingPort !== null || disconnecting || debugTransitioning,
    });
  }, [connected, estop, connectingPort, disconnecting, debugConnected, debugTransitioning]);

  useEffect(() => {
    cancelRuntimePreview();
  }, [pathname]);

  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const host = hostRef.current;
      const slot = document.querySelector<HTMLElement>("[data-runtime-slot]");
      const rect = slot?.getBoundingClientRect();
      if (host) {
        const docked = !!rect && rect.width > 0 && rect.height > 0;
        const visible = docked || recording || running || replay;
        host.dataset.docked = String(docked);
        host.dataset.visible = String(visible);
        const left = docked ? rect.left : visible ? Math.max(12, window.innerWidth - 342) : -10000;
        const top = docked ? rect.top : Math.max(90, window.innerHeight - 290);
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.width = `${docked ? rect.width : 320}px`;
        host.style.height = `${docked ? rect.height : 220}px`;
        host.style.visibility = visible ? "visible" : "hidden";
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [pathname, recording, running, replay]);

  return (
    <div ref={hostRef} className="runtime-host" aria-label="常驻实验场景">
      {runtime && model && <RobotStage
        model={runtime.model}
        sim={runtime.sim}
        baseSim={runtime.baseSim}
        assetBase={assetBase}
        cameraFeedRef={cameraFeedRef}
        eyeInHand={eyeInHand}
      />}
      <div className="runtime-host__mini-head">
        <span>{replay ? "实验回放" : "实验持续运行中"}</span>
        <Link to="/studio">返回场景</Link>
      </div>
      <div ref={cameraFeedRef} className="runtime-host__camera" aria-label="仿真相机">
        <span>{eyeInHand ? "眼在手相机" : "仿真相机"}</span>
      </div>
    </div>
  );
}
