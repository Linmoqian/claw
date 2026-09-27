/** 桌面实验仓库委托 Rust；首次读取逐块迁入旧 IndexedDB，原数据保留。
 * Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { indexedDbExperimentRepository } from "./indexedDbRepository";
import type { ExperimentBundle, ExperimentRecord, ExperimentSample, ExperimentSnapshot } from "./types";

let migration: Promise<void> | null = null;

async function migrateOnce(): Promise<void> {
  if (!isTauri()) return;
  if (migration) return migration;
  migration = (async () => {
    const records = await indexedDbExperimentRepository.list();
    for (const record of records) {
      const backup = await indexedDbExperimentRepository.get(record.id);
      if (!backup) throw new Error(`旧实验「${record.name}」缺少快照，原数据已保留`);
      const existing = await invoke<ExperimentBundle | null>("experiment_get", { id: record.id });
      if (existing && existing.samples.length >= backup.samples.length) continue;
      // 相同 offset 重试会替换该块；中途失败时下次启动可从原 IndexedDB 再次迁入。
      if (backup.samples.length === 0) {
        await invoke("experiment_write", { record, snapshot: backup.snapshot, samples: [], offset: 0 });
      } else {
        for (let offset = 0; offset < backup.samples.length; offset += 500) {
          await invoke("experiment_write", {
            record,
            snapshot: backup.snapshot,
            samples: backup.samples.slice(offset, offset + 500),
            offset,
          });
        }
      }
    }
  })().catch((error: unknown) => {
    migration = null;
    throw error;
  });
  return migration;
}

export const experimentRepository = {
  async list(): Promise<ExperimentRecord[]> {
    if (!isTauri()) return indexedDbExperimentRepository.list();
    await migrateOnce();
    return invoke<ExperimentRecord[]>("experiment_list");
  },

  async write(record: ExperimentRecord, snapshot: ExperimentSnapshot, samples: ExperimentSample[], offset: number): Promise<void> {
    if (!isTauri()) return indexedDbExperimentRepository.write(record, snapshot, samples, offset);
    await migrateOnce();
    await invoke("experiment_write", { record, snapshot, samples, offset });
  },

  async get(id: string): Promise<ExperimentBundle | null> {
    if (!isTauri()) return indexedDbExperimentRepository.get(id);
    await migrateOnce();
    return invoke<ExperimentBundle | null>("experiment_get", { id });
  },

  async updateRecord(record: ExperimentRecord): Promise<void> {
    if (!isTauri()) return indexedDbExperimentRepository.updateRecord(record);
    await migrateOnce();
    await invoke("experiment_update_record", { record });
  },
};
