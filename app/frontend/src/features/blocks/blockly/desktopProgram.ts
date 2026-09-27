// Rust 积木执行流与设备网关回执。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import { Channel, invoke } from "@tauri-apps/api/core";
import type * as Blockly from "blockly/core";
import { dispatchDesktopProgramAction } from "./desktopGateway";
import { ExecutionAborted, type LogKind } from "./interpreter";
import { createProgramAst } from "./programAst";
import type { BlockDeviceGateway } from "./types";

interface DesktopProgramEvent {
  version: number;
  runId: number;
  sequence: number;
  kind: "action" | "log" | "complete" | "stopped" | "error";
  requestId?: number;
  op?: string;
  args?: Record<string, unknown>;
  text?: string;
  logKind?: LogKind;
}

export async function executeDesktopProgram(
  workspace: Blockly.Workspace,
  gateway: BlockDeviceGateway,
  signal: AbortSignal,
  log: (message: string, kind?: LogKind) => void,
): Promise<void> {
  const ast = createProgramAst(workspace);
  const channel = new Channel<DesktopProgramEvent>();
  let runId: number | null = null;
  let lastSequence = 0;
  let settled = false;
  let resolveDone: () => void = () => undefined;
  let rejectDone: (reason: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", stop);
    if (error) rejectDone(error);
    else resolveDone();
  };
  const stop = () => {
    if (runId !== null) void invoke("program_stop", { runId }).catch(() => undefined);
  };
  signal.addEventListener("abort", stop, { once: true });
  channel.onmessage = (event) => {
    if (settled || event.version !== 1 || event.sequence <= lastSequence) return;
    if (runId !== null && event.runId !== runId) return;
    runId ??= event.runId;
    lastSequence = event.sequence;
    if (event.kind === "log") {
      if (event.text) log(event.text, event.logKind ?? "event");
      return;
    }
    if (event.kind === "action") {
      const { requestId, op, args } = event;
      if (requestId === undefined || !op) { finish(new Error("程序动作消息无效")); return; }
      void dispatchDesktopProgramAction(gateway, op, args ?? {})
        .then((result) => invoke("program_reply", {
          runId: event.runId, requestId, result: result ?? null, error: null,
        }))
        .catch((reason: unknown) => invoke("program_reply", {
          runId: event.runId, requestId, result: null, error: String(reason),
        }).catch(() => undefined));
      return;
    }
    if (event.kind === "complete") finish();
    else if (event.kind === "stopped") finish(new ExecutionAborted());
    else finish(new Error(event.text ?? "程序执行失败"));
  };
  try {
    runId = await invoke<number>("program_start", { ast, channel });
    if (signal.aborted) stop();
    await done;
  } catch (reason: unknown) {
    stop();
    finish(reason instanceof Error ? reason : new Error(String(reason)));
    await done;
  }
}
