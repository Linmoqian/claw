/** 桌面资源 IPC：大文件分块提交，失败保留调用方文件以便重试。
 * Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export type AssetBucket = "documents" | "videos" | "project-assets";
const CHUNK_BYTES = 512 * 1024;
const migrations = new Map<AssetBucket, Promise<void>>();

export const isDesktopStorage = isTauri;

export async function migrateDesktopBucket<T extends { id: string }>(
  bucket: AssetBucket,
  legacyList: () => Promise<T[]>,
  importLegacy: (record: T) => Promise<void>,
): Promise<void> {
  if (!isTauri()) return;
  const running = migrations.get(bucket);
  if (running) return running;
  const migration = (async () => {
    if (await invoke<boolean>("asset_migration_done", { bucket })) return;
    const existing = new Set((await listDesktopRecords<T>(bucket)).map((record) => record.id));
    for (const record of await legacyList()) {
      if (existing.has(record.id)) continue;
      await importLegacy(record);
    }
    // 标记在全部文件完成后写入；失败时旧 IndexedDB 保留且下次重试。
    await invoke("asset_mark_migrated", { bucket });
  })().catch((error: unknown) => {
    migrations.delete(bucket);
    throw error;
  });
  migrations.set(bucket, migration);
  return migration;
}

export async function listDesktopRecords<T>(bucket: AssetBucket): Promise<T[]> {
  return invoke<T[]>("asset_list", { bucket });
}

export async function saveDesktopLink(bucket: AssetBucket, record: object): Promise<void> {
  await invoke("asset_save_link", { bucket, record });
}

export async function uploadDesktopFile(bucket: AssetBucket, record: object, file: Blob): Promise<void> {
  const uploadId = await invoke<string>("asset_begin_upload", { bucket, record });
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
      await invoke("asset_upload_chunk", { uploadId, offset, bytes });
    }
    await invoke("asset_finish_upload", { uploadId });
  } catch (error) {
    await invoke("asset_abort_upload", { uploadId }).catch(() => undefined);
    throw error;
  }
}

export async function readDesktopFile(bucket: AssetBucket, id: string, mimeType: string): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; ; offset += CHUNK_BYTES) {
    const bytes = await invoke<number[]>("asset_read_chunk", { bucket, id, offset, limit: CHUNK_BYTES });
    chunks.push(Uint8Array.from(bytes).buffer);
    if (bytes.length < CHUNK_BYTES) break;
  }
  return new Blob(chunks, { type: mimeType });
}

export async function removeDesktopRecord(bucket: AssetBucket, id: string): Promise<void> {
  await invoke("asset_remove", { bucket, id });
}
