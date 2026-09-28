// 页面会话集成验证。Created on 2026-09-26
// @author: https://github.com/Linmoqian
import assert from "node:assert/strict";
import {
  createAiSessionStore,
  type AiSessionClient,
} from "../../../../app/src/stores/aiSessionStore";
import { useModelTrainingStore } from "../../../../app/src/stores/trainingSessionStore";
import { serialConnectionBlockedReason } from "../../../../app/src/lib/serialConnectionGuard";

function verifySerialConnectionGate(): void {
  const idle = {
    recordingLocked: false,
    replayPreparing: false,
    programRunning: false,
    serialTransition: false,
    channelTransition: false,
  };
  assert.equal(serialConnectionBlockedReason(idle, false), null);
  assert.match(serialConnectionBlockedReason(idle, true) ?? "", /退出回放/);
  assert.match(
    serialConnectionBlockedReason({ ...idle, replayPreparing: true }, false) ??
      "",
    /回放正在准备/,
  );
  assert.match(
    serialConnectionBlockedReason({ ...idle, programRunning: true }, false) ??
      "",
    /停止程序/,
  );
  assert.match(
    serialConnectionBlockedReason({ ...idle, recordingLocked: true }, false) ??
      "",
    /结束实验/,
  );
  for (const field of ["serialTransition", "channelTransition"] as const) {
    assert.match(
      serialConnectionBlockedReason({ ...idle, [field]: true }, false) ?? "",
      /等待当前连接操作完成/,
    );
  }
}

async function verifyAiSession(): Promise<void> {
  let configReads = 0;
  let starts = 0;
  let failClear = true;
  let failStop = true;
  let failChat = false;
  let finishChat: (value: string) => void = () => {
    throw new Error("聊天尚未开始");
  };
  const client: AiSessionClient = {
    isDesktop: () => true,
    getConfig: async () => {
      configReads += 1;
      return {
        provider: "openai-compatible",
        model: "fixture-model",
        baseUrl: "http://localhost/v1",
        apiKey: "",
        supportsVision: true,
        maxTokens: 128,
        modelPath: "",
        pythonPath: "",
      };
    },
    start: async () => {
      starts += 1;
    },
    stop: async () => {
      if (failStop) throw new Error("fixture-stop-error");
    },
    clear: async () => {
      if (failClear) throw new Error("fixture-clear-error");
    },
    chat: async () => {
      if (failChat) throw new Error("fixture-chat-error");
      return new Promise<string>((resolve) => {
        finishChat = resolve;
      });
    },
    selectImage: async () => "fixture.png",
  };
  const store = createAiSessionStore(client);
  await Promise.all([
    store.getState().initialize(),
    store.getState().initialize(),
  ]);
  await store.getState().initialize();
  assert.equal(configReads, 1, "配置在重挂载后不应重复加载");
  await Promise.all([store.getState().start(), store.getState().start()]);
  assert.equal(starts, 1, "同时点击启动不能建立重复会话");

  const unsubscribe = store.subscribe(() => undefined);
  store.getState().setPrompt("跨页问题");
  const pending = store.getState().submit();
  unsubscribe();
  assert.equal(store.getState().status, "busy");
  finishChat("跨页回答");
  await pending;
  const afterNavigation = store.getState();
  assert.equal(afterNavigation.messages.length, 2);
  assert.equal(afterNavigation.messages[1]?.text, "跨页回答");
  assert.equal(afterNavigation.status, "ready");

  store.getState().setImagePath("fixture.png");
  await store.getState().clear();
  assert.equal(store.getState().messages.length, 2, "清空失败必须保留原对话");
  assert.equal(store.getState().imagePath, "fixture.png");
  assert.match(store.getState().error ?? "", /对话已保留/);
  failClear = false;
  await store.getState().clear();
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().error, null);

  failChat = true;
  store.getState().setPrompt("失败后重试的问题");
  await store.getState().submit();
  assert.equal(store.getState().prompt, "失败后重试的问题");
  assert.equal(store.getState().sessionActive, true);
  await store.getState().stop();
  assert.equal(
    store.getState().sessionActive,
    true,
    "停止失败不能误报模型已停止",
  );
  store
    .getState()
    .setConfig((config) => ({ ...config, model: "cannot-switch" }));
  assert.equal(
    store.getState().config.model,
    "fixture-model",
    "活动会话出错也不能切换配置",
  );
  failStop = false;
  await store.getState().stop();
  store.getState().setConfig((config) => ({ ...config, model: "new-model" }));
  assert.equal(store.getState().config.model, "new-model");
  assert.equal(store.getState().status, "idle");

  const browserStore = createAiSessionStore({
    ...client,
    isDesktop: () => false,
  });
  await browserStore.getState().initialize();
  browserStore.getState().setPrompt("浏览器未发送草稿");
  const dispose = browserStore.subscribe(() => undefined);
  dispose();
  await browserStore.getState().initialize();
  assert.equal(browserStore.getState().prompt, "浏览器未发送草稿");
  assert.equal(configReads, 1, "浏览器初始化不调用桌面配置服务");
}

async function verifyTrainingSession(): Promise<void> {
  const state = useModelTrainingStore.getState();
  state.reset();
  state.updatePerception("samplesPerClass", 30);
  state.updatePerception("epochs", 4);
  const dispose = useModelTrainingStore.subscribe(() => undefined);
  const pending = useModelTrainingStore.getState().trainPerception();
  dispose();
  await pending;
  const afterNavigation = useModelTrainingStore.getState();
  assert.equal(afterNavigation.perceptionControls.samplesPerClass, 30);
  assert.equal(afterNavigation.running, null);
  assert.equal(afterNavigation.perceptionResult?.history.length, 4);
  assert.equal(
    afterNavigation.perceptionProvenance?.source,
    "内置合成数据 / 离线基线",
  );
  assert.match(afterNavigation.notice ?? "", /训练完成/);
  state.reset();
}

await verifyAiSession();
await verifyTrainingSession();
verifySerialConnectionGate();
console.log(
  "通过：会话跨订阅保留、单次初始化、操作互斥、AI 错误恢复、训练结果保留、串口连接门禁。",
);
