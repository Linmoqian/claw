// 业务草稿落盘与可重试的浏览器备份迁移。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import { invoke, isTauri } from "@tauri-apps/api/core";

export type DraftKey = "block-console" | "datasets" | "tool-profiles" | "active-tool";

const pending = new Map<DraftKey, Promise<void>>();

/** 首次桌面读取把原始字符串复制到 Rust；即使 JSON 损坏也保留原内容。 */
export async function readDraft(key: DraftKey, legacyKey: string): Promise<string | null> {
  if (!isTauri()) return window.localStorage.getItem(legacyKey);
  await pending.get(key)?.catch(() => undefined);
  const current = await invoke<string | null>("draft_read", { key });
  if (current !== null) return current;
  const backup = window.localStorage.getItem(legacyKey);
  if (backup !== null) {
    await writeDraft(key, legacyKey, backup);
  }
  return backup;
}

/** 桌面只更新 Rust 草稿；原 localStorage 永远保留作迁移备份。 */
export function writeDraft(key: DraftKey, legacyKey: string, value: string): Promise<void> {
  if (!isTauri()) {
    window.localStorage.setItem(legacyKey, value);
    return Promise.resolve();
  }
  const next = (pending.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => invoke<void>("draft_write", { key, value }));
  pending.set(key, next);
  return next;
}
