// Created on 2026-09-26
// @author: https://github.com/Linmoqian
// 应用内共享 AI 会话；配置、密钥、图片路径和消息只保存在内存。
import { create } from "zustand";
import {
  chatWithAi,
  clearAiConversation,
  getAiConfig,
  isAiDesktop,
  selectAiImage,
  startAi,
  stopAi,
  type AiProviderConfig,
} from "../lib/ai";

export type AssistantStatus = "idle" | "loading" | "ready" | "busy" | "error";
type AssistantOperation = "start" | "chat" | "clear" | "stop" | "image" | null;
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageName?: string;
}

export interface AiSessionClient {
  isDesktop: () => boolean;
  getConfig: () => Promise<AiProviderConfig>;
  start: (config: AiProviderConfig) => Promise<void>;
  stop: () => Promise<void>;
  chat: (prompt: string, imagePath?: string) => Promise<string>;
  clear: () => Promise<void>;
  selectImage: () => Promise<string | null>;
}

interface AiSessionState {
  initialized: boolean;
  configLoading: boolean;
  sessionActive: boolean;
  operation: AssistantOperation;
  status: AssistantStatus;
  config: AiProviderConfig;
  messages: ChatMessage[];
  prompt: string;
  imagePath: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  setConfig: (update: (config: AiProviderConfig) => AiProviderConfig) => void;
  setPrompt: (prompt: string) => void;
  setImagePath: (path: string | null) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  submit: () => Promise<void>;
  pickImage: () => Promise<void>;
}

const FALLBACK_CONFIG: AiProviderConfig = {
  provider: "zdtaichu",
  model: "ZDTaichu5.0-9B",
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  supportsVision: true,
  maxTokens: 128,
  modelPath: "",
  pythonPath: "",
};

const defaultClient: AiSessionClient = {
  isDesktop: isAiDesktop,
  getConfig: getAiConfig,
  start: startAi,
  stop: stopAi,
  chat: chatWithAi,
  clear: clearAiConversation,
  selectImage: selectAiImage,
};

const messageId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createAiSessionStore(client: AiSessionClient = defaultClient) {
  let initialization: Promise<void> | null = null;
  return create<AiSessionState>((set, get) => ({
    initialized: false,
    configLoading: false,
    sessionActive: false,
    operation: null,
    status: "idle",
    config: { ...FALLBACK_CONFIG },
    messages: [],
    prompt: "",
    imagePath: null,
    error: null,
    initialize: async () => {
      if (get().initialized) return;
      if (initialization) return initialization;
      if (!client.isDesktop()) {
        set({ initialized: true });
        return;
      }
      set({ configLoading: true });
      initialization = (async () => {
        try {
          set({ config: await client.getConfig() });
        } catch (reason) {
          set({
            error: `读取模型配置失败：${String(reason)}。可手动填写后启动。`,
          });
        } finally {
          set({ initialized: true, configLoading: false });
        }
      })();
      return initialization;
    },
    setConfig: (update) => {
      if (get().sessionActive || get().operation || get().configLoading) return;
      set({ config: update(get().config) });
    },
    setPrompt: (prompt) => set({ prompt }),
    setImagePath: (imagePath) => set({ imagePath }),
    start: async () => {
      await get().initialize();
      const state = get();
      if (state.sessionActive || state.operation || state.configLoading) return;
      if (!client.isDesktop()) {
        set({ error: "视觉助手需要在桌面应用中启动模型。" });
        return;
      }
      set({ operation: "start", status: "loading", error: null });
      try {
        await client.start({ ...state.config });
        set({ sessionActive: true, status: "ready" });
      } catch (reason) {
        set({ status: "error", error: String(reason) });
      } finally {
        set({ operation: null });
      }
    },
    stop: async () => {
      if (get().operation || !get().sessionActive) return;
      set({ operation: "stop", error: null });
      try {
        await client.stop();
        set({ sessionActive: false, status: "idle" });
      } catch (reason) {
        set({
          status: "error",
          error: `停止失败：${String(reason)}。请重试停止当前会话。`,
        });
      } finally {
        set({ operation: null });
      }
    },
    clear: async () => {
      if (get().operation) return;
      set({ operation: "clear", error: null });
      try {
        if (get().sessionActive) await client.clear();
        set({
          messages: [],
          imagePath: null,
          status: get().sessionActive ? "ready" : "idle",
        });
      } catch (reason) {
        // 后端未确认清空时保留前端消息，允许用户重试。
        set({ error: `清空失败：${String(reason)}。对话已保留，可重试。` });
      } finally {
        set({ operation: null });
      }
    },
    submit: async () => {
      const state = get();
      const prompt = state.prompt.trim();
      if (!prompt || !state.sessionActive || state.operation) return;
      if (state.imagePath && !state.config.supportsVision) {
        set({
          error: "当前供应商未启用图片输入，请移除图片或停止会话后修改配置。",
        });
        return;
      }
      const pendingImage = state.imagePath;
      set({
        messages: [
          ...state.messages,
          {
            id: messageId(),
            role: "user",
            text: prompt,
            imageName: pendingImage?.split(/[\\/]/).pop(),
          },
        ],
        prompt: "",
        imagePath: null,
        operation: "chat",
        status: "busy",
        error: null,
      });
      try {
        const answer = await client.chat(prompt, pendingImage ?? undefined);
        set((current) => ({
          messages: [
            ...current.messages,
            { id: messageId(), role: "assistant", text: answer },
          ],
          status: "ready",
        }));
      } catch (reason) {
        set({
          status: "error",
          error: `推理失败：${String(reason)}。可重新发送，或停止并重启会话。`,
          prompt,
          imagePath: pendingImage,
        });
      } finally {
        set({ operation: null });
      }
    },
    pickImage: async () => {
      if (get().operation || !get().sessionActive) return;
      if (!get().config.supportsVision) {
        set({ error: "当前供应商未启用图片输入，请停止会话后修改配置。" });
        return;
      }
      set({ operation: "image", error: null });
      try {
        const imagePath = await client.selectImage();
        if (imagePath) set({ imagePath });
      } catch (reason) {
        set({ error: String(reason) });
      } finally {
        set({ operation: null });
      }
    },
  }));
}

export const useAiSessionStore = createAiSessionStore();
