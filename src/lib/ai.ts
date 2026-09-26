/**
 * 可替换模型供应商的视觉助手 Tauri command 封装。
 *
 * 模型进程由 Rust 后端常驻管理；前端只负责会话状态和用户交互。
 */

// Created on 2026-09-16; updated on 2026-09-17
// @author:  https://github.com/Linmoqian

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const isAiDesktop = isTauri;

export type AiProviderId = "zdtaichu" | "openai-compatible" | "llama-cpp";

export type AiProviderConfig = {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  supportsVision: boolean;
  maxTokens: number;
  modelPath: string;
  pythonPath: string;
};

export type AiChatResult = {
  answer: string;
};

export async function getAiConfig(): Promise<AiProviderConfig> {
  return invoke<AiProviderConfig>("ai_get_config");
}

export async function startAi(config: AiProviderConfig): Promise<void> {
  await invoke("ai_start", { config });
}

export async function chatWithAi(
  prompt: string,
  imagePath?: string,
): Promise<string> {
  const result = await invoke<AiChatResult>("ai_chat", {
    prompt,
    imagePath: imagePath ?? null,
  });
  return result.answer;
}

export async function clearAiConversation(): Promise<void> {
  await invoke("ai_clear");
}

export async function stopAi(): Promise<void> {
  await invoke("ai_stop");
}

export async function selectAiImage(): Promise<string | null> {
  if (!isAiDesktop()) {
    throw new Error("图片选择仅在 Tauri 桌面端可用");
  }
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "图片",
        extensions: ["png", "jpg", "jpeg", "webp"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}
