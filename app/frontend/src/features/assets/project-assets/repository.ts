/** 项目资产仓库边界：桌面分块存储与旧库迁移。Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { isDesktopStorage, listDesktopRecords, migrateDesktopBucket, readDesktopFile, removeDesktopRecord, saveDesktopLink, uploadDesktopFile } from "../desktopStorage";
import { assetRecordOf, indexedDbProjectAssetRepository, validateAssetFile, validateAssetPath } from "./indexedDbRepository";
import type { ProjectAssetKind, ProjectAssetRecord } from "./types";

const BUCKET = "project-assets";

async function migrate(): Promise<void> {
  await migrateDesktopBucket(BUCKET, indexedDbProjectAssetRepository.list, async (record) => {
    if (record.source === "path") await saveDesktopLink(BUCKET, record);
    else await uploadDesktopFile(BUCKET, record, await indexedDbProjectAssetRepository.file(record.id));
  });
}

export const projectAssetRepository = {
  async list(): Promise<ProjectAssetRecord[]> {
    if (!isDesktopStorage()) return indexedDbProjectAssetRepository.list();
    await migrate();
    return (await listDesktopRecords<ProjectAssetRecord>(BUCKET)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File, kind: ProjectAssetKind): Promise<ProjectAssetRecord> {
    if (!isDesktopStorage()) return indexedDbProjectAssetRepository.import(file, kind);
    await migrate();
    await validateAssetFile(file, kind);
    const record: ProjectAssetRecord = { ...assetRecordOf(file.name, kind, "copy"), sizeBytes: file.size };
    await uploadDesktopFile(BUCKET, record, file);
    return record;
  },

  async link(path: string, kind: ProjectAssetKind): Promise<ProjectAssetRecord> {
    if (!isDesktopStorage()) return indexedDbProjectAssetRepository.link(path, kind);
    await migrate();
    const { value, fileName } = validateAssetPath(path, kind);
    const record: ProjectAssetRecord = { ...assetRecordOf(fileName, kind, "path"), path: value };
    await saveDesktopLink(BUCKET, record);
    return record;
  },

  async file(id: string): Promise<Blob> {
    if (!isDesktopStorage()) return indexedDbProjectAssetRepository.file(id);
    await migrate();
    return readDesktopFile(BUCKET, id, "application/octet-stream");
  },

  async remove(id: string): Promise<void> {
    if (!isDesktopStorage()) return indexedDbProjectAssetRepository.remove(id);
    await migrate();
    await removeDesktopRecord(BUCKET, id);
  },
};
