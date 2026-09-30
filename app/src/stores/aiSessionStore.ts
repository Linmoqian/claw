// Created on 2026-09-26; Updated on 2026-09-30
// @author: https://github.com/Linmoqian
// 应用内共享 AI 会话；消息与非密钥配置持久化到业务草稿，密钥与模型路径不落盘。
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
import { readDraft, writeDraft } from "../services/draftStorage";

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
        // 浏览器预览：草稿经 localStorage 恢复历史消息与非密钥配置
        set({
          initialized: true,
          config: applyAiDraft(get().config, aiDraft),
          messages: aiDraft?.messages ?? [],
        });
        return;
      }
      set({ configLoading: true });
      initialization = (async () => {
        try {
          // 环境变量配置为基底，草稿只覆盖用户可编辑的非密钥字段
          const config = applyAiDraft(await client.getConfig(), aiDraft);
          set({ config, messages: aiDraft?.messages ?? [] });
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

// ---- 会话持久化：消息与非密钥配置写入业务草稿，apiKey/modelPath/pythonPath 不落盘 ----

export interface AiSessionPersisted {
  config?: Partial<
    Pick<
      AiProviderConfig,
      "provider" | "model" | "baseUrl" | "supportsVision" | "maxTokens"
    >
  >;
  messages?: ChatMessage[];
}

export function projectAiDraft(state: AiSessionState): AiSessionPersisted {
  const { provider, model, baseUrl, supportsVision, maxTokens } = state.config;
  return {
    config: { provider, model, baseUrl, supportsVision, maxTokens },
    messages: state.messages,
  };
}

/** 水合合并：草稿仅覆盖存在的非密钥字段，密钥与模型路径保留运行时来源。 */
export function applyAiDraft(
  config: AiProviderConfig,
  draft: AiSessionPersisted | null,
): AiProviderConfig {
  if (!draft?.config) return config;
  const patch = draft.config;
  return {
    ...config,
    ...(patch.provider ? { provider: patch.provider } : {}),
    ...(typeof patch.model === "string" ? { model: patch.model } : {}),
    ...(typeof patch.baseUrl === "string" ? { baseUrl: patch.baseUrl } : {}),
    ...(typeof patch.supportsVision === "boolean"
      ? { supportsVision: patch.supportsVision }
      : {}),
    ...(typeof patch.maxTokens === "number" && Number.isFinite(patch.maxTokens)
      ? { maxTokens: patch.maxTokens }
      : {}),
  };
}

let aiHydrated = false;
let aiPersistTimer: number | null = null;
let aiDraft: AiSessionPersisted | null = null;

/** 启动时读取持久化草稿；需在 initialize 之前完成以避免配置覆盖。 */
export async function hydrateAiSession(): Promise<void> {
  aiHydrated = false;
  try {
    const raw = await readDraft("ai-session", "xiakao:ai-session:v1");
    if (raw) {
      const parsed = JSON.parse(raw) as AiSessionPersisted;
      aiDraft = {
        config: parsed.config ?? {},
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      };
    } else {
      aiDraft = null;
    }
  } catch {
    aiDraft = null; // 草稿损坏时忽略，保持运行时配置
  }
  aiHydrated = true;
}

if (typeof window !== "undefined") {
  // 水合完成前不写回；推理进行中（operation 非空）也不写，等终态再落盘
  useAiSessionStore.subscribe((state) => {
    if (!aiHydrated || state.operation) return;
    if (aiPersistTimer !== null) window.clearTimeout(aiPersistTimer);
    aiPersistTimer = window.setTimeout(() => {
      aiPersistTimer = null;
      void writeDraft(
        "ai-session",
        "xiakao:ai-session:v1",
        JSON.stringify(projectAiDraft(useAiSessionStore.getState())),
      ).catch(() => undefined);
    }, 500);
  });
}
